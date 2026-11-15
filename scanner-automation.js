// Durable, bounded similarity scanning on the existing Worker cron.
// No local terminal, provider credentials on Render, or deletion execution.
const AUTO_SCAN_ID='similarity_scan',AUTO_SCAN_URL='https://sh01.vivojaymail.workers.dev/social/inventory/scan';
function autoScanEnabled(env){return env.META_SYNC_ENABLED==='1'&&!!env.MEDIA_CLIP_API_KEY;}
function autoScanState(rows){try{return JSON.parse(rows.find(r=>r.id===AUTO_SCAN_ID)?.payload||'{}');}catch{return {};}}
function autoScanDue(env,tables){return autoScanEnabled(env)&&!(Date.parse(autoScanState(tables.content_collect_state).next_at)>Date.now());}
function autoScanFingerprint(row){try{
 const f=typeof row.fingerprint==='string'?JSON.parse(row.fingerprint):row.fingerprint;
 const image=v=>v?.algorithm==='sh01-social-perceptual'&&v.version===1&&v.media_type==='IMAGE'&&Array.isArray(v.hashes)&&v.hashes.length>=1&&v.hashes.length<=19&&v.hashes.every(h=>typeof h==='string'&&/^[a-f0-9]{16}$/.test(h))&&Number.isFinite(v.gray_stddev);
 if(image(f))return true;
 return f?.algorithm==='sh01-social-perceptual'&&f.version===1&&f.media_type==='VIDEO'&&Number.isFinite(f.duration)&&f.duration>=0.5&&f.duration<=900&&JSON.stringify(f.sample_positions)==='[0.1,0.3,0.5,0.7,0.9]'&&Array.isArray(f.frames)&&f.frames.length===5&&f.frames.every(image);
}catch{return false;}}

