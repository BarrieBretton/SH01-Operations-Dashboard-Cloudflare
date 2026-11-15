import {attachStore} from './test-store-helper.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {webcrypto} from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(read('./content-schema.sql'));sql.exec(read('./meta-schema.sql'));
 function prepare(q){let a=[];return {bind(...v){a=v;return this},run(){return {meta:{changes:sql.prepare(q).run(...a).changes}}},all(){return {results:sql.prepare(q).all(...a)}},first(){return sql.prepare(q).get(...a)}}}
 const env={DB:{prepare,batch(a){sql.exec('BEGIN');try{const r=a.map(x=>x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}},GOOGLE_SHEETS_WRITE_ENABLED:'1'};
 const ctx={URL,Date,crypto:webcrypto,TextEncoder,console,JSON,Map,Set,Number,AbortSignal,clean:(s,n=500)=>String(s??'').slice(0,n),iso:s=>{const d=new Date(s);return Number.isNaN(+d)?null:d.toISOString()},producerURL:s=>s,json:x=>x,error:(m,s)=>({error:m,status:s}),producerHash:async s=>Array.from(new Uint8Array(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('')};
 attachStore(env,sql,ctx);vm.createContext(ctx);vm.runInContext(read('./content-ledger.js')+';globalThis.f={cleanupScoreWeights,cleanupScore,groupReviewState,canonicalPostURL,contentPreview,rankDuplicateMembers,upsertPosts,ingestGroups,planCleanup,queueCleanup,duplicateGroup,contentApi,mirrorContentSheets};',ctx);
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
 // Isolate clickouts: production handles one outbox row per invocation.
 s.sql.prepare("UPDATE content_sheet_outbox SET status='synced' WHERE kind='post'").run();
 s.ctx.sheetToken=async()=> 'private-access';s.ctx.readSheet=async(_e,_t,title)=>title==='clickouts'?[['URLS']]:[['record_key','platform','account_id','account_handle','post_id','permalink','media_type','published_at','workflow_id','workflow_url','first_seen','last_seen','delete_status']];
 let appends=0;s.ctx.fetch=async url=>{if(url.includes(':append')){appends++;throw Error('transport_failure')}return {ok:true,json:async()=>({})}};
 assert.equal((await s.c.mirrorContentSheets(s.env)).status,'failed');assert.equal(appends,1);assert.equal(s.sql.prepare("SELECT status FROM content_sheet_outbox WHERE kind='clickouts'").get().status,'uncertain');await s.c.mirrorContentSheets(s.env);assert.equal(appends,1);
 assert.equal(s.sql.prepare('SELECT status FROM content_deletion_queue').get().status,'awaiting_sheet');
});
// Built Worker routes are exercised against the direct Sheets API harness in sheets-storage.test.mjs.

test('groups endpoint uses one consistent snapshot for all groups and preserves missing-member evidence',async()=>{
 const s=setup();await group(s);
 for(let i=0;i<22;i++)await s.c.ingestGroups(s.env,[{group_id:'g'+i,platform:'instagram',account_id:'12345',media_type:'IMAGE',members:['1','2'],algorithm:'test',evidence:{fixture:i}}]);
 s.sql.prepare("DELETE FROM content_posts WHERE post_id='2'").run();
 const snapshot=s.env.STORE.snapshot.bind(s.env.STORE);let reads=0;
 s.env.STORE.snapshot=async tables=>{reads++;assert.deepEqual([...tables],['content_duplicate_groups','content_posts','content_cleanup_plans','content_deletion_queue','meta_assets']);return snapshot(tables)};
 s.env.STORE.rows=()=>{throw Error('unexpected separate table read')};
 const r=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});
 assert.equal(reads,1);assert.equal(r.rows.length,20);assert.equal(r.limit,20);
 for(const g of r.rows){assert.ok(g.missing_members.includes('2'));assert.ok(g.members.every(p=>p.account_id==='12345'&&p.platform==='instagram'));assert.equal(g.review_status,'candidate_requires_confirmation');}
});

