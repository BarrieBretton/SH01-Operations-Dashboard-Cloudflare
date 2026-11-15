import {attachStore} from './test-store-helper.mjs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';import {DatabaseSync} from 'node:sqlite';import {webcrypto} from 'node:crypto';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
function setup(expired=false){const db=new DatabaseSync(':memory:');db.exec(read('./content-schema.sql'));db.exec(read('./meta-schema.sql'));function prepare(q){let a=[];return {bind(...v){a=v;return this},run(){return {meta:{changes:db.prepare(q).run(...a).changes}}},first(){return db.prepare(q).get(...a)},all(){return {results:db.prepare(q).all(...a)}}}}const env={DB:{prepare,batch(s){return s.map(x=>x.run())}},META_SYSVAR:'private-token-that-must-not-be-stored',META_GRAPH_VERSION:'v24.0'};
 const calls=[],ctx={crypto:webcrypto,TextEncoder,URL,URLSearchParams,AbortSignal,console,setTimeout,clean:s=>String(s??''),producerURL:s=>s,iso:s=>new Date(s).toISOString(),json:x=>x,error:(m,s)=>({error:m,status:s}),fetch:async(u,o)=>{calls.push({url:u,headers:o.headers});let data;if(expired)data={error:{code:190}};else if(u.includes('/me/accounts'))data={data:[{id:'100',name:'Own Page',access_token:'page-secret',instagram_business_account:{id:'200'}}]};else if(u.includes('published_posts'))data={data:[{id:'100_300',permalink_url:'https://www.facebook.com/100/posts/300',created_time:'2026-01-01T00:00:00Z',message:'A post',full_picture:'https://a.fbcdn.net/image.jpg'}]};else data={error:{code:100}};return {ok:!data.error,status:data.error?400:200,json:async()=>data}}};attachStore(env,db,ctx);vm.createContext(ctx);vm.runInContext(read('./content-ledger.js')+read('./meta-worker.js')+';globalThis.run=metaSync;',ctx);return {db,env,ctx,calls}}
