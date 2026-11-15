import {test} from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

test('media credential grants only the three scanner operations', async () => {
 const env={MEDIA_CLIP_API_KEY:'scanner-test',INGEST_TOKEN:'ingest-test',DASHBOARD_TOKEN:'reader-test'};
 const call=(path,method,key='scanner-test')=>worker.fetch(new Request('https://dashboard.test'+path,{method,headers:{'X-INGEST-KEY':key}}),env,{});
 for(const [path,method] of [['/api/ingest/fingerprints','GET'],['/api/ingest/posts','POST'],['/api/ingest/duplicate-groups','POST']]){
  // Auth succeeds, then unconfigured storage refuses the operation.
  assert.equal((await call(path,method)).status,503);
  assert.equal((await call(path,method,'wrong')).status,401);
 }
 for(const [path,method] of [['/api/ingest/event','POST'],['/api/ingest/deletion-result','POST'],['/api/ingest/resolve-post','POST'],['/api/ingest/posts','GET'],['/api/storage/setup','POST'],['/api/content','GET'],['/api/content/scan','POST']]){
  assert.equal((await call(path,method)).status,401);
 }
 assert.equal((await call('/api/ingest/event','POST','ingest-test')).status,503);
 const missing=await worker.fetch(new Request('https://dashboard.test/api/ingest/fingerprints',{headers:{'X-INGEST-KEY':'scanner-test'}}),{},{});
 assert.equal(missing.status,401);
});
