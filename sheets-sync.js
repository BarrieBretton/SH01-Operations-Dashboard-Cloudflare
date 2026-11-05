// Read-only source collection. OAuth tokens stay in memory, never in D1.
const STOCK_TABS=['streamables','streamables-yt'];
const REFERENCE_TABS=['pinterest-search-queries','telegram_audio_social_queue','telegram-storage','media-edit-clips','captions-archive','daily-prompts','yt-accounts-mapper-store'];
const SOURCE_META_ID='__producer_source_evidence_v2__';
async function sheetJSON(url,options={}) {
 for(let attempt=0;attempt<3;attempt++){
  let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)})}catch{if(attempt<2)continue;throw Error('google_network_timeout')}
  if((r.status===429||r.status>=500)&&attempt<2){await new Promise(ok=>setTimeout(ok,500*2**attempt));continue}
  if(!r.ok)throw Error('google_http_'+r.status);
  try{return await r.json()}catch{throw Error('google_invalid_json')}
 }
}
async function sheetToken(env){
 for(const k of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_SHEETS_SPREADSHEET_ID'])if(!env[k])throw Error('missing_'+k);
 const data=await sheetJSON('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(typeof data.access_token!=='string')throw Error('google_refresh_failed');return data.access_token;
}
async function readSheet(env,token,title){
 const range="'"+title.replaceAll("'","''")+"'!A:AZ";
 const u='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)+'/values/'+encodeURIComponent(range);
 const data=await sheetJSON(u,{headers:{Authorization:'Bearer '+token}});
 if(data.majorDimension&&data.majorDimension!=='ROWS')throw Error('sheet_invalid_shape');
 const rows=data.values||[];if(!Array.isArray(rows))throw Error('sheet_invalid_shape');
 if(rows.length>20000)throw Error('sheet_row_limit_reached');return rows;
}
function sheetRows(rows,title){
 if(!rows.length||!Array.isArray(rows[0]))throw Error('sheet_missing_header');
 const headers=rows[0].map(x=>producerText(x).toLowerCase());
 const present=headers.filter(Boolean);
 if(new Set(present).size!==present.length)throw Error('sheet_duplicate_columns');
 const required=title==='workflow-schedule'?['workflow','associated accounts']:STOCK_TABS.includes(title)?['account','approved']:[];
 if(required.some(x=>!headers.includes(x))||(STOCK_TABS.includes(title)&&!headers.includes('status')&&!headers.includes('state')))throw Error('sheet_required_columns_missing');
 return rows.slice(1).map((cells,i)=>{if(!Array.isArray(cells))throw Error('sheet_invalid_shape');return {row:i+2,data:Object.fromEntries(headers.map((h,n)=>[h,cells[n]??'']).filter(([h])=>h))}}).filter(x=>Object.values(x.data).some(v=>producerText(v)));
}
async function producerHash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('').slice(0,32)}
function scheduleRoutes(rows){
 return rows.map(({row,data:r})=>{
  const name=String(r.workflow??''), matches=SOURCE_REGISTRY.workflows.filter(w=>w.name===name);
  return {row,workflow_name:clean(name,200),workflow_id:matches.length===1?matches[0].id:null,accounts:[...new Set(producerText(r['associated accounts']).split(',').map(producerAccount).filter(Boolean))].map(a=>clean(a,150)),resolution:matches.length===1?'exact_unique_name':'unresolved_name',timings:clean(r.timings??'',200),run:clean(r.run??'',80),timezone:'Asia/Kolkata'};
 });
}
function sourceAssociations(routes){
 const map=new Map(SOURCE_REGISTRY.sources.map(s=>[s.source_id,[]]));
 for(const route of routes){
  const seen=new Set(),todo=route.workflow_id?[route.workflow_id]:[];
  while(todo.length){const id=todo.pop();if(seen.has(id))continue;seen.add(id);for(const c of SOURCE_REGISTRY.calls)if(c.workflow_id===id&&c.target_workflow_id&&!c.disabled&&c.reachable)todo.push(c.target_workflow_id)}
  for(const s of SOURCE_REGISTRY.sources)if(seen.has(s.workflow_id)&&!s.disabled&&s.reachable_from_trigger)map.get(s.source_id).push({schedule_row:route.row,accounts:route.accounts,via:s.workflow_id===route.workflow_id?'exact_schedule_workflow':'literal_subworkflow_call',branch_selection:'unverified'});
 }
 return map;
}
async function makeStockGroups(env,tables,routes){
 const groups=new Map(),assoc=sourceAssociations(routes);
 const workbookHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.GOOGLE_SHEETS_SPREADSHEET_ID))),x=>x.toString(16).padStart(2,'0')).join('');
 for(const [title,rows] of tables)for(const {row,data:r} of rows){
  const account=producerAccount(r.account),id=await producerHash(JSON.stringify(['sheet-v2',env.GOOGLE_SHEETS_SPREADSHEET_ID,title,account]));
  let g=groups.get(id);
  if(!g){
   const candidates=SOURCE_REGISTRY.sources.filter(s=>s.tab===title&&s.role==='stock_pool'&&!s.disabled&&s.reachable_from_trigger);
   const matched=candidates.filter(s=>s.workbook_id_sha256===workbookHash&&(assoc.get(s.source_id)||[]).some(a=>a.accounts.includes(account)));
   g={policy_version:PRODUCER_POLICY_VERSION,producer_id:id,name:account||'Unattributed',account,creator_handle:'',creators:[],source_tab:title,source_kind:'google_sheets_stock',sheet_backed:1,measurement:'measured',...producerThreshold(env,title,account),workflow_names:JSON.stringify([...new Set(matched.map(s=>s.workflow_name))]),source_ids:matched.map(s=>s.source_id),reference_status:matched.length?'schedule_workbook_tab_match_branch_unverified':'no_exact_account_workbook_route_verified',items:[]};groups.set(id,g);
  }
  const status=producerStatusValue(r),creator=clean(producerText(r.creator_handle),150);
  if(creator&&!g.creators.includes(creator))g.creators.push(creator);
  g.items.push({item_id:title+':'+row,source_row:row,item_label:'Row '+row,item_url:producerURL(producerText(r.yt_link)||producerText(r['public drive link'])),status:clean(status.value,60),approved:clean(producerText(r.approved),60),creator_handle:creator,status_conflict:status.conflict,ready:producerReady(r)?1:0,consumed:producerConsumed(r)?1:0,origin:title});
 }
 return groups;
}
function referenceSummary(title,rows){
 const counts={};for(const {data:r} of rows){let s=producerStatusValue(r).value||'unspecified';if(!/^[a-z_ -]{1,40}$/.test(s))s='other';counts[s]=(counts[s]||0)+1}
 return {tab:title,rows:rows.length,status_counts:counts,ready_count:null,remaining:null,measurement:'row_states_only',reason:'This schema is not the staged + approved=yes stock contract. Row counts are not available media counts.'};
}
function safeSheetError(e){return /^(missing_GOOGLE_[A-Z_]+|google_http_\d+|google_network_timeout|google_invalid_json|google_refresh_failed|sheet_[a-z_]+)$/.test(e.message)?e.message:(/^(store_|sheets_storage_)/.test(e.message)?e.message:'sync_internal_error')}
async function sheetSync(env){
 const db=env.STORE,lease=crypto.randomUUID(),started=new Date().toISOString();
 const acquired=await db.claim('sheet_sync_state',1,lease,300000);
 if(!acquired)return {status:'already_running'};
 const version=crypto.randomUUID();
 try{
  const token=await sheetToken(env),tables=[];
  // Required stock reads fail the snapshot as a unit. Failed sync retains last good version.
  for(const title of STOCK_TABS)tables.push([title,sheetRows(await readSheet(env,token,title),title)]);
  let routes=[],scheduleState='ok',scheduleError=null;
  try{routes=scheduleRoutes(sheetRows(await readSheet(env,token,'workflow-schedule'),'workflow-schedule'))}catch(e){scheduleState='unavailable';scheduleError=safeSheetError(e)}
  const groups=await makeStockGroups(env,tables,routes),references=[];
  // Optional non-stock sources cannot turn a successful stock read into fake zeros.
  for(const title of REFERENCE_TABS){try{references.push({...referenceSummary(title,sheetRows(await readSheet(env,token,title),title)),status:'ok'})}catch(e){references.push({tab:title,status:'unavailable',error_code:safeSheetError(e),rows:null,ready_count:null})}}
  let clickouts={status:'unavailable',rows:[]};
  try{const rows=sheetRows(await readSheet(env,token,'clickouts'),'clickouts');if(rows.some(r=>!Object.hasOwn(r.data,'urls')))throw Error('sheet_required_columns_missing');const links=rows.map(r=>({row:r.row,permalink:producerURL(r.data.urls)})).filter(r=>r.permalink);clickouts={status:'ok',rows:links.slice(0,500),total_rows:rows.length,truncated:links.length>500};}catch(e){clickouts.error_code=safeSheetError(e)}
  const fetched=new Date().toISOString();
  await db.transact(['sheet_sync_state','sheet_live_producers','sheet_live_items'],tx=>{
   const state=tx.find('sheet_sync_state',{id:1});if(state.lease!==lease||state.lease_until<Date.now())throw Error('sheet_lease_expired');
   // Fixed storage version + per-row diff avoids rewriting 1,291 unchanged items.
   const stable='sheets-v1',oldItems=tx.rows('sheet_live_items'),oldGroups=tx.rows('sheet_live_producers');
   const nextItems=[],nextGroups=[];
   for(const g of groups.values()){
    const payload={...g,items:undefined,total_count:g.items.length,ready_count:g.items.reduce((n,i)=>n+i.ready,0),consumed_count:g.items.reduce((n,i)=>n+i.consumed,0),status_conflicts:g.items.filter(i=>i.status_conflict).length};
    nextGroups.push({version:stable,producer_id:g.producer_id,payload:JSON.stringify(payload),fetched_at:fetched});
    for(const item of g.items)nextItems.push({version:stable,producer_id:g.producer_id,item_id:item.item_id,payload:JSON.stringify(item)});
   }
   nextGroups.push({version:stable,producer_id:SOURCE_META_ID,payload:JSON.stringify({policy_version:2,routes,schedule_state:scheduleState,schedule_error:scheduleError,references,clickouts,collection_started:started,collection_finished:fetched,required_tabs:STOCK_TABS}),fetched_at:fetched});
   // Imported historical snapshots are retained. Replace only the current fixed slot.
   tx.remove('sheet_live_items',{version:stable});tx.remove('sheet_live_producers',{version:stable});
   for(const row of nextItems)tx.put('sheet_live_items',row);for(const row of nextGroups)tx.put('sheet_live_producers',row);
   Object.assign(state,{active_version:stable,last_success:fetched,status:'ok',error_code:null,lease:null,lease_until:null});
  });
  return {status:'ok',producers:groups.size,fetched_at:fetched};
 }catch(e){
  collectorDiagnostic('sheets_before_failure_save',e);const code=safeSheetError(e);await db.finish('sheet_sync_state',1,lease,{status:'failed',error_code:code});return {status:'failed',error_code:code};

 }
}
async function sheetStatus(env){const s=await env.STORE.find('sheet_sync_state',{id:1});return {...s,configured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN&&env.GOOGLE_SHEETS_SPREADSHEET_ID),stale:s?.status==='failed'||!s?.last_success||Date.now()-Date.parse(s.last_success)>1800000,interval_minutes:10}}
async function sourceMeta(env,state){if(!state.active_version)return null;const r=await env.STORE.find('sheet_live_producers',{version:state.active_version,producer_id:SOURCE_META_ID});return r?JSON.parse(r.payload):null}
async function liveProducerList(env){
 const state=await sheetStatus(env),meta=await sourceMeta(env,state);
 if(!meta||meta.policy_version!==2)return json({rows:[],sync:state,policy_version:2,warning:'Queue Sheets sync to replace the old inferred/mixed inventory. Legacy rows are retained but not presented as verified stock.'});
 const rows=(await env.STORE.rows('sheet_live_producers')).filter(r=>r.version===state.active_version&&r.producer_id!==SOURCE_META_ID).map(x=>({...JSON.parse(x.payload),updated_at:x.fetched_at,source_stale:state.stale,version:state.last_success}));
 return json({rows,sync:state,policy_version:2,source_evidence:meta,version:state.last_success});
}
async function liveProducerItems(env,id,request){
 const state=await sheetStatus(env),u=new URL(request?.url||'https://local.invalid/'),requested=u.searchParams.get('version')||state.last_success,version=state.active_version;
 if(requested!==state.last_success)return error('Producer snapshot changed; refresh inventory',409);
 if(!version||id===SOURCE_META_ID)return error('Producer snapshot unavailable',404);
 const record=await env.STORE.find('sheet_live_producers',{version,producer_id:id});
 if(!record||JSON.parse(record.payload).policy_version!==2)return error('Producer snapshot expired; refresh inventory',409);
 const offset=Number(u.searchParams.get('offset')||0),limit=200;if(!Number.isSafeInteger(offset)||offset<0||offset>100000)return error('Invalid offset',400);
 const data=storeSort((await env.STORE.rows('sheet_live_items')).filter(r=>r.version===version&&r.producer_id===id),'item_id').slice(offset,offset+limit+1);
 const after=await sheetStatus(env);if(after.last_success!==state.last_success)return error('Producer snapshot changed; refresh inventory',409);
 return json({rows:data.slice(0,limit).map(x=>JSON.parse(x.payload)),next_offset:data.length>limit?offset+limit:null,version:requested});
}
async function producerSources(env){
 const state=await sheetStatus(env),meta=await sourceMeta(env,state),routes=meta?.routes??SOURCE_REGISTRY.schedule,assoc=sourceAssociations(routes);
 return json({coverage:SOURCE_REGISTRY.coverage,source_archive:SOURCE_REGISTRY.source_archive,evidence_date:SOURCE_REGISTRY.evidence_date,workflow_sha256:SOURCE_REGISTRY.workflow_sha256,workflow_scope:SOURCE_REGISTRY.scope,workflow_base_url:producerURL(env.N8N_WORKFLOW_BASE_URL||'https://n8n-prod-1.vivojaymail.workers.dev'),schedule_evidence:meta?(meta.schedule_state==='ok'?'live_sheet':'live_sheet_unavailable'):'handoff_snapshot',references:meta?.references||[],issues:SOURCE_REGISTRY.issues,calls:SOURCE_REGISTRY.calls,schedule:routes.map(r=>({...r,workflow_url:r.workflow_id?producerURL(env.N8N_WORKFLOW_BASE_URL||'https://n8n-prod-1.vivojaymail.workers.dev').replace(/\/$/,'')+'/workflow/'+encodeURIComponent(r.workflow_id):''})),rows:SOURCE_REGISTRY.sources.map(s=>{const evidence=assoc.get(s.source_id)||[];return {...s,accounts:[...new Set(evidence.flatMap(e=>e.accounts))],account_evidence:evidence,measurement:s.kind==='pinterest_rapidapi'?'on_demand_not_finite_stock':'not_connected',remaining:null}})});
}

