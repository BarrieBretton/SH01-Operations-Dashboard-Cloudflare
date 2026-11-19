// All provider hosts and all writable values come from reviewed repository configuration.
async function cfgFetch(url, headers={}, options={}) {
 const response = await fetch(url, {...options, headers, redirect: 'manual', signal: AbortSignal.timeout(12000)});
 if (response.status >= 300 && response.status < 400) {
  try { await response.body?.cancel(); } catch {}
  throw Error('Upstream redirect rejected (HTTP ' + response.status + ')');
 }
 return response;
}
async function cfgJSON(url,h) {
 const r=await cfgFetch(url,h);
 if(!r.ok)throw Error('HTTP '+r.status);
 return r.json();
}
async function cfgOverview(env) {
 const root='https://infra-control.vivojaymail.workers.dev';
 const h={'X-API-KEY':env.CONTROL_PLANE_API_KEY};
 const get=(p)=>cfgJSON(root+'/infra/'+p,h);
 const safe=async fn=>{try{return await fn()}catch(e){return {error:e.message}}};
 const status=await safe(async()=>{
  const r=await cfgFetch(root+'/infra/status',h);
  if(!r.ok)throw Error('HTTP '+r.status);
  const s=await r.json();
  return {active:s.active,available:s.available,master:r.headers.get('x-backend-used')};
 });
 const roles=['sh01','n8n'];
 const routers=await Promise.all(roles.map(async role=>({role,...await safe(async()=>{
  const probe=role==='sh01'?'https://sh01.vivojaymail.workers.dev/':'https://n8n-prod-1.vivojaymail.workers.dev/healthz/readiness';
  const [s,p]=await Promise.all([get('router/'+role+'/status'),cfgFetch(probe)]);
  await p.body?.cancel();
  return {maintenance:s.maintenance,preferred:s.preferred,first:s.effective_order?.[0],http:p.status,answered:p.headers.get('x-backend-used')};
 })})));
 const services=[];
 for(const slot of status.available?.render||[]) {
  services.push(...await Promise.all(roles.map(async role=>({slot,role,...await safe(async()=>{
   const s=await get('render/'+encodeURIComponent(slot)+'/'+role+'/status');
   return {state:s.suspended,suspenders:s.raw?.suspenders,workspace:s.raw?.ownerId,url:s.raw?.serviceDetails?.url};
  })}))));
 }
 const watchdog=await safe(async()=>{
  if(!env.INFRA_CF_ACCOUNT_ID||!env.INFRA_CF_TOKEN)throw Error('Cloudflare management bindings missing');
  const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(env.INFRA_CF_ACCOUNT_ID)+'/workers/scripts/infra-sla-watchdog/schedules';
  const d=await cfgJSON(url,{Authorization:'Bearer '+env.INFRA_CF_TOKEN});
  return (d.result.schedules||d.result).map(item=>item.cron);
 });
 return {status,routers,services,watchdog,inventory:CFG_INVENTORY};
}
async function cfgRoute(req,env,path) {
 const reply=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 if(path==='/config'&&req.method==='GET')return reply(await cfgOverview(env));
 if(path!=='/config/change'||req.method!=='POST')return reply({error:'unknown_operation'},404);
 if(!env.INFRA_CONFIG_ADMIN_KEY||!await authorized(req.headers.get('X-Infra-Admin'),env.INFRA_CONFIG_ADMIN_KEY))return reply({error:'configuration_admin_key_required'},403);
 try{
  const {target,key,action,expected}=await req.json();
  const node=Object.hasOwn(CFG_INVENTORY.nodes,target)?CFG_INVENTORY.nodes[target]:null;
  const worker=Object.hasOwn(CFG_INVENTORY.workers,target)?CFG_INVENTORY.workers[target]:null;
  const spec=node||worker;
  const secretRef=node&&Object.hasOwn(node.secrets||{},key)?node.secrets[key]:null;
  if(!spec||(!Object.hasOwn(spec.vars,key)&&!secretRef)||!['preview','apply'].includes(action))return reply({error:'unknown_target_or_setting'},400);
  const desired=secretRef?env[secretRef]:spec.vars[key];
  if(secretRef&&!desired)throw Error('Missing secret binding '+secretRef);
  let read,write;
  if(node){
   const id=node.id||env['INFRA_SERVICE_ID_'+target.toUpperCase()];
   if(!id||!/^srv-[a-z0-9]+$/.test(id)||!env[node.key])throw Error('Missing service ID or Render workspace key for '+target);
   const base='https://api.render.com/v1/services/'+id;
   const h={Authorization:'Bearer '+env[node.key]};
   const s=await cfgJSON(base,h);
   if(s.serviceDetails?.url!==node.url)throw Error('Render service URL differs from inventory. Verify target before editing.');
   const url=base+'/env-vars/'+encodeURIComponent(key);
   read=async()=>{const r=await cfgFetch(url,h);if(r.status===404)return null;if(!r.ok)throw Error('Render read HTTP '+r.status);const d=await r.json();const v=d.value??d.envVar?.value;if(typeof v!=='string')throw Error('Unexpected Render response');return v};
   write=()=>cfgFetch(url,{...h,'Content-Type':'application/json'},{method:'PUT',body:JSON.stringify({value:desired})});
  }else{
   if(!env.INFRA_CF_ACCOUNT_ID||!env.INFRA_CF_TOKEN)throw Error('Cloudflare management bindings missing');
   const url='https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(env.INFRA_CF_ACCOUNT_ID)+'/workers/scripts/'+encodeURIComponent(target)+'/settings';
   const h={Authorization:'Bearer '+env.INFRA_CF_TOKEN};
   let bindings;
   read=async()=>{const d=await cfgJSON(url,h);bindings=d.result?.bindings;if(!Array.isArray(bindings))throw Error('Cloudflare bindings unavailable');const b=bindings.find(x=>x.name===key);if(b&&b.type!=='plain_text')throw Error('Target binding is not plain text');return b?b.text:null};
   write=()=>{const f=new FormData();f.set('settings',JSON.stringify({bindings:[...bindings.filter(b=>b.name!==key).map(b=>({name:b.name,type:'inherit'})),{name:key,type:'plain_text',text:desired}]}));return cfgFetch(url,h,{method:'PATCH',body:f})};
  }
  const current=await read();
  if(key==='BACKENDS'&&current&&current.split(',').some(v=>!desired.split(',').includes(v.trim())))throw Error('Inventory omits a configured backend. Review Git inventory first.');
  if(key==='INFRA_REGISTRY_JSON'&&current){
   const hasExtra=(old,next)=>old&&typeof old==='object'&&Object.keys(old).some(k=>!next||!Object.hasOwn(next,k)||hasExtra(old[k],next[k]));
   if(hasExtra(JSON.parse(current),JSON.parse(desired)))throw Error('Inventory omits existing registry fields. Review Git inventory first.');
  }
  // Current provider values may contain sensitive data even in a normally public setting.
  const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([target,key,current,desired])))),x=>x.toString(16).padStart(2,'0')).join('');
  if(action==='preview')return reply({expected:digest,state:current===null?'absent':current===desired?'matches':'different'});
  if(expected!==digest)return reply({error:'setting_changed_preview_again'},409);
  if(current!==desired){const r=await write();if(!r.ok)throw Error('Provider update HTTP '+r.status)}
  if(await read()!==desired)throw Error('Provider read-back differs. Preview again.');
  return reply({verified:true});
 }catch(e){return reply({error:e.message||'Provider request failed'},502)}
}
