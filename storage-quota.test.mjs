import {test} from 'node:test';
import assert from 'node:assert/strict';
import {directHarness} from './tests/direct-sheets-harness.mjs';

const failure=n=>({source:'sh01',event_id:String(n),message:'test '+n});
function observe(h){
 const calls=[];h.ctx.fetch=async(url,options)=>{calls.push({url,method:options.method});return h.fetch(url,options)};
 return calls;
}
test('one transaction uses four Google reads and one atomic write; unchanged rows only read',async()=>{
 const h=await directHarness(),calls=observe(h);
 await h.store.put('failures',failure(1));
 assert.equal(calls.filter(c=>c.method==='GET').length,4);
 assert.equal(calls.filter(c=>c.method==='POST').length,1);
 assert.equal(calls.filter(c=>c.url.includes('/values:batchGet')).length,1);
 calls.length=0;await h.store.put('failures',failure(1));
 assert.equal(calls.length,3);assert.ok(calls.every(c=>c.method==='GET'));
});
test('simultaneous identical reads share one snapshot, return independent data and do not cache completed reads',async()=>{
 const h=await directHarness();await h.store.put('failures',failure(1));const calls=observe(h);
 const [a,b]=await Promise.all([h.store.snapshot(['failures']),h.store.snapshot(['failures'])]);
 assert.equal(calls.length,3);a.tables.failures[0].message='changed locally';assert.equal(b.tables.failures[0].message,'test 1');
 await h.store.snapshot(['failures']);assert.equal(calls.length,6);
});
test('snapshot sharing requires the same environment and exact table set',async()=>{
 const h=await directHarness(),calls=observe(h);
 await Promise.all([h.store.snapshot(['failures']),h.store.snapshot(['content_posts']),new h.ctx.Store({...h.env,GOOGLE_SHEETS_SPREADSHEET_ID:'other'}).snapshot(['failures'])]);
 assert.equal(calls.length,9);
});
test('a competing update during a transaction reruns its callback and preserves both rows',async()=>{
 const h=await directHarness();let attempts=0;
 await h.store.transact(['failures'],async tx=>{
  attempts++;tx.put('failures',failure(1));if(attempts===1)await h.store.put('failures',failure(2));
 });
 assert.equal(attempts,2);assert.deepEqual(Array.from(await h.store.rows('failures'),r=>r.event_id).sort(),['1','2']);
});
test('failed shared reads are evicted; a later read can recover',async()=>{
 const h=await directHarness(),fetch=h.ctx.fetch;let failed=false;
 h.ctx.fetch=async(url,opts)=>{if(!failed){failed=true;return new Response('{}',{status:403});}return fetch(url,opts)};
 const results=await Promise.allSettled([h.store.rows('failures'),h.store.rows('failures')]);
 assert.ok(results.every(r=>r.status==='rejected'&&r.reason.message==='store_google_permission_denied'));
 assert.equal((await h.store.rows('failures')).length,0);
});
test('Google 429 starts a shared cooldown across workbooks; longer Retry-After is honored without immediate retries',async()=>{
 const h=await directHarness();let now=Date.now(),calls=0,limited=true;
 h.ctx.Date=class extends Date{static now(){return now}};
 h.ctx.fetch=async(url,opts)=>{calls++;if(limited){limited=false;return new Response('{}',{status:429,headers:{'Retry-After':'120'}})}return h.fetch(url,opts)};
 let delay;
 await assert.rejects(h.store.rows('failures'),e=>{delay=e.retryAfter;return e.message==='store_rate_limited'&&delay>=120&&delay<=126});
 assert.equal(calls,1);
 await assert.rejects(new h.ctx.Store({...h.env,GOOGLE_SHEETS_SPREADSHEET_ID:'second-book'}).rows('failures'),/store_rate_limited/);
 assert.equal(calls,1);
 await new h.ctx.Store({...h.env,GOOGLE_REFRESH_TOKEN:'another-user'}).rows('failures');assert.equal(calls,4);
 now+=(delay+1)*1000;await h.store.rows('failures');assert.equal(calls,7);
});
test('quota rejection of a write does not reconcile or retry immediately and remains replayable',async()=>{
 const h=await directHarness(),calls=[];let now=Date.now(),limited=true;
 h.ctx.Date=class extends Date{static now(){return now}};
 h.ctx.fetch=async(url,opts)=>{calls.push(opts.method);if(opts.method==='POST'&&limited){limited=false;return new Response('{}',{status:429})}return h.fetch(url,opts)};
 await assert.rejects(h.store.put('failures',failure(1)),e=>e.message==='store_rate_limited'&&e.retryAfter>=75);
 assert.deepEqual(calls,['GET','GET','GET','GET','POST']);
 now+=81000;await h.store.put('failures',failure(1));assert.equal((await h.store.rows('failures')).length,1);
});
test('HTTP date Retry-After and explicit 403 rate reasons are safe quota diagnostics',async()=>{
 const h=await directHarness(),retry=new Date(Date.now()+180000).toUTCString();let calls=0;
 h.ctx.fetch=async()=>{calls++;return Response.json({error:{message:'PRIVATE',errors:[{reason:'userRateLimitExceeded'}]}},{status:403,headers:{'Retry-After':retry}})};
 await assert.rejects(h.store.rows('failures'),e=>e.message==='store_rate_limited'&&e.retryAfter>=179);
 await assert.rejects(h.store.rows('content_posts'),/store_rate_limited/);assert.equal(calls,1);
});
test('deployed runtime propagates Retry-After for storage limits and still authenticates before storage',async()=>{
 const h=await directHarness(),old=globalThis.fetch,oldNow=Date.now;let calls=0,now=oldNow();Date.now=()=>now;
 globalThis.fetch=async(url,options)=>{if(new URL(url).hostname==='oauth2.googleapis.com')return h.fetch(url,options);calls++;return new Response('{}',{status:429,headers:{'Retry-After':'180'}})};
 try{
  const {default:worker}=await import('./worker.js');
  const env={...h.env,GOOGLE_REFRESH_TOKEN:'runtime-quota-'+crypto.randomUUID(),DASHBOARD_TOKEN:'reader',SHEETS_STORAGE_READY:'1'};
  const call=token=>worker.fetch(new Request('https://dash.test/api/content/groups',{headers:token?{Authorization:'Bearer '+token}:{}}),env,{});
  const denied=await call();assert.equal(denied.status,401);assert.equal(calls,0);
  const response=await call('reader');assert.equal(response.status,503);assert.ok(Number(response.headers.get('Retry-After'))>=180);assert.equal((await response.json()).error,'store_rate_limited');assert.equal(calls,1);
  now+=(Number(response.headers.get('Retry-After'))-10)*1000;
  const waiting=await call('reader');assert.equal(calls,1);assert.ok(Number(waiting.headers.get('Retry-After'))<=10);
 }finally{globalThis.fetch=old;Date.now=oldNow;}
});
