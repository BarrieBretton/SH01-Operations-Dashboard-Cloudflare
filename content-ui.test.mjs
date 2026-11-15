import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('./dashboard.html',import.meta.url),'utf8').replace(/\r\n/g,'\n');
const source=html.split('<script>')[1].split('</script>')[0];
function setup(){
 const nodes=new Map(),storage=new Map(),requests=[];
 const make=()=>{const classes=new Set();return {value:'',innerHTML:'',textContent:'',disabled:false,dataset:{},attributes:{},children:[],listeners:{},classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,force){const add=force??!classes.has(k);add?classes.add(k):classes.delete(k)}},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]},addEventListener(k,fn){this.listeners[k]=fn},replaceChildren(...children){this.innerHTML='';this.textContent='';this.children=children},append(child){this.children.push(child)},scrollIntoView(){},insertAdjacentHTML(_,s){this.innerHTML+=s},click(){return this.onclick?.()},load(){}}};
 const get=id=>{if(!nodes.has(id))nodes.set(id,make());return nodes.get(id)};
 const context={console,Date,Intl,URL,URLSearchParams,Blob,AbortController,DOMException,setTimeout:()=>1,clearTimeout(){},setInterval(){},document:{getElementById:get,documentElement:{dataset:{}},addEventListener(){},createElement:make},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{getItem(){},setItem(){}},fetch:async(path,options)=>{requests.push({path,options});return {status:200,ok:true,json:async()=>({rows:[]})}}};
 vm.createContext(context);
 const inspect=`globalThis.inspectContent={groupDecision,orderedGroupEntries,updateGroupPresentation,renderGroupOptions,gallerySummary,removalTiming,setActionFeedback,showError,loadFailures,selectContent,showItems,loadCleanup:loadContentCleanup,getGroups:()=>contentGroups,isCleanupFresh:()=>cleanupFresh,cancelCleanupRetry,loadProducers,renderContentGroup,contentError,showContentView,performContentPreview,previewResponse,setView:v=>{contentView=v},getGroupRows:()=>contentGroupRows,contentDate,relativeContentDate,contentGalleryCard,setContentInfo,plotSeries:contentPlotSeries,contentQuery,normalizeContentSeries,contentSvg,contentCsvCell,safeContentMedia,platformBadge,contentState,request:contentRequest,loadAvailability:loadContentAvailability,renderContent,previewContentPlan,confirmContentQueue,clearContentPlan,clearContentState,lock:()=>lock(),setToken:t=>{token=t},setRows:r=>{contentRows=r},setPlan:p=>{contentPlan=p},setGroups:g=>{contentGroups=g;cleanupFresh=true},getPlan:()=>contentPlan,getSelection:()=>contentSelection,setSelection:r=>{contentSelection.set(contentKey(r),r)},setSource:s=>{sourceReport=s},renderSchedule:renderProducerSchedule};`;
 vm.runInContext(source.replace('// END PRODUCER UI LOGIC',inspect+'\n// END PRODUCER UI LOGIC'),context);
 get('content-metric').value='views';get('content-layout').value='cards';
 return {context,get,requests,api:context.inspectContent};
}
const post={platform:'instagram',account_id:'acct',account_handle:'handle',post_id:'post1',published_at:'2026-10-01T12:00:00Z',metrics:{views:100,likes:1,comments:null,shares:0},caption:'caption',permalink:'https://www.instagram.com/p/example/'};
test('intervals use consecutive valid observations, preserve unknowns and flag corrections',()=>{const {api}=setup();const rows=api.normalizeContentSeries([{observed_at:'2026-11-03T00:00:00Z',value:90},{observed_at:'2026-11-01T00:00:00Z',value:100},{observed_at:'2026-11-02T00:00:00Z',value:null},{observed_at:'bad',value:3},{observed_at:'2026-11-04T00:00:00Z',value:95},{observed_at:'2026-11-04T00:00:00Z',value:97},{observed_at:'2026-11-05T00:00:00Z',value:'102'}]);assert.equal(rows.length,3);assert.equal(rows[0].delta,null);assert.equal(rows[1].delta,-10);assert.equal(rows[1].interval_ms,172800000);assert.equal(rows[1].interpretation,'Correction / reset');assert.equal(rows[2].delta,7);assert.equal(rows[2].value,97)});
test('charts escape titles and distinguish interval corrections from missing history',()=>{const {api}=setup();const series=[{post:{post_id:'<script>alert(1)</script>'},rows:api.normalizeContentSeries([{observed_at:'2026-11-01',value:100},{observed_at:'2026-11-02',value:90}])}];const svg=api.contentSvg(series,'views','interval');assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;'));assert.ok(svg.includes('correction / reset'));assert.ok(svg.includes('#b02e40'));assert.equal(api.contentSvg([{post,rows:series[0].rows.slice(0,1)}],'views','interval'),'');assert.ok(!svg.includes('NaN'));assert.ok(!svg.includes('Infinity'))});
test('preview URLs are HTTPS official CDN hosts without access credentials',()=>{const {api}=setup();for(const url of ['javascript:alert(1)','https://fbcdn.net.attacker.example/p.jpg','https://attackerfbcdn.net/p.jpg','https://user:pass@x.fbcdn.net/p.jpg','https://x.fbcdn.net/p.jpg?access_token=secret','https://x.fbcdn.net:8443/p.jpg','http://x.fbcdn.net/a.jpg'])assert.equal(api.safeContentMedia(url),'',url);assert.equal(api.safeContentMedia('https://scontent.xx.fbcdn.net/p.jpg?oe=abc'),'https://scontent.xx.fbcdn.net/p.jpg?oe=abc')});
test('inventory escapes metadata, labels missing metrics and exports defend spreadsheet formulas',()=>{const {api,get}=setup();api.setRows([{...post,account_handle:'<img onerror=alert(1)>',caption:'</p><script>alert(1)</script>',workflow_url:'javascript:alert(1)'}]);api.renderContent();const cards=get('content-cards').innerHTML;assert.ok(cards.includes('&lt;img'));assert.ok(cards.includes('&lt;script&gt;'));assert.ok(!cards.includes('<script>'));assert.ok(!cards.includes('href="javascript:'));assert.ok(cards.includes('Unknown'));assert.ok(cards.includes('<dd>0</dd>'));for(const value of ['=CMD()',' +CMD()','@SUM(A1)','-5','\tformula'])assert.ok(api.contentCsvCell(value).startsWith('"\''));assert.equal(api.contentCsvCell('normal "text"'),'"normal ""text"""')});
test('lock empties content, schedule, plan and typed confirmation',()=>{const {api,get}=setup();api.setToken('private');api.setRows([post]);api.setSelection(post);api.setPlan({plan_id:'private-plan'});api.renderContent();get('content-confirm').value='QUEUE 1 LINKS';get('schedule-rows').innerHTML='private';api.lock();for(const id of ['content-cards','content-table','schedule-rows','content-plan-records'])assert.equal(get(id).innerHTML,'');assert.equal(api.getPlan(),null);assert.equal(api.getSelection().size,0);assert.equal(get('content-confirm').value,'')});
test('late POST and availability responses cannot repaint a locked or replacement session',async()=>{const {api,context,get}=setup();let finish;context.fetch=()=>new Promise(resolve=>{finish=resolve});api.setToken('old');const pending=api.request('/api/content/plan',{});api.lock();api.setToken('new');finish({status:200,ok:true,json:async()=>({plan_id:'old'})});await assert.rejects(pending,{name:'AbortError'});const resolvers=[];context.fetch=()=>new Promise(resolve=>resolvers.push(resolve));const loading=api.loadAvailability();api.lock();api.setToken('newer');for(const resolve of resolvers)resolve({status:200,ok:true,json:async()=>({rows:[{id:'old',name:'private old'}]})});await loading;assert.equal(get('content-assets').innerHTML,'');assert.equal(get('content-system-status').innerHTML,'')});
test('plan requires explicit strategy; preview never submits queue and invalidation blocks confirmation',async()=>{const {api,context,get,requests}=setup();api.setToken('private');api.setGroups([{group_id:'g',platform:'instagram',account_id:'acct',members:[post,{...post,post_id:'post2'}]}]);get('content-group').value='0';get('content-keep-count').value='1';get('content-keep-metric').value='views';await assert.rejects(api.previewContentPlan(),/explicit keep strategy/);assert.equal(requests.length,0);get('content-keep-strategy').value='worst';context.fetch=async(path,options)=>{requests.push({path,options});return {status:200,ok:true,json:async()=>({plan_id:'plan',keep:['post1'],remove:[{...post,post_id:'post2'}],excluded_missing_metrics:[],expires_at:new Date(Date.now()+60000).toISOString(),confirmation:'QUEUE 1 LINKS'})}};await api.previewContentPlan();assert.equal(requests.length,1);assert.equal(requests[0].path,'/api/content/plan');assert.equal(JSON.parse(requests[0].options.body).keep_strategy,'worst');assert.ok(get('content-plan-detail').textContent.includes('2 eligible members − 1 retained = 1'));get('content-confirm').value='QUEUE 1 LINKS';api.clearContentPlan();await api.confirmContentQueue();assert.equal(requests.length,1)});
test('queue confirmation is exact, expires, and cannot be double-submitted',async()=>{const {api,context,get}=setup();api.setToken('private');const plan={plan_id:'p',keep:['p1'],remove:[{post_id:'p2'}],expires_at:new Date(Date.now()+60000).toISOString(),confirmation:'QUEUE 1 LINKS'};api.setPlan(plan);let requests=0,finish;context.fetch=async(path)=>{requests++;if(path==='/api/content/queue'&&requests===1)return new Promise(resolve=>{finish=resolve});return {status:200,ok:true,json:async()=>({rows:[]})}};get('content-confirm').value='queue 1 links';await api.confirmContentQueue();assert.equal(requests,0);get('content-confirm').value='QUEUE 1 LINKS';const first=api.confirmContentQueue();assert.equal(get('content-plan-cancel').disabled,true);assert.equal(get('content-group').disabled,true);await api.confirmContentQueue();assert.equal(requests,1);finish({status:200,ok:true,json:async()=>({ok:true})});await first;assert.equal(requests,2);assert.equal(api.getPlan(),null);assert.equal(get('content-queue-confirm').disabled,true);api.setPlan({...plan,expires_at:'2000-01-01T00:00:00Z'});get('content-confirm').value='QUEUE 1 LINKS';await api.confirmContentQueue();assert.equal(requests,2)});
test('workflow schedules render source timing and timezone without inventing next runs',()=>{const {api,get}=setup();api.setSource({schedule_evidence:'snapshot',schedule:[{row:3,workflow_name:'<script>',workflow_url:'javascript:alert(1)',accounts:['<img>'],timings:'08:30, 21:00',timezone:'Asia/Kolkata',run:'yes',resolution:'exact_unique_name'}]});api.renderSchedule();assert.ok(get('schedule-rows').innerHTML.includes('08:30, 21:00'));assert.ok(get('schedule-rows').innerHTML.includes('Asia/Kolkata'));assert.ok(get('schedule-rows').innerHTML.includes('&lt;img&gt;'));assert.ok(!get('schedule-rows').innerHTML.includes('<script>'));assert.ok(!get('schedule-rows').innerHTML.includes('next'))});
test('editable content sources match their generated dashboard markers',()=>{for(const [start,end,file] of [['<!-- BEGIN CONTENT VIEW -->','<!-- END CONTENT VIEW -->','content-view.html'],['// BEGIN CONTENT UI LOGIC','// END CONTENT UI LOGIC','content-view.js'],['/* BEGIN CONTENT UI STYLES */','/* END CONTENT UI STYLES */','content-view.css']])assert.equal(html.split(start)[1].split(end)[0].trim(),fs.readFileSync(new URL('./'+file,import.meta.url),'utf8').replace(/\r\n/g,'\n').trim())});

test('date filters are sent as UTC calendar dates and invalid range is not silently relabeled',()=>{const {api,get}=setup();get('content-from').value='2026-10-01';get('content-to').value='2026-10-31';const q=api.contentQuery();assert.equal(q.get('from'),'2026-10-01');assert.equal(q.get('to'),'2026-10-31');get('content-from').value='2026-11-01';api.renderContent();assert.match(get('content-library-notice').textContent,/on or before/)});
test('availability reflects actual write flags, mirror state and outbox counts',async()=>{const {api,context,get}=setup();api.setToken('private');context.fetch=async path=>({status:200,ok:true,json:async()=>path==='/api/content/status'?{schema_ready:true,sheet_write_enabled:false,post_sheet:'meta-posts-to-id',clickouts_sheet:'clickouts',mirror:{status:'failed',error_code:'google_scope_denied'},outbox:[{status:'uncertain',count:2}],schedule_interval_minutes:10}:{rows:[]}});await api.loadAvailability();assert.equal(get('content-sheet-setup').disabled,true);assert.equal(get('content-sheet-sync').disabled,true);assert.match(get('content-system-status').innerHTML,/uncertain: 2/);assert.match(get('content-system-status').innerHTML,/google_scope_denied/);assert.match(get('content-system-status').innerHTML,/Migration required|Ready/);assert.match(get('content-sheet-notice').textContent,/write scope/)});
test('publication age and windows never reconstruct missing early observations',()=>{const {context,get}=setup();const api=context.inspectContent;get('content-chart-axis').value='age';get('content-chart-window').value='24';const transformed=api.plotSeries([{post:{...post,published_at:'2026-11-01T00:00:00Z'},rows:api.normalizeContentSeries([{observed_at:'2026-11-01T02:00:00Z',value:10},{observed_at:'2026-11-03T00:00:00Z',value:20}])}]);assert.equal(transformed[0].rows.length,1);assert.equal(transformed[0].rows[0].time,7200000);assert.match(api.contentSvg(transformed,'views','cumulative'),/Hours since publication/);assert.doesNotMatch(api.contentSvg(transformed,'views','cumulative'),/Observation time \(UTC\)/);});

test('gallery details are hidden at rest, preserve full captions and use readable time',()=>{const {api}=setup();const r={...post,caption:'<script>bad</script>'+ 'x'.repeat(400)};const markup=api.contentGalleryCard(r,0);assert.match(markup,/class="post-info"[^>]*hidden/);assert.ok(markup.includes('x'.repeat(400)));assert.ok(!markup.includes('<script>'));assert.match(api.contentDate('2026-11-14T13:30:00Z'),/1:30 PM/);assert.equal(api.relativeContentDate('2026-11-14T12:30:00Z',Date.parse('2026-11-14T13:30:00Z')),'1h ago');assert.equal(api.relativeContentDate('2026-11-12T13:30:00Z',Date.parse('2026-11-14T13:30:00Z')),'2d ago');assert.equal(api.relativeContentDate('bad'),'Unknown time');});
test('information hover is temporary, pin persists, and explicit hide retracts it',()=>{const {api,get}=setup();api.setRows([post]);api.renderContent();const card=get('content-card-0'),panel=get('post-info-0'),corner=get('test-corner'),button=get('test-toggle');card.querySelector=s=>s==='.post-corner'?corner:button;api.setContentInfo(0,true);assert.equal(panel.hidden,false);api.setContentInfo(0,false);assert.equal(panel.hidden,true);api.setContentInfo(0,true,true);api.setContentInfo(0,false);assert.equal(panel.hidden,false);assert.equal(button.attributes['aria-pressed'],'true');api.setContentInfo(0,false,false);assert.equal(panel.hidden,true);assert.equal(button.attributes['aria-expanded'],'false');api.setContentInfo(0,true,true);api.clearContentState();assert.ok(api.contentGalleryCard(post,0).includes('aria-pressed="false"'));});

test('duplicate groups render gallery cards with isolated IDs, full captions, video type and pinned details',()=>{
 const {api,get}=setup();api.setToken('private');api.setView('cleanup');
 api.setGroups([{group_id:'g',platform:'facebook',account_id:'acct',media_type:'VIDEO',algorithm:'ordered frames',members:[{...post,platform:'facebook',media_type:'POST',caption:'<script>bad</script>'+'long '.repeat(100)}]}]);
 get('content-group').value='0';api.renderContentGroup();
 const html=get('content-group-cards').innerHTML;
 assert.match(html,/content-preview-g0/);assert.match(html,/post-info-g0/);assert.match(html,/VIDEO/);
 assert.ok(html.includes('long '.repeat(100)));assert.ok(!html.includes('<script>'));assert.ok(!html.includes('data-content-select'));
 const card=get('content-card-g0'),corner=get('corner-g'),button=get('toggle-g');card.querySelector=s=>s==='.post-corner'?corner:button;
 api.setContentInfo('g0',true,true);api.setContentInfo('g0',false);assert.equal(get('post-info-g0').hidden,false);
 api.setContentInfo('g0',false,false);assert.equal(get('post-info-g0').hidden,true);
 api.lock();assert.equal(get('content-group-cards').innerHTML,'');assert.equal(api.getGroupRows().length,0);
});
test('late request errors stay with their originating content tab and clear on successful retry',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('inventory');let finish;
 context.fetch=()=>new Promise(resolve=>{finish=resolve});const pending=api.request('/api/content?limit=50');api.setView('cleanup');
 finish({status:503,ok:false,json:async()=>({error:'store_rate_limited'})});
 try{await pending;assert.fail('Expected failure')}catch(e){api.contentError(e)}
 assert.match(get('content-error-inventory').textContent,/store_rate_limited/);
 assert.equal(get('content-error-cleanup').textContent,'');assert.equal(get('global-notice').textContent,'');
 api.setView('inventory');context.fetch=async()=>({status:200,ok:true,json:async()=>({rows:[]})});await api.request('/api/content?limit=50');
 assert.equal(get('content-error-inventory').textContent,'');
});
test('video preview resolves playback instead of using a stored thumbnail and creates player controls',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('cleanup');api.setGroups([{group_id:'g',platform:'instagram',account_id:'acct',media_type:'VIDEO',members:[{...post,media_type:'REELS',preview_type:'image',preview_url:'https://a.cdninstagram.com/thumb.jpg'}]}]);get('content-group').value='0';api.renderContentGroup();
 let calls=0;context.fetch=async()=>{calls++;return {status:200,ok:true,json:async()=>({available:true,kind:'video',url:'https://a.cdninstagram.com/video.mp4'})}};
 const pending=api.performContentPreview('g0');for(let i=0;i<8;i++)await Promise.resolve();
 const video=get('content-preview-g0').children[0];assert.ok(video);assert.equal(video.controls,true);assert.equal(video.playsInline,true);assert.equal(video.preload,'metadata');assert.equal(calls,1);
 video.onloadedmetadata();await pending;
});

