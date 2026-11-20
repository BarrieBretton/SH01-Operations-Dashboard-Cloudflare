let snapchatRows=[],snapchatJobs=[],snapchatHealth=null,snapchatPolling=null;
const snapchatRequests=new Set(),snapchatActions=new Map();
function snapchatLink(value,label){try{const u=new URL(value);if(u.protocol==='https:'&&['docs.google.com','www.snapchat.com','accounts.snapchat.com'].includes(u.hostname)&&!u.username&&!u.password)return '<a href="'+esc(u.href)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+'</a>'}catch{}return esc(label||'Unavailable');}
async function snapchatRequest(path,payload){
 const c=new AbortController(),epoch=authEpoch; snapchatRequests.add(c);const timeout=setTimeout(()=>c.abort(),30000);
 try{
  const r=await fetch('/api/snapchat'+path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(payload===undefined?{}:{'Content-Type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:c.signal,cache:'no-store'});
  if(epoch!==authEpoch)throw new DOMException('Session changed','AbortError');
  if(r.status===401){lock();throw Error('Unlock Operations desk again.')}
  let d;try{d=await r.json()}catch{throw Error('Snapchat service returned a non-JSON response (HTTP '+r.status+').')}
  if(epoch!==authEpoch)throw new DOMException('Session changed','AbortError');
  if(!r.ok)throw Error(d.error||'Snapchat request failed (HTTP '+r.status+').');return d;
 }finally{clearTimeout(timeout);snapchatRequests.delete(c)}
}
function renderSnapchatJobs(){
 $('snapchat-jobs').innerHTML=snapchatJobs.map(j=>'<tr><td><strong>'+esc(j.item_id)+'</strong></td><td>'+esc(j.destination)+'</td><td><strong>'+esc(j.status)+'</strong><div class="sub">'+esc(j.stage||'')+'</div><div class="sub">'+esc(j.error||j.verification_error||'')+'</div></td><td>'+snapchatLink(j.reference?.link,(j.reference?.sheet||'Sheet')+' · '+(j.reference?.cell||''))+(j.published_url?'<div>'+snapchatLink(j.published_url,'Open Spotlight')+'</div><div class="sub">'+(j.link_verified?'Viewing link verified':'Viewing link has not been browser-verified')+'</div>':'')+'</td><td>'+esc(j.updated_at||'')+'</td></tr>').join('')||'<tr><td colspan="5">No publishing jobs loaded.</td></tr>';
}
function renderSnapchatQueue(){
 $('snapchat-queue').innerHTML=snapchatRows.map((r,i)=>'<tr><td><strong>'+esc(r.item_id)+'</strong><div class="sub">'+esc(r.source_locator)+'</div></td><td>'+esc(r.destination)+'</td><td>'+snapchatLink(r.reference?.link,r.reference?.sheet+' · '+r.reference?.cell)+'</td><td>'+esc(r.existing_job?.status||r.problems?.join(' · ')||'Ready for media validation')+'</td><td><button class="btn" data-snapchat-run="'+i+'" '+(r.ready&&snapchatHealth?.enabled?'':'disabled')+'>Queue publication</button></td></tr>').join('')||'<tr><td colspan="5">No queue items found.</td></tr>';
}
function renderSnapchatMetrics(metrics){
 if(!metrics){$('snapchat-metric-values').textContent='Analytics have not been collected.';return}
 const v=metrics.values||{},num=n=>typeof n==='number'?n.toLocaleString(undefined,{maximumFractionDigits:1}):'Unknown';
 $('snapchat-metric-values').innerHTML='<div class="stats">'+[['Followers',v.SUBSCRIBERS],['Spotlight views',v.SPOTLIGHT_VIEWS],['Story views',v.STORY_VIEWS],['Spotlight watch hours',v.SPOTLIGHT_VIEW_TIME_MILLIS===undefined?undefined:v.SPOTLIGHT_VIEW_TIME_MILLIS/3600000],['Story watch hours',v.STORY_VIEW_TIME_MILLIS===undefined?undefined:v.STORY_VIEW_TIME_MILLIS/3600000]].map(([n,x])=>'<span>'+esc(n)+'<strong>'+esc(num(x))+'</strong></span>').join('')+'</div><p class="legend">'+esc(metrics.period_note||'')+' Collected '+esc(new Date(metrics.checked_at*1000).toISOString())+'. Revenue and monetization approval are not available from this report.</p>';
}
function renderSnapchatStatus(d){
 const guidance={
  check_workbook_access:'Check access to the Google workbook and its Snapchat job storage, then refresh status.',
  initialize_workbook:'Choose Initialize Snapchat queue to finish setting up workbook storage.',
  configure_snapchat:'Finish Snapchat configuration on the SH01 media backend, then refresh status.',
  check_encryption_key:'Check that the backend uses the original Snapchat token encryption key.',
  connect_snapchat:'Once Snap has approved your app for the Public Profile API, choose Connect Snapchat and authorize your profile.',
  reconnect_snapchat:'Choose Connect Snapchat to authorize the configured app and profile again.',
  check_profile_access:'Choose Check API connection to verify that the app can read your Public Profile.',
  review_queue:'Choose Load content queue to review the next prepared video and its workbook row.'
 };
 const heading=[d.enabled?'Publishing enabled':'Publishing paused',d.connection?.display_name].filter(Boolean).join(' · ');
 const details=[];
 if(d.missing_configuration?.length)details.push('Missing settings · '+d.missing_configuration.join(', '));
 if(d.configuration_error)details.push('Configuration error · '+d.configuration_error);
 if(d.state_error)details.push('Workbook error · '+d.state_error);
 if(d.authorization_error)details.push('Credential error · '+d.authorization_error);
 if(d.schedule_error)details.push('Schedule error · '+d.schedule_error);
 const hint=Object.hasOwn(guidance,d.next_step)?guidance[d.next_step]:[d.authorization,d.api_access].filter(Boolean).join(' · ');
 $('snapchat-status').innerHTML='<strong>'+esc(heading)+'</strong>'+
  (hint?'<div>'+esc(hint)+'</div>':'')+details.map(line=>'<div class="sub">'+esc(line)+'</div>').join('');
 if(['initialize_workbook','connect_snapchat','reconnect_snapchat','check_profile_access'].includes(d.next_step)){
  $('snapchat-connection-settings').open=true;
 }
}
async function snapchatLoad(){
 const d=await snapchatRequest('/health');
 if(typeof d?.enabled!=='boolean')throw Error('Snapchat returned an incomplete status report. Refresh status to check again.');
 snapchatHealth=d;snapchatJobs=d.jobs||[];
 renderSnapchatStatus(d);
 $('snapchat-schedules').innerHTML=(d.schedules||[]).map(s=>'<p><strong>'+esc(s.workflow)+'</strong> · '+esc(s.error||(!s.times?.length?'No scheduled times':'Next: '+s.next_at))+' · IST</p>').join('');
 renderSnapchatJobs();renderSnapchatQueue();renderSnapchatMetrics(d.metrics);
}
async function snapchatAction(button,label,fn){
 if(button.disabled)return;const epoch=authEpoch,ticket={};snapchatActions.set(ticket,label);
 button.disabled=true;button.classList.add('is-loading');button.setAttribute('aria-busy','true');$('snapchat-loading').classList.remove('hidden');$('snapchat-loading').classList.add('is-loading');$('snapchat-loading').textContent=label;$('snapchat-error').textContent='';
 try{await fn()}catch(e){if(epoch===authEpoch&&e.name!=='AbortError')$('snapchat-error').textContent=e.message||'Request failed.'}
 finally{snapchatActions.delete(ticket);button.disabled=false;button.classList.remove('is-loading');button.removeAttribute('aria-busy');if(epoch===authEpoch){if(snapchatActions.size){$('snapchat-loading').textContent=[...snapchatActions.values()].at(-1)}else{$('snapchat-loading').classList.add('hidden');$('snapchat-loading').classList.remove('is-loading')}}}
}
function snapchatPoll(ident){
 clearTimeout(snapchatPolling);
 snapchatPolling=setTimeout(async()=>{
  if(!token||document.hidden||$('producer-view').classList.contains('hidden'))return;
  try{const j=await snapchatRequest('/jobs/'+ident);snapchatJobs=[j,...snapchatJobs.filter(x=>x.job_id!==ident)];renderSnapchatJobs();if(['queued','running','publishing','waiting_retry'].includes(j.status)||(j.status==='accepted'&&j.destination==='spotlight'))snapchatPoll(ident)}catch(e){if(e.name!=='AbortError')$('snapchat-error').textContent=e.message}
 },30000);
}
$('snapchat-refresh').onclick=()=>snapchatAction($('snapchat-refresh'),'Checking Snapchat connection and jobs…',snapchatLoad);
$('snapchat-preview').onclick=()=>snapchatAction($('snapchat-preview'),'Reading Snapchat-Queue…',async()=>{await snapchatLoad();const d=await snapchatRequest('/preview',{});snapchatRows=d.rows||[];$('snapchat-queue-note').textContent=d.media_validation;renderSnapchatQueue()});
$('snapchat-setup').onclick=()=>snapchatAction($('snapchat-setup'),'Initializing Snapchat workbook storage…',async()=>{await snapchatRequest('/setup',{});await snapchatLoad()});
$('snapchat-check').onclick=()=>snapchatAction($('snapchat-check'),'Checking authorized Snapchat profile…',async()=>{await snapchatRequest('/connection/check',{});await snapchatLoad()});
$('snapchat-connect').onclick=()=>snapchatAction($('snapchat-connect'),'Preparing Snapchat authorization…',async()=>{const d=await snapchatRequest('/connect',{});$('snapchat-authorize').innerHTML=snapchatLink(d.authorize_url,'Continue to Snapchat authorization ↗')+' · Expires in 10 minutes.'});
$('snapchat-metrics').onclick=()=>snapchatAction($('snapchat-metrics'),'Reading Snapchat analytics…',async()=>renderSnapchatMetrics(await snapchatRequest('/metrics/refresh',{})));
$('snapchat-queue').onclick=e=>{const b=e.target.closest('[data-snapchat-run]');if(!b||b.disabled)return;const r=snapchatRows[Number(b.dataset.snapchatRun)];if(!r?.ready||!snapchatHealth?.enabled)return;snapchatAction(b,'Queueing publication…',async()=>{const j=await snapchatRequest('/run',{item_id:r.item_id,fingerprint:r.fingerprint});r.ready=false;r.existing_job=j;snapchatJobs=[j,...snapchatJobs.filter(x=>x.job_id!==j.job_id)];renderSnapchatJobs();renderSnapchatQueue();snapchatPoll(j.job_id)})};
const snapchatOldLock=lock;
lock=function(){clearTimeout(snapchatPolling);snapchatPolling=null;for(const c of snapchatRequests)c.abort();snapchatRequests.clear();snapchatActions.clear();snapchatRows=[];snapchatJobs=[];snapchatHealth=null;for(const id of ['snapchat-authorize','snapchat-error','snapchat-queue','snapchat-jobs','snapchat-schedules','snapchat-metric-values'])$(id).replaceChildren();$('snapchat-status').textContent='Connection and publishing status have not been checked.';$('snapchat-loading').classList.add('hidden');snapchatOldLock()};
