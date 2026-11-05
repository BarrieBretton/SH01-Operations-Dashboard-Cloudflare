// Direct Google Sheets REST storage. Uses the existing Worker OAuth credentials.
// All writers must use this adapter; reserved _ops_ tabs are not user-editable data.
const STORE_SCHEMA = __STORE_SCHEMA__;
const STORE_MARKER='sh01-sheets-v2', STORE_GUARD_NAME='_sh01_ops_revision_guard';
const STORE_PARTS=16, STORE_CHUNK=38000;
const storeTokens=new WeakMap();
function storeKey(table,row){const s=Object.hasOwn(STORE_SCHEMA,table)?STORE_SCHEMA[table]:null;if(!s||!row||Array.isArray(row)||typeof row!=='object')throw Error('store_invalid_record');if(Object.keys(row).some(k=>!s.columns.includes(k)))throw Error('store_unknown_column');return JSON.stringify(s.keys.map(k=>{if(row[k]===undefined||row[k]===null)throw Error('store_missing_key');return row[k]}));}
function storeSort(rows,...fields){return rows.sort((a,b)=>{for(const f of fields){const desc=f[0]==='-',k=desc?f.slice(1):f,c=String(a[k]??'').localeCompare(String(b[k]??''));if(c)return desc?-c:c;}return 0;});}
function storeMatch(row,where){return Object.entries(where).every(([k,v])=>row[k]===v);}
function storeConfigured(env){return ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REFRESH_TOKEN','GOOGLE_SHEETS_SPREADSHEET_ID'].every(k=>typeof env[k]==='string'&&env[k].trim());}
function storeHeaders(){return ['record_key',...Array.from({length:STORE_PARTS},(_,i)=>'json_'+(i+1))];}
function storeCells(values){return {values:values.map(v=>({userEnteredValue:{stringValue:String(v)}}))};}
function storePack(key,row){const s=JSON.stringify(row),parts=[];let at=0;while(at<s.length){let end=Math.min(at+STORE_CHUNK,s.length);if(end<s.length&&s.charCodeAt(end-1)>=0xD800&&s.charCodeAt(end-1)<=0xDBFF)end--;parts.push(s.slice(at,end));at=end;}if(parts.length>STORE_PARTS)throw Error('store_record_too_large');while(parts.length<STORE_PARTS)parts.push('');return [key,...parts];}
async function storeToken(env){if(!storeConfigured(env))throw Error('sheets_storage_not_configured');if(!storeTokens.has(env))storeTokens.set(env,sheetToken(env).catch(()=>{storeTokens.delete(env);throw Error('store_google_oauth_failed')}));return storeTokens.get(env);}
async function storeGoogle(env,suffix,payload){
 const token=await storeToken(env),u='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)+suffix;
 // Mutations are NOT blindly retried here. Their guard/idempotency state is reconciled first.
 const tries=payload===undefined?3:1;
 for(let i=0;i<tries;i++){
  let r;try{r=await fetch(u,{method:payload===undefined?'GET':'POST',redirect:'manual',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:AbortSignal.timeout(20000)});}catch(e){
   const kind=/too many subrequests/i.test(String(e?.message||''))?'subrequest_limit':
    ['TimeoutError','AbortError'].includes(e?.name)?'request_timeout':'fetch_exception';
   console.log(JSON.stringify({event:'store_transport_failure',kind,attempt:i+1}));
   if(kind!=='subrequest_limit'&&i+1<tries)continue;
   throw Error('store_network_unavailable');
  }
  if(r.status>=300&&r.status<400)throw Error('store_redirect_rejected');
  if(!r.ok){let scopeMissing=false;if(r.status===403){try{const b=await r.json();scopeMissing=b?.error?.details?.some(d=>d.reason==='ACCESS_TOKEN_SCOPE_INSUFFICIENT')||b?.error?.errors?.some(d=>d.reason==='insufficientPermissions');}catch{}}const code=scopeMissing?'store_google_scope_missing':r.status===401?'store_google_oauth_rejected':r.status===403?'store_google_permission_denied':r.status===404?'store_workbook_not_found':r.status===429?'store_rate_limited':r.status===400?'store_google_invalid_request':'store_google_unavailable';if(i+1<tries&&(r.status===429||r.status>=500)){await new Promise(ok=>setTimeout(ok,500*2**i));continue;}throw Error(code);}
  try{return await r.json()}catch{throw Error('store_response_not_json')}
 }
}
async function storeMeta(env){const m=await storeGoogle(env,'?fields=sheets.properties,namedRanges');return {sheets:Object.fromEntries((m.sheets||[]).map(s=>[s.properties.title,s.properties])),ranges:m.namedRanges||[]};}
function storeControl(values){const v=values?.[0];if(v?.[0]!==STORE_MARKER)throw Error('store_not_initialized');let c;try{c=JSON.parse(v[1])}catch{throw Error('store_control_corrupt')}if(!Number.isSafeInteger(c.revision)||c.revision<0||typeof c.guard!=='string'||!Array.isArray(c.recent))throw Error('store_control_corrupt');return c;}
async function storeReadControl(env){return storeControl((await storeGoogle(env,'/values/'+encodeURIComponent("'_ops_control'!A1:B1")+'?valueRenderOption=UNFORMATTED_VALUE')).values);}
function storeLoad(table,data){if(!STORE_SCHEMA[table])throw Error('store_unknown_table');if(JSON.stringify(data[0])!==JSON.stringify(storeHeaders()))throw Error('store_header_mismatch');const rows=new Map(),free=[];for(let i=1;i<data.length;i++){if(!data[i]?.[0]){free.push(i);continue;}let row;try{row=JSON.parse(data[i].slice(1).join(''))}catch{throw Error('store_record_corrupt')}const key=storeKey(table,row);if(key!==data[i][0]||rows.has(key))throw Error('store_duplicate_or_corrupt_key');rows.set(key,{index:i,row});}return {rows,free,next:data.length||1};}
async function storeReadBundle(env,tables){
 if(!Array.isArray(tables)||tables.some(t=>!Object.hasOwn(STORE_SCHEMA,t))||new Set(tables).size!==tables.length)throw Error('store_invalid_tables');
 for(let attempt=0;attempt<3;attempt++){
  const before=await storeReadControl(env),q=new URLSearchParams({valueRenderOption:'UNFORMATTED_VALUE'});for(const t of tables)q.append('ranges',"'_ops_"+t+"'!A:Q");
  const data=tables.length?await storeGoogle(env,'/values:batchGet?'+q):{valueRanges:[]},after=await storeReadControl(env);
  if(before.revision!==after.revision||before.guard!==after.guard)continue;
  if(data.valueRanges?.length!==tables.length)throw Error('store_read_incomplete');
  return {control:after,tables:Object.fromEntries(tables.map((t,i)=>[t,storeLoad(t,data.valueRanges[i].values||[])]))};
 }throw Error('store_read_conflict_retry');
}
function storeGuardRequests(meta,oldGuard,newGuard){const sheetId=meta.sheets._ops_control?.sheetId;if(sheetId===undefined)throw Error('store_not_initialized');const range={sheetId,startRowIndex:0,endRowIndex:1,startColumnIndex:1,endColumnIndex:2};return [
 {updateNamedRange:{namedRange:{namedRangeId:oldGuard,range},fields:'range'}},
 {deleteNamedRange:{namedRangeId:oldGuard}},
 {addNamedRange:{namedRange:{namedRangeId:newGuard,name:STORE_GUARD_NAME,range}}}
 ];}
async function storePrepareCommit(env,payload,id,probe=false){
 if(!Array.isArray(payload.changes)||(!probe&&!payload.changes.length)||payload.changes.length>12000)throw Error('store_invalid_changes');
 const tables=[...new Set(payload.changes.map(c=>c.table))],snap=await storeReadBundle(env,tables),control=snap.control;
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(payload)))),v=>v.toString(16).padStart(2,'0')).join('');
 const prior=control.recent.find(x=>x.id===id);if(prior){if(prior.digest!==digest)throw Error('store_replay_mismatch');return {replayed:{ok:true,revision:prior.revision,replayed:true}};}
 if(payload.revision!==control.revision)throw Error('store_revision_conflict');
 if(!probe&&control.guard_verified!==true)throw Error('store_guard_verification_required');
 const meta=await storeMeta(env);if(!meta.ranges.some(r=>r.namedRangeId===control.guard&&r.name===STORE_GUARD_NAME))throw Error('store_revision_conflict');
 const loaded=snap.tables,updates=[],seen=new Set();
 for(const c of payload.changes){if(typeof c.key!=='string')throw Error('store_key_mismatch');const unique=c.table+'\n'+c.key;if(seen.has(unique))throw Error('store_duplicate_mutation');seen.add(unique);const t=loaded[c.table],old=t.rows.get(c.key);
  if(c.remove){if(old){updates.push({table:c.table,index:old.index,values:Array(17).fill('')});t.rows.delete(c.key);t.free.push(old.index);}continue;}
  if(storeKey(c.table,c.row)!==c.key)throw Error('store_key_mismatch');const index=old?old.index:t.free.length?t.free.shift():t.next++;t.rows.set(c.key,{index,row:c.row});updates.push({table:c.table,index,values:storePack(c.key,c.row)});
 }
 if(loaded.content_deletion_queue){const identities=new Set();for(const {row} of loaded.content_deletion_queue.rows.values()){const key=JSON.stringify([row.platform,row.account_id,row.post_id]);if(identities.has(key))throw Error('store_duplicate_deletion_identity');identities.add(key);}}
 const next={...control,revision:control.revision+1,guard:crypto.randomUUID(),recent:[...control.recent,{id,digest,revision:control.revision+1}].slice(-100)};
 const requests=storeGuardRequests(meta,control.guard,next.guard);
 for(const [t,data] of Object.entries(loaded)){const prop=meta.sheets['_ops_'+t];if(!prop||prop.gridProperties.columnCount<17)throw Error('store_table_missing');if(data.next>prop.gridProperties.rowCount)requests.push({appendDimension:{sheetId:prop.sheetId,dimension:'ROWS',length:data.next-prop.gridProperties.rowCount}});}
 updates.sort((a,b)=>a.table.localeCompare(b.table)||a.index-b.index);
 for(let i=0;i<updates.length;){const first=updates[i],rows=[storeCells(first.values)];let j=i+1;while(j<updates.length&&updates[j].table===first.table&&updates[j].index===first.index+j-i){rows.push(storeCells(updates[j].values));j++;}requests.push({updateCells:{start:{sheetId:meta.sheets['_ops_'+first.table].sheetId,rowIndex:first.index,columnIndex:0},rows,fields:'userEnteredValue'}});i=j;}
 requests.push({updateCells:{start:{sheetId:meta.sheets._ops_control.sheetId,rowIndex:0,columnIndex:0},rows:[storeCells([STORE_MARKER,JSON.stringify(next)])],fields:'userEnteredValue'}});
 if(new TextEncoder().encode(JSON.stringify({requests})).length>1900000)throw Error('store_transaction_too_large');
 return {requests,next,control,digest,id,changes:updates.length};
}
async function storeExecuteCommit(env,prepared){
 if(prepared.replayed)return prepared.replayed;
 for(let attempt=0;attempt<3;attempt++){
  try{await storeGoogle(env,':batchUpdate',{requests:prepared.requests});return {ok:true,revision:prepared.next.revision,changes:prepared.changes};}
  catch(e){const current=await storeReadControl(env),prior=current.recent.find(x=>x.id===prepared.id);
   if(prior){if(prior.digest!==prepared.digest)throw Error('store_replay_mismatch');return {ok:true,revision:prior.revision,replayed:true};}
   if(current.guard!==prepared.control.guard||current.revision!==prepared.control.revision)throw Error('store_revision_conflict');
   if(!['store_rate_limited','store_network_unavailable','store_google_unavailable','store_response_not_json'].includes(e.message)||attempt===2)throw e;
   await new Promise(ok=>setTimeout(ok,500*2**attempt));
  }
 }
}
async function storeRPC(env,payload){
 if(payload.op==='health'){const c=await storeReadControl(env);return {ok:true,backend:'google_sheets',transport:'direct_google_api',schema_version:2,revision:c.revision,guard_verified:c.guard_verified===true,tables:Object.keys(STORE_SCHEMA).length};}
 if(payload.op==='read'){const snap=await storeReadBundle(env,payload.tables),tables={};for(const t of payload.tables){const all=[...snap.tables[t].rows.values()].map(x=>x.row),offset=payload.offsets?.[t]||0;if(!Number.isSafeInteger(offset)||offset<0)throw Error('store_invalid_offset');const rows=[];let size=0,i=offset;while(i<all.length&&rows.length<1000){const n=new TextEncoder().encode(JSON.stringify(all[i])).length;if(rows.length&&size+n>700000)break;rows.push(all[i++]);size+=n;}tables[t]={rows,next:i<all.length?i:null,total:all.length};}return {ok:true,revision:snap.control.revision,tables};}
 if(payload.op==='commit')return storeExecuteCommit(env,await storePrepareCommit(env,payload,/^[a-f0-9-]{36}$/.test(payload.request_id||'')?payload.request_id:crypto.randomUUID()));
 throw Error('store_operation_rejected');
}
async function storeSetup(env){
 if(env.SHEETS_STORAGE_READY==='1')throw Error('store_setup_disabled_after_cutover');
 const meta=await storeMeta(env),names=['control',...Object.keys(STORE_SCHEMA)],present=names.filter(n=>meta.sheets['_ops_'+n]);
 if(present.length===names.length){await storeReadBundle(env,Object.keys(STORE_SCHEMA));return {ok:true,already_initialized:true};}
 if(present.length)throw Error('store_partial_or_old_setup_requires_review');
 const used=new Set(Object.values(meta.sheets).map(p=>p.sheetId)),requests=[],guard=crypto.randomUUID();let id=1,controlId;
 for(const n of names){while(used.has(id))id++;const sheetId=id++;used.add(sheetId);if(n==='control')controlId=sheetId;
  requests.push({addSheet:{properties:{sheetId,title:'_ops_'+n,gridProperties:{rowCount:100,columnCount:n==='control'?2:17,frozenRowCount:n==='control'?0:1}}}});
  requests.push({addProtectedRange:{protectedRange:{range:{sheetId},description:'Internal dashboard storage. Do not edit manually.',warningOnly:true}}});
  const rows=n==='control'?[storeCells([STORE_MARKER,JSON.stringify({revision:0,guard,guard_verified:false,recent:[]})])]:[storeCells(storeHeaders())];
  if(n==='sheet_sync_state')rows.push(storeCells(storePack('[1]',{id:1,status:'never',active_version:null,last_attempt:null,last_success:null,error_code:null,lease:null,lease_until:null})));
  if(n==='content_jobs')for(const job of ['sheet_mirror','meta_collect'])rows.push(storeCells(storePack(JSON.stringify([job]),{id:job,status:'never',lease:null,lease_until:null,last_attempt:null,last_success:null,error_code:null})));
  requests.push({updateCells:{start:{sheetId,rowIndex:0,columnIndex:0},rows,fields:'userEnteredValue'}});
 }
 requests.push({addNamedRange:{namedRange:{namedRangeId:guard,name:STORE_GUARD_NAME,range:{sheetId:controlId,startRowIndex:0,endRowIndex:1,startColumnIndex:1,endColumnIndex:2}}}});
 try{await storeGoogle(env,':batchUpdate',{requests});}catch(e){try{await storeReadBundle(env,Object.keys(STORE_SCHEMA));return {ok:true,already_initialized:true};}catch{throw e}}
 return {ok:true,initialized:true,tables:Object.keys(STORE_SCHEMA).length};
}
async function storeVerifyGuard(env){
 if(env.SHEETS_STORAGE_READY==='1')throw Error('store_setup_disabled_after_cutover');
 const before=await storeReadControl(env);if(before.guard_verified)return {ok:true,guard_verified:true,already_verified:true};
 // Exercise real Google API behavior before enabling business writes. This only
 // rotates the control marker; no operational/source rows or provider posts change.
 const payload={op:'commit',revision:before.revision,changes:[]};
 const a=await storePrepareCommit(env,payload,crypto.randomUUID(),true),b=await storePrepareCommit(env,payload,crypto.randomUUID(),true);
 const outcomes=await Promise.allSettled([storeGoogle(env,':batchUpdate',{requests:a.requests}),storeGoogle(env,':batchUpdate',{requests:b.requests})]);
 const current=await storeReadControl(env),winner=[a,b].find(x=>x.next.guard===current.guard);
 if(outcomes.filter(x=>x.status==='fulfilled').length!==1||!outcomes.some(x=>x.status==='rejected'&&x.reason.message==='store_google_invalid_request')||!winner||current.revision!==before.revision+1)throw Error('store_guard_probe_failed');
 // A stale retry must fail atomically. Confirm it cannot roll the revision back.
 let rejected=false;try{await storeGoogle(env,':batchUpdate',{requests:(winner===a?b:a).requests})}catch(e){if(e.message==='store_google_invalid_request')rejected=true;else throw e;}
 const after=await storeReadControl(env);if(!rejected||after.guard!==current.guard||after.revision!==current.revision)throw Error('store_guard_probe_failed');
 const verified=await storePrepareCommit(env,{op:'commit',revision:after.revision,changes:[]},crypto.randomUUID(),true);
 verified.next.guard_verified=true;verified.requests.at(-1).updateCells.rows=[storeCells([STORE_MARKER,JSON.stringify(verified.next)])];
 await storeExecuteCommit(env,verified);return {ok:true,guard_verified:true,concurrent_winners:1,stale_write_rejected:true};
}
class SheetStore{
 constructor(env){this.env=env;}
 async snapshot(tables){
  tables=[...new Set(tables)];
  const snap=await storeReadBundle(this.env,tables);
  return {revision:snap.control.revision,tables:Object.fromEntries(tables.map(t=>
   [t,[...snap.tables[t].rows.values()].map(entry=>entry.row)]))};
 }
 async rows(table){return (await this.snapshot([table])).tables[table];}
 async find(table,where){return (await this.rows(table)).find(r=>storeMatch(r,where))||null;}
 async transact(tables,fn){
  for(let attempt=0;attempt<4;attempt++){
   const snap=await this.snapshot(tables),state=Object.fromEntries(tables.map(t=>[t,new Map(structuredClone(snap.tables[t]).map(r=>[storeKey(t,r),r]))])),tx={
    rows:t=>{if(!state[t])throw Error('store_transaction_table_missing');return [...state[t].values()]},
    find:(t,w)=>{if(STORE_SCHEMA[t].keys.every(k=>Object.hasOwn(w,k)))return state[t].get(storeKey(t,w))||null;return [...state[t].values()].find(r=>storeMatch(r,w))||null;},
    put:(t,row)=>{state[t].set(storeKey(t,row),row);},
    remove:(t,where)=>{for(const [k,r] of state[t])if(storeMatch(r,where))state[t].delete(k);}
   };
   const result=await fn(tx),ops=[];
   for(const t of tables){const before=new Map(snap.tables[t].map(r=>[storeKey(t,r),r])),after=state[t];
    for(const [key,row] of after)if(JSON.stringify(before.get(key))!==JSON.stringify(row))ops.push({table:t,key,row});
    for(const key of before.keys())if(!after.has(key))ops.push({table:t,key,remove:true});
   }
   if(!ops.length)return result;
   try{await storeRPC(this.env,{op:'commit',revision:snap.revision,changes:ops});return result;}catch(e){if(e.message!=='store_revision_conflict'||attempt===3)throw e;}
  }
 }
 async put(table,row){return this.transact([table],tx=>tx.put(table,row));}
 async patch(table,where,values){return this.transact([table],tx=>{let n=0;for(const r of tx.rows(table))if(storeMatch(r,where)){Object.assign(r,values);n++;}return n;});}
 async claim(table,id,lease,ttl){return this.transact([table,'content_collect_state'],tx=>{const r=tx.find(table,{id});if(!r)throw Error('store_job_not_seeded');if(r.lease_until&&r.lease_until>=Date.now())return false;Object.assign(r,{lease,lease_until:Date.now()+ttl,last_attempt:new Date().toISOString(),status:'running',error_code:null});tx.remove('content_collect_state',{id:'request:'+(table==='sheet_sync_state'?'sheets':id)});return true;});}
 async finish(table,id,lease,fields){return this.transact([table],tx=>{const r=tx.find(table,{id});if(!r||r.lease!==lease)throw Error('store_job_lease_lost');Object.assign(r,fields,{lease:null,lease_until:null});});}
}
function storageEnv(env){return {...env,STORE:new SheetStore(env)};}
