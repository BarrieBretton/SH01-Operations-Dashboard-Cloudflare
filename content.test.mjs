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
 const s=setup();await group(s);await assert.rejects(s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'shares'}),/missing_ranking_metrics/);
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
 // Isolate the ambiguous clickouts append.
 s.sql.prepare("UPDATE content_sheet_outbox SET status='synced' WHERE kind='post'").run();
 s.ctx.sheetJSON=async u=>u.includes('/values/')?{values:[['URLS']]}:{sheets:[{properties:{title:'clickouts',sheetId:1,gridProperties:{columnCount:26}}}]};s.ctx.sheetToken=async()=> 'private-access';s.ctx.readSheet=async(_e,_t,title)=>title==='clickouts'?[['URLS']]:[['record_key','platform','account_id','account_handle','post_id','permalink','media_type','published_at','workflow_id','workflow_url','first_seen','last_seen','delete_status']];
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
 s.env.STORE.snapshot=async tables=>{reads++;assert.deepEqual([...tables],['content_duplicate_groups','content_posts','content_cleanup_plans','content_deletion_queue','meta_assets','content_collect_state','meta_content','meta_capabilities']);return snapshot(tables)};
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
 for(const metrics of [{views:100},{likes:100},{views:100,likes:null},{views:100,likes:'10'},{views:100,likes:-1},{views:Infinity,likes:1},{views:Number.MAX_SAFE_INTEGER,likes:1}])assert.throws(()=>c.rankDuplicateMembers([a,{...b,metrics}],1,'best','weighted_score'),/missing_ranking_metrics/);
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

test('larger verified groups supersede displayed subsets without deleting confirmed review history',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,[post(1),post(2),post(3)]);
 const base={platform:'instagram',account_id:'12345',media_type:'IMAGE',algorithm:'sh01-social-perceptual',evidence:{method:'complete_link_candidate_cluster',version:1}};
 await s.c.ingestGroups(s.env,[{...base,group_id:'small',members:['1','2']}]);
 const plan=await s.c.planCleanup(s.env,{group_id:'small',keep_count:1,keep_strategy:'best',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:plan.plan_id,confirmation:plan.confirmation});
 await s.c.ingestGroups(s.env,[{...base,group_id:'large',members:['1','2','3']}]);
 const data=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});
 assert.deepEqual(Array.from(data.rows,r=>r.group_id),['large']);assert.equal(data.rows[0].has_confirmed_history,true);assert.equal(data.rows[0].members.find(r=>r.post_id==='1').cleanup_review.decision,'remove');
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_duplicate_groups').get().n,2);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_cleanup_plans WHERE committed=1').get().n,1);
});

test('subset display filtering never crosses platform, account or fingerprint algorithm version',()=>{
 const s=setup(),base={group_id:'small',platform:'instagram',account_id:'1',media_type:'VIDEO',algorithm:'sh01-social-perceptual',members:'["a","b"]',evidence:'{"method":"complete_link_candidate_cluster","version":1}'};
 for(const extra of [{platform:'facebook'},{account_id:'2'},{media_type:'IMAGE'},{evidence:'{"method":"complete_link_candidate_cluster","version":2}'},{algorithm:'other'}]){
  s.ctx.groups=[base,{...base,...extra,group_id:'large',members:'["a","b","c"]'}];assert.equal(vm.runInContext('currentDuplicateGroups(groups).length',s.ctx),2);
 }
});

test('account priority endpoint persists through real store transactions without touching cleanup plans',async()=>{
 const s=setup();await group(s);Object.assign(s.env,{META_SYNC_ENABLED:'1',MEDIA_CLIP_API_KEY:'private-test'});s.ctx.body=r=>r.json();
 vm.runInContext(read('./scanner-automation.js'),s.ctx);
 const before=s.sql.prepare('SELECT COUNT(*) n FROM content_sheet_outbox').get().n;
 const req={url:'https://d.test/api/content/scan',method:'POST',json:async()=>({platform:'instagram',account_id:'12345'})};
 const response=await s.c.contentApi(req,s.env,{});assert.equal(response.status,'queued');assert.equal(response.coverage.pending,4);assert.equal(response.scan_status.prioritized,true);
 const payload=s.sql.prepare("SELECT payload FROM content_collect_state WHERE id='similarity_scan'").get().payload;
 await s.c.contentApi(req,s.env,{});assert.equal(s.sql.prepare("SELECT payload FROM content_collect_state WHERE id='similarity_scan'").get().payload,payload);
 const groups=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(groups.rows[0].scan_status.prioritized,true);assert.equal(groups.rows[0].scan_status.last_result,null);assert.equal(groups.rows[0].scan_coverage.pending,4);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,0);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_cleanup_plans').get().n,0);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_sheet_outbox').get().n,before);
});