test('confirmed keep and removal decisions survive a fresh group read and expired confirmation window',async()=>{
 const s=setup();await group(s);const plan=await s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'views'});
 let response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});
 assert.equal(response.rows[0].has_confirmed_history,false,'unconfirmed previews are not scheduled');
 const result=await s.c.queueCleanup(s.env,{plan_id:plan.plan_id,confirmation:plan.confirmation});assert.ok(result.confirmed_at);
 s.sql.prepare("UPDATE content_cleanup_plans SET expires_at='2000-01-01T00:00:00Z'").run();
 response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});
 const g=response.rows[0];assert.equal(g.has_confirmed_history,true);
 const kept=g.members.find(p=>p.post_id==='4'),removed=g.members.find(p=>p.post_id==='1');
 assert.equal(kept.cleanup_review.decision,'keep');assert.equal(kept.delete_status,'published');
 assert.equal(removed.cleanup_review.decision,'remove');assert.equal(removed.cleanup_review.queue_status,'awaiting_sheet');assert.equal(removed.cleanup_review.removal_scheduled_at,null);
 assert.equal(removed.cleanup_review.confirmed_at,result.confirmed_at);await assert.rejects(s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'views'}),/already_queued/);
});

test('history and queue annotations match exact platform and account, including legacy confirmed plans',()=>{
 const {c}=setup();const g={platform:'instagram',account_id:'12345',members:[post(1),post(2)]};
 const legacy={plan_id:'old',committed:1,payload:JSON.stringify({platform:'instagram',account_id:'12345',keep:['1'],remove:[{post_id:'2'}]})};
 const queue=[{platform:'instagram',account_id:'12345',post_id:'2',status:'queued_clickouts',created_at:'2026-11-14T10:00:00Z'}];
 const result=c.groupReviewState(g,[legacy],queue);assert.equal(result.members[0].cleanup_review.confirmed_at,queue[0].created_at);
 for(const other of [{platform:'facebook',account_id:'12345'},{platform:'instagram',account_id:'other'}]){
  const different={...g,...other,members:g.members.map(p=>({...p,...other}))};const clean=c.groupReviewState(different,[legacy],queue);assert.equal(clean.has_confirmed_history,false);assert.equal(clean.members[0].cleanup_review.decision,undefined);assert.equal(clean.members[1].cleanup_review.queue_status,null);
 }
});

test('weighted cleanup uses the default 1x views plus 10x likes, reverses for worst, and accepts explicit weights',async()=>{
 const s=setup();await group(s);
 for(const p of [post(1,{metrics:{views:1000,likes:1}}),post(2,{metrics:{views:400,likes:100}}),post(3,{metrics:{views:500,likes:0}}),post(4,{metrics:{views:500,likes:0}})])await s.c.upsertPosts(s.env,[p]);
 const request={group_id:'g',keep_count:1,keep_strategy:'best',metric:'weighted_score'};
 const best=await s.c.planCleanup(s.env,request);assert.deepEqual([...best.keep],['2']);assert.equal(best.ranking.formula,'Views × 1 + Likes × 10');assert.deepEqual(JSON.parse(JSON.stringify(best.ranking.weights)),{views:1,likes:10});
 assert.equal(best.ranking.values.find(x=>x.post_id==='2').value,1400);
 const worst=await s.c.planCleanup(s.env,{...request,keep_strategy:'worst'});assert.deepEqual([...worst.keep],['3'],'ties use deterministic post IDs');
 const custom=await s.c.planCleanup(s.env,{...request,weights:{views:3,likes:1}});assert.deepEqual([...custom.keep],['1']);assert.equal(custom.ranking.values.find(x=>x.post_id==='1').value,3001);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,0);
});

test('weighted ranking distinguishes missing from zero and permits an explicitly excluded metric',()=>{
 const {c}=setup(),a={post_id:'a',delete_status:'published',metrics:{views:0,likes:0}},b={post_id:'b',delete_status:'published',metrics:{views:1,likes:0}};
 assert.deepEqual([...c.rankDuplicateMembers([a,b],1,'worst','weighted_score').keep],['a']);
 for(const metrics of [{views:100},{likes:100},{views:100,likes:null},{views:100,likes:'10'},{views:100,likes:-1},{views:Infinity,likes:1},{views:Number.MAX_SAFE_INTEGER,likes:1}])assert.throws(()=>c.rankDuplicateMembers([a,{...b,metrics}],1,'best','weighted_score'),/missing_metrics/);
 assert.deepEqual([...c.rankDuplicateMembers([a,{...b,metrics:{likes:8}}],1,'best','weighted_score',{views:0,likes:10}).keep],['b']);
 assert.throws(()=>c.rankDuplicateMembers([a,{...b,delete_status:'awaiting_sheet'}],1,'best','weighted_score'),/already_queued/);
});

test('invalid score weights fail before saving a plan',async()=>{
 const s=setup();await group(s);for(const weights of [null,[],{},'10',{views:1},{views:'1',likes:10},{views:-1,likes:10},{views:0,likes:0},{views:1.5,likes:10},{views:1001,likes:10},{views:NaN,likes:10},{views:1,likes:Infinity},{views:1,likes:10,shares:20}])await assert.rejects(s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'weighted_score',weights}),/invalid_score_weights/);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_cleanup_plans').get().n,0);
});

