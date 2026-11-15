import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('./dashboard.html',import.meta.url),'utf8').split('<script>')[1].split('</script>')[0];
const KEY='sh01-dashboard-session',MINUTE=60000,START=Date.parse('2026-11-15T12:00:00Z');
const response=(status=200)=>({status,ok:status===200,json:async()=>status===200?{rows:[]}:{error:status===401?'unauthorized':'store_rate_limited'}});
const settle=async()=>{for(let i=0;i<20;i++)await Promise.resolve();};
function setup({at=START,storage=new Map(),fetcher=async()=>response(),storageFails=false}={}){
 let now=at,id=0,writes=0;const timers=new Map(),intervals=[],nodes=new Map(),listeners=new Map(),calls=[];
 const get=name=>{
  if(!nodes.has(name)){const classes=new Set(['app','producer-view','meta-view'].includes(name)?['hidden']:[]);
   nodes.set(name,{value:'',textContent:'',innerHTML:'',disabled:false,dataset:{},children:[],attributes:{},classList:{add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle(c,force){const yes=force??!classes.has(c);yes?classes.add(c):classes.delete(c)}},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]},addEventListener(){},replaceChildren(){this.textContent=this.innerHTML='';this.children=[]},insertAdjacentHTML(_,s){this.innerHTML+=s},scrollIntoView(){},click(){return this.onclick?.()}});
  }return nodes.get(name);
 };
 const listen=(type,fn)=>{if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn);};
 const context={console,Intl,URL,URLSearchParams,Blob,AbortController,DOMException,
  Date:class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}},
  setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:k=>timers.delete(k),setInterval(fn,ms){intervals.push({fn,ms});},
  document:{hidden:false,getElementById:get,documentElement:{dataset:{}},addEventListener:listen,createElement:()=>({click(){}})},addEventListener:listen,
  sessionStorage:{getItem:k=>{if(storageFails)throw Error('storage blocked');return storage.get(k)},setItem(k,v){if(storageFails)throw Error('storage blocked');writes++;storage.set(k,v)},removeItem:k=>{if(storageFails)throw Error('storage blocked');storage.delete(k)}},
  localStorage:{getItem(){},setItem(){}},fetch(...args){calls.push(args);return fetcher(...args);}
 };
 vm.createContext(context);vm.runInContext(source.replace('// END PRODUCER UI LOGIC',`globalThis.sessionTest={state:()=>({token,expires:sessionExpires,epoch:authEpoch}),api,contentRequest,lock:()=>lock()};\n// END PRODUCER UI LOGIC`),context);
 const emit=(type,extra={})=>{for(const fn of listeners.get(type)||[])fn({type,isTrusted:true,...extra});};
 const due=async()=>{for(let n=0;n<100;n++){const entry=[...timers].find(([,t])=>t.at<=now);if(!entry)break;timers.delete(entry[0]);entry[1].fn();await settle();}};
 const unlock=async()=>{get('token').value='fixture-token';await get('unlock').onclick();};
 return {context,get,storage,calls,timers,intervals,emit,due,unlock,api:context.sessionTest,setTime:t=>{now=t},writes:()=>writes};
}

test('trusted activity extends login beyond 30 minutes, without network keepalives',async()=>{
 const s=setup();await s.unlock();assert.equal(s.api.state().expires,START+30*MINUTE);
 const originalTimer=[...s.timers.values()].find(t=>t.at===START+30*MINUTE);
 for(const [i,type] of ['pointermove','pointerdown','keydown','wheel','touchstart','touchmove','click','input'].entries()){
  s.setTime(START+(29+i*10)*MINUTE);s.emit(type);await s.due();assert.ok(s.api.state().token,type);
  assert.equal(s.api.state().expires,START+(59+i*10)*MINUTE);
 }
 originalTimer.fn();assert.ok(s.api.state().token,'obsolete login deadline must recheck activity');
 assert.equal(s.calls.length,1,'activity must not call the API');assert.match(s.get('session-age').textContent,/Auto-lock in 30 min/);
 s.setTime(s.api.state().expires);await s.due();assert.equal(s.api.state().token,'');assert.match(s.get('notice').textContent,/30 minutes without activity/);assert.equal(s.storage.has(KEY),false);
});

test('background reads, synthetic events and visibility do not extend inactivity',async()=>{
 const s=setup();await s.unlock();const deadline=s.api.state().expires;
 s.setTime(START+10*MINUTE);await s.api.api('/api/producers');await s.api.contentRequest('/api/content/groups');
 s.emit('pointermove',{isTrusted:false});s.emit('input',{isTrusted:false});s.emit('visibilitychange');s.emit('pageshow');
 s.context.document.hidden=true;s.emit('click');s.emit('wheel');assert.equal(s.api.state().expires,deadline);
 s.setTime(deadline+1);s.context.document.hidden=false;s.emit('visibilitychange');assert.equal(s.api.state().token,'');
});