test('library and group video posters use stored thumbnails only for the exact platform/account/post',async()=>{
 const s=setup();await group(s);
 await s.c.upsertPosts(s.env,[post(1,{media_type:'VIDEO',preview_type:'video',preview_url:'https://a.cdninstagram.com/video.mp4'})]);
 const insert=s.sql.prepare('INSERT INTO meta_content(id,asset_id,platform,kind,thumbnail_url,first_seen,last_seen) VALUES(?,?,?,?,?,?,?)');
 insert.run('1','wrong','instagram','VIDEO','https://a.cdninstagram.com/wrong.jpg','now','now');
 let data=await s.c.contentApi({url:'https://d.test/api/content',method:'GET'},s.env,{});assert.equal(data.rows.find(p=>p.post_id==='1').poster_url,'');
 s.sql.prepare('UPDATE meta_content SET asset_id=?,thumbnail_url=? WHERE id=?').run('12345','https://a.cdninstagram.com/poster.jpg','1');
 data=await s.c.contentApi({url:'https://d.test/api/content',method:'GET'},s.env,{});assert.equal(data.rows.find(p=>p.post_id==='1').poster_url,'https://a.cdninstagram.com/poster.jpg');
 s.sql.prepare('UPDATE meta_content SET thumbnail_url=? WHERE id=?').run('https://a.cdninstagram.com/video.mp4?oe=123','1');
 data=await s.c.contentApi({url:'https://d.test/api/content',method:'GET'},s.env,{});assert.equal(data.rows.find(p=>p.post_id==='1').poster_url,'');
});
test('queue previews and status come from one snapshot, preserve queue state and never guess an unmapped identity',async()=>{
 const s=setup();s.sql.exec(read('./sheets-sync-schema.sql'));
 await s.c.upsertPosts(s.env,[post(1,{preview_url:'https://a.cdninstagram.com/photo.jpg',preview_type:'image',caption:'Known caption'})]);
 await s.env.STORE.put('content_deletion_queue',{request_id:'q1',platform:'instagram',account_id:'12345',post_id:'1',permalink:post(1).permalink,status:'awaiting_sheet',reason:'confirmed_duplicate_plan',created_at:'2026-11-15T13:42:00Z',updated_at:'now'});
 await s.env.STORE.put('content_deletion_queue',{request_id:'q2',platform:'instagram',account_id:'999',post_id:'1',permalink:post(1).permalink,status:'awaiting_sheet',reason:'test',created_at:'2026-11-15T13:42:00Z',updated_at:'now'});
 const snapshot=s.env.STORE.snapshot.bind(s.env.STORE);let reads=0;s.env.STORE.snapshot=async t=>{reads++;return snapshot(t)};
 const result=await s.c.contentApi({url:'https://d.test/api/content/queue',method:'GET'},s.env,{});assert.equal(reads,1);
 const known=result.rows.find(r=>r.request_id==='q1'),unknown=result.rows.find(r=>r.request_id==='q2');
 assert.equal(known.caption,'Known caption');assert.equal(known.metrics.views,10);assert.equal(known.status,'awaiting_sheet');assert.equal(known.created_at,'2026-11-15T13:42:00Z');assert.equal(known.preview_available,true);
 assert.equal(unknown.preview_available,false);assert.equal(unknown.preview_url,undefined);assert.equal(unknown.caption,undefined);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,2);
});

