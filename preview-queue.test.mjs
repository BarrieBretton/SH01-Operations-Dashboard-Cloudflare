import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('./content-view.js',import.meta.url),'utf8').split('// Warm nearby previews only; all requests share a bounded queue.')[1].split('const contentInfoPinned=')[0];
function harness(){const boxes=[0,1,2,3].map(i=>({id:'content-preview-'+i,dataset:{},getBoundingClientRect:()=>({top:i*400,bottom:i*400+200})}));const pending=[],observers=[];let aborted=0;const c={token:'test',contentVisible:boxes,contentView:'inventory',inflight:new Map([['content:/api/content/preview?x',{abort(){aborted++}}]]),document:{},$:(id)=>id==='content-layout'?{value:'cards'}:boxes[Number(id.split('-').at(-1))],performContentPreview:()=>new Promise(resolve=>pending.push(resolve)),IntersectionObserver:class{constructor(cb,options){this.cb=cb;this.options=options;observers.push(this)}observe(){}disconnect(){this.disconnected=true}},setTimeout,clearTimeout};vm.createContext(c);vm.runInContext(code,c);return {c,boxes,pending,observers,aborted:()=>aborted};}
test('lookahead starts nearby cards with two concurrent jobs; duplicate clicks share work',async()=>{const h=harness();vm.runInContext('startAutoPreviews()',h.c);assert.equal(h.observers[0].options.rootMargin,'1800px 0px');h.observers[0].cb(h.boxes.map(target=>({target,isIntersecting:true})));assert.equal(h.pending.length,2);vm.runInContext('loadContentPreview(0)',h.c);assert.equal(h.pending.length,2);h.pending.shift()();await new Promise(r=>setImmediate(r));assert.equal(h.pending.length,2);vm.runInContext("token='';stopAutoPreviews(true)",h.c);for(const done of h.pending)done();});
test('lock clears queue/cache, aborts requests and prevents late callbacks restarting loads',async()=>{const h=harness();vm.runInContext("startAutoPreviews();previewCache.set('x',{});loadContentPreview(0);loadContentPreview(1);loadContentPreview(2);token='';stopAutoPreviews(true)",h.c);assert.equal(h.aborted(),1);assert.equal(vm.runInContext('previewCache.size+previewQueue.length',h.c),0);h.observers[0].cb([{target:h.boxes[3],isIntersecting:true}]);for(const done of h.pending)done();await new Promise(r=>setImmediate(r));assert.equal(h.pending.length,2);});
test('cards that leave lookahead are removed from the waiting queue',async()=>{const h=harness();vm.runInContext('startAutoPreviews()',h.c);h.observers[0].cb(h.boxes.map(target=>({target,isIntersecting:true})));h.observers[0].cb([{target:h.boxes[2],isIntersecting:false}]);assert.equal(vm.runInContext('previewQueue.length',h.c),1);assert.equal(h.boxes[2].dataset.previewAttempted,undefined);vm.runInContext("token='';stopAutoPreviews()",h.c);for(const done of h.pending)done();});
test('stored media bypasses backend; missing media is paced and rate limits set a shared cooldown',async()=>{
 const h=harness();let calls=0;Object.assign(h.c,{contentKey:r=>r.post_id,safeContentMedia:v=>v?.startsWith('https://safe/')?v:'',URLSearchParams,contentRequest:async()=>{calls++;throw Error('Request failed (HTTP 503). store_rate_limited')}});
 const stored=await vm.runInContext("previewResponse({post_id:'a',preview_url:'https://safe/a',preview_type:'image'})",h.c);
 assert.equal(stored.stored,true);assert.equal(calls,0);
 await assert.rejects(vm.runInContext("previewResponse({post_id:'b'})",h.c),e=>e.previewRetry===true);
 assert.equal(calls,1);assert.ok(vm.runInContext('previewNextRequest-Date.now()',h.c)>59000);
 await assert.rejects(vm.runInContext("previewResponse({post_id:'c'})",h.c),e=>e.deferred===true);
 assert.equal(calls,1);vm.runInContext('stopAutoPreviews(true)',h.c);
});
test('rate-limited jobs stay queued and stopping cancels their scheduled recovery',async()=>{
 const h=harness();h.c.performContentPreview=async()=>{vm.runInContext('previewNextRequest=Date.now()+60000',h.c);throw Object.assign(Error('limited'),{previewRetry:true})};
 vm.runInContext('loadContentPreview(0)',h.c);await new Promise(r=>setImmediate(r));
 assert.equal(vm.runInContext('previewQueue.length',h.c),1);assert.equal(vm.runInContext('previewQueue[0].retries',h.c),1);
 vm.runInContext("token='';stopAutoPreviews(true)",h.c);assert.equal(vm.runInContext('previewResumeTimer',h.c),null);
});
