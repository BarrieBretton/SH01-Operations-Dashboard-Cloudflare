// Automatic read-only Google Sheets collector. Tokens never enter D1.
const SHEET_TABS=['streamables','streamables-yt','workflow-schedule'];
async function sheetJSON(url,options={}){
 for(let attempt=0;attempt<3;attempt++){
  let r;try{r=await fetch(url,{...options,signal:AbortSignal.timeout(20000)})}catch{if(attempt<2)continue;throw Error('google_network_timeout')}
  if((r.status===429||r.status>=500)&&attempt<2){await new Promise(ok=>setTimeout(ok,500*2**attempt));continue}
  if(!r.ok)throw Error('google_http_'+r.status);
  try{return await r.json()}catch{throw Error('google_invalid_json')}
 }
}
async function sheetToken(env){
 for(let k of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_SHEETS_SPREADSHEET_ID'])if(!env[k])throw Error('missing_'+k);
 const data=await sheetJSON('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_REFRESH_TOKEN,grant_type:'refresh_token'})});
 if(typeof data.access_token!=='string')throw Error('google_refresh_failed');return data.access_token;
}
async function readSheet(env,token,title){
 const range="'"+title.replaceAll("'","''")+"'!A:Z";
 const u='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)+'/values/'+encodeURIComponent(range);
 const data=await sheetJSON(u,{headers:{Authorization:'Bearer '+token}});
 const rows=data.values||[];
 if(!Array.isArray(rows))throw Error('sheet_invalid_shape');
 if(rows.length>20000)throw Error('sheet_row_limit_reached');
 return rows;
}
const sheetText=x=>String(x??'').trim();
function sheetRows(rows,title){
 if(!rows.length)throw Error('sheet_missing_header');
 let headers=rows[0].map(x=>sheetText(x).toLowerCase());
 const required=title==='workflow-schedule'?['associated accounts']:['account','creator_handle','status','approved'];
 if(required.some(x=>!headers.includes(x)))throw Error('sheet_required_columns_missing');
 return rows.slice(1).map((cells,i)=>({row:i+2,data:Object.fromEntries(headers.map((h,n)=>[h,cells[n]??'']))}));
}
async function producerHash(s){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),x=>x.toString(16).padStart(2,'0')).join('').slice(0,32)}
async function sheetSync(env){
 const db=env.DB,lease=crypto.randomUUID(),started=new Date().toISOString();
 await db.prepare("INSERT OR IGNORE INTO sheet_sync_state(id,status) VALUES(1,'never')").run();
 let acquired=await db.prepare("UPDATE sheet_sync_state SET lease=?,lease_until=?,last_attempt=?,status='running' WHERE id=1 AND (lease_until IS NULL OR lease_until<?)").bind(lease,Date.now()+300000,started,Date.now()).run();
 if(!acquired.meta.changes)return {status:'already_running'};
 const version=crypto.randomUUID();
 try{
  let token=await sheetToken(env),tables=[];
  for(let title of SHEET_TABS)tables.push([title,sheetRows(await readSheet(env,token,title),title)]);
  const existing=(await db.prepare('SELECT producer_id,threshold,workflow_names FROM producers').all()).results;
  const old=new Map(existing.map(p=>[p.producer_id,p])),groups=new Map(),schedule=new Set();
  for(let [title,rows] of tables)for(let {row,data:r} of rows){
   if(!Object.values(r).some(x=>sheetText(x)))continue;
   if(title==='workflow-schedule'){for(let a of sheetText(r['associated accounts']).split(','))if(a.trim())schedule.add(a.trim());continue}
   let account=sheetText(r.account),creator=sheetText(r.creator_handle);if(!account&&!creator)account='Unattributed / '+title;
   let id=await producerHash(account.toLowerCase()+'\0'+creator.toLowerCase()),g=groups.get(id);
   if(!g){g={producer_id:id,name:account||creator,account,creator_handle:creator,threshold:old.get(id)?.threshold??3,workflow_names:old.get(id)?.workflow_names||'[]',sheet_backed:1,items:[]};groups.set(id,g)}
   let status=sheetText(r.status),approved=sheetText(r.approved);
   g.items.push({item_id:title+':'+row,item_label:clean(sheetText(r.caption).slice(0,140)||'Row '+row,140),item_url:url(sheetText(r.yt_link)||sheetText(r['public drive link'])),status:clean(status,60),approved:clean(approved,60),ready:['yes','true','approved','1','y'].includes(approved.toLowerCase())&&!['used','published','consumed','done','posted','completed','deleted'].includes(status.toLowerCase())?1:0,origin:title});
  }
  let names=new Set([...groups.values()].map(g=>g.name.toLowerCase()));
  for(let name of schedule)if(!names.has(name.toLowerCase())){
   let id=await producerHash('schedule\0'+name.toLowerCase());groups.set(id,{producer_id:id,name,account:name,creator_handle:'',threshold:old.get(id)?.threshold??3,workflow_names:old.get(id)?.workflow_names||'[]',sheet_backed:0,items:[]});
  }
  let fetched=new Date().toISOString(),batch=[];
  const flush=async()=>{if(batch.length){await db.batch(batch);batch=[]}};
  for(let g of groups.values()){
   batch.push(db.prepare('INSERT INTO sheet_live_producers(version,producer_id,payload,fetched_at) VALUES(?,?,?,?)').bind(version,g.producer_id,JSON.stringify({...g,items:undefined,name:clean(g.name,150),account:clean(g.account,150),creator_handle:clean(g.creator_handle,150),total_count:g.items.length,ready_count:g.items.reduce((n,i)=>n+i.ready,0),consumed_count:g.items.filter(i=>['used','published','consumed','done','posted','completed','deleted'].includes(i.status.toLowerCase())).length}),fetched));
   for(let i of g.items){batch.push(db.prepare('INSERT INTO sheet_live_items(version,producer_id,item_id,payload) VALUES(?,?,?,?)').bind(version,g.producer_id,i.item_id,JSON.stringify(i)));if(batch.length>=80)await flush()}
   if(batch.length>=80)await flush();
  }
  await flush();
  let published=await db.prepare("UPDATE sheet_sync_state SET active_version=?,last_success=?,status='ok',error_code=NULL,lease=NULL,lease_until=NULL WHERE id=1 AND lease=? AND lease_until>?").bind(version,fetched,lease,Date.now()).run();
  if(!published.meta.changes)throw Error('sheet_lease_expired');
  // Old snapshots retained for an hour to avoid disrupting in-flight reads.
  await db.prepare("DELETE FROM sheet_live_items WHERE version IN (SELECT DISTINCT version FROM sheet_live_producers WHERE fetched_at<? AND version<>(SELECT active_version FROM sheet_sync_state WHERE id=1))").bind(new Date(Date.now()-3600000).toISOString()).run();
  await db.prepare("DELETE FROM sheet_live_producers WHERE fetched_at<? AND version<>(SELECT active_version FROM sheet_sync_state WHERE id=1)").bind(new Date(Date.now()-3600000).toISOString()).run();
  return {status:'ok',producers:groups.size,fetched_at:fetched};
 }catch(e){
  let code=/^(missing_GOOGLE_[A-Z_]+|google_http_\d+|google_network_timeout|google_invalid_json|google_refresh_failed|sheet_[a-z_]+)$/.test(e.message)?e.message:'sync_internal_error';
  await db.prepare("UPDATE sheet_sync_state SET status='failed',error_code=?,lease=NULL,lease_until=NULL WHERE id=1 AND lease=?").bind(code,lease).run();
  return {status:'failed',error_code:code}; // No upstream body or credential logging.
 }
}
async function sheetStatus(env){const s=await env.DB.prepare('SELECT status,last_attempt,last_success,error_code,active_version,lease_until FROM sheet_sync_state WHERE id=1').first();return {...s,configured:!!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_REFRESH_TOKEN&&env.GOOGLE_SHEETS_SPREADSHEET_ID),stale:!s?.last_success||Date.now()-Date.parse(s.last_success)>1800000,interval_minutes:10}}
async function liveProducerList(env){
 let state=await sheetStatus(env);
 let legacy=(await env.DB.prepare('SELECT p.*,COUNT(i.item_id) total_count,COALESCE(SUM(i.ready),0) ready_count,COALESCE(SUM(CASE WHEN lower(i.status) IN (\'used\',\'published\',\'consumed\',\'done\',\'posted\',\'completed\',\'deleted\') THEN 1 ELSE 0 END),0) consumed_count FROM producers p LEFT JOIN producer_items i ON i.producer_id=p.producer_id GROUP BY p.producer_id LIMIT 2000').all()).results;
 if(!state.active_version)return json({rows:legacy.map(p=>({...p,updated_at:null,source_kind:'archive_or_manual',source_stale:true})),sync:state});
 let rows=(await env.DB.prepare('SELECT payload,fetched_at FROM sheet_live_producers WHERE version=?').bind(state.active_version).all()).results.map(x=>({...JSON.parse(x.payload),updated_at:x.fetched_at,source_kind:'google_sheets_live',source_stale:state.stale}));
 let ids=new Set(rows.map(x=>x.producer_id));
 // Retain workflow-only archive references. Old stock/schedule rows are superseded.
 for(let p of legacy)if(!p.sheet_backed&&!ids.has(p.producer_id)&&!p.account)rows.push({...p,updated_at:null,source_kind:'archive_reference',source_stale:true});
 return json({rows,sync:state});
}
async function liveProducerItems(env,id){
 const state=await sheetStatus(env);
 if(state.active_version){
  let found=await env.DB.prepare('SELECT producer_id FROM sheet_live_producers WHERE version=? AND producer_id=?').bind(state.active_version,id).first();
  if(found){let r=await env.DB.prepare('SELECT payload FROM sheet_live_items WHERE version=? AND producer_id=? ORDER BY item_id LIMIT 5000').bind(state.active_version,id).all();return json({rows:r.results.map(x=>JSON.parse(x.payload))})}
 }
 return json({rows:(await env.DB.prepare('SELECT item_id,item_label,item_url,status,approved,ready,origin FROM producer_items WHERE producer_id=? LIMIT 5000').bind(id).all()).results});
}