test('producer stock renders before slow source evidence and repeated checks coalesce',async()=>{
 const {api,context,get,requests}=setup();api.setToken('private');let sourceFinish;
 context.fetch=async path=>{requests.push(path);if(path==='/api/producer-sources')return new Promise(resolve=>{sourceFinish=resolve});return {ok:true,status:200,json:async()=>({rows:[],sync:{status:'ok',last_success:'2026-11-14T22:07:00Z'}})};};
 const first=api.loadProducers(),second=api.loadProducers();for(let i=0;i<8;i++)await Promise.resolve();
 assert.equal(requests.length,2);assert.match(get('producer-refresh-status').textContent,/Dashboard checked/);assert.match(get('sheet-health').textContent,/10:07 PM/);
 sourceFinish({ok:false,status:503,json:async()=>({error:'store_rate_limited'})});await Promise.all([first,second]);
 assert.match(get('producer-sources-error').textContent,/store_rate_limited/);assert.equal(get('refresh-producers').disabled,false);
 context.fetch=async path=>({ok:true,status:200,json:async()=>path==='/api/producers'?{rows:[],sync:{status:'ok',last_success:'2026-11-14T22:07:00Z'}}:{rows:[],schedule:[]}});
 await api.loadProducers();assert.match(get('producer-refresh-status').textContent,/Stored stock unchanged/);assert.doesNotMatch(get('producer-refresh-status').textContent,/store_rate_limited/);
});