test('Bounded Meta collection stores real metadata, marks unsupported metrics, and never stores transient tokens',async()=>{const s=setup();const r=await s.ctx.run(s.env);assert.equal(r.status,'partial');assert.equal(r.media,1);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM content_posts').get().n,1);assert.ok(s.calls.every(c=>!c.url.includes('secret')&&!c.url.includes('access_token=')));for(const t of ['content_posts','content_collect_state','meta_capabilities','content_jobs'])assert.ok(!JSON.stringify(s.db.prepare('SELECT * FROM '+t).all()).includes('private-token'));assert.equal(s.db.prepare('SELECT preview_url FROM content_posts').get().preview_url,'https://a.fbcdn.net/image.jpg')});
test('Expired credentials preserve previous rows and release collector lease with safe error',async()=>{const s=setup(true);await assert.rejects(s.ctx.run(s.env),/credential_rejected/);const state=s.db.prepare("SELECT * FROM content_jobs WHERE id='meta_collect'").get();assert.equal(state.status,'failed');assert.equal(state.lease,null);assert.equal(state.error_code,'credential_rejected')});
test('Probe scheduling is per media, skips fresh checks and eventually visits every candidate',()=>{const s=setup();const c=s.ctx;vm.runInContext('globalThis.helpers={metaDue,metaCatalog,metaObservation,metaErrorCategory,metaProgress,metaCoverage}',c);const catalog=c.helpers.metaCatalog('instagram','REELS'),caps=[],now=Date.now();let visited=new Set();for(let i=0;i<8;i++){const due=c.helpers.metaDue(catalog,'300','REELS',caps,now);for(const spec of due){visited.add(spec.metric);caps.push({asset_id:'300',kind:'REELS',metric:spec.metric,status:'available',checked_at:new Date(now).toISOString()});}}assert.equal(visited.size,catalog.length);assert.equal(c.helpers.metaDue(catalog,'301','REELS',caps,now).length,2);});
test('Structured breakdowns retain dimensions without fabricating a scalar total',()=>{const s=setup();vm.runInContext('globalThis.parse=metaObservation;globalThis.classify=metaErrorCategory',s.ctx);const v=s.ctx.parse({total_value:{breakdowns:[{dimension_keys:['follow_type'],results:[{dimension_values:['FOLLOWER'],value:0}]}]}});assert.equal(v.value,undefined);assert.equal(v.breakdowns[0].results[0].value,0);assert.equal(s.ctx.classify({code:100,message:'Invalid parameter; private-secret'},400),'invalid_parameter_or_object');assert.equal(s.ctx.classify({code:100,message:'metric must be one of the valid insights metrics'},400),'metric_unsupported');assert.equal(s.ctx.classify({code:200},400),'permission_denied')});
test('Fresh Facebook views and engagement fields reach registry without impressions aliasing',async()=>{const s=setup();s.ctx.fetch=async u=>{let data;if(u.includes('/me/accounts'))data={data:[{id:'100',name:'Own Page',access_token:'page-secret'}]};else if(u.includes('/published_posts'))data={data:[{id:'100_300',permalink_url:'https://www.facebook.com/100/posts/300',created_time:'2026-01-01T00:00:00Z'}]};else if(u.includes('/insights')){const metric=new URL(u).searchParams.get('metric');data={data:[{name:metric,values:[{value:metric==='post_media_view'?42:{like:2}}]}]};}else data={likes:{summary:{total_count:2}},comments:{summary:{total_count:0}},shares:{count:1}};return {ok:true,status:200,json:async()=>data}};await s.ctx.run(s.env);const metrics=JSON.parse(s.db.prepare('SELECT metrics FROM content_posts').get().metrics);assert.equal(metrics.views,42);assert.equal(metrics.likes,2);assert.equal(metrics.comments,0);assert.equal(metrics.shares,1);assert.equal(metrics.post_impressions,undefined);});
test('Account phase supplies reporting parameters and stores daily semantics',async()=>{const s=setup();s.db.prepare('INSERT INTO content_collect_state(id,payload) VALUES(?,?)').run('meta',JSON.stringify({'100':{turn:2}}));let queries=[];s.ctx.fetch=async u=>{const url=new URL(u);let data;if(u.includes('/me/accounts'))data={data:[{id:'100',name:'Own Page'}]};else{queries.push(url);data=url.searchParams.has('fields')?{followers_count:10}:{data:[{name:url.searchParams.get('metric'),values:[{value:7}]}]}};return {ok:true,status:200,json:async()=>data}};await s.ctx.run(s.env);assert.ok(queries.filter(u=>u.pathname.endsWith('/insights')).every(u=>u.searchParams.get('period')==='day'&&u.searchParams.has('since')&&u.searchParams.has('until')));assert.match(s.db.prepare('SELECT source_period FROM meta_snapshots WHERE source_period LIKE \'day:%\'').get().source_period,/^day:/);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM content_posts').get().n,0)});
test('Account failure is recorded and does not starve the next account',async()=>{const s=setup();s.ctx.fetch=async u=>({ok:!u.includes('published_posts'),status:u.includes('published_posts')?400:200,json:async()=>u.includes('/me/accounts')?{data:[{id:'100',name:'First'},{id:'200',name:'Second'}]}:u.includes('published_posts')?{error:{code:200}}:{id:'100'}});await assert.rejects(s.ctx.run(s.env));const state=JSON.parse(s.db.prepare("SELECT payload FROM content_collect_state WHERE id='meta'").get().payload);assert.equal(state['100'].last_error,'permission_denied');assert.ok(state['100'].attempted_at);});

test('discovery stores the actual Instagram username independently of its linked Facebook Page name',async()=>{
 const s=setup(),original=s.ctx.fetch;s.ctx.fetch=async(u,o)=>{if(u.includes('/me/accounts')){const fields=new URL(u).searchParams.get('fields');assert.match(fields,/instagram_business_account\{id,username,name\}/);return {ok:true,status:200,json:async()=>({data:[{id:'100',name:'Different Facebook Page',access_token:'page-secret',instagram_business_account:{id:'200',username:'real.instagram',name:'Actual Instagram Name'}}]})};}return original(u,o);};await s.ctx.run(s.env);assert.equal(s.db.prepare("SELECT name FROM meta_assets WHERE id='100'").get().name,'Different Facebook Page');assert.equal(s.db.prepare("SELECT name FROM meta_assets WHERE id='200'").get().name,'@real.instagram · Actual Instagram Name');
 assert.equal(s.ctx.metaInstagramName({id:'200'},'@previous.handle'),'@previous.handle');assert.equal(s.ctx.metaInstagramName({id:'200'}),'');
});

test('optional Instagram name fields fall back without stopping discovery and are not repeatedly retried',async()=>{
 const s=setup(),state={},calls=[];const call=async(path,token,params)=>{calls.push({path,params});if(params.fields.includes('{'))throw Error('Graph error 200');return {data:[{id:'100',name:'Page'}]};};
 let result=await s.ctx.metaDiscoverNamedAccounts(call,'private',state);assert.equal(result.data.length,1);assert.equal(calls.length,2);assert.ok(Date.parse(state.instagram_name_retry_after)>Date.now()+23*3600000);
 result=await s.ctx.metaDiscoverNamedAccounts(call,'private',state);assert.equal(result.data.length,1);assert.equal(calls.length,3);assert.doesNotMatch(calls[2].params.fields,/\{/);
 let failures=0;await assert.rejects(s.ctx.metaDiscoverNamedAccounts(async()=>{failures++;throw Error('Graph error 190');},'private',{}),/190/);assert.equal(failures,1);
});


test('Facebook expanded-field rejection falls back independently; missing is not zero and reactions are not likes',async()=>{
 const s=setup(),calls=[];const call=async(id,token,params)=>{calls.push(params.fields);if(params.fields.includes(','))throw Object.assign(Error('Graph error 100'),{category:'invalid_parameter_or_object'});if(params.fields.startsWith('likes'))return {likes:{summary:{total_count:0}}};if(params.fields.startsWith('comments'))return {comments:{summary:{total_count:3}}};return {};};
 const result=await s.ctx.metaFacebookCounts(call,'100_300','private',[],{calls:2});assert.deepEqual({...result.values},{likes:0,comments:3});assert.equal(result.errors.shares,'metric_not_returned');assert.equal(calls.length,4);
 let deniedCalls=0;const denied=await s.ctx.metaFacebookCounts(async()=>{deniedCalls++;throw Object.assign(Error('Graph error 200'),{category:'permission_denied'});},'100_300','private',[],{calls:2});assert.equal(deniedCalls,1);assert.equal(denied.errors.likes,'permission_denied');
 const partial=await s.ctx.metaFacebookCounts(async()=>({likes:{summary:{total_count:2}},comments:{summary:{total_count:0}}}),'100_300','private',[],{calls:2});assert.equal(partial.values.comments,0);assert.equal(partial.values.shares,undefined);
});

async function metricFixture(s){
 const posts=['100_301','100_302','100_303'].map((id,i)=>({platform:'facebook',account_id:'100',post_id:id,permalink:'https://www.facebook.com/100/posts/'+id.split('_')[1],media_type:'IMAGE',metrics:{}}));
 await s.ctx.upsertPosts(s.env,posts);await s.ctx.ingestGroups(s.env,[{group_id:'metric_group',platform:'facebook',account_id:'100',media_type:'IMAGE',members:posts.map(p=>p.post_id),algorithm:'fixture',evidence:{}}]);
 await s.env.STORE.put('meta_assets',{id:'100',platform:'facebook',name:'Own Page',updated_at:new Date().toISOString()});
 for(const p of posts)await s.env.STORE.put('meta_content',{first_seen:new Date().toISOString(),last_seen:new Date().toISOString(),id:p.post_id,asset_id:'100',platform:'facebook',kind:'POST'});
 s.ctx.fetch=async u=>{const url=new URL(u),fields=url.searchParams.get('fields')||'',id=url.pathname.split('/').at(-1);let data;
 if(u.includes('/me/accounts'))data={data:[{id:'100',name:'Own Page',access_token:'private-page'}]};
 else if(fields.startsWith('likes'))data={likes:{summary:{total_count:7}},comments:{summary:{total_count:0}},shares:{count:2}};
 else if(u.includes('/insights'))data={data:[{name:url.searchParams.get('metric'),values:[{value:url.searchParams.get('metric')==='post_media_view'?20:{like:7}}]}]};
 else if(u.includes('/published_posts'))data={data:[]};
 else data={id,permalink_url:'https://www.facebook.com/100/posts/'+id.split('_')[1],created_time:'2026-11-01T00:00:00Z'};
 return {ok:true,status:200,json:async()=>data};};return posts;
}
test('group metric refresh persists, coalesces repeated clicks, rotates with regular work and never queues removal',async()=>{
 const s=setup();await metricFixture(s);const one=await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'metric_group'}),two=await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'metric_group'});
 assert.equal(one.queued,3);assert.equal(two.queued,0);assert.equal(two.pending,3);
 const batch=await s.ctx.run(s.env);assert.equal(batch.phase,'metrics_refresh');assert.equal(batch.media,2);assert.equal(await s.env.STORE.find('content_collect_state',{id:'request:meta_collect'}),null);
 let states=s.db.prepare("SELECT payload FROM content_collect_state WHERE id LIKE 'meta:refresh:%'").all().map(r=>JSON.parse(r.payload));assert.equal(states.filter(r=>r.status==='queued').length,1);assert.equal(states.filter(r=>r.status==='checked').length,2);
 const again=await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'metric_group'});assert.equal(again.queued,0);assert.equal(again.cooling,2);
 assert.notEqual((await s.ctx.run(s.env)).phase,'metrics_refresh');assert.equal((await s.ctx.run(s.env)).phase,'metrics_refresh');
 assert.equal(s.db.prepare('SELECT COUNT(*) n FROM content_deletion_queue').get().n,0);assert.equal(s.db.prepare('SELECT COUNT(*) n FROM content_cleanup_plans').get().n,0);
 const metrics=JSON.parse(s.db.prepare("SELECT metrics FROM content_posts WHERE post_id='100_301'").get().metrics);assert.equal(metrics.likes,7);assert.equal(metrics.comments,0);assert.equal(metrics.views,20);
 assert.doesNotMatch(JSON.stringify(s.db.prepare('SELECT * FROM content_collect_state').all()),/private-page|private-token/);
});

