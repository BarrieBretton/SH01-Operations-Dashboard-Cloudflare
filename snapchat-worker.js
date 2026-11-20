// Only fixed Snapchat backend routes are exposed; provider credentials stay server-side.
async function snapchatRemote(raw,path,method='GET',payload){
 if(!raw.MEDIA_CLIP_API_KEY)throw Error('snapchat_media_key_not_configured');
 const base=infraBase(raw.OPS_INFRA_MEDIA_URL||'https://sh01.vivojaymail.workers.dev');
 const c=new AbortController(),timer=setTimeout(()=>c.abort(),25000);
 try{
  const r=await fetch(base+'/snapchat'+path,{method,headers:{'X-API-KEY':raw.MEDIA_CLIP_API_KEY,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:JSON.stringify(payload||{})}:{}),redirect:'manual',signal:c.signal});
  if(r.status>=300&&r.status<400)throw Error('snapchat_upstream_redirect_rejected');
  let d;try{d=await r.json()}catch{throw Error('snapchat_upstream_non_json_http_'+r.status)}
  if(!r.ok)throw Error(typeof d?.detail==='string'&&/^[a-z][a-z0-9_]{1,100}$/.test(d.detail)?d.detail:'snapchat_upstream_http_'+r.status);
  return d;
 }finally{clearTimeout(timer)}
}
async function snapchatDeskApi(req,raw){
 const url=new URL(req.url),path=url.pathname.slice('/api/snapchat'.length);
 const get=['/health','/metrics'].includes(path)||/^\/jobs\/[a-f0-9]{40}$/.test(path);
 const post=['/setup','/connect','/connection/check','/preview','/run','/metrics/refresh'].includes(path);
 if(url.search||!(req.method==='GET'&&get||req.method==='POST'&&post))return error('snapchat_route_not_allowed',404);
 let payload={};
 if(req.method==='POST'){
  const d=await body(req);
  if(path==='/run'){
   if(!d||typeof d.item_id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(d.item_id)||!/^[a-f0-9]{64}$/.test(d.fingerprint||''))return error('snapchat_invalid_selection',400);
   payload={item_id:d.item_id,fingerprint:d.fingerprint};
  }
 }
 try{return json(await snapchatRemote(raw,path,req.method,payload));}
 catch(e){return error(/^[a-z][a-z0-9_]{1,100}$/.test(e.message||'')?e.message:'snapchat_bridge_unavailable',503);}
}
async function snapchatScheduled(raw){
 if(raw.SNAPCHAT_TICK_ENABLED!=='1')return;
 try{await snapchatRemote(raw,'/tick','POST',{})}catch{console.log('snapchat_scheduled_tick_unavailable')}
}
