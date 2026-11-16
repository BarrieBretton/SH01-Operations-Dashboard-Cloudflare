import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync(new URL('./infra-view.js',import.meta.url),'utf8');
function harness(){
 const nodes=new Map();const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',disabled:false,hidden:false,innerHTML:'',textContent:'',dataset:{},open:false,classList:{add(){},remove(){},toggle(){},contains(){return false}},setAttribute(){},addEventListener(){},replaceChildren(){this.textContent=this.innerHTML=''},scrollIntoView(){},showModal(){this.open=true},close(){this.open=false},focus(){}});return nodes.get(id)};
 const c={console,URLSearchParams,AbortController,DOMException,Date,Set,Map,setTimeout,clearTimeout,$:get,esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),authEpoch:0,token:'reader',checkIdleSession:()=>true,tab(){},lock(){c.authEpoch++;c.token=''},banner(){},cancelCleanupRetry(){},stopAutoPreviews(){},fetch:async()=>Response.json({})};
 vm.createContext(c);vm.runInContext(source,c);get('b2-sort').value='size-desc';
 const run=s=>vm.runInContext(s,c);
 return {c,get,run};
}
test('default size sorting, HTML escaping and partial inventory labels',()=>{
 const h=harness();h.run("b2Rows=[{file_id:'a',name:'small',size:1,uploaded_at:0,action:'upload',ticket:'a'},{file_id:'b',name:'<img onerror=x>',size:9000,uploaded_at:0,action:'upload',ticket:'b'}];b2CanDelete=true;renderB2()");
 assert.ok(h.get('b2-rows').innerHTML.indexOf('data-b2-id="b"')<h.get('b2-rows').innerHTML.indexOf('data-b2-id="a"'));
 assert.match(h.get('b2-rows').innerHTML,/&lt;img/);assert.doesNotMatch(h.get('b2-rows').innerHTML,/<img/);assert.match(h.get('b2-progress').textContent,/PARTIAL/);
 h.run('b2Complete=true;renderB2()');assert.match(h.get('b2-progress').textContent,/Listing complete/);
});
test('unknown limits do not render a fake capacity donut',()=>{
 const h=harness();h.run("infraRows=[{id:'x',name:'Test',status:'unchecked',scope:'runtime',metrics:[{label:'Storage',used:50,limit:null,unit:'bytes'}]}];renderInfra()");
 assert.match(h.get('infra-cards').innerHTML,/limit unknown/);assert.doesNotMatch(h.get('infra-cards').innerHTML,/infra-donut/);
});
test('cancel clears reviewed plan without a delete request',()=>{
 const h=harness();let calls=0;h.c.fetch=()=>{calls++;};h.run("b2Plan={plan:'signed'}");h.get('b2-cancel').onclick();assert.equal(h.run('b2Plan'),null);assert.equal(calls,0);
});
test('delete requires typed confirmation and clears plan and selection after one request',async()=>{
 const h=harness();let calls=0;h.c.fetch=async()=>{calls++;return Response.json({results:[{file_id:'a',name:'a',status:'deleted'}],instruction:'Refresh'})};
 h.run("b2Slot='slot';b2Rows=[{file_id:'a',name:'a',size:10,uploaded_at:0,action:'upload',ticket:'t'}];b2Selection.add('a');b2Plan={plan:'signed',confirmation:'DELETE 1'};b2CanDelete=true");
 h.get('b2-confirm-input').value='wrong';await h.get('b2-delete').onclick();assert.equal(calls,0);
 h.get('b2-confirm-input').value='DELETE 1';await h.get('b2-delete').onclick();await h.get('b2-delete').onclick();
 assert.equal(calls,1);assert.equal(h.run('b2Plan'),null);assert.equal(h.run('b2Selection.size'),0);assert.equal(h.get('b2-review').disabled,true);assert.match(h.get('b2-results').textContent,/DELETED/);
});
test('lock clears file data and confirmation and rejects delayed reads',async()=>{
 const h=harness();let resolve;h.c.fetch=()=>new Promise(r=>{resolve=r});const promise=h.run("infraRequest('control','/inventory')");
 h.run("b2Plan={plan:'secret'};b2Rows=[{name:'private'}];lock()");
 resolve(Response.json({rows:[{name:'late'}]}));await assert.rejects(promise,e=>e.name==='AbortError');
 assert.equal(h.run('b2Rows.length'),0);assert.equal(h.run('b2Plan'),null);assert.equal(h.get('b2-confirm-files').innerHTML,'');
});
test('empty inventory has no misleading zero-percent health ring',()=>{
 const h=harness();h.run('renderInfra()');assert.match(h.get('infra-summary').innerHTML,/No inventory loaded/);assert.doesNotMatch(h.get('infra-summary').innerHTML,/infra-donut/);
});
test('storage grouping, filter and bucket identity govern management actions',()=>{
 const h=harness();h.run("infraRows=[{id:'b2:a',name:'Bucket',bucket_id:'one',prefix:'',status:'healthy',scope:'control'},{id:'b2:@default',name:'Media',bucket_id:'two',prefix:'',status:'healthy',scope:'runtime'},{id:'telegram',name:'Bot',status:'unavailable',scope:'runtime'}];renderInfra()");
 assert.match(h.get('infra-cards').innerHTML,/Storage & files/);assert.match(h.get('infra-cards').innerHTML,/data-b2-open="0"/);
 assert.equal(h.run('infraManageIndex(infraRows[1],1)'),-1);
 h.run("infraRows[1].bucket_id='one'");assert.equal(h.run('infraManageIndex(infraRows[1],1)'),0);
 h.run("infraRows[1].prefix='private/'");assert.equal(h.run('infraManageIndex(infraRows[1],1)'),-1);
 h.get('infra-filter').value='attention';h.run('renderInfra()');assert.match(h.get('infra-cards').innerHTML,/Bot/);assert.doesNotMatch(h.get('infra-cards').innerHTML,/data-b2-open/);
});
test('folder browsing filters loaded rows without clearing other selected files',()=>{
 const h=harness();h.run("b2Rows=[{file_id:'a',name:'one/a.mp4',size:20,uploaded_at:0,action:'upload',ticket:'a'},{file_id:'b',name:'two/b.mp4',size:40,uploaded_at:0,action:'upload',ticket:'b'}];b2Selection.add('b');b2CanDelete=true");
 h.get('b2-folder').value='one/';h.run('renderB2()');assert.match(h.get('b2-rows').innerHTML,/one\/a.mp4/);assert.doesNotMatch(h.get('b2-rows').innerHTML,/two\/b.mp4/);assert.equal(h.run("b2Selection.has('b')"),true);assert.match(h.get('b2-selected').textContent,/1 \/ 10/);
});
