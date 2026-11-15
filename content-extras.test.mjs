import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import worker from './worker.js';
const source=fs.readFileSync(new URL('./content-extras.js',import.meta.url),'utf8');
const ledger=fs.readFileSync(new URL('./content-ledger.js',import.meta.url),'utf8');
const post={platform:'instagram',account_id:'123',post_id:'456',preview_url:'https://a.cdninstagram.com/image.jpg?oe=ffffffff',preview_type:'image',media_type:'IMAGE',delete_status:'published'};
function setup(shared=new Map()){
 const calls={store:0,cdn:0,graph:[],refresh:0};let now=Date.now();
 const c={Request,Response,URL,Map,TextEncoder,TextDecoder,btoa,atob,Uint8Array,AbortSignal,crypto:webcrypto,Date:class extends Date{static now(){return now}},json:d=>Response.json(d),body:r=>r.json(),producerHash:async s=>Buffer.from(await webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex'),metaCredential:x=>x,META_VERSION:'v24.0',metaPreview:async()=>{calls.refresh++;return {available:true,kind:'image',url:post.preview_url}},graph:async(path,token,params)=>{calls.graph.push({path,params});return path==='123'?{access_token:'page-secret'}:{data:[]}},fetch:async()=>{calls.cdn++;return new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}})},caches:{default:{match:async r=>shared.get(r.url)?.clone(),put:async(r,v)=>{shared.set(r.url,v.clone())}}}};
 vm.createContext(c);vm.runInContext(ledger+'\n'+source,c);
 const env={DASHBOARD_TOKEN:'dashboard-secret',META_SYSVAR:'meta-secret',GOOGLE_SHEETS_SPREADSHEET_ID:'book-1',STORE:{find:async(table)=>{calls.store++;return table==='meta_assets'?{id:'123'}:post}}};
 const req=()=>new Request('https://dashboard.test/api/content/media',{method:'POST'});
 const payload=async(p=post)=>{const [r]=await c.extrasDecorate(env,[p]);return {...p,ticket:r.extras_ticket};};return {c,env,calls,shared,req,payload,advance:ms=>{now+=ms}};
}
test('signed post tickets prevent arbitrary URLs, cross-account reuse, expired and rotated credentials',async()=>{
 const h=setup(),b=await h.payload();await h.c.extrasPost(h.env,b);assert.equal(h.calls.store,0);
 await assert.rejects(h.c.extrasPost(h.env,{...b,post_id:'777'}),/identity/);
 await assert.rejects(h.c.extrasPost(h.env,{...b,ticket:b.ticket.slice(0,-3)+'xyz'}),/invalid/);
 await assert.rejects(h.c.extrasPost({...h.env,META_SYSVAR:'changed'},b),/invalid/);
 h.advance(6*3600000+1);await assert.rejects(h.c.extrasPost(h.env,b),/invalid/);
});
test('image bytes coalesce, survive a fresh Worker instance and never read Sheets or Meta on cache hits',async()=>{
 const h=setup(),b=await h.payload();const [a,z]=await Promise.all([h.c.extrasMedia(h.req(),h.env,b),h.c.extrasMedia(h.req(),h.env,b)]);assert.equal(h.calls.cdn,1);assert.equal(h.calls.store,0);assert.equal(h.calls.refresh,0);assert.equal(a.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(await a.arrayBuffer(),await z.arrayBuffer());
 const next=setup(h.shared),r=await next.c.extrasMedia(next.req(),next.env,b);assert.equal(r.headers.get('X-Extras-Cache'),'shared');assert.equal(next.calls.cdn,0);assert.equal(next.calls.store,0);for(const key of h.shared.keys())assert.doesNotMatch(key,/secret|image.jpg|456/);
 next.advance(86400001);const fresh=await next.payload();await next.c.extrasMedia(next.req(),next.env,fresh);assert.equal(next.calls.cdn,1);
});
test('shared cache isolates workbooks and rejects unsafe media URLs and redirects',async()=>{
 const h=setup(),b=await h.payload();await h.c.extrasMedia(h.req(),h.env,b);const other=setup(h.shared);other.env.GOOGLE_SHEETS_SPREADSHEET_ID='book-2';await other.c.extrasMedia(other.req(),other.env,await other.payload());assert.equal(other.calls.cdn,1);
 h.c.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://evil.test/private'}});await assert.rejects(h.c.extrasCDN(post.preview_url),/redirect_rejected/);await assert.rejects(h.c.extrasCDN('http://127.0.0.1/file'),/unavailable/);
});
test('expired CDN response refreshes once; oversized and non-image payloads are refused',async()=>{
 const h=setup();let n=0;h.c.fetch=async()=>++n===1?new Response(null,{status:403}):new Response('image',{headers:{'Content-Type':'image/png'}});await h.c.extrasMedia(h.req(),h.env,await h.payload());assert.equal(n,2);assert.equal(h.calls.refresh,1);
 for(const headers of [{'Content-Type':'image/png','Content-Length':String(9*1024*1024)},{'Content-Type':'text/html'}]){const q=setup();q.c.fetch=async()=>new Response('bad',{headers});await assert.rejects(q.c.extrasMedia(q.req(),q.env,await q.payload()),/too_large|unsupported/);}
});
test('video descriptors cache without fetching full video bytes and honor signed URL expiry',async()=>{
 const h=setup(),b=await h.payload({...post,preview_type:'video',media_type:'REELS',preview_url:'https://a.fbcdn.net/video.mp4?oe=ffffffff'});const r=await h.c.extrasMedia(h.req(),h.env,b);assert.equal((await r.json()).kind,'video');assert.equal(h.calls.cdn,0);assert.ok(Number(r.headers.get('X-Extras-Expires'))<=Date.now()+1801000);assert.equal(h.c.extrasURLTTL('https://a.fbcdn.net/x?oe=1'),0);
});
test('comment pages and reply cursors stay bound to their post, use fixed Graph paths and cache across isolates',async()=>{
 const h=setup(),b=await h.payload();h.c.graph=async(path,t,params)=>{h.calls.graph.push({path,params});if(path==='123')return {access_token:'page-secret'};return {data:[{id:'900',text:'<b>hello</b>',username:'viewer',timestamp:'2026-11-15T01:00:00Z'}],paging:{next:'https://evil.test/?access_token=bad',cursors:{after:'next-page'}}};};
 const first=await (await h.c.extrasComments(h.req(),h.env,b)).json();assert.equal(first.rows[0].text,'<b>hello</b>');assert.ok(first.rows[0].reply_cursor);assert.equal(h.calls.graph[1].path,'456/comments');
 await h.c.extrasComments(h.req(),h.env,{...b,cursor:first.next_cursor});assert.equal(h.calls.graph.at(-1).params.after,'next-page');
 await h.c.extrasComments(h.req(),h.env,{...b,cursor:first.rows[0].reply_cursor});assert.equal(h.calls.graph.at(-1).path,'900/replies');
 const other=await h.payload({...post,post_id:'777'});await assert.rejects(h.c.extrasComments(h.req(),h.env,{...other,cursor:first.next_cursor}),/identity/);
 const fresh=setup(h.shared);await fresh.c.extrasComments(fresh.req(),fresh.env,b);assert.equal(fresh.calls.graph.length,0);assert.equal(fresh.calls.store,0);
});
test('permission failures are explicit cached unavailable states, never empty successful threads',async()=>{
 const h=setup(),b=await h.payload();let n=0;h.c.graph=async()=>{n++;throw Object.assign(Error('private raw provider response'),{category:'permission_denied'});};
 const r=await (await h.c.extrasComments(h.req(),h.env,b)).json();assert.equal(r.available,false);assert.equal(r.reason,'permission_denied');assert.doesNotMatch(JSON.stringify(r),/private raw/);await h.c.extrasComments(h.req(),h.env,b);assert.equal(n,1);
});
test('transient failures have a bounded cooldown instead of repeated immediate upstream requests',async()=>{
 const h=setup(),b=await h.payload();let n=0;h.c.fetch=async()=>{n++;return new Response(null,{status:429});};await assert.rejects(h.c.extrasMedia(h.req(),h.env,b),/rate_limited/);await assert.rejects(h.c.extrasMedia(h.req(),h.env,b),e=>e.retryAfter>=75);assert.equal(n,1);
});
test('new routes require dashboard auth even when the edge cache is warm; scanner credential is insufficient',async()=>{
 const env={DASHBOARD_TOKEN:'reader',MEDIA_CLIP_API_KEY:'scanner'};for(const path of ['/api/content/media','/api/content/comments'])for(const headers of [{},{Authorization:'Bearer scanner'},{'X-INGEST-KEY':'scanner'}])assert.equal((await worker.fetch(new Request('https://dashboard.test'+path,{method:'POST',headers,body:'{}'}),env,{})).status,401);
 assert.equal((await worker.fetch(new Request('https://dashboard.test/__private_post_cache/anything'),env,{})).status,404);
});
test('explicit failed-video recovery refreshes once per cooldown and replaces the ordinary shared descriptor',async()=>{
 const h=setup(),b=await h.payload({...post,preview_type:'video',media_type:'REELS',preview_url:'https://a.fbcdn.net/old.mp4'});await h.c.extrasMedia(h.req(),h.env,b);h.c.metaPreview=async()=>{h.calls.refresh++;return {available:true,kind:'video',url:'https://a.fbcdn.net/new.mp4'}};
 const recovered=await h.c.extrasMedia(h.req(),h.env,{...b,refresh:true});assert.equal((await recovered.json()).url,'https://a.fbcdn.net/new.mp4');await h.c.extrasMedia(h.req(),h.env,{...b,refresh:true});assert.equal(h.calls.refresh,1);
 assert.equal((await (await h.c.extrasMedia(h.req(),h.env,b)).json()).url,'https://a.fbcdn.net/new.mp4');
});
test('Graph retry jitter respects numeric and date Retry-After floors instead of retrying early',()=>{
 const c={Date,Math:Object.create(Math)};vm.createContext(c);vm.runInContext(fs.readFileSync(new URL('./meta-worker.js',import.meta.url),'utf8'),c);c.Math.random=()=>0;assert.equal(c.metaRetryDelay(0,'120'),120000);c.Math.random=()=>0.8;assert.equal(c.metaRetryDelay(0,'120'),120400);assert.ok(c.metaRetryDelay(0,new Date(Date.now()+60000).toUTCString())>=59000);
});