test('group refresh refuses unknown groups and unrelated Meta identities',async()=>{
 const s=setup();await metricFixture(s);await assert.rejects(s.ctx.metaQueueGroupMetrics(s.env,{group_id:'unknown'}),/group_not_found/);
 s.db.prepare("UPDATE meta_content SET asset_id='999'").run();await assert.rejects(s.ctx.metaQueueGroupMetrics(s.env,{group_id:'metric_group'}),/need_meta_collection/);
 assert.equal(s.db.prepare("SELECT COUNT(*) n FROM content_collect_state WHERE id LIKE 'meta:refresh:%'").get().n,0);
});

test('provider rate limit stops further calls in the batch and persists cooldown across a fresh invocation',async()=>{
 const s=setup();await metricFixture(s);await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'metric_group'});let calls=0;const base=s.ctx.fetch;
 s.ctx.fetch=async(u,o)=>{calls++;if(u.includes('/me/accounts'))return base(u,o);return {ok:false,status:429,headers:{get:()=> '120'},json:async()=>({error:{code:4}})};};
 const result=await s.ctx.run(s.env);assert.equal(result.phase,'metrics_refresh');assert.equal(calls,2);
 const state=JSON.parse(s.db.prepare("SELECT payload FROM content_collect_state WHERE id='meta'").get().payload);assert.ok(Date.parse(state.next_attempt)>=Date.now()+119000);
 assert.equal((await s.ctx.run(s.env)).status,'deferred');assert.equal(calls,2);
});

