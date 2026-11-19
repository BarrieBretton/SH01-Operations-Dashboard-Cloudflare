// Same-origin, authenticated allowlist bridge. Never forward arbitrary paths or URLs.
function infraBase(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||u.pathname!=='/')throw Error('infra_invalid_origin');return u.origin;}
async function infraDeskApi(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(p.startsWith('/api/infra/control/config'))return cfgRoute(req,env,p.slice('/api/infra/control'.length));
 const runtime=p.startsWith('/api/infra/runtime/');
 const path=runtime?p.slice('/api/infra/runtime'.length):p.slice('/api/infra/control'.length);
 if(!runtime&&path==='/b2/automation'&&['GET','POST'].includes(req.method)){
  try{return json(await cleanupRemote(env,false,'/infra/desk/b2/automation'+(req.method==='GET'?'?slot='+encodeURIComponent(u.searchParams.get('slot')||''):''),req.method==='POST'?await body(req):undefined));}catch(e){return error(e.message,503);}
 }
 // Classification is read-only. Do not forward deletion operations in this release.
 if(!runtime&&['/b2/preview','/b2/delete'].includes(path))return error('b2_deletion_disabled_reference_review_only',409);
 if(!runtime&&(path==='/b2/workbook'&&req.method==='GET'||path==='/b2/reference-scan'&&req.method==='POST'))return b2ReferenceApi(req,env,path);
 const reads=['/inventory','/check','/b2/files'],writes=['/b2/preview','/b2/delete'];
 if((runtime&&!['/inventory','/check'].includes(path))||!(req.method==='GET'&&reads.includes(path)||req.method==='POST'&&!runtime&&writes.includes(path)))return error('infra_route_not_allowed',404);
 const key=runtime?env.MEDIA_CLIP_API_KEY:env.CONTROL_PLANE_API_KEY;
 const base=runtime?(env.OPS_INFRA_MEDIA_URL||'https://sh01.vivojaymail.workers.dev'):(env.OPS_INFRA_CONTROL_URL||'https://infra-control.vivojaymail.workers.dev');
 if(!key)return error(runtime?'infra_media_key_not_configured':'infra_control_key_not_configured',503);
 const query=new URLSearchParams();for(const name of path==='/check'?['component']:path==='/b2/files'?['slot','cursor']:[])if(u.searchParams.has(name))query.set(name,u.searchParams.get(name));
 let payload;
 if(req.method==='POST'){
  const source=await body(req);
  if(path==='/b2/preview'){
   if(typeof source.slot!=='string'||!Array.isArray(source.tickets)||source.tickets.length<1||source.tickets.length>10||source.tickets.some(t=>typeof t!=='string'||t.length>12000))return error('infra_invalid_selection',400);
   payload={slot:source.slot,tickets:source.tickets};
  }else{
   if(typeof source.slot!=='string'||typeof source.plan!=='string'||source.plan.length>50000||typeof source.confirmation!=='string')return error('infra_invalid_confirmation',400);
   payload={slot:source.slot,plan:source.plan,confirmation:source.confirmation};
  }
 }
 const started=Date.now();let stage='validate_origin';
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),path==='/b2/delete'?65000:30000);
 try{
  const origin=infraBase(base);stage='fetch';
  const r=await fetch(origin+(runtime?'/ops/infra':'/infra/desk')+path+(query.size?'?'+query:''),{method:req.method,headers:{'X-API-KEY':key,...(payload?{'Content-Type':'application/json'}:{})},...(payload?{body:JSON.stringify(payload)}:{}),redirect:'manual',signal:controller.signal});
  if(r.status>=300&&r.status<400){try{await r.body?.cancel()}catch{}return error('infra_upstream_redirect_rejected',502);}
  if(!r.ok){let d;try{d=await r.json()}catch{}const code=typeof d?.detail==='string'&&/^[a-z][a-z0-9_]{2,100}$/.test(d.detail)?d.detail:'infra_upstream_http_'+r.status;return error(code,r.status===401||r.status===403?502:r.status);}
  stage='parse_response';return json(await r.json());
 }catch(e){
  const message=String(e?.message||''),blocked=/\b1042\b|same account|same zone/i.test(message);
  const reason=stage==='validate_origin'?'invalid_origin':controller.signal.aborted?'timeout':stage==='parse_response'?'invalid_json':blocked?'worker_fetch_blocked':'fetch_exception';
  return json({error:path==='/b2/delete'?'infra_delete_outcome_unknown_refresh_files':'infra_'+reason,
   diagnostic:{revision:'infra-bridge-2',stage,reason,elapsed_ms:Date.now()-started,
    exception:['TypeError','SyntaxError','AbortError','Error'].includes(e?.name)?e.name:'Other'}},502);
 }
 finally{clearTimeout(timer);}
}
