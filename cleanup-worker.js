// Cleanup control: receipt-only social reconciliation and opt-in B2 schedule proxy.
async function cleanupRemote(env,media,path,payload){
 const base=infraBase(media?(env.OPS_INFRA_MEDIA_URL||'https://sh01.onrender.com'):(env.OPS_INFRA_CONTROL_URL||'https://infra-control.vivojaymail.workers.dev'));
 const key=media?env.MEDIA_CLIP_API_KEY:env.CONTROL_PLANE_API_KEY;
 if(!key)throw Error('cleanup_key_not_configured');
 const r=await fetch(base+path,{method:payload===undefined?'GET':'POST',headers:{'X-API-KEY':key,...(payload===undefined?{}:{'Content-Type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),redirect:'manual',signal:AbortSignal.timeout(25000)});
 if(!r.ok)throw Error('cleanup_upstream_http_'+r.status);
 return r.json();
}
function cleanupMatch(q,r){
 return r.request_id===q.request_id&&r.platform===q.platform&&r.account_id===q.account_id&&r.post_id===q.post_id&&canonicalPostURL(r.urls,r.platform)===canonicalPostURL(q.permalink,q.platform);
}
async function cleanupReconcile(env){
 const data=await cleanupRemote(env,true,'/social/clickouts/evidence');
 if(data.read_only!==true||!Array.isArray(data.rows)||data.rows.length>10000)throw Error('cleanup_evidence_invalid');
 const counts=new Map();for(const r of data.rows)counts.set(r.request_id,(counts.get(r.request_id)||0)+1);
 const result={updated:0,deleted:0,manual_required:0,unmatched:0,diagnostics:data.rows.filter(r=>r.status!=='done'||!r.receipt_verified).map(r=>({request_id:r.request_id,post_id:r.post_id,status:r.status,reason:/^[a-zA-Z0-9_ :.-]{1,120}$/.test(r.error||'')?r.error:'No verified completion receipt'})),added:data.rows.filter(r=>r.status==='added').length,checked_at:contentNow()};
 await env.STORE.transact(['content_deletion_queue','content_posts','content_collect_state'],tx=>{
  for(const r of data.rows){
   const q=tx.find('content_deletion_queue',{request_id:r.request_id});
   if(!q||counts.get(r.request_id)!==1||!cleanupMatch(q,r)){result.unmatched++;continue;}
   let next=null,reason='';
   if(r.status==='done'&&r.receipt_verified===true){next='deleted';reason='clickouts_provider_receipt_verified';}
   else if(['blocked','manual_required','failed'].includes(r.status)){next='manual_required';reason='executor_'+r.status+':'+(/^[a-zA-Z0-9_ :.-]{1,120}$/.test(r.error||'')?r.error:'review_executor_evidence');}
   if(!next||q.status==='deleted')continue;
   if(q.status!==next||q.reason!==reason){Object.assign(q,{status:next,reason,updated_at:result.checked_at});const p=tx.find('content_posts',{platform:q.platform,account_id:q.account_id,post_id:q.post_id});if(p)p.delete_status=next;result.updated++;}
   result[next]++;
  }
  tx.put('content_collect_state',{id:'cleanup_receipts',payload:JSON.stringify(result)});
 });
 return result;
}
async function cleanupScheduled(raw){
 // No B2 schedule is created or enabled by this tick. Configured schedules only.
 const results=await Promise.allSettled([
  cleanupRemote(raw,false,'/infra/desk/b2/automation/tick',{}),
  (async()=>{if(raw.SHEETS_STORAGE_READY!=='1')return;const env=storageEnv(raw),state=(await env.STORE.rows('content_collect_state')).find(r=>r.id==='cleanup_receipts');if(state&&Date.now()-Date.parse(JSON.parse(state.payload).checked_at)<600000)return;return cleanupReconcile(env);})()
 ]);
 for(const r of results)if(r.status==='rejected')console.log('cleanup_background_check_failed');
}
