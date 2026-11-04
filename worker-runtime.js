const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
const error = (message,status) => json({error:message},status);
async function authorized(given,expected){if(!given||!expected)return false;const e=new TextEncoder(),a=await crypto.subtle.digest('SHA-256',e.encode(given)),b=await crypto.subtle.digest('SHA-256',e.encode(expected));return Array.from(new Uint8Array(a)).every((x,i)=>x===new Uint8Array(b)[i]);}
function clean(s,max=500){return String(s??'').slice(0,max).replace(/(?:Bearer\s+|api[_-]?key\s*[=:]\s*|password\s*[=:]\s*)\S+/gi,'[REDACTED]').replace(/eyJ[A-Za-z0-9_-]{18,}\.eyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{12,}/g,'[REDACTED]');}
function url(s){try{const u=new URL(String(s));if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';u.hash='';for(const key of Array.from(u.searchParams.keys()))if(/token|secret|password|auth|signature|api.?key|credential/i.test(key))u.searchParams.set(key,'[REDACTED]');return u.href}catch{return ''}}
function iso(s){const d=new Date(s);return Number.isNaN(d.valueOf())?null:d.toISOString()}
function like(q){return `%${q.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`}
async function body(req){if(Number(req.headers.get('Content-Length')||0)>900000)throw Error('Body too large');const t=await req.text();if(t.length>900000)throw Error('Body too large');return JSON.parse(t)}
async function ingestEvent(req,env){const b=await body(req),events=Array.isArray(b.events)?b.events:[b];if(events.length>100)return error('Maximum 100 events',400);const rows=events.map(x=>{if(!x||!['n8n','sh01'].includes(x.source)||!x.event_id||!iso(x.happened_at))throw Error('invalid_event');return {source:x.source,event_id:clean(x.event_id,150),happened_at:iso(x.happened_at),workflow_name:clean(x.workflow_name,150),workflow_url:url(x.workflow_url),severity:clean(x.severity||'error',20),message:clean(x.message,700),service:clean(x.service,100)};});await env.STORE.transact(['failures'],tx=>{for(const row of rows){const old=tx.find('failures',{source:row.source,event_id:row.event_id});tx.put('failures',{...row,ingested_at:old?.ingested_at||contentNow()});}});return json({ok:true,accepted:rows.length});}
async function ingestProducer(req,env){const x=await body(req);if(!x||!x.producer_id||!x.name||!Array.isArray(x.items)||x.items.length>350)throw Error('invalid_producer_batch');const id=clean(x.producer_id,180);await env.STORE.transact(['producers','producer_items'],tx=>{tx.put('producers',{producer_id:id,name:clean(x.name,150),account:clean(x.account,150),creator_handle:clean(x.creator_handle,150),threshold:Math.max(0,Math.min(100000,Number(x.threshold)||0)),sheet_backed:x.sheet_backed?1:0,workflow_names:JSON.stringify((x.workflow_names||[]).filter(v=>typeof v==='string').slice(0,100).map(v=>clean(v,120))),updated_at:contentNow()});if(x.reset)tx.remove('producer_items',{producer_id:id});for(const item of x.items){if(!item.item_id)throw Error('missing_item_id');tx.put('producer_items',{producer_id:id,item_id:clean(item.item_id,150),item_label:clean(item.item_label,150),item_url:producerURL(item.item_url),status:clean(item.status,60),approved:clean(item.approved,60),ready:producerReady(item)?1:0,origin:clean(item.origin,100)});}});return json({ok:true,items:x.items.length});}
async function listFailures(req,env){const u=new URL(req.url),q=(u.searchParams.get('q')||'').trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0,5),source=u.searchParams.get('source');if(source&&!['n8n','sh01'].includes(source))throw Error('invalid_source');let rows=(await env.STORE.rows('failures')).filter(r=>(!source||r.source===source)&&q.every(t=>[r.workflow_name,r.message,r.service].some(v=>String(v||'').toLowerCase().includes(t))));for(const key of ['from','to']){const v=u.searchParams.get(key);if(v){if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!iso(v))throw Error('invalid_date');const at=v+(key==='to'?'T23:59:59.999Z':'T00:00:00.000Z');rows=rows.filter(r=>key==='from'?r.happened_at>=at:r.happened_at<=at);}}const limit=Math.min(100,Math.max(1,Math.trunc(Number(u.searchParams.get('limit'))||100))),offset=Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0));storeSort(rows,'-happened_at','source','event_id');return json({rows:rows.slice(offset,offset+limit),has_more:rows.length>offset+limit});}
// The old binding is consulted only for explicit, authenticated, read-only migration.
async function exportLegacyD1(req,env){
 if(env.SHEETS_STORAGE_READY==='1')throw Error('legacy_export_disabled_after_cutover');if(!env.DB)throw Error('legacy_d1_binding_missing');const u=new URL(req.url),table=u.searchParams.get('table');
 if(table==='__catalog'){const result=await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();return json({tables:result.results.map(r=>r.name).filter(n=>!n.startsWith('sqlite_')&&!n.startsWith('_cf_')),migration_mode:true});}
 const schema=STORE_SCHEMA[table];if(!schema)throw Error('migration_unknown_table');let cursor=null;if(u.searchParams.has('cursor')){try{cursor=JSON.parse(u.searchParams.get('cursor'))}catch{throw Error('migration_invalid_cursor')}if(!Array.isArray(cursor)||cursor.length!==schema.keys.length||cursor.some(v=>!['string','number'].includes(typeof v)))throw Error('migration_invalid_cursor');}
 const columns=schema.keys.map(k=>'"'+k+'"').join(','),where=cursor?' WHERE ('+columns+') > ('+cursor.map(()=>'?').join(',')+')':'';
 let statement=env.DB.prepare('SELECT * FROM "'+table+'"'+where+' ORDER BY '+columns+' LIMIT 100');if(cursor)statement=statement.bind(...cursor);
 const rows=(await statement.all()).results,total=cursor?null:(await env.DB.prepare('SELECT COUNT(*) AS n FROM "'+table+'"').first()).n;
 return json({table,rows,total,next_cursor:rows.length===100?schema.keys.map(k=>rows.at(-1)[k]):null,migration_mode:true});
}
async function queueStoredJob(env,id){await env.STORE.put('content_collect_state',{id:'request:'+id,payload:JSON.stringify({requested_at:contentNow(),nonce:crypto.randomUUID()})});return {status:'queued',job:id,expected_start:'next_minute_cron',requires_cloudflare_cron:true};}
async function runStoredJobs(raw){
 if(raw.SHEETS_STORAGE_READY!=='1')return;const env=storageEnv(raw),snap=await env.STORE.snapshot(['content_collect_state','content_jobs','sheet_sync_state']);
 const jobs=[['sheets',snap.tables.sheet_sync_state[0],sheetSync,true],['sheet_mirror',snap.tables.content_jobs.find(r=>r.id==='sheet_mirror'),mirrorContentSheets,env.GOOGLE_SHEETS_WRITE_ENABLED==='1'],['meta_collect',snap.tables.content_jobs.find(r=>r.id==='meta_collect'),metaSync,env.META_SYNC_ENABLED==='1']];
 jobs.sort((a,b)=>{const ra=snap.tables.content_collect_state.find(r=>r.id==='request:'+a[0]),rb=snap.tables.content_collect_state.find(r=>r.id==='request:'+b[0]);return Number(!!rb)-Number(!!ra)||String(a[1]?.last_attempt||'').localeCompare(String(b[1]?.last_attempt||''));});
 for(const [id,state,fn,automatic] of jobs){const request=snap.tables.content_collect_state.find(r=>r.id==='request:'+id),due=automatic&&(!state?.last_attempt||Date.now()-Date.parse(state.last_attempt)>=600000);if(!request&&!due)continue;if(state?.lease_until>Date.now())continue;
  let result;try{result=await fn(env)}catch(e){console.log('collector_failed_'+id);result={status:'failed'};const code=({'META_SYSVAR missing':'meta_credential_missing','META_SYSVAR structure invalid':'meta_credential_invalid_json','META_SYSVAR has no supported access token field':'meta_credential_token_field_missing','META_SYSVAR credential format unsupported':'meta_credential_format_unsupported'}[e.message]||(/^[a-z][a-z0-9_]{2,100}$/.test(e.message||'')?e.message:'collector_failed'));const table=id==='sheets'?'sheet_sync_state':'content_jobs',jobId=id==='sheets'?1:id;try{await env.STORE.transact([table,'content_collect_state'],tx=>{const job=tx.find(table,{id:jobId});if(job&&(!job.lease_until||job.lease_until<Date.now())){Object.assign(job,{status:'failed',last_attempt:contentNow(),error_code:code,lease:null,lease_until:null});if(request&&tx.find('content_collect_state',{id:request.id})?.payload===request.payload)tx.remove('content_collect_state',{id:request.id});}});}catch{}}
  // The successful job claim consumes requests atomically; requests arriving during work remain queued.
  return; // One bounded collector per invocation avoids stacking provider/subrequest budgets.
 }
}
export default {
 async scheduled(event,raw,ctx){ctx.waitUntil(runStoredJobs(raw).catch(()=>console.log('scheduled_storage_unavailable')));},
 async fetch(req,raw,ctx){const u=new URL(req.url),p=u.pathname;
 if(p==='/'&&req.method==='GET')return new Response(HTML,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: https://*.cdninstagram.com https://*.fbcdn.net https://*.tumblr.com; media-src https://*.cdninstagram.com https://*.fbcdn.net https://*.tumblr.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"}});
 if(!p.startsWith('/api/'))return error('Not found',404);const ingest=p.startsWith('/api/ingest/'),given=ingest?req.headers.get('X-INGEST-KEY'):(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'');if(!await authorized(given,ingest?raw.INGEST_TOKEN:raw.DASHBOARD_TOKEN))return error('Unauthorized',401);
 try{
  if(p==='/api/storage/d1-export'&&req.method==='GET')return await exportLegacyD1(req,raw);
  if(p==='/api/storage/setup'&&req.method==='POST'){await storeSetup(raw);return json(await storeVerifyGuard(raw));}
  if(p==='/api/storage/transfer'&&req.method==='POST'){
   const payload=await body(req);
   if(!payload||!['read','health','commit'].includes(payload.op))throw Error('store_operation_rejected');
   if(payload.op==='commit'&&raw.SHEETS_STORAGE_READY==='1')throw Error('store_import_disabled_after_cutover');
   return json(await storeRPC(raw,payload));
  }
  if(p==='/api/storage/status'&&req.method==='GET')return json({...await storeRPC(raw,{op:'health'}),cutover_ready:raw.SHEETS_STORAGE_READY==='1'});
  if(raw.SHEETS_STORAGE_READY!=='1')return json({error:'sheets_migration_not_verified',instruction:'Complete migration verification before setting SHEETS_STORAGE_READY=1.'},503);
  const env=storageEnv(raw);
  if(p==='/api/content'||p.startsWith('/api/content/')||['/api/ingest/posts','/api/ingest/duplicate-groups','/api/ingest/fingerprints','/api/ingest/resolve-post','/api/ingest/deletion-result'].includes(p))return await contentApi(req,env,ctx);
  if(p==='/api/sheets/status'&&req.method==='GET')return json(await sheetStatus(env));
  if(p==='/api/sheets/sync'&&req.method==='POST'){return json(await queueStoredJob(env,'sheets'),202);}
  if(p.startsWith('/api/meta/'))return await metaApi(req,env);
  if(ingest&&req.method==='POST'&&p==='/api/ingest/event')return await ingestEvent(req,env);
  if(ingest&&req.method==='POST'&&p==='/api/ingest/producer')return await ingestProducer(req,env);
  if(req.method==='GET'&&p==='/api/failures')return await listFailures(req,env);
  if(req.method==='GET'&&p==='/api/producer-sources')return await producerSources(env);
  if(req.method==='GET'&&p==='/api/producers')return await liveProducerList(env);
  const m=p.match(/^\/api\/producers\/([^/]+)\/items$/);if(req.method==='GET'&&m)return await liveProducerItems(env,decodeURIComponent(m[1]),req);
  return error('Not found',404);
 }catch(e){const m=String(e.message||''),safe=/^[a-z][a-z0-9_]{2,100}$/.test(m)?m:'request_failed';return json({error:safe},/^(store_|sheets_storage_)/.test(safe)?503:400);}
 }
};
