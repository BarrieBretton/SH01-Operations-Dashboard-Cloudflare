import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
const frame={algorithm:'sh01-social-perceptual',version:1,media_type:'IMAGE',hashes:['123456789abcdef0'],gray_stddev:20};
const fp=JSON.stringify({algorithm:'sh01-social-perceptual',version:1,media_type:'VIDEO',duration:12,sample_positions:[0.1,0.3,0.5,0.7,0.9],frames:Array(5).fill(frame)});
const post=(id,account='a',extra={})=>({platform:'instagram',account_id:account,post_id:id,delete_status:'published',media_type:'REELS',fingerprint:null,...extra});
function setup(posts=[]){
 let now=Date.parse('2026-11-15T10:00:00Z'),tail=Promise.resolve();const tables={content_posts:posts,content_jobs:[],content_collect_state:[]},requests=[];
 const store={async transact(names,fn){const job=tail.then(async()=>{const draft=structuredClone(tables),tx={rows:t=>draft[t],find:(t,w)=>draft[t].find(r=>Object.entries(w).every(([k,v])=>r[k]===v)),put(t,row){const i=draft[t].findIndex(x=>x.id===row.id);if(i<0)draft[t].push(row);else draft[t][i]=row;},remove(t,w){draft[t]=draft[t].filter(r=>!Object.entries(w).every(([k,v])=>r[k]===v));}};const result=await fn(tx);for(const t of names)tables[t]=draft[t];return result;});tail=job.catch(()=>{});return job;},snapshot:async()=>({tables})};
 const env={META_SYNC_ENABLED:'1',MEDIA_CLIP_API_KEY:'private-test-key',STORE:store};
 const c={Date:class extends Date{static now(){return now;}},Math,JSON,Map,Set,crypto:webcrypto,AbortSignal,console,Response,fetch:async(u,o)=>{const body=JSON.parse(o.body);requests.push({u,o,body});for(const p of tables.content_posts)if(p.platform===body.platform&&p.account_id===body.account_id&&body.post_ids.includes(p.post_id))p.fingerprint=fp;return new Response(JSON.stringify({ok:true,platform:body.platform,account_id:body.account_id,counts:{fingerprints_saved:body.post_ids.length},coverage:{targeted_posts:true}}),{status:200});}};
 vm.createContext(c);vm.runInContext(read('./scanner-automation.js'),c);
 return {env,c,tables,requests,advance(ms=90000){now+=ms;},state:()=>JSON.parse(tables.content_collect_state.find(r=>r.id==='similarity_scan')?.payload||'{}'),job:()=>tables.content_jobs.find(r=>r.id==='similarity_scan')};
}
test('automatic scanner selects only missing supported media, resumes after restart and finds later posts',async()=>{
 const h=setup([...Array.from({length:9},(_,i)=>post(String(i+1))),post('cached','a',{fingerprint:fp}),post('carousel','a',{media_type:'CAROUSEL_ALBUM'}),post('deleted','a',{delete_status:'deleted'}),post('foreign','a',{platform:'tumblr'})]);
 await h.c.autoScanTick(h.env);assert.deepEqual(h.requests[0].body.post_ids,['1','2','3','4','5','6','7','8']);assert.equal(h.requests[0].u,'https://sh01.vivojaymail.workers.dev/social/inventory/scan');assert.equal(h.requests[0].o.redirect,'manual');assert.equal(h.requests[0].body.max_posts,8);assert.equal(h.state().batches.length,0);
 await h.c.autoScanTick(h.env);assert.equal(h.requests.length,1);h.advance();const restarted=vm.createContext({...h.c});vm.runInContext(read('./scanner-automation.js'),restarted);
 await restarted.autoScanTick(h.env);assert.deepEqual(h.requests[1].body.post_ids,['9']);h.advance();await h.c.autoScanTick(h.env);assert.equal(h.requests.length,2);assert.equal(h.job().status,'idle');
 h.tables.content_posts.push(post('new'));h.advance(301000);await h.c.autoScanTick(h.env);assert.deepEqual(h.requests[2].body.post_ids,['new']);
});
test('automatic batches rotate accounts and preserve same-platform account isolation',async()=>{
 const h=setup([...Array.from({length:9},(_,i)=>post(String(i),'a')),post('1','b')]);await h.c.autoScanTick(h.env);h.advance();await h.c.autoScanTick(h.env);assert.equal(h.requests[1].body.account_id,'b');h.advance();await h.c.autoScanTick(h.env);assert.equal(h.requests[2].body.account_id,'a');
});
test('lease prevents concurrent cron deliveries from dispatching duplicate scans',async()=>{
 const h=setup([post('1')]);let release;h.c.fetch=async()=>{h.requests.push(1);await new Promise(r=>release=r);return new Response('{}',{status:503});};const first=h.c.autoScanTick(h.env);while(!release)await new Promise(r=>setImmediate(r));await h.c.autoScanTick(h.env);assert.equal(h.requests.length,1);release();await first;
});
test('successful fingerprint save with failed group delivery remains replayable from saved state',async()=>{
 const h=setup([post('1')]),normal=h.c.fetch;h.c.fetch=async(u,o)=>{h.tables.content_posts[0].fingerprint=fp;return new Response(JSON.stringify({ok:false,errors:[{diagnostic:{dashboard_code:'store_rate_limited',retry_after_seconds:180}}]}),{status:200});};await h.c.autoScanTick(h.env);assert.equal(h.state().batches.length,1);assert.equal(h.job().status,'retry_scheduled');h.advance(90000);await h.c.autoScanTick(h.env);assert.equal(h.state().batches[0].attempts,1);h.advance(120000);h.c.fetch=normal;await h.c.autoScanTick(h.env);assert.deepEqual(h.requests[0].body.post_ids,['1']);assert.equal(h.state().batches.length,0);
});
test('unconfirmed response retains checkpoint and delays retry; unrelated posts can follow after recovery',async()=>{
 const h=setup([post('1'),post('2'),post('3')]),normal=h.c.fetch;h.c.fetch=async()=>{throw Error('secret signed URL');};await h.c.autoScanTick(h.env);assert.equal(h.state().batches.length,1);assert.equal(h.state().last_result.error,'scanner_response_unconfirmed');assert.doesNotMatch(JSON.stringify(h.state()),/secret signed/);h.advance(300000);await h.c.autoScanTick(h.env);assert.equal(h.state().batches[0].attempts,1);h.advance(320000);h.c.fetch=normal;await h.c.autoScanTick(h.env);assert.equal(h.state().batches.length,0);
});
test('new backend must acknowledge targeted mode; old deployment and auth errors back off',async()=>{
 for(const status of [401,422]){const h=setup([post('1')]);h.c.fetch=async()=>new Response('{}',{status});await h.c.autoScanTick(h.env);assert.ok(Date.parse(h.state().next_at)>=h.c.Date.now()+3600000);assert.equal(h.state().batches.length,1);}
 const h=setup([post('1')]);h.c.fetch=async()=>new Response(JSON.stringify({ok:true,platform:'instagram',account_id:'a',counts:{fingerprints_saved:1},coverage:{}}));await h.c.autoScanTick(h.env);assert.equal(h.state().last_result.error,'scanner_partial_result');assert.equal(h.state().batches.length,1);
});
test('coverage limits do not silently mark matching complete; existing switches disable automatic scans',async()=>{
 const h=setup([post('1')]);h.c.fetch=async()=>new Response(JSON.stringify({ok:true,platform:'instagram',account_id:'a',counts:{fingerprints_saved:1},coverage:{targeted_posts:true,comparison_truncated:true}}));await h.c.autoScanTick(h.env);assert.equal(h.state().batches.length,1);assert.equal(h.state().last_result.comparison_truncated,true);
 for(const env of [{META_SYNC_ENABLED:'0',MEDIA_CLIP_API_KEY:'x'},{META_SYNC_ENABLED:'1'}]){const r=setup([post('1')]);Object.assign(r.env,{MEDIA_CLIP_API_KEY:null},env);await r.c.autoScanTick(r.env);assert.equal(r.requests.length,0);}
});
test('scheduler includes automatic scanning while retaining one job per invocation',async()=>{
 assert.ok(read('./worker.js').includes(read('./scanner-automation.js')));const h=setup([]);let scans=0,others=0;Object.assign(h.c,{storageEnv:x=>x,sheetSync:async()=>others++,mirrorContentSheets:async()=>others++,metaSync:async()=>others++,autoScanTick:async()=>scans++,SOURCE_REGISTRY:[]});h.tables.sheet_sync_state=[{last_attempt:new Date(h.c.Date.now()).toISOString()}];h.tables.content_jobs.push({id:'meta_collect',last_attempt:new Date(h.c.Date.now()).toISOString()});vm.runInContext(read('./worker-runtime.js').replace('export default','globalThis.worker ='),h.c);await h.c.runStoredJobs({...h.env,SHEETS_STORAGE_READY:'1'});assert.equal(scans,1);assert.equal(others,0);
});

