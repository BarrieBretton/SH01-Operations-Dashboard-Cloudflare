import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const module=fs.readFileSync(new URL('./sheets-sync.js',import.meta.url),'utf8');
function setup(){
 const sql=new DatabaseSync(':memory:');
 sql.exec(fs.readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
 sql.exec(fs.readFileSync(new URL('./sheets-sync-schema.sql',import.meta.url),'utf8'));
 function prepare(q){let args=[];return {bind(...a){args=a;return this},run(){return {meta:{changes:sql.prepare(q).run(...args).changes}}},all(){return {results:sql.prepare(q).all(...args)}},first(){return sql.prepare(q).get(...args)}}}
 const env={DB:{prepare,batch(a){sql.exec('BEGIN');try{let r=a.map(x=>x.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}},GOOGLE_CLIENT_ID:'client',GOOGLE_CLIENT_SECRET:'secret',GOOGLE_REFRESH_TOKEN:'refresh',GOOGLE_SHEETS_SPREADSHEET_ID:'book'};
 let fail=false;
 const c={crypto:webcrypto,TextEncoder,AbortSignal,URLSearchParams,Date,Map,Set,setTimeout,console,clean:(s)=>String(s),url:(s)=>s,json:x=>x,fetch:async(url)=>{if(fail)return {ok:false,status:403};if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'test-access'})};const schedule=decodeURIComponent(url).includes('workflow-schedule');return {ok:true,json:async()=>({values:schedule?[['associated accounts'],['scheduled-only']]:[['account','creator_handle','status','approved','yt_link'],['account','creator','pending','yes','https://example.test/video']]})}}};
 vm.createContext(c);vm.runInContext(module+';globalThis.f={sheetSync,liveProducerList,liveProducerItems,sheetStatus};',c);
 return {env,c,sql,fail:()=>{fail=true}};
}
test('successful snapshot is published, items are grouped and failed reads preserve it',async()=>{let {env,c,sql,fail}=setup();let first=await c.f.sheetSync(env);assert.equal(first.status,'ok');let list=await c.f.liveProducerList(env);assert.equal(list.rows.length,2);let stock=list.rows.find(p=>p.sheet_backed);assert.equal(stock.ready_count,2);assert.equal((await c.f.liveProducerItems(env,stock.producer_id)).rows.length,2);let version=sql.prepare('SELECT active_version FROM sheet_sync_state').get().active_version;fail();let second=await c.f.sheetSync(env);assert.equal(second.status,'failed');assert.equal(second.error_code,'google_http_403');assert.equal(sql.prepare('SELECT active_version FROM sheet_sync_state').get().active_version,version);assert.equal((await c.f.liveProducerList(env)).rows.length,2)});
test('missing secrets fail safely and legacy ingestion is never labelled live',async()=>{let {env,c,sql}=setup();delete env.GOOGLE_REFRESH_TOKEN;assert.equal((await c.f.sheetSync(env)).error_code,'missing_GOOGLE_REFRESH_TOKEN');sql.exec("INSERT INTO producers(producer_id,name,sheet_backed) VALUES('old','snapshot',1)");let rows=(await c.f.liveProducerList(env)).rows;assert.equal(rows[0].updated_at,null);assert.equal(rows[0].source_stale,true)});
test('active lease prevents overlap',async()=>{let {env,c,sql}=setup();sql.prepare("UPDATE sheet_sync_state SET status='running',lease='existing',lease_until=? WHERE id=1").run(Date.now()+60000);assert.equal((await c.f.sheetSync(env)).status,'already_running')});
