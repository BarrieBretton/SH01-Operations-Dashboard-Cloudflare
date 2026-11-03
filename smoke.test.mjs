import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import worker from './worker.js';

const sqlite = new DatabaseSync(':memory:');
sqlite.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const wrap = () => ({prepare(sql){return {all(){return {results:sqlite.prepare(sql).all()}},bind(...args){return {
  all(){return {results:sqlite.prepare(sql).all(...args)}},
  run(){return sqlite.prepare(sql).run(...args)}
}}}}});
const env = {DB:{...wrap(),batch(statements){sqlite.exec('BEGIN');try{for(const statement of statements)statement.run();sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}},DASHBOARD_TOKEN:'private-ui',INGEST_TOKEN:'private-ingest'};
const origin = 'https://dashboard.example.test';
const request = (path, method='GET', data, auth) => worker.fetch(new Request(origin+path,{
  method, headers:{...(auth||{}),...(data?{'Content-Type':'application/json'}:{})},
  body:data?JSON.stringify(data):undefined,
}),env);
const privateUI={Authorization:'Bearer private-ui'};
const privateIngest={'X-INGEST-KEY':'private-ingest'};

assert.equal((await request('/')).status,200);
assert.equal((await request('/api/failures')).status,401);
assert.equal((await request('/api/failures','GET',null,privateIngest)).status,401);
let result=await request('/api/ingest/event','POST',{source:'n8n',event_id:'A:1',happened_at:'2026-11-03T12:00:00Z',workflow_name:'streamables-to-yt',workflow_url:'https://n8n.example.test/workflow/123',message:'Run failed'},privateIngest);
assert.equal(result.status,200);
assert.equal((await (await request('/api/failures?q=streamables&from=2026-11-03&to=2026-11-03','GET',null,privateUI)).json()).rows.length,1);
assert.equal((await (await request('/api/failures?q=streamables&from=2026-11-04','GET',null,privateUI)).json()).rows.length,0);
assert.equal((await (await request('/api/failures?q=unrelated','GET',null,privateUI)).json()).rows.length,0);
result=await request('/api/ingest/producer','POST',{producer_id:'sample',name:'Creator sample',threshold:2,sheet_backed:true,workflow_names:['streamables-to-yt'],reset:true,items:[{item_id:'streamables:2',item_label:'First clip',item_url:'https://youtube.com/watch?v=abc',approved:'yes',ready:true},{item_id:'streamables:3',item_label:'Second clip',item_url:'https://example.test/media?token=sensitive&v=xyz',approved:'yes',ready:false}]},privateIngest);
assert.equal(result.status,200);
let producers=(await (await request('/api/producers','GET',null,privateUI)).json()).rows;
assert.equal(producers[0].ready_count,1);
assert.equal(producers[0].total_count,2);
let items=(await (await request('/api/producers/sample/items','GET',null,privateUI)).json()).rows;
assert.ok(items.some(i=>i.item_url.includes('watch?v=abc')));
assert.ok(items.some(i=>decodeURIComponent(i.item_url).includes('[REDACTED]')));
assert.ok(!items.some(i=>i.item_url.includes('sensitive')));
console.log('PASS: auth isolation, error filtering, D1 storage, producer stock and query token masking');