test('overall scan coverage counts all stored accounts once, including accounts without groups, in the existing snapshot',async()=>{
 const s=setup();await group(s);vm.runInContext(read('./scanner-automation.js'),s.ctx);
 const fp={algorithm:'sh01-social-perceptual',version:1,media_type:'IMAGE',hashes:['123456789abcdef0'],gray_stddev:20};
 await s.c.upsertPosts(s.env,[post(1,{fingerprint:fp}),post(5,{account_id:'99999',fingerprint:fp}),post(6,{account_id:'99999'}),post(7,{account_id:'99999'}),post(8,{account_id:'99999',media_type:'CAROUSEL'}),post(9,{platform:'facebook',permalink:'https://www.facebook.com/12345/posts/9',fingerprint:fp}),post(10,{platform:'facebook',permalink:'https://www.facebook.com/12345/posts/10',fingerprint:fp})]);
 s.sql.prepare("UPDATE content_posts SET delete_status='deleted' WHERE platform='instagram' AND post_id='4'").run();
 s.sql.prepare('INSERT INTO meta_assets(id,platform,name,updated_at) VALUES(?,?,?,?)').run('empty','instagram','Empty account','2026-11-15T00:00:00Z');
 for(let i=0;i<22;i++)await s.c.ingestGroups(s.env,[{group_id:'g'+i,platform:'instagram',account_id:'12345',media_type:'IMAGE',members:['1','2'],algorithm:'test',evidence:{fixture:i}}]);
 const snapshot=s.env.STORE.snapshot.bind(s.env.STORE);let reads=0;s.env.STORE.snapshot=names=>{reads++;return snapshot(names);};
 const result=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(reads,1);assert.equal(result.rows.length,20);const p=result.scan_progress;
 assert.deepEqual(JSON.parse(JSON.stringify(p.totals)),{eligible:8,fingerprinted:4,pending:4,accounts:4,accounts_with_posts:3,accounts_fingerprinted:1});assert.equal(p.full_history_verified,false);assert.equal(p.scope,'stored_supported_facebook_instagram_posts');
 assert.equal(p.accounts.find(a=>a.account_id==='99999').eligible,3);assert.equal(p.accounts.find(a=>a.account_id==='empty').eligible,0);assert.equal(p.accounts.filter(a=>a.account_id==='12345').length,2);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,0);
});

test('complete group index retains an older account beyond twenty recent groups and loads its exact details on demand',async()=>{
 const s=setup();await group(s);
 await s.c.upsertPosts(s.env,[post('a1',{account_id:'17841478352273385',account_handle:'@aand.cut'}),post('a2',{account_id:'17841478352273385',account_handle:'@aand.cut'})]);
 await s.c.ingestGroups(s.env,[{group_id:'aand_old',platform:'instagram',account_id:'17841478352273385',media_type:'IMAGE',members:['a1','a2'],algorithm:'test',evidence:{}}]);
 s.sql.prepare("UPDATE content_duplicate_groups SET updated_at='2020-01-01T00:00:00Z' WHERE group_id='aand_old'").run();
 for(let i=0;i<24;i++)await s.c.ingestGroups(s.env,[{group_id:'recent_'+i,platform:'instagram',account_id:'12345',media_type:'IMAGE',members:['1','2'],algorithm:'test',evidence:{}}]);
 const snapshot=s.env.STORE.snapshot.bind(s.env.STORE);let reads=0;s.env.STORE.snapshot=names=>{reads++;return snapshot(names);};
 const before=s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n;
 const listed=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(reads,1);assert.equal(listed.rows.length,20);assert.equal(listed.index_complete,true);assert.equal(listed.index.length,26);assert.equal(listed.total,26);assert.equal(listed.rows.some(g=>g.group_id==='aand_old'),false);
 const old=listed.index.find(g=>g.group_id==='aand_old');assert.equal(old.account_name,'@aand.cut');assert.equal(old.member_count,2);assert.equal(old.details_loaded,false);assert.equal(old.members,undefined);assert.equal(old.evidence,undefined);
 const detailed=await s.c.contentApi({url:'https://d.test/api/content/groups?group_id=aand_old',method:'GET'},s.env,{});assert.equal(reads,2);assert.equal(detailed.rows.length,1);assert.equal(detailed.rows[0].details_loaded,true);assert.equal(detailed.rows[0].group_id,'aand_old');assert.ok(detailed.rows[0].members.every(p=>p.account_id==='17841478352273385'));assert.deepEqual(Array.from(detailed.rows[0].members,p=>p.post_id),['a1','a2']);assert.equal(detailed.index,undefined);
 await assert.rejects(s.c.contentApi({url:'https://d.test/api/content/groups?group_id=not_found',method:'GET'},s.env,{}),/group_not_found_refresh_groups/);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,before);
});

