import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
const source=fs.readFileSync(new URL('./content-extras-ui.js',import.meta.url),'utf8');
// Minimal asynchronous IndexedDB transaction fixture; data survives new VM sessions.
function fakeIDB(rows){const db={objectStoreNames:{contains:()=>true},close(){},transaction(){const tx={};let jobs=0,ended=false;const finish=()=>setImmediate(()=>{if(!jobs&&!ended){ended=true;tx.oncomplete?.();}});const request=fn=>{jobs++;const r={};setImmediate(()=>{r.result=fn();r.onsuccess?.();jobs--;finish();});return r;};const store={get:id=>request(()=>rows.get(id)),getAll:()=>request(()=>[...rows.values()]),put:r=>{rows.set(r.id,structuredClone(r));},delete:id=>rows.delete(id),clear:()=>{rows.clear();return request(()=>undefined)}};tx.objectStore=()=>store;tx.abort=()=>{ended=true;tx.onabort?.();};finish();return tx;}};return {open(){const r={};setImmediate(()=>{r.result=db;r.onsuccess?.();});return r;}};}
const row={platform:'instagram',account_id:'1',post_id:'2',cache_scope:'credential-scope',media_revision:'revision',extras_ticket:'signed'};
function setup(rows=new Map()){
 let requests=0,revoked=[],objects=0;const widgets=new Map();const c={console,crypto:webcrypto,indexedDB:fakeIDB(rows),TextEncoder,TextDecoder,Uint8Array,Date,Map,Set,JSON,Blob,Response,AbortController,DOMException,btoa,atob,setTimeout,clearTimeout,token:'secret',authEpoch:1,previewNextRequest:0,URL:{createObjectURL:()=>{objects++;return 'blob:private-'+objects},revokeObjectURL:v=>revoked.push(v)},contentKey:r=>r.platform+':'+r.account_id+':'+r.post_id,contentDate:s=>s||'Unknown',relativeContentDate:()=> '1h ago',safeContentMedia:u=>String(u||'').startsWith('https://')?u:'',esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),link:()=>'<a>Original</a>',$:()=>null,document:{addEventListener(){},querySelectorAll:()=>[...widgets.values()]},fetch:async()=>{requests++;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png','X-Extras-Expires':String(Date.now()+86400000)}})}};
 vm.createContext(c);vm.runInContext(source,c);return {c,rows,widgets,requests:()=>requests,revoked};
}
test('encrypted image bytes survive a hard reload and reopening a session without a network request',async()=>{
 const h=setup();const a=await h.c.persistentPostPreview(row);assert.equal(a.local_blob,true);assert.equal(h.requests(),1);assert.equal(h.rows.size,1);const record=[...h.rows.values()][0];assert.deepEqual(Object.keys(record).sort(),['cipher','id','iv','saved','size','until']);assert.doesNotMatch(JSON.stringify(record),/secret|instagram|image\/png|signed/);
 const fresh=setup(h.rows);const b=await fresh.c.persistentPostPreview(row);assert.equal(b.local_blob,true);assert.equal(fresh.requests(),0);assert.equal((await fresh.c.persistentPostPreview(row)).url,b.url);
});
test('changed credentials, expired records and corrupt ciphertext cannot reuse old private image data',async()=>{
 const h=setup();await h.c.persistentPostPreview(row);const next=setup(h.rows);next.c.token='other';await next.c.persistentPostPreview(row);assert.equal(next.requests(),1);
 const expired=setup(h.rows);for(const r of h.rows.values())r.until=1;await expired.c.persistentPostPreview(row);assert.equal(expired.requests(),1);
 const damaged=setup(h.rows);for(const r of h.rows.values())r.cipher=new Uint8Array([1]).buffer;await damaged.c.persistentPostPreview(row);assert.equal(damaged.requests(),1);
});
test('lock revokes object URLs and clears decrypted memory while retaining encrypted disk entries',async()=>{
 const h=setup();const r=await h.c.persistentPostPreview(row);vm.runInContext("token='';authEpoch++;stopPostExtras(true)",h.c);assert.deepEqual(h.revoked,[r.url]);assert.equal(h.rows.size,1);assert.equal(vm.runInContext('postCacheKeys.size+postObjectURLs.size+postCommentStates.size',h.c),0);
});
test('late image response after lock cannot populate cache or create an object URL',async()=>{
 const h=setup();let finish;h.c.fetch=()=>new Promise(r=>{finish=r});const pending=h.c.persistentPostPreview(row);while(!finish)await new Promise(r=>setImmediate(r));vm.runInContext("authEpoch++;token='';stopPostExtras(true)",h.c);finish(new Response('image',{headers:{'Content-Type':'image/png'}}));await assert.rejects(pending,e=>e.name==='AbortError');assert.equal(h.rows.size,0);assert.equal(vm.runInContext('postObjectURLs.size',h.c),0);
});
test('browser persistence denied falls back to a usable preview without blocking the gallery',async()=>{
 const h=setup();h.c.indexedDB={open(){throw Error('denied')}};const result=await h.c.persistentPostPreview(row);assert.equal(result.kind,'image');assert.equal(h.requests(),1);
});
test('disk cache evicts old entries to enforce both count and byte budgets',async()=>{
 const h=setup();for(let i=0;i<160;i++)h.rows.set(String(i),{id:String(i),until:Date.now()+60000,saved:i,size:500000,cipher:new ArrayBuffer(0),iv:[]});await h.c.persistentPostPreview(row);assert.ok(h.rows.size<=160);assert.ok([...h.rows.values()].reduce((n,r)=>n+r.size,0)<=64*1024*1024);
});
test('threads escape comment markup, show local loading, paginate replies and reuse encrypted page cache',async()=>{
 const h=setup(),id='g0',box={dataset:{commentBody:id},setAttribute(){}};h.widgets.set(id,box);h.c.postCommentWidget(row,id);let calls=0;h.c.fetch=async(_path,options)=>{calls++;const cursor=JSON.parse(options.body).cursor;return Response.json({available:true,rows:cursor?[{id:'8',text:'reply',author:'B'}]:[{id:'7',text:'<img src=x onerror=bad>',author:'<script>',reply_cursor:'reply-cursor'}],checked_at:'2026-11-15T01:00:00Z',refresh_after:new Date(Date.now()+300000).toISOString(),next_cursor:null},{headers:{'X-Extras-Expires':String(Date.now()+300000)}});};
 const pending=h.c.loadPostComments(id);assert.match(box.innerHTML,/Loading comments/);await pending;assert.match(box.innerHTML,/&lt;img/);assert.doesNotMatch(box.innerHTML,/<script>|<img src=x/);assert.equal(calls,1);await h.c.loadPostComments(id);assert.equal(calls,1);await h.c.loadPostComments(id,'reply-cursor','7');assert.match(box.innerHTML,/reply/);assert.equal(calls,2);
 const fresh=setup(h.rows);fresh.c.postCommentWidget(row,id);await fresh.c.loadPostComments(id);assert.equal(fresh.requests(),0);
});
test('rate limits honor Retry-After, show local feedback and suppress subsequent requests during cooldown',async()=>{
 const h=setup();h.c.fetch=async()=>Response.json({error:'store_rate_limited'},{status:503,headers:{'Retry-After':'120'}});await assert.rejects(h.c.postExtrasRequest('/api/content/comments',row),e=>e.previewRetry===true);assert.ok(vm.runInContext('postExtrasCooldown-Date.now()',h.c)>=120000);h.c.fetch=async()=>{throw Error('should not call')};await assert.rejects(h.c.postExtrasRequest('/api/content/comments',row),/cooling down/);
});
