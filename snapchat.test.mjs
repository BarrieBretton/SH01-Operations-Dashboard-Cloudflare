import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const worker=fs.readFileSync(new URL('./snapchat-worker.js',import.meta.url),'utf8');
function bridge(fetch){const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout,console,fetch,
 infraBase:v=>{const u=new URL(v);if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('invalid_origin');return u.origin},
 body:r=>r.json(),json:d=>Response.json(d),error:(s,n)=>Response.json({error:s},{status:n})});vm.runInContext(worker,c);return c;}
test('bridge sends only its configured credential and selected fields',async()=>{
 let observed;const c=bridge(async(url,init)=>{observed={url,init};return Response.json({job_id:'job'})});
 const r=await c.snapchatDeskApi(new Request('https://desk/api/snapchat/run',{method:'POST',body:JSON.stringify({item_id:'episode',fingerprint:'a'.repeat(64),source_url:'https://evil',token:'secret'})}),{MEDIA_CLIP_API_KEY:'backend-key'});
 assert.equal(r.status,200);assert.equal(observed.url,'https://sh01.onrender.com/snapchat/run');assert.equal(observed.init.redirect,'manual');assert.equal(observed.init.headers['X-API-KEY'],'backend-key');assert.deepEqual(JSON.parse(observed.init.body),{item_id:'episode',fingerprint:'a'.repeat(64)});
});
test('bridge rejects arbitrary routes, query forwarding, callbacks and ticks',async()=>{
 let calls=0;const c=bridge(async()=>{calls++;return Response.json({})});
 for(const p of ['/oauth/callback','/tick','/jobs/private','/health?url=https://evil','/delete']){
  const r=await c.snapchatDeskApi(new Request('https://desk/api/snapchat'+p),{MEDIA_CLIP_API_KEY:'k'});assert.equal(r.status,404);
 }assert.equal(calls,0);
});
test('missing credential and invalid origins stop before fetch',async()=>{
 let calls=0;const c=bridge(async()=>{calls++});
 for(const env of [{},{MEDIA_CLIP_API_KEY:'k',OPS_INFRA_MEDIA_URL:'http://evil'},{MEDIA_CLIP_API_KEY:'k',OPS_INFRA_MEDIA_URL:'https://u:p@evil'}]){
  assert.equal((await c.snapchatDeskApi(new Request('https://desk/api/snapchat/health'),env)).status,503);
 }assert.equal(calls,0);
});
test('HTML, redirects and secret-bearing provider errors are sanitized',async()=>{
 for(const upstream of [new Response('<!DOCTYPE html>PRIVATE',{status:502}),new Response('',{status:302,headers:{Location:'https://evil'}}),Response.json({detail:'Bearer PRIVATE?Authorization=secret'},{status:500})]){
  const c=bridge(async()=>upstream);const r=await c.snapchatDeskApi(new Request('https://desk/api/snapchat/health'),{MEDIA_CLIP_API_KEY:'k'});const text=await r.text();assert.equal(r.status,503);assert.doesNotMatch(text,/PRIVATE|Bearer|Authorization|DOCTYPE/);
 }
});
test('scheduled wake is opt-in and uses authenticated fixed tick route',async()=>{
 let count=0;const c=bridge(async(url,init)=>{count++;assert.equal(url,'https://sh01.onrender.com/snapchat/tick');assert.equal(init.method,'POST');return Response.json({status:'paused'})});
 await c.snapchatScheduled({MEDIA_CLIP_API_KEY:'k'});assert.equal(count,0);await c.snapchatScheduled({MEDIA_CLIP_API_KEY:'k',SNAPCHAT_TICK_ENABLED:'1'});assert.equal(count,1);
});
function ui(){
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',disabled:false,dataset:{},classList:{add(){},remove(){},contains(){return false}},setAttribute(){},removeAttribute(){},replaceChildren(){this.innerHTML='';this.textContent=''}});return elements.get(id)};
 const c=vm.createContext({URL,AbortController,DOMException,Date,setTimeout,clearTimeout,console,$:get,document:{hidden:false},token:'dashboard',authEpoch:1,lock(){c.authEpoch++;c.token=''},esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'),fetch:async()=>Response.json({})});
 vm.runInContext(fs.readFileSync(new URL('./snapchat-view.js',import.meta.url),'utf8'),c);return {c,get,run:s=>vm.runInContext(s,c)};
}
test('UI exposes loading feedback until an operation finishes',async()=>{
 const h=ui();let complete;const operation=()=>new Promise(r=>complete=r);const b=h.get('snapchat-refresh');const p=h.c.snapchatAction(b,'Loading…',operation);assert.equal(b.disabled,true);assert.equal(h.get('snapchat-loading').textContent,'Loading…');complete();await p;assert.equal(b.disabled,false);
});
test('overlapping actions keep loading feedback for the remaining request',async()=>{
 const h=ui();let first,second;
 const a=h.c.snapchatAction(h.get('snapchat-refresh'),'Checking connection…',()=>new Promise(r=>first=r));
 const b=h.c.snapchatAction(h.get('snapchat-preview'),'Reading queue…',()=>new Promise(r=>second=r));
 assert.equal(h.get('snapchat-loading').textContent,'Reading queue…');second();await b;
 assert.equal(h.get('snapchat-loading').textContent,'Checking connection…');assert.equal(h.get('snapchat-refresh').disabled,true);
 first();await a;assert.equal(h.get('snapchat-refresh').disabled,false);
});
test('UI escapes workbook values, protects unready rows and preserves cell links',()=>{
 const h=ui();h.run(`snapchatHealth={enabled:true};snapchatRows=[{item_id:'<img src=x>',destination:'spotlight',source_locator:'path',reference:{sheet:'Snapchat-Queue',cell:'B2',link:'https://docs.google.com/spreadsheets/d/book/edit#gid=42&range=B2'},problems:['rights_confirmed_must_be_yes'],ready:false}];renderSnapchatQueue()`);
 const html=h.get('snapchat-queue').innerHTML;assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);assert.match(html,/disabled/);assert.match(html,/gid=42&amp;range=B2/);assert.match(html,/rights_confirmed_must_be_yes/);
});
test('link helper rejects script and arbitrary external URLs',()=>{
 const h=ui();assert.doesNotMatch(h.c.snapchatLink('javascript:alert(1)','x'),/<a/);assert.doesNotMatch(h.c.snapchatLink('https://evil.example','x'),/<a/);assert.match(h.c.snapchatLink('https://www.snapchat.com/spotlight/id','Open'),/<a/);
});
test('lock clears rows, authorization link and ignores delayed responses',async()=>{
 const h=ui();let complete;h.c.fetch=()=>new Promise(r=>complete=r);const p=h.c.snapchatRequest('/health');h.get('snapchat-authorize').innerHTML='nonce';h.run('snapchatRows=[{private:true}];lock()');complete(Response.json({private:true}));await assert.rejects(p,e=>e.name==='AbortError');assert.equal(h.get('snapchat-authorize').innerHTML,'');assert.equal(h.run('snapchatRows.length'),0);
});
test('new bridge is after dashboard authentication and bundled sources are present',()=>{
 const runtime=fs.readFileSync(new URL('./worker-runtime.js',import.meta.url),'utf8');assert.ok(runtime.indexOf('return error(\'Unauthorized\',401)')<runtime.indexOf('return await snapchatDeskApi'));
 const bundle=fs.readFileSync(new URL('./worker.js',import.meta.url),'utf8');assert.match(bundle,/function snapchatDeskApi/);assert.match(bundle,/snapchat-panel/);
});