test('failed metadata refresh cannot silently mark queued counts as collected',async()=>{
 const s=setup();await metricFixture(s);await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'metric_group'});const base=s.ctx.fetch;
 s.ctx.fetch=async(u,o)=>u.includes('/me/accounts')?base(u,o):{ok:false,status:400,json:async()=>({error:{code:200}})};
 await s.ctx.run(s.env);const states=s.db.prepare("SELECT payload FROM content_collect_state WHERE id LIKE 'meta:refresh:%'").all().map(r=>JSON.parse(r.payload));assert.equal(states.filter(r=>r.status==='failed').length,2);
 const response=await s.ctx.contentApi({url:'https://d.test/api/content/groups',method:'GET'},s.env,{});assert.equal(response.rows[0].members[0].metric_status.likes.status,'permission_required');assert.equal(response.rows[0].metric_refresh.failed,2);
});


async function instagramMetricFixture(s,enabled=true){
 const now=new Date().toISOString();s.env.META_SYNC_ENABLED=enabled?'1':'0';
 const posts=['201','202'].map(id=>({platform:'instagram',account_id:'200',post_id:id,permalink:'https://www.instagram.com/reel/test'+id+'/',media_type:'REELS',metrics:{likes:4,comments:0}}));
 await s.ctx.upsertPosts(s.env,posts);await s.ctx.ingestGroups(s.env,[{group_id:'ig',platform:'instagram',account_id:'200',media_type:'VIDEO',members:posts.map(p=>p.post_id),algorithm:'fixture',evidence:{}}]);
 await s.env.STORE.put('meta_assets',{id:'200',platform:'instagram',name:'@account',page_id:'100',updated_at:now});
 for(const p of posts)await s.env.STORE.put('meta_content',{id:p.post_id,asset_id:'200',platform:'instagram',kind:'REELS',first_seen:now,last_seen:now});
 const calls=[];let omitShares=false;
 s.ctx.fetch=async u=>{const url=new URL(u),id=url.pathname.split('/').at(-1),query=url.searchParams;calls.push(url);let data;
 if(u.includes('/me/accounts'))data={data:[{id:'100',name:'Page',access_token:'private',instagram_business_account:{id:'200'}}]};
 else if(u.includes('/insights'))data={data:(query.get('metric')||'').split(',').filter(m=>!omitShares||m!=='shares').map(m=>({name:m,values:[{value:{views:123,shares:0,reach:99,saved:2}[m]??5}]}))};
 else if(u.includes('/published_posts')||u.includes('/media'))data={data:[]};
 else data={id,media_type:'VIDEO',media_product_type:'REELS',permalink:'https://www.instagram.com/reel/test'+id+'/',like_count:4,comments_count:0,timestamp:now};
 return {ok:true,status:200,json:async()=>data};};return {calls,omit:()=>omitShares=true};
}
test('automatic duplicate metrics catch-up collects Instagram views shares and reach in bounded combined requests',async()=>{
 const s=setup(),f=await instagramMetricFixture(s);const r=await s.ctx.run(s.env);assert.equal(r.phase,'metrics_backfill');assert.equal(r.media,2);assert.ok(f.calls.length<=12);
 const insights=f.calls.filter(u=>u.pathname.endsWith('/insights'));assert.equal(insights.length,2);assert.ok(insights.every(u=>['views','shares','reach'].every(m=>u.searchParams.get('metric').split(',').includes(m))));
 const rows=s.db.prepare("SELECT metrics FROM content_posts WHERE platform='instagram'").all();for(const row of rows){const m=JSON.parse(row.metrics);assert.equal(m.views,123);assert.equal(m.shares,0);assert.equal(m.reach,99);assert.equal(m.likes,4);}
 assert.notEqual((await s.ctx.run(s.env)).phase,'metrics_backfill');assert.equal(s.db.prepare('SELECT count(*) n FROM content_deletion_queue').get().n,0);
});
test('explicit metric refresh includes the selected rank and cannot report omitted shares as collected',async()=>{
 const s=setup(),f=await instagramMetricFixture(s,false);f.omit();await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'ig',metric:'reach'});await s.ctx.run(s.env);
 const requests=s.db.prepare("SELECT payload FROM content_collect_state WHERE id LIKE 'meta:refresh:%'").all().map(r=>JSON.parse(r.payload));assert.ok(requests.every(r=>r.required.includes('reach')&&r.status==='failed'&&r.missing.includes('shares')));
 const caps=s.db.prepare("SELECT * FROM meta_capabilities WHERE metric='shares'").all();assert.ok(caps.every(c=>c.status==='unavailable'&&c.reason.includes('no_numeric')));assert.ok(s.db.prepare('SELECT metrics FROM content_posts').all().every(r=>JSON.parse(r.metrics).shares===undefined));
});
test('combined insight rejection isolates unsupported metrics without fan-out on permissions or rate limits',async()=>{
 const s=setup(),specs=['views','shares','reach'].map(metric=>({metric})),seen=[],budget={calls:0,deadline:Date.now()+80000};
 const read=async(id,token,params)=>{budget.calls++;seen.push(params.metric);if(params.metric.includes(','))throw Object.assign(Error('bad metric'),{category:'metric_unsupported'});if(params.metric==='shares')throw Object.assign(Error('unsupported'),{category:'metric_unsupported'});return {data:[{name:params.metric,values:[{value:0}]}]};};
 const values=await s.ctx.metaReadMediaInsights(read,'201','private',specs,budget);assert.equal(values.get('views').value.value,0);assert.equal(values.get('reach').value.value,0);assert.equal(values.get('shares').error.category,'metric_unsupported');assert.equal(seen.length,4);
 for(const reason of ['permission_denied','rate_limited']){let calls=0;const result=await s.ctx.metaReadMediaInsights(async()=>{calls++;throw Object.assign(Error('safe'),{category:reason})},'201','private',specs,{calls:0,deadline:Date.now()+80000});assert.equal(calls,1);assert.ok([...result.values()].every(r=>r.error.category===reason));}
});
test('fresh unavailable metrics are not hammered and a budget deferral can recover after a minute',()=>{
 const s=setup(),at=new Date().toISOString(),caps=[{asset_id:'201',kind:'REELS',metric:'views',status:'unavailable',reason:'metric_unsupported',checked_at:at},{asset_id:'201',kind:'REELS',metric:'shares',status:'unavailable',reason:'meta_request_budget',checked_at:new Date(Date.now()-61000).toISOString()}];
 const due=s.ctx.metaMediaDue('instagram','REELS','201',caps,{});assert.ok(!due.some(s=>s.metric==='views'));assert.ok(due.some(s=>s.metric==='shares'));
});


test('a failed count refresh retains old numeric values without reporting a successful refresh',async()=>{
 const s=setup(),f=await instagramMetricFixture(s,false);f.omit();
 await s.ctx.upsertPosts(s.env,['201','202'].map(id=>({platform:'instagram',account_id:'200',post_id:id,permalink:'https://www.instagram.com/reel/test'+id+'/',media_type:'REELS',metrics:{views:4,shares:7,reach:3}})));
 await s.ctx.metaQueueGroupMetrics(s.env,{group_id:'ig'});await s.ctx.run(s.env);
 const requests=s.db.prepare("SELECT payload FROM content_collect_state WHERE id LIKE 'meta:refresh:%'").all().map(r=>JSON.parse(r.payload));assert.ok(requests.every(r=>r.status==='failed'&&r.failed_metrics.includes('shares')));
 assert.ok(s.db.prepare('SELECT metrics FROM content_posts').all().every(r=>JSON.parse(r.metrics).shares===7));
});
