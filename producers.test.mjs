import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto,createHash} from 'node:crypto';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
const registry=JSON.parse(read('./producer-sources.json'));
// Known workbook identities in the fixture refer to the fixture workbook.
for(const s of registry.sources)if(s.workbook_id_sha256)s.workbook_id_sha256=createHash('sha256').update('book').digest('hex');
const code='const SOURCE_REGISTRY='+JSON.stringify(registry)+';'+read('./producer-policy.js')+read('./sheets-sync.js');
export function setup(){
 const sql=new DatabaseSync(':memory:');sql.exec(read('./schema.sql'));sql.exec(read('./sheets-sync-schema.sql'));
 function prepare(q){let args=[];return {bind(...a){args=a;return this},run(){return {meta:{changes:sql.prepare(q).run(...args).changes}}},all(){return {results:sql.prepare(q).all(...args)}},first(){return sql.prepare(q).get(...args)}}}
 const env={DB:{prepare,batch(a){sql.exec('BEGIN');try{let r=a.map(x=>x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}},GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_REFRESH_TOKEN:'refresh',GOOGLE_SHEETS_SPREADSHEET_ID:'book'};
 const fixtures={
  'streamables':[['account','creator_handle','status','approved','yt_link'],['aand.cut','one','staged','yes','https://example.test/one'],['@AAND.CUT','two','staged','yes','https://example.test/two'],['aand.cut','three','uploaded','yes',''],['aand.cut','four','pending','yes',''],['aand.cut','five','staged','true','']],
  'streamables-yt':[['account','creator_handle','status','approved'],['aand.cut','one','staged','yes']],
  'workflow-schedule':[['workflow','associated accounts'],['streamables-to-meta-account-agnostic','aand.cut'],['ai-image-model-erika.devereux','erika.devereux'],['ig-sidehustle PINTEREST 4','vlvt.ave']],
 };
 let fail=null;
 const fetch=async u=>{if(fail==='all')return {ok:false,status:403};if(u.includes('oauth2'))return {ok:true,json:async()=>({access_token:'test-access'})};const range=decodeURIComponent(u.split('/values/')[1]||''),name=range.split("'")[1];if(fail===name)return {ok:false,status:403};return {ok:true,json:async()=>({values:fixtures[name]||[['status'],['staged'],['used']]})}};
 const c={crypto:webcrypto,TextEncoder,AbortSignal,URLSearchParams,URL,Date,Map,Set,setTimeout,console,clean:s=>String(s),json:x=>x,error:(m,s)=>({error:m,status:s}),fetch};
 vm.createContext(c);vm.runInContext(code+';globalThis.f={sheetRows,sheetSync,liveProducerList,liveProducerItems,sheetStatus,producerSources,producerReady,producerConsumed,producerStatusValue,producerStockState,producerThreshold,producerURL};',c);
 return {env,c,sql,fixtures,fail:x=>{fail=x}};
}
test('strict availability: staged + yes only, aliases, whitespace, conflicts and uploaded',()=>{
 const {c}=setup();for(const status of ['pending','','uploaded','done','staging','false'])assert.equal(c.f.producerReady({status,approved:'yes'}),false);
 for(const approved of ['','true','1','approved','y','no'])assert.equal(c.f.producerReady({status:'staged',approved}),false);
 assert.equal(c.f.producerReady({status:' Staged ',approved:' YES '}),true);
 assert.equal(c.f.producerReady({state:'staged',approved:'yes'}),true);
 assert.equal(c.f.producerReady({status:'staged',state:'uploaded',approved:'yes'}),false);
 assert.equal(c.f.producerConsumed({status:' Uploaded '}),true);
});
test('snapshot separates tabs, combines creators by account, excludes blank rows and refuses guessed accounts',async()=>{
 const {env,c,fixtures}=setup();fixtures.streamables.push(['','','','','']);assert.equal((await c.f.sheetSync(env)).status,'ok');
 const list=await c.f.liveProducerList(env);assert.equal(list.rows.length,2);
 const stock=list.rows.find(p=>p.source_tab==='streamables');assert.equal(stock.ready_count,2);assert.equal(stock.total_count,5);assert.equal(stock.consumed_count,1);assert.equal(stock.creators.length,5);assert.ok(stock.workflow_names.includes('streamables-to-meta-account-agnostic'));assert.ok(!list.rows.some(p=>p.account==='vlvt.ave'));
 const items=await c.f.liveProducerItems(env,stock.producer_id);assert.equal(items.rows.length,5);assert.equal(items.rows.find(x=>x.status==='uploaded').ready,0);
});
test('threshold equality, failed freshness, empty and consumed have distinct meanings',()=>{
 const {c}=setup(),base={measurement:'measured',source_stale:false,total_count:5,threshold:3};
 assert.equal(c.f.producerStockState({...base,ready_count:3}),'ready');assert.equal(c.f.producerStockState({...base,ready_count:2}),'low');assert.equal(c.f.producerStockState({...base,ready_count:0,consumed_count:5}),'consumed');assert.equal(c.f.producerStockState({...base,ready_count:0,consumed_count:2}),'empty');assert.equal(c.f.producerStockState({...base,ready_count:4,source_stale:true}),'stale');
 assert.equal(c.f.producerThreshold({},'streamables','a').threshold_source,'dashboard_default_workflow_CFG_unverified');assert.throws(()=>c.f.producerThreshold({PRODUCER_MIN_READY_JSON:'{"streamables:a":-1}'},'streamables','a'));
});
test('matching tab and account in a different workbook does not establish a workflow binding',async()=>{
 const {env,c}=setup();env.GOOGLE_SHEETS_SPREADSHEET_ID='different-book';await c.f.sheetSync(env);const list=await c.f.liveProducerList(env);assert.ok(list.rows.length>0);assert.ok(list.rows.every(p=>p.workflow_names==='[]'));
});
test('required read failure retains last complete snapshot and marks stale',async()=>{
 const {env,c,sql,fail}=setup();await c.f.sheetSync(env);const before=sql.prepare('SELECT active_version FROM sheet_sync_state').get().active_version;fail('streamables');assert.equal((await c.f.sheetSync(env)).status,'failed');assert.equal(sql.prepare('SELECT active_version FROM sheet_sync_state').get().active_version,before);assert.equal((await c.f.liveProducerList(env)).rows[0].source_stale,true);
});
test('optional queue failure and missing schedule are explicit without losing verified stock',async()=>{
 const {env,c,fail}=setup();fail('telegram_audio_social_queue');await c.f.sheetSync(env);let result=await c.f.producerSources(env);assert.equal(result.references.find(r=>r.tab==='telegram_audio_social_queue').status,'unavailable');fail('workflow-schedule');await c.f.sheetSync(env);result=await c.f.producerSources(env);assert.equal(result.schedule_evidence,'live_sheet_unavailable');assert.equal(result.rows.some(s=>s.accounts.length),false);assert.equal((await c.f.liveProducerList(env)).rows.length,2);
});
test('explicit schedule links vlvt to Pinterest and erika to Drive, not Streamables',async()=>{
 const {env,c}=setup();await c.f.sheetSync(env);const {rows}=await c.f.producerSources(env);
 for(const [account,kind] of [['vlvt.ave','pinterest_rapidapi'],['erika.devereux','google_drive']]){
  assert.ok(rows.some(s=>s.accounts.includes(account)&&s.kind===kind&&!s.disabled));assert.ok(!rows.some(s=>s.accounts.includes(account)&&s.role==='stock_pool'));
 }
 assert.ok(rows.some(s=>s.kind==='telegram'&&s.role==='event_input'));
 assert.ok(rows.filter(s=>s.disabled).every(s=>s.accounts.length===0));
});
test('legacy wrong counts are hidden until v2 sync, and old item IDs do not leak into live view',async()=>{
 const {env,c,sql}=setup();sql.exec("INSERT INTO producers(producer_id,name,sheet_backed) VALUES('old','Bad guess',1)");let result=await c.f.liveProducerList(env);assert.equal(result.rows.length,0);assert.ok(result.warning);assert.equal((await c.f.liveProducerItems(env,'old')).status,404);
});
test('item pagination pins the snapshot and enumerates beyond 200 rows',async()=>{
 const {env,c,fixtures}=setup();fixtures.streamables=[fixtures.streamables[0],...Array.from({length:451},(_,i)=>['aand.cut','creator','staged','yes','https://example.test/'+i])];await c.f.sheetSync(env);const list=await c.f.liveProducerList(env),stock=list.rows.find(x=>x.source_tab==='streamables'),seen=new Set();let offset=0;
 do{const page=await c.f.liveProducerItems(env,stock.producer_id,{url:'https://local.invalid/?version='+stock.version+'&offset='+offset});for(const i of page.rows){assert.ok(!seen.has(i.item_id));seen.add(i.item_id)}offset=page.next_offset}while(offset!==null);assert.equal(seen.size,451);
});
test('leases prevent overlapping collection and duplicate headers fail closed',async()=>{
 const {env,c,sql}=setup();sql.prepare("UPDATE sheet_sync_state SET lease='busy',lease_until=? WHERE id=1").run(Date.now()+60000);assert.equal((await c.f.sheetSync(env)).status,'already_running');assert.throws(()=>c.f.sheetRows([['account','approved','status','status']],'streamables'));
});
test('item URLs discard credentials and signed query strings while preserving ordinary links',()=>{
 const {c}=setup();assert.equal(c.f.producerURL('https://example.test/item?token=secret&v=abc'),'https://example.test/item?v=abc');assert.equal(c.f.producerURL('https://user:pass@example.test/x'),'');assert.equal(c.f.producerURL('javascript:alert(1)'),'');assert.equal(c.f.producerURL('https://api.telegram.org/bot123:abc/getFile'),'');
});