test('confirmed weighted decisions retain their inputs, score and formula across new sessions and later metrics',async()=>{
 const s=setup();await group(s);await s.c.upsertPosts(s.env,[post(1,{metrics:{views:1000,likes:1}}),post(2,{metrics:{views:400,likes:100}}),post(3,{metrics:{views:0,likes:0}}),post(4,{metrics:{views:2,likes:0}})]);
 const plan=await s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'weighted_score',weights:{views:1,likes:20}});
 await s.c.queueCleanup(s.env,{plan_id:plan.plan_id,confirmation:plan.confirmation});
 await s.c.upsertPosts(s.env,[post(2,{metrics:{views:5000,likes:800}})]);
 const response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{}),member=response.rows[0].members.find(x=>x.post_id==='2');
 assert.equal(member.metrics.likes,800);assert.equal(member.cleanup_review.decision,'keep');assert.equal(member.cleanup_review.ranking.value,2400);assert.equal(member.cleanup_review.ranking.formula,'Views × 1 + Likes × 20');assert.deepEqual(JSON.parse(JSON.stringify(member.cleanup_review.ranking.inputs)),{views:400,likes:100});
 const saved=JSON.parse(s.sql.prepare('SELECT payload FROM content_cleanup_plans WHERE plan_id=?').get(plan.plan_id).payload);assert.equal(saved.ranking.weights.likes,20);assert.equal(saved.ranking.version,'weighted_v1');assert.ok(saved.confirmed_at);
});

test('weighted plans retain stale-metric protection and do not create provider metric observations',async()=>{
 const s=setup();await group(s);for(let n=1;n<=4;n++)await s.c.upsertPosts(s.env,[post(n,{metrics:{views:100,likes:n}})]);
 const plan=await s.c.planCleanup(s.env,{group_id:'g',keep_count:2,keep_strategy:'best',metric:'weighted_score'});
 await s.c.upsertPosts(s.env,[post(4,{metrics:{views:100,likes:99}})]);
 await assert.rejects(s.c.queueCleanup(s.env,{plan_id:plan.plan_id,confirmation:plan.confirmation}),/group_or_metrics_changed/);
 assert.ok(s.sql.prepare('SELECT metrics FROM content_observations').all().every(x=>!Object.hasOwn(JSON.parse(x.metrics),'weighted_score')));
});

test('account labels use the matched platform catalogue and do not change stored posts or cleanup-plan identity',async()=>{
 const s=setup();await group(s);const plan=await s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'views'});
 s.sql.prepare('INSERT INTO meta_assets(id,platform,name,updated_at) VALUES(?,?,?,?)').run('12345','instagram','@exact.ig · Display Name','2026-11-15T00:00:00Z');
 const get=path=>s.c.contentApi({url:'https://d.test'+path,method:'GET'},s.env,{});
 const groups=await get('/api/content/groups');assert.equal(groups.rows[0].account_name,'@exact.ig · Display Name');assert.equal(groups.rows[0].account_name_source,'instagram_profile');assert.equal(groups.rows[0].members[0].account_name,'@exact.ig · Display Name');assert.equal(groups.rows[0].group_id,'g');
 const library=await get('/api/content?q=exact.ig');assert.equal(library.rows.length,4);assert.equal(library.rows[0].account_name,'@exact.ig · Display Name');assert.equal(s.sql.prepare('SELECT account_handle FROM content_posts LIMIT 1').get().account_handle,'');
 s.sql.prepare('UPDATE meta_assets SET name=? WHERE id=?').run('@renamed.ig','12345');await s.c.queueCleanup(s.env,{plan_id:plan.plan_id,confirmation:plan.confirmation});assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,3);
});

test('name fallback cannot borrow another platform or account name',async()=>{
 const s=setup();await group(s);s.sql.prepare('INSERT INTO meta_assets(id,platform,name,updated_at) VALUES(?,?,?,?)').run('12345','facebook','Wrong Facebook Page','2026-11-15T00:00:00Z');
 let response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(response.rows[0].account_name,'');assert.equal(response.rows[0].account_name_source,'unavailable');
 await s.c.upsertPosts(s.env,[post(1,{account_handle:'Stored Instagram name'})]);response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(response.rows[0].account_name,'Stored Instagram name');assert.equal(response.rows[0].account_name_source,'stored_post');
});