test('throttled group refresh retains selection and galleries, blocks plans, recovers after cooldown',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('cleanup');
 const g={group_id:'g',platform:'instagram',account_id:'acct',members:[post]};
 api.setGroups([g]);get('content-group').value='0';api.renderContentGroup();
 const cards=get('content-group-cards').innerHTML;let calls=0;
 const timers=new Map();let next=0;
 context.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next};context.clearTimeout=id=>timers.delete(id);
 context.fetch=async path=>{calls++;return {status:path.endsWith('/groups')?503:200,ok:!path.endsWith('/groups'),headers:{get:()=> '120'},json:async()=>path.endsWith('/groups')?{error:'store_rate_limited'}:{rows:[]}}};
 await api.loadCleanup();assert.equal(api.getGroups().length,1);assert.equal(get('content-group').value,'0');assert.equal(get('content-group-cards').innerHTML,cards);assert.equal(api.isCleanupFresh(),false);assert.equal(get('content-plan').disabled,true);
 await assert.rejects(api.previewContentPlan(),/Refresh groups and queue/);assert.equal(calls,2);
 const retry=[...timers.values()].find(t=>t.ms>=120000);assert.ok(retry);assert.ok(retry.ms<135001);
 await api.loadCleanup();assert.equal(calls,2,'manual clicks respect cooldown');
 context.Date=class extends Date{static now(){return Date.now()+140000}};
 context.fetch=async path=>{calls++;return {status:200,ok:true,json:async()=>({rows:path.endsWith('/groups')?[g]:[]})}};
 await api.loadCleanup();assert.equal(api.isCleanupFresh(),true);assert.equal(get('content-group').value,'0');assert.equal(get('content-plan').disabled,false);assert.match(get('content-cleanup-notice').textContent,/Returned 1/);assert.ok(![...timers.values()].some(t=>t.ms>=75000));
});

