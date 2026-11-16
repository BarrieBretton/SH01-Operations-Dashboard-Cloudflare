import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('./worker-runtime.js',import.meta.url),'utf8').replace('export default {','globalThis.worker = {');
function runtime(failure){
 const logs=[];const context={URL,Response,Request,TextEncoder,crypto:webcrypto,console:{log:x=>logs.push(x)},storageEnv:x=>x,contentApi:async()=>{throw failure;}};
 vm.createContext(context);vm.runInContext(source,context);
 return {logs,context,call:()=>context.worker.fetch(new Request('https://desk.test/api/content/groups',{headers:{Authorization:'Bearer fixture'}}),{DASHBOARD_TOKEN:'fixture',SHEETS_STORAGE_READY:'1'},{} )};
}
test('unexpected content errors become sanitized 500 JSON with matching reference, never a misleading 400',async()=>{
 const h=runtime(new TypeError('private credentials and HTML <body>'));const response=await h.call();const body=await response.json();
 assert.equal(response.status,500);assert.equal(body.error,'server_type_error');assert.equal(response.headers.get('X-Ops-Request-ID'),body.request_id);
 const log=JSON.parse(h.logs[0]);assert.equal(log.request_id,body.request_id);assert.equal(log.path,'/api/content/groups');assert.doesNotMatch(JSON.stringify([body,h.logs]),/private|credentials|<body>/);
});
test('storage quota errors retain 503 and retry-after while validation remains 400',async()=>{
 for(const [error,status] of [[Object.assign(Error('store_rate_limited'),{retryAfter:100}),503],[Error('confirmation_mismatch'),400]]){
  const h=runtime(error);const r=await h.call();assert.equal(r.status,status);
  if(status===503)assert.equal(r.headers.get('Retry-After'),'100');
 }
});
test('malformed caller JSON is classified as a request problem',async()=>{
 const h=runtime(Error('unused'));
 await assert.rejects(h.context.body(new Request('https://desk.test',{method:'POST',body:'<html>private</html>'})),/invalid_request_json/);
});
