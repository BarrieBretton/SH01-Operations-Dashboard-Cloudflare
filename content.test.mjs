import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(read('./content-schema.sql'));
 function prepare(q){let a=[];return {bind(...v){a=v;return this},run(){return {meta:{changes:sql.prepare(q).run(...a).changes}}},all(){return {results:sql.prepare(q).all(...a)}},first(){return sql.prepare(q).get(...a)}}}
 const env={DB:{prepare,batch(a){sql.exec('BEGIN');try{const r=a.map(x=>x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}},GOOGLE_SHEETS_WRITE_ENABLED:'1'};
 const ctx={URL,Date,crypto:webcrypto,TextEncoder,console,JSON,Map,Set,Number,AbortSignal,clean:(s,n=500)=>String(s??'').slice(0,n),iso:s=>{const d=new Date(s);return Number.isNaN(+d)?null:d.toISOString()},producerURL:s=>s,json:x=>x,error:(m,s)=>({error:m,status:s}),producerHash:async s=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('')};
 vm.createContext(ctx);vm.runInContext(read('./content-ledger.js')+';globalThis.f={canonicalPostURL,contentPreview,rankDuplicateMembers,upsertPosts,ingestGroups,planCleanup,queueCleanup,duplicateGroup,contentApi,mirrorContentSheets};',ctx);
 return {sql,env,c:ctx.f,ctx};
}
const post=(n,extra={})=>({platform:'instagram',account_id:'12345',post_id:String(n),permalink:'https://www.instagram.com/p/test'+n+'/',media_type:'IMAGE',metrics:{views:n*10},...extra});
test('Canonical links preserve identity; no credentials or arbitrary domains',()=>{
 const {c}=setup();assert.equal(c.canonicalPostURL('https://instagram.com/p/ABC/?igsh=tracking','instagram'),'https://www.instagram.com/p/ABC/');
 assert.equal(c.canonicalPostURL('https://blog.tumblr.com/post/123/title','tumblr'),'https://www.tumblr.com/blog/123');
 assert.throws(()=>c.canonicalPostURL('https://evil.test/p/ABC','instagram'));assert.throws(()=>c.canonicalPostURL('https://x:y@instagram.com/p/ABC','instagram'));
 assert.equal(c.contentPreview('https://cdninstagram.com.evil.test/img'), '');assert.equal(c.contentPreview('https://a.cdninstagram.com/img?access_token=secret'),'');
});
test('Post replay is idempotent, IDs stay strings, missing metrics do not zero stored observations',async()=>{
 const {c,env,sql}=setup();const p=post('9223372036854775807',{metrics:{views:12}});await c.upsertPosts(env,[p]);await c.upsertPosts(env,[{...p,metrics:{}}]);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM content_posts').get().n,1);assert.equal(sql.prepare('SELECT post_id FROM content_posts').get().post_id,p.post_id);assert.equal(JSON.parse(sql.prepare('SELECT metrics FROM content_posts').get().metrics).views,12);
 assert.equal(sql.prepare('SELECT COUNT(*) n FROM content_sheet_outbox').get().n,1);
});
test('Candidates cannot mix accounts, nonexistent posts, videos and images',async()=>{
 const {c,env}=setup();await c.upsertPosts(env,[post(1),post(2,{media_type:'VIDEO'})]);await assert.rejects(c.ingestGroups(env,[{group_id:'g',platform:'instagram',account_id:'12345',media_type:'IMAGE',members:['1','2']}]),/mixed/);
});
async function group(s){await s.c.upsertPosts(s.env,[post(1),post(2),post(3),post(4)]);await s.c.ingestGroups(s.env,[{group_id:'g',platform:'instagram',account_id:'12345',media_type:'IMAGE',members:['1','2','3','4'],algorithm:'test',evidence:{}}]);}
test('Explicit best/worst keep policy selects exactly n-k and no defaults',async()=>{
 const s=setup();await group(s);const b=await s.c.planCleanup(s.env,{group_id:'g',keep_count:2,keep_strategy:'best',metric:'views'});assert.deepEqual([...b.keep],['4','3']);assert.deepEqual(Array.from(b.remove,x=>x.post_id),['2','1']);
 const w=await s.c.planCleanup(s.env,{group_id:'g',keep_count:2,keep_strategy:'worst',metric:'views'});assert.deepEqual([...w.keep],['1','2']);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,0);
 await assert.rejects(s.c.planCleanup(s.env,{group_id:'g',keep_count:2,metric:'views'}),/explicit/);
});
test('Missing ranking metrics block cleanup; stale preview and wrong confirmation block queue',async()=>{
 const s=setup();await group(s);await assert.rejects(s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'shares'}),/missing_metrics/);
 const p=await s.c.planCleanup(s.env,{group_id:'g',keep_count:2,keep_strategy:'best',metric:'views'});
 await assert.rejects(s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:'YES'}),/confirmation/);
 await s.c.upsertPosts(s.env,[post(4,{metrics:{views:10}})]);await assert.rejects(s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation}),/changed/);
});
test('Confirmed queue is idempotent and does not execute provider deletions',async()=>{
 const s=setup();await group(s);const p=await s.c.planCleanup(s.env,{group_id:'g',keep_count:3,keep_strategy:'worst',metric:'views'});const r=await s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation});assert.equal(r.queued,1);
 assert.equal(s.sql.prepare('SELECT post_id,status FROM content_deletion_queue').get().post_id,'4');assert.equal(s.sql.prepare('SELECT status FROM content_deletion_queue').get().status,'awaiting_sheet');
 await assert.rejects(s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation}),/used/);
});
test('Permission flag blocks Sheets mutations and queue creation',async()=>{
 const s=setup();await group(s);s.env.GOOGLE_SHEETS_WRITE_ENABLED='0';assert.equal((await s.c.mirrorContentSheets(s.env)).status,'disabled');const p=await s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'views'});await assert.rejects(s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation}),/disabled/);
});
test('Read pagination and series explicitly distinguish missing from zero',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,[post(1,{metrics:{views:0}}),post(2)]);const r=await s.c.contentApi({url:'https://d.test/api/content?limit=1',method:'GET'},s.env,{});assert.equal(r.rows.length,1);assert.equal(r.has_more,true);
 const series=await s.c.contentApi({url:'https://d.test/api/content/series?platform=instagram&account_id=12345&post_id=1&metric=views',method:'GET'},s.env,{});assert.equal(series.rows[0].value,0);
});
test('Ambiguous clickouts write is quarantined instead of automatically re-appended',async()=>{
 const s=setup();await group(s);const p=await s.c.planCleanup(s.env,{group_id:'g',keep_count:3,keep_strategy:'best',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation});
 s.ctx.sheetToken=async()=> 'private-access';s.ctx.readSheet=async(_e,_t,title)=>title==='clickouts'?[['URLS']]:[['record_key','platform','account_id','account_handle','post_id','permalink','media_type','published_at','workflow_id','workflow_url','first_seen','last_seen','delete_status']];
 let appends=0;s.ctx.fetch=async url=>{if(url.includes(':append')){appends++;throw Error('transport_failure')}return {ok:true,json:async()=>({})}};
 assert.equal((await s.c.mirrorContentSheets(s.env)).status,'failed');assert.equal(appends,1);assert.equal(s.sql.prepare("SELECT status FROM content_sheet_outbox WHERE kind='clickouts'").get().status,'uncertain');await s.c.mirrorContentSheets(s.env);assert.equal(appends,1);
 assert.equal(s.sql.prepare('SELECT status FROM content_deletion_queue').get().status,'awaiting_sheet');
});
test('Built Worker enforces separate ingestion auth and serves newly persisted registry rows',async()=>{
 const {default:worker}=await import('./worker.js');const s=setup();s.env.DASHBOARD_TOKEN='reader';s.env.INGEST_TOKEN='writer';s.sql.exec(read('./schema.sql'));s.sql.exec(read('./sheets-sync-schema.sql'));s.sql.exec(read('./meta-schema.sql'));
 const call=(path,method='GET',payload,headers={})=>worker.fetch(new Request('https://dashboard.test'+path,{method,headers,body:payload?JSON.stringify(payload):undefined}),s.env,{waitUntil(){}});
 assert.equal((await call('/api/content')).status,401);
 assert.equal((await call('/api/ingest/posts','POST',{posts:[post(1)]},{Authorization:'Bearer reader'})).status,401);
 assert.equal((await call('/api/ingest/posts','POST',{posts:[post(1)]},{'X-INGEST-KEY':'writer'})).status,200);
 const r=await (await call('/api/content','GET',null,{Authorization:'Bearer reader'})).json();assert.equal(r.rows.length,1);assert.equal(r.rows[0].post_id,'1');
 assert.ok(read('./worker.js').includes(read('./content-ledger.js').trim()));assert.ok(read('./worker.js').includes(read('./meta-worker.js').trim()));
});
