import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('./dashboard.html',import.meta.url),'utf8');
const source=html.split('<script>')[1].split('</script>')[0];
function setup(){
 const nodes=new Map(),storage=new Map();
 const get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',disabled:false,dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},addEventListener(){},replaceChildren(){this.innerHTML=''},scrollIntoView(){},insertAdjacentHTML(_,s){this.innerHTML+=s},click(){this.onclick?.()} });return nodes.get(id)};
 const context={console,Date,Intl,URL,URLSearchParams,Blob,AbortController,DOMException,setTimeout:()=>1,clearTimeout(){},setInterval(){},document:{getElementById:get,documentElement:{dataset:{}},addEventListener(){},createElement:()=>({click(){}})},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{getItem(){},setItem(){}},fetch:async()=>({status:200,ok:true,json:async()=>({rows:[]})})};
 vm.createContext(context);
 const instrumented=source.replace("let sessionExpires=0,authEpoch=0,filteredProducers=[];","globalThis.inspect={setRows:x=>{producerList=x},render:()=>renderProducers(),status:x=>status(x),lock:()=>lock(),setToken:x=>{token=x},getToken:()=>token};let sessionExpires=0,authEpoch=0,filteredProducers=[];");
 vm.runInContext(instrumented,context);
 return {context,get,storage};
}
test('stock states distinguish missing telemetry, zero, consumed, stale, low and ready',()=>{const {context:c}=setup();assert.equal(c.inspect.status({measurement:'not_connected'}),'unknown');const p={measurement:'measured',source_stale:false,total_count:3,ready_count:0,consumed_count:1,threshold:3};assert.equal(c.inspect.status(p),'empty');assert.equal(c.inspect.status({...p,consumed_count:3}),'consumed');assert.equal(c.inspect.status({...p,ready_count:3}),'ready');assert.equal(c.inspect.status({...p,ready_count:2}),'low');assert.equal(c.inspect.status({...p,ready_count:3,source_stale:true}),'stale')});
test('metadata escapes HTML and invalid workflow labels do not break tables',()=>{const {context:c,get}=setup();c.inspect.setRows([{producer_id:'1',name:'<img onerror=alert(1)>',account:'<script>',source_tab:'streamables',creators:['<script>'],workflow_names:'bad-json',measurement:'measured',total_count:2,ready_count:1,consumed_count:0,threshold:3,source_stale:true}]);c.inspect.render();assert.ok(get('producers').innerHTML.includes('&lt;img'));assert.ok(!get('producers').innerHTML.includes('<script>'));assert.ok(get('producers').innerHTML.includes('Stale'));get('producer-fresh').value='fresh';c.inspect.render();assert.equal(get('producers').innerHTML,'')});
test('lock clears sources, item cache and session',()=>{const {context:c,get,storage}=setup();storage.set('sh01-dashboard-session','private');c.inspect.setToken('private');get('items').innerHTML='private item';get('source-rows').innerHTML='private routing';c.inspect.lock();assert.equal(c.inspect.getToken(),'');assert.equal(get('items').innerHTML,'');assert.equal(get('source-rows').innerHTML,'');assert.equal(storage.has('sh01-dashboard-session'),false)});
