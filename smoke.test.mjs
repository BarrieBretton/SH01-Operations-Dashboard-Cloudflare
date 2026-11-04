import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from './worker.js';
test('Worker routes enforce auth; ingestion cannot override eligibility; new source route works',async()=>{
 const sql=new DatabaseSync(':memory:');for(const file of ['schema.sql','sheets-sync-schema.sql'])sql.exec(fs.readFileSync(new URL(file,import.meta.url),'utf8'));
 function prepare(q){let a=[];return {bind(...v){a=v;return this},run(){return {meta:{changes:sql.prepare(q).run(...a).changes}}},all(){return {results:sql.prepare(q).all(...a)}},first(){return sql.prepare(q).get(...a)}}}
 const env={DB:{prepare,batch(stmts){sql.exec('BEGIN');try{const r=stmts.map(s=>s.run());sql.exec('COMMIT');return r}catch(e){sql.exec('ROLLBACK');throw e}}},DASHBOARD_TOKEN:'private-ui',INGEST_TOKEN:'private-ingest'};
 const req=(path,method='GET',data,headers={})=>worker.fetch(new Request('https://dashboard.test'+path,{method,headers,body:data?JSON.stringify(data):undefined}),env,{});
 assert.equal((await req('/')).status,200);
 assert.equal((await req('/api/producer-sources')).status,401);
 assert.equal((await req('/api/producer-sources','GET',null,{'X-INGEST-KEY':'private-ingest'})).status,401);
 const h={Authorization:'Bearer private-ui'};
 const inventory=await (await req('/api/producer-sources','GET',null,h)).json();assert.equal(inventory.coverage.workflows,70);assert.equal(inventory.coverage.nodes,3295);assert.equal(inventory.schedule_evidence,'handoff_snapshot');
 const response=await req('/api/ingest/producer','POST',{producer_id:'x',name:'x',items:[{item_id:'1',status:'uploaded',approved:'yes',ready:true,item_url:'https://example.test/video?token=private&v=1'},{item_id:'2',status:'staged',approved:'yes',ready:false}]},{'X-INGEST-KEY':'private-ingest'});
 assert.equal(response.status,200);const rows=sql.prepare('SELECT * FROM producer_items ORDER BY item_id').all();assert.equal(rows[0].ready,0);assert.equal(rows[1].ready,1);assert.ok(!rows[0].item_url.includes('private'));
 assert.equal((await req('/api/producers/x/items','GET',null,h)).status,404);
 const payload=await (await req('/api/producers','GET',null,h)).json();assert.equal(payload.rows.length,0);assert.equal(payload.policy_version,2);
});
