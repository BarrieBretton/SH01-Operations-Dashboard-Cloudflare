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
test('producer status differentiates consumed, unavailable and low stock',()=>{let {context:c}=setup();assert.equal(c.inspect.status({sheet_backed:0,total_count:2,ready_count:2}),'unknown');assert.equal(c.inspect.status({sheet_backed:1,total_count:0}),'unknown');assert.equal(c.inspect.status({sheet_backed:1,total_count:3,ready_count:0,consumed_count:1}),'unknown');assert.equal(c.inspect.status({sheet_backed:1,total_count:3,ready_count:0,consumed_count:3}),'red');assert.equal(c.inspect.status({sheet_backed:1,total_count:3,ready_count:1,threshold:2}),'amber')});
test('producer metadata escapes HTML; malformed references do not break rendering',()=>{let {context:c,get}=setup();c.inspect.setRows([{producer_id:'1',name:'<img onerror=alert(1)>',account:'<script>',creator_handle:'a',workflow_names:'not-json',sheet_backed:1,total_count:2,ready_count:1,consumed_count:0,threshold:2,updated_at:'2020-01-01 00:00:00'}]);c.inspect.render();assert.ok(get('producers').innerHTML.includes('&lt;img'));assert.ok(!get('producers').innerHTML.includes('<script>'));assert.ok(get('producers').innerHTML.includes('Stale / unknown'));get('producer-fresh').value='fresh';c.inspect.render();assert.equal(get('producers').innerHTML,'')});
test('lock clears cached records and authentication',()=>{let {context:c,get,storage}=setup();storage.set('sh01-dashboard-session','private');c.inspect.setToken('private');get('items').innerHTML='private item';get('meta-content-table').innerHTML='private metadata';c.inspect.lock();assert.equal(c.inspect.getToken(),'');assert.equal(get('items').innerHTML,'');assert.equal(get('meta-content-table').innerHTML,'');assert.equal(storage.has('sh01-dashboard-session'),false)});