test('first-load throttling is not empty evidence and retry is cancelled on navigation and lock',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('cleanup');
 const timers=new Map();let next=0,calls=0;
 context.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next};context.clearTimeout=id=>timers.delete(id);
 context.fetch=async path=>{calls++;return {status:503,ok:false,json:async()=>({error:'store_rate_limited'})}};
 await api.loadCleanup();assert.match(get('content-group-info').textContent,/does not mean no groups/);
 const retry=[...timers.values()].find(t=>t.ms>=75000);assert.ok(retry);
 await api.showContentView('compare');assert.ok(![...timers.values()].some(t=>t.ms>=75000));await retry.fn();assert.equal(calls,2);
 api.setView('cleanup');await api.loadCleanup();const second=[...timers.values()].find(t=>t.ms>=75000);assert.ok(second);api.lock();await second.fn();assert.equal(calls,2);assert.equal(api.getGroups().length,0);
});

test('overlapping cleanup refreshes share requests and permanent errors are not automatically retried',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('cleanup');
 const resolves=[];context.fetch=()=>new Promise(r=>resolves.push(r));
 const a=api.loadCleanup(),b=api.loadCleanup();assert.equal(resolves.length,2);
 for(const r of resolves)r({status:403,ok:false,json:async()=>({error:'forbidden'})});
 await Promise.all([a,b]);assert.match(get('content-cleanup-notice').textContent,/403/);assert.equal(api.isCleanupFresh(),false);
});