test('targeted catalogue reads return only the requested identities and reject mixed cursor modes',async()=>{
 const h=setup([post('1'),post('2'),post('3','b'),post('4','a',{delete_status:'deleted'})]);
 Object.assign(h.c,{URL,clean:s=>s,producerHash:async s=>s});vm.runInContext(read('./content-ledger.js')+'\n'+read('./scanner-bridge.js'),h.c);
 const u=new URL('https://dashboard.test/api/ingest/scanner/posts?platform=instagram&account_id=a&post_ids=1,3,4');
 const result=await h.c.scannerPosts(h.env,u);assert.deepEqual(Array.from(result.rows,r=>r.post_id),['1']);assert.equal(result.next_after,null);assert.equal(result.full_history_verified,false);
 for(const query of ['post_ids=1,1','post_ids=1&after=0','post_ids='])await assert.rejects(h.c.scannerPosts(h.env,new URL('https://dashboard.test/api?platform=instagram&account_id=a&'+query)),/invalid_targeted_posts/);
});

test('transaction retry cannot dispatch a stale selection after another owner acquired the lease',async()=>{
 const h=setup([post('1')]),normal=h.env.STORE.transact;let first=true;
 h.env.STORE.transact=(names,fn)=>normal(names,tx=>{const r=fn(tx);if(first){first=false;tx.find('content_jobs',{id:'similarity_scan'}).lease='another-owner';return fn(tx);}return r;});
 await h.c.autoScanTick(h.env);assert.equal(h.requests.length,0);assert.equal(h.job().lease,'another-owner');
});