test('complete group index keeps confirmed review evidence scoped to exact platform and account',async()=>{
 const s=setup();await group(s);const p=await s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation});
 await s.c.upsertPosts(s.env,[post(1,{account_id:'99999'}),post(2,{account_id:'99999'})]);await s.c.ingestGroups(s.env,[{group_id:'other',platform:'instagram',account_id:'99999',media_type:'IMAGE',members:['1','2'],algorithm:'test',evidence:{}}]);
 const r=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(r.index.find(g=>g.group_id==='g').has_confirmed_history,true);assert.equal(r.index.find(g=>g.group_id==='other').has_confirmed_history,false);
});


test('metric evidence distinguishes saved zero, unsupported, denied and missing without leaking provider messages',async()=>{
 const s=setup();await group(s);
 await s.c.upsertPosts(s.env,[post(1,{metrics:{views:0,likes:0}})]);
 await s.env.STORE.put('meta_content',{first_seen:new Date().toISOString(),last_seen:new Date().toISOString(),id:'1',asset_id:'12345',platform:'instagram',kind:'IMAGE'});
 const now=new Date().toISOString();
 for(const [metric,status,reason] of [['views','available','v24.0'],['likes','unavailable','permission_denied; SECRET'],['comments','unavailable','v24.0; metric_unsupported'],['shares','unavailable','rate_limited']])await s.env.STORE.put('meta_capabilities',{asset_id:'1',kind:'IMAGE',metric,status,reason,checked_at:now});
 const response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{}),p=response.rows[0].members.find(p=>p.post_id==='1');
 assert.equal(p.metrics.views,0);assert.equal(p.metric_status.views.status,'available');assert.equal(p.metrics.likes,0);assert.equal(p.metric_status.likes.refresh_status,'permission_required');assert.equal(p.metric_status.comments.status,'unsupported');assert.equal(p.metric_status.shares.status,'deferred');assert.doesNotMatch(JSON.stringify(p),/SECRET/);
 const library=await s.c.contentApi({url:'https://d.test/api/content',method:'GET'},s.env,{});assert.deepEqual(library.rows.find(p=>p.post_id==='1').metric_status,p.metric_status);
 assert.equal(response.rows[0].members.find(p=>p.post_id==='2').metric_status.likes.status,'not_collected');
});

test('metric failures attach only to the exact platform account post and retain numeric history',async()=>{
 const s=setup();await group(s);await s.env.STORE.put('meta_content',{first_seen:new Date().toISOString(),last_seen:new Date().toISOString(),id:'1',asset_id:'other',platform:'facebook',kind:'POST'});
 await s.env.STORE.put('meta_capabilities',{asset_id:'1',kind:'POST',metric:'engagement_fields',status:'unavailable',reason:'permission_denied',checked_at:new Date().toISOString()});
 let response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(response.rows[0].members[0].metric_status.likes.status,'not_collected');
 await s.env.STORE.put('meta_content',{first_seen:new Date().toISOString(),last_seen:new Date().toISOString(),id:'1',asset_id:'12345',platform:'instagram',kind:'IMAGE'});await s.env.STORE.put('content_collect_state',{id:'meta:post:1',payload:JSON.stringify({error:'network_unavailable',checked_at:new Date().toISOString()})});
 response=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});const p=response.rows[0].members[0];assert.equal(p.metrics.views,10);assert.equal(p.metric_status.views.refresh_status,'failed');assert.equal(p.metric_status.likes.status,'failed');
});


