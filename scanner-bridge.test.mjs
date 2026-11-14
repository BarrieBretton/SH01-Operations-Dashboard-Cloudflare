import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import worker from './worker.js';

function harness(posts=[],assets=[]){
 const tables={content_posts:posts,meta_assets:assets,content_duplicate_groups:[]};
 const env={META_SYSVAR:'private-token',STORE:{rows:async t=>tables[t],snapshot:async()=>({tables}),find:async(t,w)=>tables[t].find(r=>Object.entries(w).every(([k,v])=>r[k]===v)),transact:async(names,fn)=>{
  const draft=structuredClone(tables);const tx={rows:t=>draft[t],find:(t,w)=>draft[t].find(r=>Object.entries(w).every(([k,v])=>r[k]===v)),put:(t,r)=>draft[t].push(r)};const result=await fn(tx);for(const t of names)tables[t]=draft[t];return result;
 }}};
 const c={URL,Date,Map,Set,JSON,console,clean:(s,n=100)=>String(s||'').slice(0,n),json:x=>x,error:(x,status)=>({error:x,status}),body:async r=>r.json(),metaCredential:()=>env.META_SYSVAR,META_VERSION:'v24.0',producerHash:async x=>x};
 vm.createContext(c);for(const file of ['content-ledger.js','scanner-bridge.js'])vm.runInContext(fs.readFileSync(new URL(file,import.meta.url),'utf8'),c);
 return {env,c,tables};
}
const post=(id,extra={})=>({platform:'instagram',account_id:'1',post_id:String(id).padStart(3,'0'),media_type:'IMAGE',delete_status:'published',caption:'caption',metrics:'{"views":10}',...extra});
test('catalogue pagination is bounded, stable by ID, scoped and excludes unpublished posts',async()=>{
 const h=harness([...Array.from({length:25},(_,i)=>post(i)),post(99,{account_id:'2'}),post(98,{delete_status:'deleted'})]);
 const u=new URL('https://dash/api?platform=instagram&account_id=1');let data=await h.c.scannerPosts(h.env,u);
 assert.equal(data.rows.length,20);assert.equal(data.next_after,'019');assert.equal(data.rows[0].metrics,undefined);assert.equal(data.rows[0].preview_url,undefined);
 u.searchParams.set('after',data.next_after);data=await h.c.scannerPosts(h.env,u);assert.equal(data.rows.length,5);assert.equal(data.next_after,null);
});
test('accounts come from stored assets/posts, including accounts with no posts',async()=>{
 const h=harness([post(1),post(2)],[{platform:'instagram',id:'1',name:'One'},{platform:'facebook',id:'2',name:'Two'}]);
 const data=await h.c.scannerAccounts(h.env);assert.equal(data.rows.length,2);assert.equal(data.rows.find(a=>a.account_id==='1').stored_posts,2);assert.equal(data.rows.find(a=>a.account_id==='2').stored_posts,0);assert.equal(data.coverage.full_history_verified,false);
});
test('fingerprint updates preserve existing metadata and metrics; failures roll back',async()=>{
 const h=harness([post(1)]),before=structuredClone(h.tables.content_posts[0]);
 const r={platform:'instagram',account_id:'1',post_id:'001',fingerprint:{algorithm:'sh01-social-perceptual',version:1,media_type:'IMAGE'}};
 const ack=await h.c.scannerFingerprints(h.env,[r]);assert.equal(ack.observations_created,0);
 const after={...h.tables.content_posts[0]};delete after.fingerprint;assert.deepEqual(after,before);
 await assert.rejects(h.c.scannerFingerprints(h.env,[{...r,fingerprint:{...r.fingerprint,media_type:'VIDEO'}}]),/mismatch/);
});
test('Facebook video resolves actual source, caches it and never hashes thumbnail as video',async()=>{
 const h=harness([post(1,{platform:'facebook',media_type:'POST'})],[{id:'1',platform:'facebook'}]);let calls=0;
 h.c.graph=async(path,token,params)=>{calls++;if(params.fields==='id,access_token')return {access_token:'page-private'};if(params.fields==='source')return {source:'https://a.fbcdn.net/video.mp4'};return {attachments:{data:[{media_type:'video',media:{image:{src:'https://a.fbcdn.net/thumb.jpg'}},target:{id:'44'}}]}};};
 const u=new URL('https://dash/api?platform=facebook&account_id=1&post_id=001');const data=await h.c.scannerMedia(h.env,u);
 assert.equal(data.kind,'video');assert.equal(data.url,'https://a.fbcdn.net/video.mp4');assert.equal(calls,3);
 await h.c.scannerMedia(h.env,u);assert.equal(calls,3);assert.ok(!JSON.stringify(data).includes('private'));
});
test('a video without an actual source remains unavailable',async()=>{
 const h=harness([post(1,{platform:'facebook',media_type:'VIDEO',preview_type:'image',preview_url:'https://a.fbcdn.net/thumb.jpg'})],[{id:'1',platform:'facebook'}]);
 h.c.graph=async(path,token,p)=>p.fields==='id,access_token'?{access_token:'page-private'}:{attachments:{data:[{media_type:'video',media:{image:{src:'https://a.fbcdn.net/thumb.jpg'}}}]}};
 const data=await h.c.scannerMedia(h.env,new URL('https://dash/api?platform=facebook&account_id=1&post_id=001'));
 assert.equal(data.available,false);assert.equal(data.media_type,'VIDEO');assert.equal(data.url,'');
});
test('generic Facebook posts may join image groups only after fingerprint classification',async()=>{
 const fp=JSON.stringify({algorithm:'sh01-social-perceptual',version:1,media_type:'IMAGE'});
 const h=harness([post(1,{platform:'facebook',media_type:'POST',fingerprint:fp}),post(2,{platform:'facebook',media_type:'POST',fingerprint:fp})]);
 await h.c.ingestGroups(h.env,[{group_id:'g1',platform:'facebook',account_id:'1',media_type:'IMAGE',members:['001','002'],algorithm:'sh01-social-perceptual'}]);
 assert.equal(h.tables.content_duplicate_groups.length,1);
 h.tables.content_posts[1].fingerprint=null;
 await assert.rejects(h.c.ingestGroups(h.env,[{group_id:'g2',platform:'facebook',account_id:'1',media_type:'IMAGE',members:['001','002']}]),/mixed_or_missing/);
});
test('bridge auth grants exact methods only; deletion and arbitrary bridge paths remain denied',async()=>{
 const env={MEDIA_CLIP_API_KEY:'scanner'},call=(p,method='GET',key='scanner')=>worker.fetch(new Request('https://dash'+p,{method,headers:{'X-INGEST-KEY':key}}),env,{});
 for(const p of ['health','accounts','posts','media'])assert.equal((await call('/api/ingest/scanner/'+p)).status,503);
 assert.equal((await call('/api/ingest/scanner/fingerprints','POST')).status,503);
 for(const [p,m] of [['/api/ingest/scanner/posts','POST'],['/api/ingest/scanner/unknown','GET'],['/api/ingest/deletion-result','POST'],['/api/storage/setup','POST']])assert.equal((await call(p,m)).status,401);
 assert.equal((await call('/api/ingest/scanner/health','GET','wrong')).status,401);
});
test('scanner snapshots coalesce reads, isolate credentials, expire and invalidate on writes',async()=>{
 const h=harness([post(1,{preview_url:'https://a.cdninstagram.com/a.jpg',preview_type:'image'})]);
 let reads=0;h.env.STORE.snapshot=async()=>{reads++;return {tables:structuredClone(h.tables)};};
 await Promise.all([h.c.scannerAccounts(h.env),h.c.scannerPosts(h.env,new URL('https://dash/?platform=instagram&account_id=1'))]);
 await h.c.scannerMedia(h.env,new URL('https://dash/?platform=instagram&account_id=1&post_id=001'));
 assert.equal(reads,1);
 h.env.GOOGLE_REFRESH_TOKEN='other';await h.c.scannerAccounts(h.env);assert.equal(reads,2);
 await h.c.scannerFingerprints(h.env,[{platform:'instagram',account_id:'1',post_id:'001',fingerprint:{algorithm:'sh01-social-perceptual',version:1,media_type:'IMAGE'}}]);
 await h.c.scannerAccounts(h.env);assert.equal(reads,3);
 const realDate=h.c.Date;h.c.Date={now:()=>realDate.now()+11000};await h.c.scannerAccounts(h.env);assert.equal(reads,4);
});
test('failed snapshots are evicted and retried on next request',async()=>{
 const h=harness();let reads=0;h.env.STORE.snapshot=async()=>{if(++reads===1)throw Error('store_rate_limited');return {tables:h.tables};};
 await assert.rejects(h.c.scannerAccounts(h.env),/store_rate_limited/);
 await h.c.scannerAccounts(h.env);assert.equal(reads,2);
});