test('failed completion persistence leaves the durable batch leased until safe recovery',async()=>{
 const h=setup([post('1')]),normal=h.env.STORE.transact;let calls=0;
 h.env.STORE.transact=(names,fn)=>{if(++calls===2)throw Error('store_network_unavailable');return normal(names,fn);};
 await assert.rejects(h.c.autoScanTick(h.env),/store_network_unavailable/);assert.equal(h.requests.length,1);assert.equal(h.state().batches.length,1);assert.equal(h.job().status,'running');
 h.env.STORE.transact=normal;h.advance(300000);await h.c.autoScanTick(h.env);assert.equal(h.requests.length,1);h.advance(301000);await h.c.autoScanTick(h.env);assert.equal(h.requests.length,2);assert.equal(h.state().batches.length,0);
});

test('account catch-up survives restart, processes eight at a time and yields after three batches',async()=>{
 const h=setup([...Array.from({length:42},(_,i)=>post(String(i).padStart(3,'0'),'focus')),...Array.from({length:20},(_,i)=>post('o'+i,'other'))]);
 Object.assign(h.c,{contentPlatform:s=>s,contentID:s=>s,contentNow:()=>new Date(h.c.Date.now()).toISOString()});
 const ack=await h.c.autoScanPrioritize(h.env,{platform:'instagram',account_id:'focus'});
 assert.equal(ack.coverage.pending,42);assert.equal(ack.scan_status.prioritized,true);
 const restarted=vm.createContext({...h.c});vm.runInContext(read('./scanner-automation.js'),restarted);
 for(let i=0;i<8;i++){await restarted.autoScanTick(h.env);h.advance();}
 assert.deepEqual(h.requests.slice(0,4).map(r=>r.body.account_id),['focus','focus','focus','other']);
 assert.ok(h.requests.every(r=>r.body.post_ids.length<=8));
 assert.equal(h.c.autoScanCoverage(h.tables.content_posts).find(x=>x.account_id==='focus').pending,0);
 assert.equal(h.c.autoScanCoverage(h.tables.content_posts).find(x=>x.account_id==='other').fingerprinted,16);
 assert.equal(h.state().priority,undefined);
 const status=h.c.autoScanAccountSummary(h.env,h.tables,'instagram','focus');
 assert.equal(status.last_result.account_id,'focus');assert.equal(status.last_result.fingerprints_saved,2);
});

test('priority does not bypass cooldown or an existing lease, and repeated clicks are idempotent',async()=>{
 const h=setup(Array.from({length:12},(_,i)=>post(String(i).padStart(3,'0'),'focus')));
 Object.assign(h.c,{contentPlatform:s=>s,contentID:s=>s,contentNow:()=>new Date(h.c.Date.now()).toISOString()});
 await h.c.autoScanTick(h.env);const until=h.state().next_at;
 await h.c.autoScanPrioritize(h.env,{platform:'instagram',account_id:'focus'});
 h.state().priority_streak=2;
 const stamp=h.state().priority.requested_at;
 await h.c.autoScanPrioritize(h.env,{platform:'instagram',account_id:'focus'});
 assert.equal(h.state().priority.requested_at,stamp);assert.equal(h.state().next_at,until);
 await h.c.autoScanTick(h.env);assert.equal(h.requests.length,1);
 await assert.rejects(h.c.autoScanPrioritize(h.env,{platform:'instagram',account_id:'missing'}),/no_supported_posts/);
 h.env.META_SYNC_ENABLED='0';await assert.rejects(h.c.autoScanPrioritize(h.env,{platform:'instagram',account_id:'focus'}),/disabled/);
});

test('a focused account with a deferred failure does not block other accounts or lose group retries',async()=>{
 const h=setup([post('1','focus'),post('2','other')]);Object.assign(h.c,{contentPlatform:s=>s,contentID:s=>s,contentNow:()=>new Date(h.c.Date.now()).toISOString()});
 await h.c.autoScanPrioritize(h.env,{platform:'instagram',account_id:'focus'});const normal=h.c.fetch;
 h.c.fetch=async()=>{h.tables.content_posts[0].fingerprint=fp;return new Response(JSON.stringify({ok:false,errors:[{diagnostic:{dashboard_code:'store_rate_limited',retry_after_seconds:300}}]}));};
 await h.c.autoScanTick(h.env);h.advance(320000);h.c.fetch=normal;
 await h.c.autoScanTick(h.env);assert.equal(h.requests[0].body.account_id,'focus');
 h.advance();await h.c.autoScanTick(h.env);assert.equal(h.requests[1].body.account_id,'other');assert.equal(h.state().batches.length,0);
});