function mirrorFixture(s,initial={clickouts:[['URLS']]}){
 const tabs=new Map(Object.entries(initial).map(([title,rows],i)=>[title,{sheetId:i+1,rows:structuredClone(rows),columnCount:26}])),calls=[];let mode='ok';
 s.ctx.sheetToken=async()=> 'private';s.ctx.sheetJSON=async u=>{if(u.includes('/values/')){const range=decodeURIComponent(u.split('/values/')[1]);assert.match(range,/!A:Z$/);return {values:await s.ctx.readSheet(null,null,range.split("'")[1])};}return {sheets:[...tabs].map(([title,t])=>({properties:{title,sheetId:t.sheetId,gridProperties:{columnCount:t.columnCount}}}))};};
 s.ctx.readSheet=async(_env,_token,title)=>{calls.push({read:title});if(!tabs.has(title))throw Error('google_http_400');return structuredClone(tabs.get(title).rows);};
 const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)-1;
 s.ctx.fetch=async(url,options)=>{
  const body=JSON.parse(options.body),entry={url,body};calls.push(entry);
  if(url.endsWith(':batchUpdate')&&!url.includes('/values')){
   const replies=body.requests.map(r=>{if(r.addSheet){const title=r.addSheet.properties.title,t={sheetId:tabs.size+1,rows:[],columnCount:26};tabs.set(title,t);return {addSheet:{properties:{title,sheetId:t.sheetId,gridProperties:{columnCount:26}}}};}return {};});return {ok:true,json:async()=>({replies})};
  }
  if(url.includes(':append')){
   if(mode==='reject')return {ok:false,status:400,json:async()=>({})};
   const t=tabs.get('clickouts');if(mode!=='lost-before')t.rows.push(...structuredClone(body.values));
   if(mode.startsWith('lost'))throw Error('network_lost');return {ok:true,json:async()=>({updates:{updatedRows:body.values.length}})};
  }
  assert.equal(body.valueInputOption,'RAW');
  for(const update of body.data){const m=update.range.match(/^'([^']+)'!([A-Z]+)(\d+)/);assert.ok(m,update.range);const rows=tabs.get(m[1]).rows,r=Number(m[3])-1,c=col(m[2]);while(rows.length<=r)rows.push([]);update.values[0].forEach((v,i)=>rows[r][c+i]=v);}
  return {ok:true,json:async()=>({})};
 };
 return {tabs,calls,setMode:v=>mode=v};
}
async function confirmedMirrorFixture(){const s=setup();await group(s);const p=await s.c.planCleanup(s.env,{group_id:'g',keep_count:1,keep_strategy:'best',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation});return s;}
test('confirmed clickouts bypass a missing mapping tab, batch all removals and include exact text identities',async()=>{
 const s=await confirmedMirrorFixture(),f=mirrorFixture(s);assert.ok(await s.env.STORE.find('content_collect_state',{id:'request:sheet_mirror'}));
 const result=await s.c.mirrorContentSheets(s.env);assert.equal(result.status,'ok');assert.equal(result.processed,3);assert.deepEqual(f.calls.filter(c=>c.read).map(c=>c.read),['clickouts']);
 const rows=f.tabs.get('clickouts').rows;assert.deepEqual(rows[0],['URLS','platform','account_id','post_id','request_id','queued_at']);assert.equal(rows.length,4);
 for(const r of rows.slice(1)){assert.equal(r[1],'instagram');assert.equal(r[2],'12345');assert.equal(typeof r[3],'string');assert.ok(r[4]);assert.ok(r[5]);assert.match(r[0],/instagram.com/);}
 assert.equal(s.sql.prepare("SELECT count(*) n FROM content_deletion_queue WHERE status='queued_clickouts'").get().n,3);assert.equal(f.calls.filter(c=>c.url?.includes(':append')).length,1);
 assert.equal((await s.c.mirrorContentSheets(s.env)).status,'ok');assert.ok(f.tabs.has('meta-posts-to-id'));assert.equal(f.tabs.get('meta-posts-to-id').rows.length,5);assert.equal(f.calls.filter(c=>c.url?.includes(':append')).length,1);
});
test('legacy URL rows gain identity without duplicate links or overwriting workflow columns',async()=>{
 const s=await confirmedMirrorFixture(),q=s.sql.prepare('SELECT * FROM content_deletion_queue ORDER BY post_id').all(),f=mirrorFixture(s,{clickouts:[['notes','URLS','status'],['operator note',q[0].permalink,'reviewed']]});
 assert.equal((await s.c.mirrorContentSheets(s.env)).status,'ok');const rows=f.tabs.get('clickouts').rows;assert.equal(rows.length,4);assert.deepEqual(rows[1].slice(0,3),['operator note',q[0].permalink,'reviewed']);assert.equal(rows[1][rows[0].indexOf('post_id')],q[0].post_id);
 const appended=f.calls.find(c=>c.url?.includes(':append')).body.values;assert.equal(appended.length,2);assert.ok(appended.every(r=>r[0]===''&&r[2]===''));
});
test('a definite Sheet append rejection stays retryable while a lost response is reconciled without another append',async()=>{
 const s=await confirmedMirrorFixture(),f=mirrorFixture(s);f.setMode('reject');let r=await s.c.mirrorContentSheets(s.env);assert.match(r.error_code,/append_clickouts:google_write_http_400/);assert.equal(s.sql.prepare("SELECT count(*) n FROM content_sheet_outbox WHERE kind='clickouts' AND status='pending'").get().n,3);
 f.setMode('lost-after');r=await s.c.mirrorContentSheets(s.env);assert.equal(r.status,'failed');assert.equal(s.sql.prepare("SELECT count(*) n FROM content_sheet_outbox WHERE kind='clickouts' AND status='uncertain'").get().n,3);
 s.sql.prepare("UPDATE content_sheet_outbox SET status='synced' WHERE kind='post'").run();f.setMode('ok');r=await s.c.mirrorContentSheets(s.env);assert.equal(r.status,'ok');assert.equal(r.processed,3);assert.equal(f.calls.filter(c=>c.url?.includes(':append')).length,2);assert.equal(f.tabs.get('clickouts').rows.length,4);
});
test('uncertain absent rows are never re-appended and existing identity conflicts fail before mutation',async()=>{
 const s=await confirmedMirrorFixture(),f=mirrorFixture(s);f.setMode('lost-before');await s.c.mirrorContentSheets(s.env);s.sql.prepare("UPDATE content_sheet_outbox SET status='synced' WHERE kind='post'").run();f.setMode('ok');const r=await s.c.mirrorContentSheets(s.env);assert.equal(r.status,'needs_review');assert.equal(f.calls.filter(c=>c.url?.includes(':append')).length,1);
 const t=await confirmedMirrorFixture(),q=t.sql.prepare('SELECT * FROM content_deletion_queue').get(),g=mirrorFixture(t,{clickouts:[['URLS','platform','account_id','post_id','request_id','queued_at'],[q.permalink,'instagram','another-account','wrong-post',q.request_id,'']]});
 assert.match((await t.c.mirrorContentSheets(t.env)).error_code,/clickouts_identity_conflict/);assert.equal(g.calls.filter(c=>c.url).length,0);assert.equal(g.tabs.get('clickouts').rows[1][2],'another-account');
});
test('large Meta post IDs survive clickouts export as strings',async()=>{
 const s=setup(),id='9223372036854775807';await s.c.upsertPosts(s.env,[post(id),post('2')]);await s.c.ingestGroups(s.env,[{group_id:'big',platform:'instagram',account_id:'12345',media_type:'IMAGE',members:[id,'2'],algorithm:'fixture',evidence:{}}]);
 const p=await s.c.planCleanup(s.env,{group_id:'big',keep_count:1,keep_strategy:'worst',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation});const f=mirrorFixture(s);assert.equal((await s.c.mirrorContentSheets(s.env)).status,'ok');assert.equal(f.tabs.get('clickouts').rows[1][3],id);
});