function autoScanEligible(row){return ['facebook','instagram'].includes(row.platform)&&row.delete_status==='published'&&['IMAGE','VIDEO','REELS','POST'].includes(row.media_type);}
function autoScanKey(row){return row.platform+':'+row.account_id;}
function autoScanCoverage(rows){const out=new Map();for(const r of rows){if(!autoScanEligible(r))continue;const key=autoScanKey(r),a=out.get(key)||{platform:r.platform,account_id:r.account_id,eligible:0,fingerprinted:0,pending:0};a.eligible++;a[autoScanFingerprint(r)?'fingerprinted':'pending']++;out.set(key,a);}return [...out.values()];}
function autoScanSummary(env,tables){const s=autoScanState(tables.content_collect_state),job=tables.content_jobs.find(r=>r.id===AUTO_SCAN_ID)||{};return {enabled:autoScanEnabled(env),status:job.lease_until>Date.now()?'running':job.status||'awaiting_first_tick',last_attempt:job.last_attempt||null,last_success:job.last_success||null,next_attempt:s.next_at||null,pending_batches:(s.batches||[]).length,last_result:s.last_result||null,scope:'Collected Facebook and Instagram images/videos; full provider history is not verified.'};}
function autoScanSelect(rows,state,now){
 const eligible=rows.filter(autoScanEligible),exists=(b,id)=>eligible.some(p=>p.platform===b.platform&&p.account_id===b.account_id&&p.post_id===id);
 state.batches=(state.batches||[]).map(b=>({...b,post_ids:b.post_ids.filter(id=>exists(b,id))})).filter(b=>b.post_ids.length);
 const candidates=state.batches.filter(b=>!(Date.parse(b.not_before)>now));
 if(state.batches.length<50){const byAccount=new Map();for(const r of eligible){if(autoScanFingerprint(r)||state.batches.some(b=>autoScanKey(b)===autoScanKey(r)&&b.post_ids.includes(r.post_id)))continue;const key=autoScanKey(r);if(!byAccount.has(key))byAccount.set(key,[]);byAccount.get(key).push(r);}
  for(const values of byAccount.values()){values.sort((a,b)=>String(a.first_seen||'').localeCompare(String(b.first_seen||''))||a.post_id.localeCompare(b.post_id));const r=values[0];candidates.push({platform:r.platform,account_id:r.account_id,post_ids:values.slice(0,2).map(x=>x.post_id),attempts:0});}
 }
 candidates.sort((a,b)=>String(state.account_attempts?.[autoScanKey(a)]||'').localeCompare(String(state.account_attempts?.[autoScanKey(b)]||''))||autoScanKey(a).localeCompare(autoScanKey(b)));
 return candidates[0]||null;
}
function autoScanOutcome(response,data,batch){
 const diag=[data?.detail,...(data?.errors||[])].filter(Boolean);const storage=diag.some(x=>(x.diagnostic||x).dashboard_code==='store_rate_limited'||x.code==='scanner_storage_cooldown');
 const raw=response?.headers?.get('Retry-After'),numeric=Number(raw);let retry=Math.max(0,Number.isFinite(numeric)?numeric:(Date.parse(raw)-Date.now())/1000)||0;
 for(const x of diag){const n=Number((x.diagnostic||x).retry_after_seconds);if(Number.isFinite(n)&&n>retry)retry=n;}
 const valid=response?.ok&&data?.ok===true&&data.platform===batch.platform&&data.account_id===batch.account_id&&data.coverage?.targeted_posts===true&&data.counts?.fingerprints_saved===batch.post_ids.length&&!data.coverage?.comparison_truncated&&!data.coverage?.cache_truncated;
 const status=response?.status,code=valid?null:storage||status===429?'scanner_storage_rate_limited':status===409?'scanner_busy':[401,403].includes(status)?'scanner_auth_failed':[404,422].includes(status)?'scanner_update_required':response?.ok?'scanner_partial_result':'scanner_unavailable';
 return {ok:!!valid,code,retry,counts:Object.fromEntries(['visited','fingerprinted','reused','failed_items','fingerprints_saved','duplicate_groups_ingested'].map(k=>[k,Number.isFinite(data?.counts?.[k])?data.counts[k]:0])),comparison_truncated:!!data?.coverage?.comparison_truncated,cache_truncated:!!data?.coverage?.cache_truncated};
}
async function autoScanTick(env){
 if(!autoScanEnabled(env))return {status:'disabled'};const lease=crypto.randomUUID(),now=Date.now();let batch=null;
 await env.STORE.transact(['content_jobs','content_collect_state','content_posts'],tx=>{
  batch=null;let job=tx.find('content_jobs',{id:AUTO_SCAN_ID});if(!job){job={id:AUTO_SCAN_ID,status:'never',lease:null,lease_until:null,last_attempt:null,last_success:null,error_code:null};tx.put('content_jobs',job);job=tx.find('content_jobs',{id:AUTO_SCAN_ID});}
  const state=autoScanState(tx.rows('content_collect_state'));if(job.lease_until>now||Date.parse(state.next_at)>now)return;
  batch=autoScanSelect(tx.rows('content_posts'),state,now);state.coverage=autoScanCoverage(tx.rows('content_posts'));state.checked_at=new Date(now).toISOString();
  if(!batch){state.next_at=new Date(now+300000).toISOString();Object.assign(job,{status:state.batches.length?'waiting':'idle',last_attempt:state.checked_at,lease:null,lease_until:null,error_code:null});}
  else{
   if(!state.batches.includes(batch))state.batches.push(batch);batch.not_before=new Date(now+600000).toISOString();batch.attempts=(batch.attempts||0)+1;
   state.account_attempts={...(state.account_attempts||{}),[autoScanKey(batch)]:state.checked_at};state.next_at=batch.not_before;
   Object.assign(job,{status:'running',lease,lease_until:now+600000,last_attempt:state.checked_at,error_code:null});
  }
  tx.put('content_collect_state',{id:AUTO_SCAN_ID,payload:JSON.stringify(state)});
 });
 if(!batch)return {status:'idle_or_waiting'};
 let outcome;
 try{const response=await fetch(AUTO_SCAN_URL,{method:'POST',redirect:'manual',headers:{'X-API-KEY':env.MEDIA_CLIP_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({platform:batch.platform,account_id:batch.account_id,post_ids:batch.post_ids,max_posts:batch.post_ids.length}),signal:AbortSignal.timeout(180000)});let data;try{const text=await response.text();if(text.length<=100000)data=JSON.parse(text);}catch{}outcome=autoScanOutcome(response,data,batch);}
 catch{outcome={ok:false,code:'scanner_response_unconfirmed',retry:600,counts:{}};}
 const at=Date.now(),cooldown=Math.max(75,outcome.retry||0)+Math.floor(Math.random()*15),backoff=Math.max(cooldown,Math.min(21600,75*2**Math.min(8,batch.attempts-1)),['scanner_auth_failed','scanner_update_required'].includes(outcome.code)?3600:0);
 await env.STORE.transact(['content_jobs','content_collect_state'],tx=>{
  const job=tx.find('content_jobs',{id:AUTO_SCAN_ID});if(job?.lease!==lease)return;
  const state=autoScanState(tx.rows('content_collect_state')),same=b=>autoScanKey(b)===autoScanKey(batch)&&JSON.stringify(b.post_ids)===JSON.stringify(batch.post_ids);
  if(outcome.ok)state.batches=(state.batches||[]).filter(b=>!same(b));else{const saved=state.batches.find(same);if(saved)saved.not_before=new Date(at+backoff*1000).toISOString();}
  state.last_result={platform:batch.platform,account_id:batch.account_id,checked_at:new Date(at).toISOString(),ok:outcome.ok,error:outcome.code,...outcome.counts,comparison_truncated:outcome.comparison_truncated||false,cache_truncated:outcome.cache_truncated||false};
  const globalDelay=['scanner_auth_failed','scanner_update_required','scanner_response_unconfirmed'].includes(outcome.code)?backoff:cooldown;
  state.next_at=new Date(at+globalDelay*1000).toISOString();Object.assign(job,{status:outcome.ok?'ok':'retry_scheduled',last_success:outcome.ok?new Date(at).toISOString():job.last_success,error_code:outcome.code,lease:null,lease_until:null});
  tx.put('content_collect_state',{id:AUTO_SCAN_ID,payload:JSON.stringify(state)});
 });
 return {status:outcome.ok?'ok':'retry_scheduled'};
}
