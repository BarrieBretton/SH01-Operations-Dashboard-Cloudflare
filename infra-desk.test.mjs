import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';
const env={DASHBOARD_TOKEN:'dashboard-fixture',CONTROL_PLANE_API_KEY:'control-fixture',MEDIA_CLIP_API_KEY:'media-fixture'};
function req(path,method='GET',body,token='dashboard-fixture'){return new Request('https://desk.test'+path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
test('infrastructure authenticates before provider calls even before Sheets migration',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({rows:[]})};
 try{assert.equal((await worker.fetch(req('/api/infra/control/inventory','GET',null,'wrong'),env,{})).status,401);assert.equal(calls,0);assert.equal((await worker.fetch(req('/api/infra/control/inventory'),env,{})).status,200);assert.equal(calls,1);}finally{globalThis.fetch=old;}
});
test('bridge uses distinct keys, fixed routes and suppresses redirects',async()=>{
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(u,o)=>{calls.push([u,o]);return Response.json({rows:[]})};
 try{
  await worker.fetch(req('/api/infra/control/inventory?url=https://evil.test'),env,{});
  await worker.fetch(req('/api/infra/runtime/inventory'),env,{});
  assert.equal(calls[0][0],'https://infra-control.vivojaymail.workers.dev/infra/desk/inventory');
  assert.equal(calls[0][1].headers['X-API-KEY'],'control-fixture');assert.equal(calls[1][1].headers['X-API-KEY'],'media-fixture');assert.equal(calls[0][1].redirect,'manual');
  for(const path of ['/api/infra/control/select/render','/api/infra/runtime/b2/delete','/api/infra/control/registry','/api/infra/evil/inventory'])assert.equal((await worker.fetch(req(path,'POST',{}),env,{})).status,404);
  assert.equal(calls.length,2);
 }finally{globalThis.fetch=old;}
});
test('missing control key is explicit and does not fall back to media key',async()=>{
 assert.equal((await worker.fetch(req('/api/infra/control/inventory'),{...env,CONTROL_PLANE_API_KEY:''},{})).status,503);
});
test('reference review release blocks preview/delete with zero upstream calls',async()=>{
 const old=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error('no deletion permitted')};
 try{for(const path of ['preview','delete']){const r=await worker.fetch(req('/api/infra/control/b2/'+path,'POST',{slot:'b2-a',plan:'signed',confirmation:'DELETE 1'}),env,{});assert.equal(r.status,409);assert.equal((await r.json()).error,'b2_deletion_disabled_reference_review_only');}assert.equal(calls,0);}finally{globalThis.fetch=old;}
});
test('provider errors are sanitized and upstream credential errors do not lock dashboard session',async()=>{
 const old=globalThis.fetch;globalThis.fetch=async()=>Response.json({detail:'secret-bearing upstream error'},{status:401});
 try{const r=await worker.fetch(req('/api/infra/control/inventory'),env,{});assert.equal(r.status,502);assert.equal((await r.json()).error,'infra_upstream_http_401');}finally{globalThis.fetch=old;}
});

test('bridge diagnoses failures without exposing URLs, credentials or raw exceptions',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{
  for(const [mode,expected] of [['origin','invalid_origin'],['blocked','worker_fetch_blocked'],['json','invalid_json'],['network','fetch_exception']]){
   globalThis.fetch=async()=>{calls++;if(mode==='json')return new Response('secret response');throw Error(mode==='blocked'?'Error 1042 secret credential':'secret credential');};
   const response=await worker.fetch(req('/api/infra/control/inventory'),{...env,...(mode==='origin'?{OPS_INFRA_CONTROL_URL:'https://secret:credential@example.test'}:{})},{});
   assert.equal(response.status,502);const data=await response.json();
   assert.equal(data.error,'infra_'+expected);assert.equal(data.diagnostic.revision,'infra-bridge-2');
   assert.ok(!JSON.stringify(data).includes('secret'));assert.ok(!JSON.stringify(data).includes('credential'));
  }
  assert.equal(calls,3);
 }finally{globalThis.fetch=old;}
});

test('Cloudflare-compatible redirect mode works and never follows upstream redirects',async()=>{
 const old=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async(u,o)=>{
   calls++;
   if(o.redirect==='error')throw new TypeError('Unsupported redirect mode');
   assert.equal(o.redirect,'manual');
   return Response.json({rows:[],scope:'control_plane_registry'});
  };
  assert.equal((await worker.fetch(req('/api/infra/control/inventory'),env,{})).status,200);
  for(const status of [301,302,303,307,308]){
   calls=0;globalThis.fetch=async(u,o)=>{
    calls++;assert.equal(o.redirect,'manual');
    return new Response('redirect body',{status,headers:{Location:'https://other.test/secret-target'}});
   };
   for(const [path,method,payload] of [['/api/infra/control/inventory','GET',null]]){
    const before=calls;
    const r=await worker.fetch(req(path,method,payload),env,{});
    assert.equal(r.status,502);assert.deepEqual(await r.json(),{error:'infra_upstream_redirect_rejected'});
    assert.equal(calls,before+1);
   }
  }
 }finally{globalThis.fetch=old;}
});