const reviewFP=(hash='0123456789abcdef')=>({algorithm:'sh01-social-perceptual',version:1,media_type:'IMAGE',hashes:[hash],gray_stddev:30});
const reviewGroup=(id,ids,extra={})=>({group_id:id,platform:'instagram',account_id:'12345',media_type:'IMAGE',algorithm:'sh01-social-perceptual',members:ids.map(String),evidence:{method:'complete_link_candidate_cluster',version:1},...extra});
test('seven reviewed posts plus a later overlapping 29-post scan become one partially reviewed 35-post group',async()=>{
 const s=setup();for(let i=1;i<=35;i++)await s.c.upsertPosts(s.env,[post(i,{fingerprint:reviewFP()})]);
 await s.c.ingestGroups(s.env,[reviewGroup('old-seven',[1,2,3,4,5,6,7])]);
 const old=await s.c.planCleanup(s.env,{group_id:'old-seven',keep_count:1,keep_strategy:'best',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:old.plan_id,confirmation:old.confirmation});
 await s.c.ingestGroups(s.env,[reviewGroup('new-29',Array.from({length:29},(_,i)=>i+7))]);
 const read=()=>s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});
 const before=s.sql.prepare('SELECT COUNT(*) n FROM content_sheet_outbox').get().n;
 let data=await read(),g=data.rows[0];assert.equal(data.total,1);assert.equal(g.members.length,35);assert.equal(g.review_coverage.reviewed,7);assert.equal(g.review_coverage.unreviewed,28);assert.equal(g.review_coverage.status,'partial');assert.deepEqual(data.index[0].review_coverage,g.review_coverage);
 assert.equal(g.members.filter(p=>p.cleanup_review.decision==='keep').length,1);assert.equal(g.members.filter(p=>p.cleanup_review.decision==='remove').length,6);assert.equal(g.members.filter(p=>!p.cleanup_review.decision).length,28);
 assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_sheet_outbox').get().n,before,'read reconciliation cannot queue links');assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_duplicate_groups').get().n,2,'immutable group history retained');
 const detail=await s.c.contentApi({url:'https://d.test/api/content/groups?group_id='+g.group_id,method:'GET'},s.env,{});assert.deepEqual(detail.rows[0].review_coverage,g.review_coverage);
 // Missing counts on already queued posts do not block a plan for the 29 active posts.
 s.sql.prepare("UPDATE content_posts SET metrics='{}' WHERE delete_status='awaiting_sheet'").run();
 const next=await s.c.planCleanup(s.env,{group_id:g.group_id,keep_count:1,keep_strategy:'best',metric:'views'});assert.equal(next.eligible_count,29);assert.equal(next.excluded_previously_queued.length,6);assert.equal(next.remove.length,28);assert.ok(next.remove.every(p=>Number(p.post_id)>=7));assert.equal((await read()).rows[0].review_coverage.reviewed,7,'a preview is not a review');
 await s.c.queueCleanup(s.env,{plan_id:next.plan_id,confirmation:next.confirmation});data=await read();assert.equal(data.rows[0].review_coverage.reviewed,35);assert.equal(data.rows[0].review_coverage.status,'reviewed');assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,34);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_cleanup_plans WHERE committed=1').get().n,2);
});
test('overlap alone cannot merge groups; disjoint compatible fingerprints can, within exact scope and version',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,[post(1,{fingerprint:reviewFP('0000000000000000')}),post(2,{fingerprint:reviewFP()}),post(3,{fingerprint:reviewFP('ffffffffffffffff')})]);
 await s.c.ingestGroups(s.env,[reviewGroup('ab',[1,2]),reviewGroup('bc',[2,3])]);
 const read=()=>s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal((await read()).total,2);
 await s.c.upsertPosts(s.env,Array.from({length:4},(_,i)=>post(i+1,{fingerprint:reviewFP()})));await s.c.ingestGroups(s.env,[reviewGroup('cd',[3,4])]);assert.equal((await read()).rows[0].members.length,4);
 s.ctx.groups=[reviewGroup('ab',[1,2]),reviewGroup('cd',[3,4],{evidence:{method:'complete_link_candidate_cluster',version:2}})].map(g=>({...g,members:JSON.stringify(g.members),evidence:JSON.stringify(g.evidence)}));s.ctx.posts=s.sql.prepare('SELECT * FROM content_posts').all();assert.equal(vm.runInContext('currentDuplicateGroups(groups,posts).length',s.ctx),2);
 for(const different of [{platform:'facebook'},{account_id:'other'},{media_type:'VIDEO'},{algorithm:'other'}]){s.ctx.groups[1]={...s.ctx.groups[1],...different,evidence:'{"method":"complete_link_candidate_cluster","version":1}'};assert.equal(vm.runInContext('currentDuplicateGroups(groups,posts).length',s.ctx),2);}
});
test('review coverage is identical in index and details and never borrows an unrelated account review',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,Array.from({length:5},(_,i)=>post(i+1)));await s.c.ingestGroups(s.env,[reviewGroup('reviewed',[1,2]),reviewGroup('partial',[2,3,4]),reviewGroup('unreviewed',[4,5])]);
 const p=await s.c.planCleanup(s.env,{group_id:'reviewed',keep_count:1,keep_strategy:'best',metric:'views'});await s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation});
 const d=await s.c.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});for(const g of d.rows)assert.deepEqual(d.index.find(x=>x.group_id===g.group_id).review_coverage,g.review_coverage);
 assert.equal(d.rows.find(x=>x.group_id==='partial').review_coverage.reviewed,1);assert.equal(d.rows.find(x=>x.group_id==='unreviewed').review_coverage.reviewed,0);
});
test('queued fingerprints remain comparison evidence while confirmed deletions and other accounts stay excluded',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,[post(1,{fingerprint:reviewFP()}),post(2,{fingerprint:reviewFP()}),post(3,{fingerprint:reviewFP()}),post(4,{fingerprint:reviewFP()})]);
 s.sql.prepare("UPDATE content_posts SET delete_status='queued_clickouts' WHERE post_id='1'").run();s.sql.prepare("UPDATE content_posts SET delete_status='awaiting_sheet' WHERE post_id='2'").run();s.sql.prepare("UPDATE content_posts SET delete_status='deleted' WHERE post_id='3'").run();s.sql.prepare("UPDATE content_posts SET account_id='other' WHERE post_id='4'").run();
 const d=await s.c.contentApi({url:'https://d.test/api/ingest/fingerprints?platform=instagram&account_id=12345',method:'GET'},s.env,{});assert.deepEqual(Array.from(d.fingerprints,p=>p.post_id),['1','2']);
});
test('a new verified group member after preview invalidates confirmation without creating queue entries',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,[post(1,{fingerprint:reviewFP()}),post(2,{fingerprint:reviewFP()}),post(3,{fingerprint:reviewFP()})]);await s.c.ingestGroups(s.env,[reviewGroup('ab',[1,2])]);
 const p=await s.c.planCleanup(s.env,{group_id:'ab',keep_count:1,keep_strategy:'best',metric:'views'});await s.c.ingestGroups(s.env,[reviewGroup('bc',[2,3])]);await assert.rejects(s.c.queueCleanup(s.env,{plan_id:p.plan_id,confirmation:p.confirmation}),/group_or_metrics_changed/);assert.equal(s.sql.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,0);
});
test('saved video consolidation preserves ordered-frame, duration and low-information guards',()=>{
 const {ctx}=setup();const frame=hash=>reviewFP(hash),video=(hash='0123456789abcdef',extra={})=>({algorithm:'sh01-social-perceptual',version:1,media_type:'VIDEO',duration:10,sample_positions:[0.1,0.3,0.5,0.7,0.9],frames:Array.from({length:5},()=>frame(hash)),...extra});
 ctx.a=video();ctx.b=video();assert.equal(vm.runInContext('duplicateFingerprintMatch(a,b,{pairs:0,hashes:0})',ctx),true);
 for(const b of [video('ffffffffffffffff'),video(undefined,{duration:20}),video(undefined,{sample_positions:[0,0.2,0.4,0.6,0.8]}),video(undefined,{frames:Array.from({length:5},()=>({...frame('0123456789abcdef'),gray_stddev:0}))})]){ctx.b=b;assert.equal(vm.runInContext('duplicateFingerprintMatch(a,b,{pairs:0,hashes:0})',ctx),false);}
 ctx.b=video();assert.throws(()=>vm.runInContext('duplicateFingerprintMatch(a,b,{pairs:0,hashes:100000})',ctx),/budget/);
});
test('consolidation cannot exceed 100 members and a missing post never becomes reviewed by association',async()=>{
 const s=setup();s.ctx.groups=[reviewGroup('a',Array.from({length:100},(_,i)=>i+1)),reviewGroup('b',[100,101])].map(g=>({...g,members:JSON.stringify(g.members),evidence:JSON.stringify(g.evidence)}));s.ctx.posts=Array.from({length:101},(_,i)=>({...post(i+1),fingerprint:JSON.stringify(reviewFP())}));assert.equal(vm.runInContext('currentDuplicateGroups(groups,posts).length',s.ctx),2);
 const g={platform:'instagram',account_id:'12345',members:[post(1)],missing_members:['2']},plan={committed:1,plan_id:'p',payload:JSON.stringify({platform:'instagram',account_id:'12345',keep:['1'],remove:[]})};const result=s.c.groupReviewState(g,[plan],[]);assert.equal(result.review_coverage.total,2);assert.equal(result.review_coverage.reviewed,1);assert.equal(result.review_coverage.status,'partial');
});

test('lightweight index avoids preview decoration while exact group detail remains available',async()=>{
 const s=setup();await s.c.upsertPosts(s.env,[post(1),post(2)]);
 await s.c.ingestGroups(s.env,[{group_id:'light',platform:'instagram',account_id:'12345',media_type:'IMAGE',algorithm:'manual',members:['1','2'],evidence:{}}]);
 let decorated=0;s.ctx.extrasDecorate=async(env,rows)=>{decorated+=rows.length;return rows};
 const result=await s.c.contentApi({url:'https://d.test/api/content/groups?index_only=1',method:'GET'},s.env,{});
 assert.equal(result.rows.length,0);assert.equal(result.index.length,1);assert.equal(result.index_complete,true);assert.equal(result.index[0].details_loaded,false);assert.equal(decorated,0);
 const detail=await s.c.contentApi({url:'https://d.test/api/content/groups?group_id=light',method:'GET'},s.env,{});
 assert.equal(detail.rows[0].members.length,2);assert.equal(decorated,2);
});