test('reload preserves activity deadline and does not grant an extra 30 minutes',async()=>{
 const s=setup();await s.unlock();s.setTime(START+5*MINUTE);s.emit('keydown');
 s.setTime(START+5*MINUTE+20);s.emit('pointermove');s.emit('pagehide');
 const deadline=START+35*MINUTE+20;assert.equal(JSON.parse(s.storage.get(KEY)).expires,deadline);
 const reloaded=setup({at:START+20*MINUTE,storage:s.storage});await settle();assert.equal(reloaded.api.state().expires,deadline);assert.equal(reloaded.get('app').classList.contains('hidden'),false);
 reloaded.setTime(deadline);await reloaded.due();assert.equal(reloaded.api.state().token,'');
 const expired=setup({at:deadline+1,storage:new Map([[KEY,JSON.stringify({token:'fixture-token',expires:deadline})]])});await settle();assert.equal(expired.calls.length,0);assert.equal(expired.api.state().token,'');
});

test('high-frequency activity coalesces storage writes while retaining the exact last event time',async()=>{
 const s=setup();await s.unlock();const writes=s.writes();
 for(let i=1;i<=100;i++){s.setTime(START+i);s.emit('pointermove');}
 assert.equal(s.api.state().expires,START+100+30*MINUTE);assert.equal(s.writes(),writes);
 s.setTime(START+1000);await s.due();assert.equal(s.writes(),writes+1);assert.equal(JSON.parse(s.storage.get(KEY)).expires,START+100+30*MINUTE);
});

test('manual lock, API rejection and storage failure retain working lock behavior',async()=>{
 const s=setup();await s.unlock();const staleTimer=[...s.timers.values()].find(t=>t.at===START+30*MINUTE);
 s.setTime(START+1);s.emit('click');s.api.lock();assert.equal(s.api.state().token,'');assert.equal(s.storage.has(KEY),false);assert.equal(s.timers.size,0);
 s.setTime(START+2);await s.unlock();staleTimer.fn();assert.ok(s.api.state().token,'old-session timer cannot lock replacement');
 s.context.fetch=async()=>response(401);await assert.rejects(s.api.api('/api/producers'),/Access rejected/);assert.equal(s.api.state().token,'');
 const blocked=setup({storageFails:true});await blocked.unlock();blocked.setTime(START+15*MINUTE);blocked.emit('keydown');assert.equal(blocked.api.state().expires,START+45*MINUTE);assert.doesNotThrow(()=>blocked.api.lock());assert.equal(blocked.api.state().token,'');
});

test('late input and request guards cannot revive an expired session after sleep',async()=>{
 const s=setup();await s.unlock();s.setTime(START+31*MINUTE);s.emit('click');assert.equal(s.api.state().token,'');assert.equal(s.storage.has(KEY),false);
 const t=setup();await t.unlock();t.setTime(START+31*MINUTE);const count=t.calls.length;await assert.rejects(t.api.api('/api/producers'),/Session expired/);assert.equal(t.calls.length,count);assert.equal(t.api.state().token,'');
 const c=setup();await c.unlock();c.setTime(START+31*MINUTE);await assert.rejects(c.api.contentRequest('/api/content/groups'),/Session expired after inactivity/);assert.equal(c.calls.length,1);assert.equal(c.api.state().token,'');
});

test('a locked pending unlock cannot recreate its session when the request completes',async()=>{
 let finish;const s=setup({fetcher:()=>new Promise(r=>{finish=r})});const opening=s.unlock();s.api.lock();finish(response());await opening;
 assert.equal(s.api.state().token,'');assert.equal(s.api.state().expires,0);assert.equal(s.storage.has(KEY),false);assert.equal(s.get('app').classList.contains('hidden'),true);
});

test('temporary restore failures keep valid sessions; rejected credentials and late restores cannot unlock',async()=>{
 const saved=()=>new Map([[KEY,JSON.stringify({token:'fixture-token',expires:START+25*MINUTE})]]);
 const transient=setup({storage:saved(),fetcher:async()=>response(503)});await settle();assert.equal(transient.get('app').classList.contains('hidden'),false);assert.ok(transient.api.state().token);assert.match(transient.get('failure-error').textContent,/store_rate_limited/);
 const rejected=setup({storage:saved(),fetcher:async()=>response(401)});await settle();assert.equal(rejected.api.state().token,'');assert.equal(rejected.get('app').classList.contains('hidden'),true);
 let finish;const late=setup({storage:saved(),fetcher:()=>new Promise(r=>{finish=r})});late.api.lock();finish(response());await settle();assert.equal(late.api.state().token,'');assert.equal(late.get('app').classList.contains('hidden'),true);
});