test('storage throttling automatically retries at most twice and stops when the main view is hidden',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('cleanup');
 let now=Date.now(),next=0,calls=0;const timers=new Map();
 context.Date=class extends Date{static now(){return now}};
 context.setTimeout=(fn,ms)=>{timers.set(++next,{fn,ms});return next};context.clearTimeout=id=>timers.delete(id);
 context.fetch=async()=>{calls++;return {status:503,ok:false,json:async()=>({error:'store_rate_limited'})}};
 await api.loadCleanup();
 for(let i=0;i<2;i++){const [id,t]=[...timers.entries()].find(([,t])=>t.ms>=75000);timers.delete(id);now+=100000;await t.fn();}
 assert.equal(calls,6);assert.equal(timers.size,0);assert.match(get('content-cleanup-notice').textContent,/Refresh again after/);
 now+=100000;await api.loadCleanup();const [,t]=[...timers.entries()].find(([,t])=>t.ms>=75000);get('meta-view').classList.add('hidden');now+=100000;await t.fn();assert.equal(calls,8);
});

test('keep strategy validation and server errors stay beside the plan controls and clear on retry',async()=>{
 const {api,get,context}=setup();api.setToken('private');api.setView('cleanup');api.setGroups([{group_id:'g',members:[post]}]);get('content-group').value='0';
 await get('content-plan').onclick();assert.match(get('content-error-plan').textContent,/explicit keep strategy/);assert.equal(get('content-keep-count').attributes['aria-invalid'],'true');assert.equal(get('content-error-cleanup').textContent,'');assert.equal(get('global-notice').textContent,'');
 get('content-keep-count').value='1';get('content-keep-strategy').value='best';get('content-keep-count').listeners.input();assert.equal(get('content-error-plan').textContent,'');assert.equal(get('content-keep-count').attributes['aria-invalid'],undefined);
 context.fetch=async()=>({status:400,ok:false,json:async()=>({error:'missing_metrics'})});await get('content-plan').onclick();assert.match(get('content-error-plan').textContent,/missing_metrics/);assert.equal(get('content-error-cleanup').textContent,'');
 context.fetch=async()=>({status:200,ok:true,json:async()=>({plan_id:'p',keep:['p1'],remove:[{...post,post_id:'p2'}],confirmation:'QUEUE 1 LINKS',expires_at:new Date(Date.now()+60000).toISOString()})});await get('content-plan').onclick();assert.equal(get('content-error-plan').textContent,'');assert.match(get('content-plan-notice').textContent,/Preview only/);
});

test('failed confirmation stays visible by the plan area after its confirmation panel closes',async()=>{
 const {api,get,context}=setup();api.setToken('private');api.setView('cleanup');api.setPlan({plan_id:'p',remove:[post],confirmation:'QUEUE 1 LINKS',expires_at:new Date(Date.now()+60000).toISOString()});get('content-confirm').value='QUEUE 1 LINKS';get('content-queue-confirm').disabled=false;
 context.fetch=async()=>({status:503,ok:false,json:async()=>({error:'store_rate_limited'})});await get('content-queue-confirm').onclick();assert.equal(get('content-plan-panel').classList.contains('hidden'),true);assert.match(get('content-error-confirm').textContent,/store_rate_limited/);assert.match(get('content-confirm-notice').textContent,/could not be verified/);assert.equal(get('global-notice').textContent,'');
});

test('errors from separate actions stay independent, with pagination feedback at the footer',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('inventory');context.fetch=async()=>({status:503,ok:false,json:async()=>({error:'store_rate_limited'})});await get('content-more').onclick();assert.match(get('content-error-more').textContent,/store_rate_limited/);assert.equal(get('content-error-inventory').textContent,'');
 api.contentError(Object.assign(Error('Sync rejected'),{contentScope:'inventory',feedbackTarget:'content-error-sync'}));api.contentError(Object.assign(Error('Library problem'),{contentScope:'inventory',contentPath:'/api/content?limit=50'}));
 context.fetch=async()=>({status:200,ok:true,json:async()=>({rows:[]})});await get('content-more').onclick();assert.equal(get('content-error-more').textContent,'');assert.match(get('content-error-sync').textContent,/Sync rejected/);api.lock();assert.equal(get('content-error-sync').textContent,'');
});

test('failure filters, source sync and producer items use their own feedback rather than the banner',async()=>{
 const {api,context,get}=setup();api.setToken('private');get('from').value='2026-12-01';get('to').value='2026-11-01';await get('refresh-failures').onclick();assert.match(get('failure-error').textContent,/on or before/);assert.equal(get('global-notice').textContent,'');
 get('from').value='';await get('refresh-failures').onclick();assert.equal(get('failure-error').textContent,'');
 context.fetch=async()=>({status:503,ok:false,json:async()=>({error:'store_rate_limited'})});await get('sheet-sync-now').onclick();assert.match(get('producer-sync-error').textContent,/503/);assert.equal(get('producer-error').textContent,'');
 api.showError(Object.assign(Error('Items failed'),{dashboardScope:'producer-view',feedbackTarget:'producer-items-error'}));assert.equal(get('producer-items-error').textContent,'Items failed');assert.equal(get('global-notice').textContent,'');
 api.lock();assert.equal(get('producer-sync-error').textContent,'');assert.equal(get('producer-items-error').textContent,'');
});

test('feedback opens its containing disclosure and comparison actions appear only for a selection',()=>{
 const {api,get}=setup();const parent={tagName:'DETAILS',open:false,parentElement:null};get('producer-sync-error').parentElement=parent;api.setActionFeedback('producer-sync-error','Try again');assert.equal(parent.open,true);
 api.setRows([post]);api.renderContent();assert.equal(get('content-selection-bar').classList.contains('hidden'),true);api.setSelection(post);api.renderContent();assert.equal(get('content-selection-bar').classList.contains('hidden'),false);
});

test('changing keep controls ignores an obsolete pending plan error',async()=>{
 const {api,context,get}=setup();api.setToken('private');api.setView('cleanup');api.setGroups([{group_id:'g',members:[post]}]);get('content-group').value='0';get('content-keep-count').value='1';get('content-keep-strategy').value='best';
 let finish;context.fetch=()=>new Promise(resolve=>{finish=resolve});const pending=get('content-plan').onclick();get('content-keep-count').value='2';get('content-keep-count').listeners.input();finish({status:400,ok:false,json:async()=>({error:'old_plan_error'})});await pending;assert.equal(get('content-error-plan').textContent,'');assert.equal(api.getPlan(),null);
});

test('one gallery displays authoritative keep/remove decisions, all four metrics and platform outside details',()=>{
 const {api,get}=setup();api.setToken('private');api.setView('cleanup');api.setGroups([{group_id:'g',platform:'instagram',account_id:'acct',members:[{...post,delete_status:'published'},{...post,post_id:'p2',metrics:{views:300,likes:3,comments:2,shares:1},delete_status:'published'}]}]);get('content-group').value='0';get('content-keep-metric').value='views';api.renderContentGroup();
 const html=get('content-group-cards').innerHTML;const firstHeader=html.slice(html.indexOf('<header'),html.indexOf('</header>'));for(const value of ['Instagram','views','likes','comments','shares','100'])assert.ok(firstHeader.includes(value),value);assert.ok(!firstHeader.includes('caption'));assert.ok(html.indexOf('caption')>html.indexOf('post-info'));
 api.setPlan({group_id:'g',keep:['p2'],remove:[post],expires_at:new Date(Date.now()+60000).toISOString()});api.updateGroupPresentation();
 assert.equal(api.groupDecision(post).tone,'remove');assert.equal(api.groupDecision({...post,post_id:'p2'}).tone,'keep');assert.match(get('content-summary-g0').innerHTML,/Remove · proposed/);assert.match(get('content-summary-g1').innerHTML,/Keep · proposed/);assert.equal(get('content-plan-records').innerHTML,'');
 api.clearContentPlan();assert.equal(api.groupDecision(post).tone,'neutral');
});

test('display sorting preserves media nodes and does not submit another plan or queue',()=>{
 const {api,get,requests}=setup();api.setView('cleanup');api.setGroups([{group_id:'g',platform:'instagram',account_id:'acct',members:[{...post,metrics:{views:0}},{...post,post_id:'p2',metrics:{views:200}},{...post,post_id:'p3',metrics:{views:null}}]}]);get('content-group').value='0';get('content-keep-metric').value='views';api.renderContentGroup();
 const container=get('content-group-cards'),moved=[];container.appendChild=card=>moved.push(card);
 const cards=[0,1,2].map(i=>get('content-card-g'+i));for(const card of cards)card.parentNode=container;
 const media=get('content-preview-g1');media.innerHTML='playing video';get('content-group-order').value='metric-asc';api.updateGroupPresentation();assert.deepEqual(moved,cards);assert.equal(media.innerHTML,'playing video');
 get('content-group-order').value='metric-desc';assert.deepEqual(Array.from(api.orderedGroupEntries(),x=>x.row.post_id),['p2','post1','p3']);assert.equal(requests.length,0);
});

test('persisted decisions remain visible, platform filter separates accounts, and expiry is not a removal countdown',()=>{
 const {api,get}=setup();api.setView('cleanup');const g={group_id:'g',platform:'instagram',account_id:'acct',has_confirmed_history:true,members:[{...post,delete_status:'queued_clickouts',cleanup_review:{decision:'remove',queue_status:'queued_clickouts',removal_scheduled_at:null}},{...post,post_id:'p2',delete_status:'published',cleanup_review:{decision:'keep'}}]};api.setGroups([g,{...g,group_id:'fb',platform:'facebook',account_id:'different',members:[]}]);get('content-group-platform').value='instagram';api.renderGroupOptions();assert.ok(get('content-group').innerHTML.includes('Previously confirmed'));assert.ok(!get('content-group').innerHTML.includes('facebook'));get('content-group').value='0';api.renderContentGroup();
 assert.equal(api.groupDecision(g.members[0]).tone,'queued');assert.match(get('content-summary-g0').innerHTML,/Removal date not reported/);assert.match(get('content-summary-g1').innerHTML,/Kept in confirmed plan/);assert.equal(get('content-plan').disabled,true);
 api.setPlan({group_id:'g',keep:['p2'],remove:[post],expires_at:'2000-01-01T00:00:00Z'});api.updateGroupPresentation();assert.match(get('content-plan-notice').textContent,/expired/);assert.equal(api.groupDecision(g.members[0]).tone,'queued');assert.equal(api.removalTiming({queue_status:'deleted'}),'Deletion reported');assert.match(api.removalTiming({queue_status:'queued_clickouts',removal_scheduled_at:new Date(Date.now()+86400000*2).toISOString()}),/2d until scheduled removal/);
});
