// Content UI runs inside the authenticated dashboard closure. No third-party scripts.
let contentRows=[],contentVisible=[],contentAssets=[],contentGroups=[],contentQueue=[],contentOffset=0,contentHasMore=false;
let contentSelection=new Map(),contentSeries=[],contentChartSvg='',contentPlan=null,contentPlanVersion=0,contentChartVersion=0,contentView='inventory',contentQueueBusy=false;
const contentErrors=new Map();
let cleanupWaitDone=null;
let cleanupLoad=null,cleanupRetryTimer=null,cleanupRetryCount=0,cleanupRetryAt=0,cleanupFresh=false;
function cancelCleanupRetry(){clearTimeout(cleanupRetryTimer);cleanupRetryTimer=null;cleanupWaitDone?.();cleanupWaitDone=null;}
function scheduleCleanupRetry(){
 cancelCleanupRetry();
 if(cleanupRetryCount>=2||!token||contentView!=='cleanup')return;
 cleanupWaitDone=beginDeskLoading('content-groups-loading','Service busy · waiting for the scheduled retry…',['content-cleanup-refresh']);
 const epoch=authEpoch;
 cleanupRetryTimer=setTimeout(()=>{
  cleanupRetryTimer=null;cleanupWaitDone?.();cleanupWaitDone=null;
  if(epoch!==authEpoch||!token||contentView!=='cleanup'||$('meta-view').classList.contains('hidden')||document.hidden)return;
  cleanupRetryCount++;return loadContentCleanup(true).catch(contentError);
 },Math.max(0,cleanupRetryAt-Date.now()));
}
const contentFeedbackTargets=['content-error-inventory','content-error-more','content-error-compare','content-error-cleanup','content-error-plan','content-error-confirm','content-error-queue','content-error-availability','content-error-sheets','content-error-sync'];
function contentFeedbackTarget(path,view,body){
 if(path==='/api/content/plan')return 'content-error-plan';
 if(path==='/api/content/queue')return body===undefined?'content-error-queue':'content-error-confirm';
 if(path.includes('/sheets/'))return 'content-error-sheets';
 if(path==='/api/meta/sync')return 'content-error-sync';
 return 'content-error-'+view;
}
function renderContentErrors(){
 const messages=new Map();
 for(const errors of contentErrors.values())for(const {target,message} of errors.values()){
  if(!messages.has(target))messages.set(target,[]);messages.get(target).push(message);
 }
 for(const target of contentFeedbackTargets)setActionFeedback(target,(messages.get(target)||[]).join(' · '));
}
function clearContentFeedback(target){for(const errors of contentErrors.values())for(const [key,value] of errors)if(value.target===target)errors.delete(key);renderContentErrors();}
function contentError(e){if(e.name==='AbortError'||!token)return;const view=e.contentScope||contentView,target=e.feedbackTarget||contentFeedbackTarget(e.contentPath||'',view);if(!contentErrors.has(view))contentErrors.set(view,new Map());contentErrors.get(view).set(e.contentPath||target,{target,message:e.message||'Request failed'});renderContentErrors();}
const contentActionTargets={'content-plan':'content-error-plan','content-cleanup-refresh':'content-error-cleanup','content-more':'content-error-more','content-plot':'content-error-compare','content-sheet-setup':'content-error-sheets','content-sheet-sync':'content-error-sheets','meta-sync':'content-error-sync'};
function contentGuarded(button,fn){guarded(button,async()=>{const view=contentView,target=contentActionTargets[button]||'content-error-'+view,epoch=authEpoch;clearContentFeedback(target);let version;try{const pending=fn();version=contentPlanVersion;return await pending}catch(e){if(epoch!==authEpoch||(button==='content-plan'&&version!==contentPlanVersion))return;e.contentScope ||= view;e.feedbackTarget=target;contentError(e);}});}
const contentBaseError=showError;showError=e=>e.contentScope?contentError(e):contentBaseError(e);
const contentMetrics=['views','likes','comments','shares'];
const contentChartMetrics=[...contentMetrics,'reach','saved','total_interactions','notes'];
const contentKey=r=>JSON.stringify([r.platform,r.account_id,r.post_id]);
const contentNumber=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const contentCount=v=>contentNumber(v)===null?'Unknown':new Intl.NumberFormat(undefined,{maximumFractionDigits:2}).format(v);
const contentDate=v=>{const d=sourceDate(v);return d?new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'UTC',timeZoneName:'short'}).format(d):'Unknown'};
const contentPlatforms={instagram:['Instagram','<rect x="4" y="4" width="16" height="16" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="7" r="1.2"/>'],facebook:['Facebook','<path d="M14 22v-9h3l.5-4H14V7c0-1.2.4-2 2-2h2V1.5A24 24 0 0 0 15 1c-3 0-5 1.9-5 5.4V9H7v4h3v9z"/>'],youtube:['YouTube','<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 6 3-6 3z" fill="var(--panel)"/>'],pinterest:['Pinterest','<path d="M12 2a10 10 0 0 0-3.6 19.3c0-1 .1-2.1.4-3.2l1.3-5.4s-.3-.6-.3-1.6c0-1.5.9-2.7 2-2.7 1 0 1.4.7 1.4 1.6 0 1-.6 2.5-.9 3.9-.2 1.1.5 2 1.6 2 1.9 0 3.2-2.4 3.2-5.2 0-2.1-1.4-3.7-3.9-3.7-2.8 0-4.5 2.1-4.5 4.4 0 .8.2 1.4.6 1.9.2.2.2.3.1.5l-.2.8c0 .3-.3.4-.6.3-1.4-.6-2-2.1-2-3.8 0-2.9 2.4-6.3 7-6.3 3.8 0 6.2 2.8 6.2 5.7 0 3.9-2.2 6.9-5.4 6.9-1.1 0-2.1-.6-2.5-1.3l-.7 2.8c-.2 1.1-.8 2.1-1.3 2.9A10 10 0 1 0 12 2z"/>'],tiktok:['TikTok','<path d="M14 2h3c.3 2 1.5 3.5 4 4v3a9 9 0 0 1-4-1v8a6 6 0 1 1-5-6v3a3 3 0 1 0 2 3z"/>'],telegram:['Telegram','<path d="m2 11 19-8-3 18-6-5-3 3v-5l9-8-11 7z"/>'],n8n:['n8n','<circle cx="4" cy="12" r="3"/><circle cx="12" cy="5" r="3"/><circle cx="20" cy="12" r="3"/><circle cx="12" cy="19" r="3"/><path d="m6 10 4-3m4 0 4 3m0 4-4 3m-4 0-4-3" fill="none" stroke="currentColor" stroke-width="2"/>'],sh01:['SH01','<path d="M4 3h16v18H4z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 7h10v2H7zm0 4h10v2H7zm0 4h6v2H7z"/>']};
contentPlatforms.tumblr=['Tumblr','<path d="M14 2v5h5v4h-5v6c0 2 1 2.5 2.5 2.5 1 0 1.8-.3 2.5-.8V22c-1 .6-2.5 1-4 1-4 0-6-2-6-6v-6H6V8c3-1 4-3 4-6z"/>'];
contentPlatforms.google_sheets=['Google Sheets','<path d="M5 2h10l4 4v16H5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 10h8v8H8zm0 4h8m-4-4v8" fill="none" stroke="currentColor"/>'];
contentPlatforms.google_drive=['Google Drive','<path d="m9 2 6 0 8 14-3 6H4l-3-6zm0 0L1 16h7l7-14zm-1 14h15M9 2l8 14" fill="none" stroke="currentColor" stroke-width="1.8"/>'];
contentPlatforms.pinterest_rapidapi=['Pinterest API',contentPlatforms.pinterest[1]];
function platformBadge(value){const key=String(value||'').toLowerCase(),entry=contentPlatforms[key];return entry?'<span class="platform platform-'+key+'"><svg viewBox="0 0 24 24" aria-hidden="true">'+entry[1]+'</svg>'+entry[0]+'</span>':'<span class="platform">'+esc(value||'Unknown platform')+'</span>'}
function contentState(value){const v=String(value||'unknown'),key=v.toLowerCase(),tone=/^(ready|available|supported|ok|success|synced|completed)$/.test(key)?'green':/^(queued|pending|mirrored|planned|published|awaiting_sheet|queued_clickouts)$/.test(key)?'info':/partial|stale|warning|retry|correction|uncertain/.test(key)?'amber':/fail|error|deleted|blocked|denied/.test(key)?'red':'muted';return '<span class="badge '+tone+'">'+esc(v.replaceAll('_',' '))+'</span>'}
async function contentRequest(path,body){
 if(!token)throw Error('Unlock the dashboard first.');if(sessionExpires&&Date.now()>=sessionExpires){lock();throw Error('Session expired. Unlock again.')}
 const scope=contentView,epoch=authEpoch,key='content:'+path,controller=new AbortController();let timedOut=false;inflight.get(key)?.abort();inflight.set(key,controller);
 const finishLoading=deskRequestLoading(path,body);controller.contentRead=body===undefined;const timeout=setTimeout(()=>{timedOut=true;controller.abort()},25000);
 try{const r=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',signal:controller.signal});if(epoch!==authEpoch||inflight.get(key)!==controller)throw new DOMException('Superseded','AbortError');if(r.status===401){lock();throw Error('Access rejected. Unlock again.')}const data=await r.json();if(epoch!==authEpoch||inflight.get(key)!==controller)throw new DOMException('Superseded','AbortError');if(!r.ok){const retry=r.headers?.get('Retry-After'),seconds=retry&&Number(retry),retryMs=retry?(Number.isFinite(seconds)?seconds*1000:Date.parse(retry)-Date.now()):0;throw Object.assign(Error('Request failed (HTTP '+r.status+'). '+String(data.error||'Check Availability and refresh the stored data.').slice(0,240)),{httpStatus:r.status,code:data.error,retryMs:Number.isFinite(retryMs)?Math.max(0,retryMs):0});}contentErrors.get(scope)?.delete(path);renderContentErrors(scope);return data}
 catch(e){e.feedbackTarget=contentFeedbackTarget(path,scope,body);e.contentScope=scope;e.contentPath=path;if(timedOut&&epoch===authEpoch)throw Object.assign(Error(body===undefined?'Request timed out. Try refreshing.':'Request timed out. Its outcome is unknown; refresh the queue or sync status before retrying.'),{contentScope:scope,contentPath:path,feedbackTarget:contentFeedbackTarget(path,scope,body)});throw e}
 finally{finishLoading();clearTimeout(timeout);if(inflight.get(key)===controller)inflight.delete(key)}
}
function contentQuery(){const q=new URLSearchParams({limit:'50',offset:String(contentOffset)});for(const [key,id] of [['platform','content-platform'],['account_id','content-account'],['q','content-search'],['from','content-from'],['to','content-to']])if($(id).value.trim())q.set(key,$(id).value.trim());return q}
async function metaLoad(kind){return showContentView(kind==='capabilities'?'availability':kind==='compare'?'compare':kind==='cleanup'?'cleanup':'inventory')}
async function showContentView(view){cancelCleanupRetry();stopAutoPreviews();for(const [key,c] of inflight)if(key.startsWith('content:')&&c.contentRead)c.abort();banner();contentView=view;renderContentErrors(view);for(const name of ['inventory','compare','cleanup','availability']){$('content-panel-'+name).classList.toggle('hidden',name!==view);$('content-nav-'+name).setAttribute('aria-selected',String(name===view));$('content-nav-'+name).setAttribute('tabindex',name===view?'0':'-1')}if(view==='inventory')await loadContent();else if(view==='compare')renderContentSelection();else if(view==='cleanup')await loadContentCleanup();else await loadContentAvailability()}
async function loadContent(more=false){
 if($('content-from').value&&$('content-to').value&&$('content-from').value>$('content-to').value)throw Error('Published from must be on or before Published through.');
 if(!more){contentOffset=0;contentHasMore=false}const d=await contentRequest('/api/content?'+contentQuery());const incoming=Array.isArray(d.rows)?d.rows:[];
 if(more){const seen=new Set(contentRows.map(contentKey));contentRows.push(...incoming.filter(x=>!seen.has(contentKey(x))))}else contentRows=incoming;
 contentOffset=d.next_offset==null?contentOffset+incoming.length:d.next_offset;contentHasMore=Boolean(d.has_more);refreshContentAccounts();renderContent();$('content-library-notice').textContent=d.warning||'';
 $('freshness').textContent='Stored content refreshed '+contentDate(new Date().toISOString());
}
function refreshContentAccounts(){const select=$('content-account'),selected=select.value,platform=$('content-platform').value,accounts=new Map();for(const x of [...contentAssets.map(x=>({platform:x.platform,account_id:x.id,account_handle:x.name})),...contentRows]){if(x.account_id&&(!platform||x.platform===platform))accounts.set(String(x.account_id),(x.account_handle||x.account_id)+' · '+(contentPlatforms[x.platform]?.[0]||x.platform||'Unknown'))}if(selected&&!accounts.has(selected))accounts.set(selected,selected);select.innerHTML='<option value="">All accounts</option>'+[...accounts].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');select.value=selected}
function contentMetricCells(row){return '<dl class="content-metrics">'+contentMetrics.map(m=>'<div><dt>'+m[0].toUpperCase()+m.slice(1)+'</dt><dd>'+esc(contentCount(row.metrics?.[m]))+'</dd></div>').join('')+'</dl>'}
function contentPostLinks(row){return link(row.permalink,'Open post ↗')+' '+(row.workflow_url?link(row.workflow_url,'Workflow ↗'):'<span class="sub">Workflow unknown</span>')}
function contentCheckbox(row,index){return '<label class="compare-check"><input type="checkbox" data-content-select="'+index+'" '+(contentSelection.has(contentKey(row))?'checked ':'')+'aria-label="Compare post '+esc(row.post_id)+'">Compare</label>'}
function renderContent(){
 stopAutoPreviews();
 const from=$('content-from').value,to=$('content-to').value;if(from&&to&&from>to){$('content-library-notice').textContent='Published from must be on or before Published through.';return}
 contentVisible=contentRows.filter(r=>{const d=sourceDate(r.published_at);return (!from||(d&&d.toISOString().slice(0,10)>=from))&&(!to||(d&&d.toISOString().slice(0,10)<=to))});
 const unknown=contentVisible.filter(r=>contentMetrics.some(m=>contentNumber(r.metrics?.[m])===null)).length;
 $('content-stats').innerHTML=[['Visible posts',contentVisible.length],['Loaded posts',contentRows.length],['Accounts in view',new Set(contentVisible.map(r=>r.platform+':'+r.account_id)).size],['Missing one or more metrics',unknown]].map(([k,v])=>'<span>'+esc(k)+'<strong>'+v+'</strong></span>').join('');
 $('content-cards').innerHTML=contentVisible.map(contentGalleryCard).join('');
 $('content-table').innerHTML=contentVisible.map((r,i)=>'<tr><td>'+(String(i).startsWith('g')?'<span class="sub">Duplicate candidate · '+esc(r._groupEvidence||'Review the original posts before planning.')+'</span>':contentCheckbox(r,i))+'</td><td>'+platformBadge(r.platform)+'<div><strong>'+esc(r.account_handle||r.account_id)+'</strong></div><div class="sub">'+esc(r.post_id)+'</div><p class="sub">'+esc((r.caption||'No caption collected').slice(0,180))+'</p></td><td>'+esc(contentDate(r.published_at))+'</td><td>'+esc(r.media_type||'Unknown')+'<div>'+contentState(r.delete_status||'Stored')+'</div></td><td>'+contentMetricCells(r)+'</td><td>'+contentPostLinks(r)+'</td></tr>').join('');
 $('content-cards').classList.toggle('hidden',$('content-layout').value==='table');$('content-table-wrap').classList.toggle('hidden',$('content-layout').value!=='table');$('content-empty').classList.toggle('hidden',contentVisible.length>0);$('content-empty').textContent=contentRows.length?'No loaded posts match these dates.':'No content is stored for these filters. Check Availability or sync an available source.';
 $('content-page').textContent=contentVisible.length+' visible / '+contentRows.length+' loaded · '+(contentHasMore?'more stored posts available':'end of stored result set')+' · missing values are Unknown';$('content-more').classList.toggle('hidden',!contentHasMore);renderContentSelection();startAutoPreviews();
}
function renderContentSelection(){const rows=[...contentSelection.values()];$('content-selection-bar').classList.toggle('hidden',!rows.length);$('content-selection-count').textContent=rows.length?rows.length+' / 4 selected · '+(contentPlatforms[rows[0].platform]?.[0]||rows[0].platform):'Select up to 4 posts on the same platform.';$('content-open-compare').disabled=!rows.length;$('content-compare-selection').innerHTML=rows.length?rows.map(r=>'<div class="compare-chip">'+platformBadge(r.platform)+'<strong>'+esc(r.account_handle||r.account_id)+'</strong>Post '+esc(r.post_id)+'<div class="sub">Published '+esc(contentDate(r.published_at))+'</div></div>').join(''):'<p class="sub">Select posts using Compare in the library.</p>';$('content-plot').disabled=!rows.length}
function invalidateContentChart(){contentChartVersion++;contentSeries=[];contentChartSvg='';for(const id of ['content-chart','content-chart-legend','content-observations'])$(id).replaceChildren();$('content-chart-export').disabled=true;$('content-series-export').disabled=true;$('content-chart-status').textContent='Selection or metric changed. Load chart to see observations.'}
function selectContent(index,checked){const row=contentVisible[index];if(!row)return;const key=contentKey(row);if(checked){if(contentSelection.size>=4&&!contentSelection.has(key)){setActionFeedback('content-error-selection','Select up to four posts.');renderContent();return}const first=contentSelection.values().next().value;if(first&&first.platform!==row.platform){setActionFeedback('content-error-selection','Compare posts on the same platform; clear the selection to change platforms.');renderContent();return}contentSelection.set(key,row)}else contentSelection.delete(key);invalidateContentChart();renderContent();setActionFeedback('content-error-selection','')}
function safeContentMedia(value){try{const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>5000)return '';const h=u.hostname.toLowerCase(),roots=['cdninstagram.com','fbcdn.net','tumblr.com'];if(!roots.some(root=>h===root||h.endsWith('.'+root)))return '';for(const k of u.searchParams.keys())if(/^(access_token|token|authorization|api_key|key|password|secret)$/i.test(k))return '';return u.href}catch{return ''}}
async function performContentPreview(index,force=false){
 const row=previewRow(index),box=$('content-preview-'+index);if(!row||!box)return;
 const key=contentKey(row),epoch=authEpoch,generation=previewGeneration,owner={};box._previewOwner=owner;let closed=false,retrying=false;
 const current=()=>!closed&&box._previewOwner===owner&&epoch===authEpoch&&generation===previewGeneration&&contentKey(previewRow(index)||{})===key&&$('content-preview-'+index)===box;
 box.replaceChildren();setPreviewLoading(box,'Checking preview availability…');
 try{
  const d=await previewResponse(row,force);if(!current())return;
  const url=safeContentMedia(d.url);if(!url||!['image','video'].includes(d.kind)){box.innerHTML='<div class="preview-placeholder">Preview unavailable or expired. '+link(row.permalink,'Open original post ↗')+'</div>';return}
  const media=document.createElement(d.kind==='video'?'video':'img');media.referrerPolicy='no-referrer';
  if(d.kind==='video'){
   media.controls=true;media.preload='metadata';media.playsInline=true;
   media.onwaiting=media.onstalled=()=>{if(current())setPreviewLoading(box,'Buffering video…')};
   media.onplaying=media.oncanplay=media.onpause=media.onended=()=>{if(current())clearPreviewLoading(box)};
  }else{media.alt=(row.account_handle||row.platform)+' · '+(row.media_type||'post');media.loading='eager';media.decoding='async';}
  let mediaFailed=false;media.onerror=()=>{mediaFailed=true;previewCache.delete(key);if(current())clearPreviewLoading(box)};
  const ready=waitForPreviewMedia(media);media.src=url;box.replaceChildren(media);setPreviewLoading(box,d.kind==='video'?'Loading video preview…':'Loading image…');
  if(d.kind==='image'&&typeof media.cloneNode==='function'){const full=media.cloneNode();full.className='preview-full';full.alt='';full.setAttribute('aria-hidden','true');box.append(full);}
  const close=document.createElement('button');close.className='btn preview-close';close.textContent='Close preview';close.onclick=()=>{closed=true;clearPreviewLoading(box);media.removeAttribute('src');if(d.kind==='video')media.load();box.innerHTML='<div class="preview-placeholder"><button class="btn" data-preview="'+index+'">Reload preview</button><span class="preview-message">Media links may expire.</span></div>'};box.append(close);
  if(d.poster_only){const note=document.createElement('span');note.className='preview-video-note';note.textContent='Video poster · playback unavailable. Open the original post to watch.';box.append(note);}
  box.title=String(d.expires_warning||'Media links may expire; refresh to request a new preview.');const outcome=await ready;if(!current())return;
  if(outcome==='timeout'){clearPreviewLoading(box);closed=true;media.removeAttribute('src');if(d.kind==='video')media.load();box.innerHTML='<div class="preview-placeholder">Preview timed out. <button class="btn" data-preview="'+index+'">Retry preview</button>'+link(row.permalink,'Open original ↗')+'</div>';return;}
  if(mediaFailed){if(!force&&d.stored){box.dataset.refreshPreview='1';throw Object.assign(Error('Refreshing expired preview…'),{previewRetry:true,deferred:true})}box.innerHTML='<div class="preview-placeholder">Media unavailable. '+link(row.permalink,'Open original ↗')+'<button class="btn" data-preview="'+index+'">Retry preview</button></div>';}
 }catch(e){if(current()&&e.name!=='AbortError'){if(e.previewRetry){retrying=true;setPreviewLoading(box,'Waiting to retry preview…');throw e;}box.innerHTML='<div class="preview-placeholder">'+esc(e.message)+'<button class="btn" data-preview="'+index+'">Retry preview</button></div>';}}
 finally{if(current()&&!retrying)clearPreviewLoading(box);}
}
function normalizeContentSeries(rows){const byTime=new Map();for(const row of rows||[]){const date=sourceDate(row.observed_at),value=contentNumber(row.value);if(date&&value!==null)byTime.set(+date,{observed_at:date.toISOString(),time:+date,value})}const sorted=[...byTime.values()].sort((a,b)=>a.time-b.time);return sorted.map((row,i)=>{const previous=sorted[i-1],delta=previous?row.value-previous.value:null;return {...row,interval_start:previous?.observed_at||null,interval_ms:previous?row.time-previous.time:null,delta,interpretation:delta===null?'First observation':delta<0?'Correction / reset':'Observed interval change'}})}
async function loadContentChart(){const selected=[...contentSelection.values()],metric=$('content-metric').value;if(!selected.length||!contentChartMetrics.includes(metric))return;const generation=++contentChartVersion;contentSeries=[];contentChartSvg='';$('content-chart-export').disabled=true;$('content-series-export').disabled=true;$('content-chart').replaceChildren();$('content-observations').replaceChildren();$('content-chart-legend').replaceChildren();$('content-chart-status').textContent='Loading observed snapshots…';const results=await Promise.allSettled(selected.map(async row=>{const d=await contentRequest('/api/content/series?'+new URLSearchParams({platform:row.platform,account_id:row.account_id,post_id:row.post_id,metric}));return {post:row,rows:normalizeContentSeries(d.rows),metric,warning:[d.warning,d.truncated?'Series truncated to the first 2,000 stored observations. Later observations are omitted.':''].filter(Boolean).join(' ')}}));if(generation!==contentChartVersion||!token)return;contentSeries=results.map((r,i)=>r.status==='fulfilled'?r.value:{post:selected[i],rows:[],metric,warning:r.reason.name==='AbortError'?'Request interrupted':r.reason.message});renderContentChart()}
function contentSvg(series,metric,mode){
 const colors=['#176d65','#7143ae','#b25113','#1d63ad'],width=960,height=360,left=78,right=28,top=25,bottom=60,plotWidth=width-left-right,plotHeight=height-top-bottom;
 const points=series.flatMap(s=>s.rows.filter(r=>mode!=='interval'||r.delta!==null).map(r=>({time:r.time,value:mode==='interval'?r.delta:r.value})));if(!points.length)return '';
 const age=$('content-chart-axis').value==='age';
 const start=Math.min(...points.map(p=>p.time)),end=Math.max(...points.map(p=>p.time)),low=Math.min(0,...points.map(p=>p.value)),high=Math.max(1,...points.map(p=>p.value));const x=t=>left+(end===start?0.5:(t-start)/(end-start))*plotWidth,y=v=>top+(high-v)/(high-low)*plotHeight;
 let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(metric+' · '+(mode==='interval'?'observed interval change':'cumulative snapshots'))+'"><title>'+esc(metric)+' — '+(mode==='interval'?'observed interval changes':'cumulative observations')+'</title><desc>Points are collection observations, not exact activity times. Negative intervals are corrections or resets.</desc><rect width="960" height="360" rx="10" fill="#f7f9fc"/>';
 for(let i=0;i<=4;i++){const v=low+(high-low)*i/4,py=y(v);s+='<line x1="'+left+'" y1="'+py+'" x2="'+(width-right)+'" y2="'+py+'" stroke="#d6dfe8"/><text x="'+(left-10)+'" y="'+(py+4)+'" text-anchor="end" font-family="system-ui,sans-serif" font-size="11" fill="#405669">'+esc(new Intl.NumberFormat('en',{notation:Math.abs(v)>=10000?'compact':'standard',maximumFractionDigits:1}).format(v))+'</text>'}
 s+='<line x1="'+left+'" y1="'+y(0)+'" x2="'+(width-right)+'" y2="'+y(0)+'" stroke="#8495a7"/>';
 for(let i=0;i<=3;i++){const time=start+(end-start)*i/3,label=age?(time/3600000).toFixed(1)+' h':new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true,timeZone:'UTC'}).format(new Date(time));s+='<text x="'+(left+plotWidth*i/3)+'" y="'+(height-30)+'" text-anchor="'+(i===0?'start':i===3?'end':'middle')+'" font-family="system-ui,sans-serif" font-size="11" fill="#405669">'+esc(label)+'</text>'}s+='<text x="'+(width/2)+'" y="'+(height-9)+'" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#405669">'+(age?'Hours since publication':'Observation time (UTC)')+'</text>';
 series.forEach((series,i)=>{const rows=series.rows.filter(r=>mode!=='interval'||r.delta!==null),color=colors[i%colors.length],value=r=>mode==='interval'?r.delta:r.value;if(mode!=='interval'&&rows.length>1)s+='<polyline fill="none" stroke="'+color+'" stroke-width="2" stroke-dasharray="'+(['none','7 3','3 3','10 3 2 3'][i%4])+'" points="'+rows.map(r=>x(r.time).toFixed(2)+','+y(value(r)).toFixed(2)).join(' ')+'"/>';for(const row of rows){const px=x(row.time),py=y(value(row)),correction=mode==='interval'&&row.delta<0,title=series.post.post_id+' · '+row.observed_at+' · '+value(row)+(correction?' · correction / reset':'')+(row.interval_start&&mode==='interval'?' · interval from '+row.interval_start:'');if(mode==='interval')s+='<line x1="'+px+'" x2="'+px+'" y1="'+y(0)+'" y2="'+py+'" stroke="'+(correction?'#b02e40':color)+'" stroke-width="4" opacity=".75"/>';s+='<circle cx="'+px+'" cy="'+py+'" r="4" fill="'+(correction?'#b02e40':color)+'" stroke="#fff" stroke-width="1"><title>'+esc(title)+'</title></circle>'}});return s+'</svg>'
}
function renderContentChart(){const metric=$('content-metric').value,mode=$('content-chart-mode').value,colors=['#176d65','#7143ae','#b25113','#1d63ad'];const plotted=contentPlotSeries(contentSeries);contentChartSvg=contentSvg(plotted,metric,mode);$('content-window-summary').textContent=contentWindowSummary(contentSeries);$('content-chart').innerHTML=contentChartSvg||'<p class="empty">'+(mode==='interval'?'At least two numeric observations per post are needed to calculate interval changes.':'No numeric snapshots are available for this selection and metric.')+'</p>';$('content-chart-export').disabled=!contentChartSvg;$('content-series-export').disabled=!contentSeries.some(s=>s.rows.length);$('content-chart-legend').innerHTML=contentSeries.map((s,i)=>'<span><i style="background:'+colors[i%colors.length]+'"></i>'+esc(s.post.post_id)+' · '+s.rows.length+' observations</span>').join('');const corrections=contentSeries.reduce((n,s)=>n+s.rows.filter(r=>r.delta<0).length,0);$('content-chart-status').textContent=contentSeries.map(s=>'Post '+s.post.post_id+': '+s.rows.length+' snapshots'+(s.rows.length?' · first '+contentDate(s.rows[0].observed_at):'')+(s.warning?' · '+s.warning:'')).join(' | ')+(corrections?' · '+corrections+' correction / reset intervals flagged.':'');$('content-observations').innerHTML=contentSeries.flatMap(s=>s.rows.map(r=>'<tr><td>'+esc(s.post.post_id)+'</td><td>'+esc(contentDate(r.observed_at))+'</td><td>'+esc(contentCount(r.value))+'</td><td>'+esc(r.interval_start?contentDate(r.interval_start):'—')+'</td><td>'+esc(r.delta===null?'—':r.delta)+'</td><td>'+contentState(r.delta<0?'Correction / reset':r.interpretation)+'</td></tr>')).join('')}
function contentCsvCell(value){let s=String(value??'');if(/^\s*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
function contentCsv(rows,cols){return [cols.map(contentCsvCell).join(','),...rows.map(r=>cols.map(k=>contentCsvCell(r[k])).join(','))].join('\r\n')}
function contentExportRows(){return contentVisible.map(r=>({platform:r.platform,account_id:r.account_id,account_handle:r.account_handle,post_id:r.post_id,published_at:r.published_at,media_type:r.media_type,caption:r.caption,permalink:href(r.permalink),workflow_url:href(r.workflow_url),...Object.fromEntries(contentMetrics.map(m=>[m,contentNumber(r.metrics?.[m])])),first_seen:r.first_seen,last_seen:r.last_seen,delete_status:r.delete_status}))}
async function loadContentCleanup(automatic=false){
 if(contentQueueBusy)return;
 if(cleanupLoad)return cleanupLoad;
 if(Date.now()<cleanupRetryAt){
  $('content-cleanup-notice').textContent='Storage is cooling down. Retry after '+contentDate(new Date(cleanupRetryAt).toISOString())+'. '+(contentGroups.length?'Previously loaded groups remain visible; planning is paused.':'Groups have not loaded yet.');
  scheduleCleanupRetry();return;
 }
 cancelCleanupRetry();if(!automatic)cleanupRetryCount=0;
 contentPlanVersion++;const epoch=authEpoch;clearContentPlan(false);cleanupFresh=false;$('content-plan').disabled=true;
 $('content-cleanup-notice').textContent='Refreshing duplicate evidence and queue…';
 const pending=(async()=>{
  const results=await Promise.allSettled([contentRequest('/api/content/groups'),contentRequest('/api/content/queue')]);
  if(epoch!==authEpoch||!token||contentView!=='cleanup'||$('meta-view').classList.contains('hidden'))return;
  const [groups,queue]=results;cleanupFresh=results.every(r=>r.status==='fulfilled');
  if(groups.status==='fulfilled'){
   const selectedId=selectedContentGroup()?.group_id;contentGroups=groups.value.rows||[];renderGroupOptions(selectedId);renderContentGroup();
  }else{
   $('content-plan').disabled=true;
   if(contentGroups.length)$('content-group-info').textContent='Showing previously loaded groups. Refresh failed; planning is paused until groups and queue are verified.';
   else{$('content-group').innerHTML='<option value="">Groups temporarily unavailable</option>';$('content-group-info').textContent='Groups could not be read. This does not mean no groups exist.';}
  }
  if(queue.status==='fulfilled'){contentQueue=queue.value.rows||[];renderContentQueue(queue.value)}
  else $('content-queue-status').textContent='Queue refresh failed. Any displayed entries are from the previous load; planning is paused.';
  const failures=results.filter(r=>r.status==='rejected'&&r.reason.name!=='AbortError').map(r=>r.reason);
  const throttled=failures.filter(e=>e.httpStatus===429||e.code==='store_rate_limited');
  if(throttled.length){
   cleanupRetryAt=Date.now()+Math.max(75000,...throttled.map(e=>e.retryMs||0))+Math.floor(Math.random()*15000);
   previewNextRequest=Math.max(previewNextRequest,cleanupRetryAt);scheduleCleanupRetry();
   $('content-cleanup-notice').textContent='Storage rate limit reached. '+(contentGroups.length?'Previously loaded groups are retained. ':'')+'Planning is paused. '+(cleanupRetryTimer?'Automatic retry after ':'Refresh again after ')+contentDate(new Date(cleanupRetryAt).toISOString())+'.';
  }else{
   cleanupRetryAt=0;
   $('content-cleanup-notice').textContent=failures.map(e=>e.message).join(' · ')||(cleanupFresh?(!contentGroups.length?'No duplicate candidate groups are stored.':'Returned '+contentGroups.length+' candidate groups (up to 20 most recently updated). Choose a group to review.'):'Refresh interrupted; try again.');
   if(cleanupFresh)cleanupRetryCount=0;
  }
 })();
 cleanupLoad=pending;
 try{return await pending}finally{if(cleanupLoad===pending)cleanupLoad=null;}
}

function selectedContentGroup(){const value=$('content-group').value;return value===''?null:contentGroups[Number(value)]}
function renderGroupOptions(selectedId=selectedContentGroup()?.group_id){
 const platform=$('content-group-platform').value,visible=contentGroups.map((g,i)=>({g,i})).filter(({g})=>!platform||g.platform===platform);
 const buckets=new Map();for(const item of visible){const key=item.g.platform+' · '+item.g.account_id;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(item);}
 $('content-group').innerHTML='<option value="">'+(visible.length?'Choose a group':'No groups loaded for this platform')+'</option>'+[...buckets].map(([key,items])=>'<optgroup label="'+esc(key)+'">'+items.map(({g,i})=>'<option value="'+i+'">'+esc((g.members||[]).length+' posts · '+g.group_id+(g.has_confirmed_history?' · Previously confirmed':''))+'</option>').join('')+'</optgroup>').join('');
 const match=visible.find(({g})=>g.group_id===selectedId);$('content-group').value=match?String(match.i):'';
}
function removalTiming(review){
 if(!review||!review.queue_status&&review.decision!=='remove')return '';
 if(review.queue_status==='deleted')return 'Deletion reported';
 const time=sourceDate(review.removal_scheduled_at);
 if(!time)return 'Removal date not reported';
 const days=Math.ceil((+time-Date.now())/86400000);
 return (days>0?days+'d until scheduled removal':days===0?'Scheduled for today':'Scheduled date passed; result unverified')+' · '+contentDate(time.toISOString());
}
function groupDecision(row){
 const group=selectedContentGroup(),plan=contentPlan,review=row.cleanup_review||{};
 const active=plan&&(!plan.group_id||plan.group_id===group?.group_id)&&Date.parse(plan.expires_at)>Date.now();
 const id=x=>typeof x==='object'?x.post_id:x;
 if(active&&(plan.keep||[]).map(id).includes(row.post_id))return {tone:'keep',label:'Keep · proposed',detail:'Not yet confirmed'};
 if(active&&(plan.remove||[]).map(id).includes(row.post_id))return {tone:'remove',label:'Remove · proposed',detail:'Not queued; confirmation required'};
 const status=review.queue_status||row.delete_status;
 if(status&&status!=='published'&&status!=='Stored')return {tone:'queued',label:status==='deleted'?'Deletion reported':'Removal state · '+status.replaceAll('_',' '),detail:removalTiming({...review,queue_status:status})};
 if(review.decision==='keep')return {tone:'keep',label:'Kept in confirmed plan',detail:'Previously confirmed'+(review.confirmed_at?' · '+contentDate(review.confirmed_at):'')};
 if(review.decision==='remove')return {tone:'queued',label:'Removal previously confirmed',detail:removalTiming(review)};
 return {tone:'neutral',label:'Not marked for removal',detail:contentPlan?'Preview expired or changed; create a new preview.':''};
}
function contentScoreWeights(){
 const weights={};for(const key of ['views','likes']){const text=$('content-weight-'+key).value.trim();if(!text)return null;const n=Number(text);if(!Number.isInteger(n)||n<0||n>1000)return null;weights[key]=n;}
 return weights.views+weights.likes>0?weights:null;
}
function contentScoreFormula(weights){return 'Views × '+weights.views+' + Likes × '+weights.likes}
function contentWeightedScore(metrics,weights){
 if(!weights)return null;
 let score=0;for(const key of ['views','likes']){if(weights[key]===0)continue;const n=contentNumber(metrics?.[key]);if(n===null)return null;score+=n*weights[key];}
 return Number.isFinite(score)&&score<=Number.MAX_SAFE_INTEGER?score:null;
}
function contentRankValue(row,metric,weights){return metric==='weighted_score'?contentWeightedScore(row.metrics,weights):contentNumber(row.metrics?.[metric])}
function updateScoreSettings(){
 const weighted=$('content-keep-metric').value==='weighted_score',weights=contentScoreWeights();
 $('content-score-settings').classList.toggle('hidden',!weighted);
 $('content-score-formula').classList.toggle('hidden',!weighted);
 $('content-score-formula').textContent=weights?contentScoreFormula(weights):'Enter whole-number weights from 0 to 1,000, with at least one greater than zero.';
}
function recordedScoreText(review){
 const r=review?.ranking;if(!r||r.metric!=='weighted_score'||contentNumber(r.value)===null)return '';
 return 'Confirmed score '+contentCount(r.value)+' · '+r.formula;
}
function activeGroupRanking(row){
 const plan=contentPlan;if(!plan||plan.group_id!==selectedContentGroup()?.group_id||Date.parse(plan.expires_at)<=Date.now()||plan.metric!==$('content-keep-metric').value)return null;
 return plan.ranking?.values?.find(x=>x.post_id===row.post_id)||null;
}
function orderedGroupEntries(){
 const metric=$('content-keep-metric').value||'weighted_score',weights=contentScoreWeights(),order=$('content-group-order').value||'decision';
 const rows=contentGroupRows.map((row,index)=>({row,index}));
 const active=contentPlan&&Date.parse(contentPlan.expires_at)>Date.now();
 const ranked=active?[...(contentPlan.keep||[]),...(contentPlan.remove||[])].map(x=>typeof x==='object'?x.post_id:x):[];
 return rows.sort((a,b)=>{
  if(order==='decision'&&active){const ai=ranked.indexOf(a.row.post_id),bi=ranked.indexOf(b.row.post_id);if(ai!==bi)return (ai<0?Infinity:ai)-(bi<0?Infinity:bi);}
  const av=contentNumber(activeGroupRanking(a.row)?.value)??contentRankValue(a.row,metric,weights),bv=contentNumber(activeGroupRanking(b.row)?.value)??contentRankValue(b.row,metric,weights);
  if(av===null||bv===null)return av===bv?a.row.post_id.localeCompare(b.row.post_id):av===null?1:-1;
  return (order==='metric-asc'?av-bv:bv-av)||a.row.post_id.localeCompare(b.row.post_id);
 });
}
function gallerySummary(row,index,rank){
 const group=String(index).startsWith('g'),decision=group?groupDecision(row):(row.delete_status&&row.delete_status!=='published'?{tone:'queued',label:'Removal state · '+row.delete_status.replaceAll('_',' '),detail:removalTiming({queue_status:row.delete_status})}:null),metric=group?$('content-keep-metric').value:'';
 const metrics=metric&&metric!=='weighted_score'&&!contentMetrics.includes(metric)?[...contentMetrics,metric]:contentMetrics;
 const saved=group?activeGroupRanking(row):null,displayMetrics={...row.metrics,...saved?.inputs};
 const weights=contentScoreWeights(),score=contentNumber(saved?.value)??contentWeightedScore(displayMetrics,weights),scoreCell=group&&metric==='weighted_score'?'<div class="rank-metric gallery-score"><dt>Weighted score</dt><dd>'+esc(score===null?'Unavailable':contentCount(score))+'</dd><small>'+esc(weights?contentScoreFormula(weights):'Check score settings')+(saved?' · Plan snapshot':'')+'</small></div>':'';
 const recorded=group?recordedScoreText(row.cleanup_review):'';
 return '<div class="gallery-summary-top">'+platformBadge(row.platform)+(group?'<span class="review-rank">Display #'+rank+'</span>':'')+'</div><dl class="gallery-metrics">'+metrics.map(m=>'<div'+(m===metric?' class="rank-metric"':'')+'><dt>'+esc(m.replaceAll('_',' '))+'</dt><dd>'+esc(contentCount(displayMetrics[m]))+'</dd></div>').join('')+scoreCell+'</dl>'+(decision?'<div class="gallery-decision" data-tone="'+decision.tone+'"><strong>'+esc(decision.label)+'</strong><span>'+esc(decision.detail)+'</span>'+(recorded?'<span>'+esc(recorded)+'</span>':'')+'</div>':'');
}
function updateGroupPresentation(){
 updateScoreSettings();
 const rows=orderedGroupEntries(),container=$('content-group-cards');
 rows.forEach(({row,index},rank)=>{
  const card=$('content-card-g'+index),header=$('content-summary-g'+index);if(!card||!header)return;
  card.setAttribute('data-decision',groupDecision(row).tone);header.innerHTML=gallerySummary(row,'g'+index,rank+1);
  // Move existing elements: playing videos, loaded images and preview IDs survive sorting.
  if(card.parentNode===container){const before=container.children?.[rank]||null;if(before!==card){if(typeof container.moveBefore==='function')container.moveBefore(card,before);else if(typeof container.insertBefore==='function')container.insertBefore(card,before);else container.appendChild(card);}}
 });
 if(contentPlan&&Date.parse(contentPlan.expires_at)<=Date.now()){$('content-plan-notice').textContent='Preview expired. Build a new preview before confirming.';updateContentConfirmation();}
}
function rememberConfirmedPlan(plan,result){
 const group=selectedContentGroup();if(!group)return;
 const id=x=>typeof x==='object'?x.post_id:x,keep=(plan.keep||[]).map(id),remove=(plan.remove||[]).map(id);
 group.has_confirmed_history=true;
 for(const row of group.members||[]){if(!keep.includes(row.post_id)&&!remove.includes(row.post_id))continue;
  const saved=plan.ranking?.values?.find(x=>x.post_id===row.post_id);
  row.cleanup_review={decision:keep.includes(row.post_id)?'keep':'remove',confirmed_at:result.confirmed_at||null,queue_status:remove.includes(row.post_id)?result.status||'awaiting_sheet':null,removal_scheduled_at:null,ranking:saved?{metric:plan.metric,version:plan.ranking.version,formula:plan.ranking.formula,weights:plan.ranking.weights,value:saved.value,inputs:saved.inputs}:null};
  if(remove.includes(row.post_id))row.delete_status=result.status||'awaiting_sheet';
  const shown=contentGroupRows.find(r=>contentKey(r)===contentKey(row));if(shown)Object.assign(shown,{cleanup_review:row.cleanup_review,delete_status:row.delete_status});
 }
 renderGroupOptions(group.group_id);cleanupFresh=false;updateGroupPresentation();
}

function renderContentGroup(){stopAutoPreviews();const group=selectedContentGroup();contentGroupRows=(group?.members||[]).map(r=>({...r,platform:r.platform||group.platform,account_id:r.account_id||group.account_id,media_type:group.media_type==='VIDEO'?'VIDEO':r.media_type,_groupEvidence:group.algorithm||'Similarity candidate'}));$('content-group-evidence').textContent=group?.evidence?JSON.stringify(group.evidence,null,2):'No additional evidence stored.';$('content-group-cards').innerHTML=contentGroupRows.map((r,i)=>contentGalleryCard(r,'g'+i)).join('');$('content-group-info').textContent=group?(contentPlatforms[group.platform]?.[0]||group.platform)+' · Account '+group.account_id+' · '+(group.has_confirmed_history?'Previously confirmed decisions are shown on the cards. ':'')+'Evidence: '+(group.algorithm||'Unknown algorithm')+' · confidence: '+(group.confidence??'Unknown')+' · '+(group.review_status||'Needs review')+' · '+(group.members||[]).length+' returned members.'+((group.missing_members||[]).length?' '+group.missing_members.length+' missing members; planning is blocked.':''):'No group selected.';$('content-group-members').innerHTML=(group?.members||[]).map(r=>'<tr><td>'+platformBadge(r.platform||group.platform)+'<div>'+esc(r.account_handle||r.account_id||group.account_id)+'</div><strong>'+esc(r.post_id)+'</strong></td><td>'+esc(r.media_type||group.media_type||'Unknown media')+'<div class="sub">'+esc((r.caption||'No caption').slice(0,180))+'</div></td><td>'+esc(contentDate(r.published_at))+'</td><td>'+contentMetricCells(r)+'</td><td>'+link(r.permalink,'Review post ↗')+'</td></tr>').join('');$('content-plan').disabled=!group||!cleanupFresh||Boolean(group?.missing_members?.length)||(group?.members||[]).some(r=>r.cleanup_review?.queue_status||(r.delete_status&&r.delete_status!=='published'));updateGroupPresentation();if(contentView==='cleanup')startAutoPreviews();}
function clearContentPlan(invalidate=true){clearContentFeedback('content-error-plan');$('content-plan-notice').textContent='';for(const id of ['content-keep-count','content-keep-strategy','content-weight-views','content-weight-likes'])$(id).removeAttribute('aria-invalid');if(invalidate)contentPlanVersion++;contentPlan=null;$('content-plan-panel').classList.add('hidden');$('content-plan-records').replaceChildren();$('content-plan-title').textContent='Review removal plan';$('content-plan-detail').textContent='';$('content-confirm').value='';$('content-queue-confirm').disabled=true;updateGroupPresentation()}
async function previewContentPlan(){
 clearContentPlan();clearContentFeedback('content-error-plan');if(!cleanupFresh)throw Error('Refresh groups and queue successfully before planning.');
 const group=selectedContentGroup(),count=Number($('content-keep-count').value),strategy=$('content-keep-strategy').value,metric=$('content-keep-metric').value;
 if(!group||!Number.isInteger(count)||count<1||!['best','worst'].includes(strategy)){for(const [id,bad] of [['content-keep-count',!Number.isInteger(count)||count<1],['content-keep-strategy',!['best','worst'].includes(strategy)]])$(id).setAttribute('aria-invalid',String(bad));throw Error('Choose a group, an explicit keep strategy and a positive whole number to keep.')}
 const weights=metric==='weighted_score'?contentScoreWeights():null;
 if(metric==='weighted_score'){
  if(!weights){$('content-score-settings').open=true;for(const key of ['views','likes'])$('content-weight-'+key).setAttribute('aria-invalid','true');throw Error('Use whole-number score weights from 0 to 1,000, with at least one greater than zero.')}
  const missing=(group.members||[]).filter(row=>contentWeightedScore(row.metrics,weights)===null).length;
  if(missing)throw Error(missing+' post'+(missing===1?' has':'s have')+' no calculable weighted score. Each positively weighted metric must be available; missing values are not zero. Refresh metrics or explicitly choose another ranking.');
 }
 const generation=contentPlanVersion;$('content-plan-notice').textContent='Building a reviewable plan…';
 const plan=await contentRequest('/api/content/plan',{group_id:group.group_id,keep_count:count,keep_strategy:strategy,metric,...(weights?{weights}:{})});
 if(generation!==contentPlanVersion)return;
 if(!plan.plan_id||!Array.isArray(plan.keep)||!Array.isArray(plan.remove)||typeof plan.confirmation!=='string'||metric==='weighted_score'&&(!plan.ranking||plan.ranking.weights?.views!==weights.views||plan.ranking.weights?.likes!==weights.likes||plan.ranking.formula!==contentScoreFormula(weights)))throw Error('The plan response is incomplete or its score settings differ. Refresh the group before retrying.');
 contentPlan=plan;const keepIds=plan.keep.map(x=>typeof x==='object'?x.post_id:x),removed=plan.remove,eligible=keepIds.length+removed.length;
 $('content-plan-title').textContent='Keep '+keepIds.length+' · propose '+removed.length+' removals';
 $('content-plan-detail').textContent=eligible+' eligible members − '+keepIds.length+' retained = '+removed.length+' proposed removals · '+(strategy==='best'?'highest':'lowest')+' '+(metric==='weighted_score'?'weighted score ('+plan.ranking.formula+')':metric)+' retained. '+(plan.excluded_missing_metrics||[]).length+' missing-metric members excluded. Plan expires '+contentDate(plan.expires_at)+'.';
 $('content-plan-records').replaceChildren();updateGroupPresentation();$('content-confirm-label').textContent='Type '+plan.confirmation+' to confirm';$('content-plan-panel').classList.remove('hidden');$('content-plan-notice').textContent='Preview only: keep '+keepIds.length+' · propose '+removed.length+' removals. The cards show the exact decisions. No links have been queued.';updateContentConfirmation();
}
function setContentQueueBusy(busy){contentQueueBusy=busy;for(const id of ['content-group','content-group-platform','content-group-order','content-keep-strategy','content-keep-count','content-keep-metric','content-weight-views','content-weight-likes','content-confirm','content-plan-cancel','content-cleanup-refresh','content-plan'])$(id).disabled=busy;if(!busy)$('content-plan').disabled=!cleanupFresh||!selectedContentGroup()||Boolean(selectedContentGroup()?.missing_members?.length)||(selectedContentGroup()?.members||[]).some(r=>r.cleanup_review?.queue_status||(r.delete_status&&r.delete_status!=='published'));updateContentConfirmation()}
function updateContentConfirmation(){const valid=contentPlan&&contentPlan.remove?.length>0&&$('content-confirm').value===contentPlan.confirmation,expires=contentPlan&&sourceDate(contentPlan.expires_at);$('content-queue-confirm').disabled=contentQueueBusy||!valid||!expires||+expires<=Date.now()}
async function confirmContentQueue(){clearContentFeedback('content-error-confirm');updateContentConfirmation();if($('content-queue-confirm').disabled)return;setContentQueueBusy(true);const finishLoading=beginDeskLoading('content-confirm-loading','Confirming links and refreshing queue status…',['content-queue-confirm']);const plan=contentPlan,generation=contentPlanVersion;try{const d=await contentRequest('/api/content/queue',{plan_id:plan.plan_id,confirmation:$('content-confirm').value});if(generation!==contentPlanVersion)return;rememberConfirmedPlan(plan,d);clearContentPlan();$('content-confirm-notice').textContent='Queue request accepted. Refreshing queue status…';const queue=await contentRequest('/api/content/queue');contentQueue=queue.rows||[];renderContentQueue(queue);updateGroupPresentation();$('content-confirm-notice').textContent=d.warning||'Links queued. Queue status below reports stored state; it does not prove deletion has occurred.'}catch(e){if(e.name!=='AbortError'&&token){clearContentPlan();$('content-confirm-notice').textContent='The queue outcome could not be verified. Refresh the queue before creating another plan.'}throw e}finally{finishLoading();setContentQueueBusy(false);updateContentConfirmation();updateGroupPresentation()}}
function renderContentQueue(data){const sheet=data.sheet_status,mirror=sheet?.mirror,summary=typeof sheet==='string'?sheet:mirror?.status||sheet?.status||'Unknown / not reported';$('content-queue-status').textContent=contentQueue.length+' returned requests'+(data.limit?' · at most '+data.limit+' latest stored requests':'')+' · clickouts Sheet mirror: '+summary+(mirror?.last_success?' · last success '+contentDate(mirror.last_success):'')+(mirror?.error_code?' · '+mirror.error_code:'')+'. A queued link is not a verified deletion.';$('content-queue').innerHTML=contentQueue.length?contentQueue.map(r=>'<tr><td>'+platformBadge(r.platform)+'<div>'+esc(r.account_id)+'</div><strong>'+esc(r.post_id)+'</strong></td><td>'+contentState(r.status)+(r.checked_at&&Date.now()-Date.parse(r.checked_at)>86400000?' · stale':'')+'</td><td>'+esc(r.reason||'—')+'</td><td>'+esc(contentDate(r.created_at))+'</td><td>'+link(r.permalink,'Review post ↗')+'</td></tr>').join(''):'<tr><td colspan="5" class="empty">No deletion requests stored.</td></tr>'}
async function loadContentAvailability(){const extraEpoch=authEpoch;try{await refreshMetaProgress();await loadMetaCoverage();}catch(e){if(e.name==='AbortError'||extraEpoch!==authEpoch)return;$('meta-progress').textContent='Meta progress unavailable: '+e.message;}const epoch=authEpoch;const results=await Promise.allSettled([contentRequest('/api/content/status'),contentRequest('/api/meta/assets'),contentRequest('/api/meta/capabilities')]);if(!token||epoch!==authEpoch)return;const [statusResult,assetsResult,capabilitiesResult]=results;if(statusResult.status==='fulfilled'){const d=statusResult.value,mirror=d.mirror||{},outbox=(d.outbox||[]).map(x=>x.status+': '+x.count).join(' · ');$('content-system-status').innerHTML=[['Content storage',d.schema_ready?'Ready':'Migration required',d.schema_ready?'Google Sheets storage is available.':'Complete the Sheets storage migration.'],['Optional mapping/cleanup writes',d.sheet_write_enabled?'Enabled':'Disabled','Post mapping: '+(d.post_sheet||'meta-posts-to-id')+' · queue: '+(d.clickouts_sheet||'clickouts')+'. Google credentials also need Sheets write scope.'],['Sheet mirror',mirror.status||'Unknown','Last success: '+contentDate(mirror.last_success)+' · last attempt: '+contentDate(mirror.last_attempt)+(mirror.error_code?' · '+mirror.error_code:'')],['Pending Sheet operations',outbox?'Stored jobs':'No stored jobs',outbox||'No outbox state reported.'],['Deletion execution','Separate executor required','Queueing records links; a configured deletion workflow must report each result.'],['Sync cadence',d.schedule_interval_minutes?String(d.schedule_interval_minutes)+' minutes':'Unknown','Reported collection cadence; configured times do not prove successful runs.']].map(([title,value,detail])=>'<div class="status-card"><strong>'+esc(title)+'</strong>'+contentState(value)+'<p>'+esc(detail)+'</p></div>').join('');$('content-sheet-setup').disabled=!d.schema_ready||!d.sheet_write_enabled;$('content-sheet-sync').disabled=!d.schema_ready||!d.sheet_write_enabled;$('content-sheet-notice').textContent=d.sheet_write_enabled?'Writes enabled in Worker configuration. A Google authorization error still requires write scope.':'Mapping/clickouts writes are disabled; dashboard storage still writes to its internal Sheets tabs. Configure GOOGLE_SHEETS_WRITE_ENABLED=1 and a Google credential with Sheets write scope before using these controls.'}else $('content-system-status').innerHTML='<div class="status-card"><strong>Content status unavailable</strong><p>'+esc(statusResult.reason.message)+'</p></div>';
 if(assetsResult.status==='fulfilled'){contentAssets=assetsResult.value.rows||[];refreshContentAccounts();$('content-assets').innerHTML=contentAssets.length?contentAssets.map(r=>'<tr><td>'+platformBadge(r.platform)+'</td><td>'+esc(r.name)+'</td><td>'+esc(r.id)+'</td><td>'+esc(contentDate(r.updated_at))+'</td></tr>').join(''):'<tr><td colspan="4" class="empty">No connected account metadata collected.</td></tr>'}else $('content-assets').innerHTML='<tr><td colspan="4">'+esc(assetsResult.reason.message)+'</td></tr>';
 if(capabilitiesResult.status==='fulfilled'){const rows=capabilitiesResult.value.rows||[];$('content-capabilities').innerHTML=rows.length?rows.map(r=>'<tr><td>'+esc(r.asset_id)+'<div class="sub">'+esc(r.kind)+'</div></td><td>'+esc(r.metric)+'</td><td>'+contentState(r.status)+(r.checked_at&&Date.now()-Date.parse(r.checked_at)>86400000?' · stale':'')+'</td><td>'+esc(r.reason||'—')+'</td><td>'+esc(contentDate(r.checked_at))+'</td></tr>').join(''):'<tr><td colspan="5" class="empty">No metric checks stored. This does not confirm support.</td></tr>'}else $('content-capabilities').innerHTML='<tr><td colspan="5">'+esc(capabilitiesResult.reason.message)+'</td></tr>';
}
function clearContentState(){setActionFeedback('content-error-selection','');cancelCleanupRetry();cleanupLoad=null;cleanupRetryCount=0;cleanupRetryAt=0;cleanupFresh=false;$('content-group-evidence').textContent='';contentGroupRows=[];$('content-group-cards').replaceChildren();contentErrors.clear();for(const view of ['inventory','compare','cleanup','availability'])renderContentErrors(view);contentInfoPinned.clear();stopAutoPreviews(true);clearTimeout(metaPollTimer);metaPollTimer=null;for(const id of ['meta-progress','meta-account-progress','meta-account-observations','meta-coverage-summary','content-window-summary'])$(id).replaceChildren();contentRows=[];contentVisible=[];contentAssets=[];contentGroups=[];contentQueue=[];contentSelection.clear();contentSeries=[];contentChartSvg='';contentOffset=0;contentHasMore=false;setContentQueueBusy(false);contentChartVersion++;clearContentPlan();for(const id of ['content-cards','content-table','content-stats','content-compare-selection','content-chart','content-chart-legend','content-observations','content-group-info','content-group-members','content-queue','content-system-status','content-assets','content-capabilities','content-page','content-cleanup-notice','content-plan-notice','content-confirm-notice','content-library-notice','meta-notice','content-sheet-notice','schedule-rows','schedule-evidence'])$(id).replaceChildren();$('content-group').innerHTML='<option value="">Choose a group</option>';$('content-account').innerHTML='<option value="">All accounts</option>';for(const id of ['content-search','content-from','content-to','content-keep-count','content-keep-strategy','content-group-platform'])$(id).value='';$('content-selection-count').textContent='Select up to 4 posts on the same platform.';$('content-chart-status').textContent='Select posts in the library to begin.';$('content-queue-status').textContent='No queue status loaded.';$('content-chart-export').disabled=true;$('content-series-export').disabled=true;$('content-more').classList.add('hidden')}
for(const view of ['inventory','compare','cleanup','availability'])$('content-nav-'+view).onclick=()=>showContentView(view).catch(contentError);
const contentTabNames=['inventory','compare','cleanup','availability'];for(const [index,name] of contentTabNames.entries())$('content-nav-'+name).addEventListener('keydown',e=>{let next;if(e.key==='ArrowRight')next=(index+1)%contentTabNames.length;else if(e.key==='ArrowLeft')next=(index+contentTabNames.length-1)%contentTabNames.length;else if(e.key==='Home')next=0;else if(e.key==='End')next=contentTabNames.length-1;else return;e.preventDefault();$('content-nav-'+contentTabNames[next]).focus();showContentView(contentTabNames[next]).catch(contentError)});
for(const id of ['content-platform','content-account'])$(id).addEventListener('change',()=>{if(id==='content-platform')$('content-account').value='';loadContent().catch(contentError)});
$('content-search').addEventListener('input',wait(()=>loadContent().catch(contentError)));
for(const id of ['content-from','content-to'])$(id).addEventListener('change',()=>loadContent().catch(contentError));$('content-layout').addEventListener('change',renderContent);
for(const id of ['content-cards','content-table','content-group-cards']){$(id).addEventListener('change',e=>{if(e.target.dataset.contentSelect!==undefined)selectContent(Number(e.target.dataset.contentSelect),e.target.checked)});$(id).addEventListener('click',e=>{const button=e.target.closest('[data-preview]');if(button)loadContentPreview(button.dataset.preview).catch(contentError)})}
$('content-open-compare').onclick=()=>showContentView('compare').catch(contentError);$('content-clear-selection').onclick=()=>{setActionFeedback('content-error-selection','');contentSelection.clear();invalidateContentChart();renderContent()};
$('content-metric').addEventListener('change',invalidateContentChart);$('content-chart-mode').addEventListener('change',()=>{if(contentSeries.length)renderContentChart()});
$('content-group-platform').addEventListener('change',()=>{clearContentPlan();renderGroupOptions();renderContentGroup()});$('content-group-order').addEventListener('change',updateGroupPresentation);
$('content-group').addEventListener('change',()=>{clearContentPlan();renderContentGroup()});for(const id of ['content-keep-count','content-keep-strategy','content-keep-metric','content-weight-views','content-weight-likes'])$(id).addEventListener('input',()=>clearContentPlan());$('content-confirm').addEventListener('input',updateContentConfirmation);$('content-plan-cancel').onclick=()=>{if(contentQueueBusy)return;clearContentPlan();$('content-plan-notice').textContent='Plan canceled. No new links queued.'};
$('content-export-csv').onclick=()=>{const rows=contentExportRows();downloadProducerFile('content-visible.csv',contentCsv(rows,['platform','account_id','account_handle','post_id','published_at','media_type','caption','permalink','workflow_url',...contentMetrics,'first_seen','last_seen','delete_status']),'text/csv;charset=utf-8')};$('content-export-json').onclick=()=>downloadProducerFile('content-visible.json',JSON.stringify({scope:'Visible loaded records only',rows:contentExportRows()},null,2),'application/json');
$('content-chart-export').onclick=()=>{if(contentChartSvg)downloadProducerFile('content-observations.svg',contentChartSvg,'image/svg+xml')};$('content-series-export').onclick=()=>{const rows=contentSeries.flatMap(s=>s.rows.map(r=>({platform:s.post.platform,account_id:s.post.account_id,post_id:s.post.post_id,metric:s.metric,observed_at:r.observed_at,value:r.value,interval_start:r.interval_start,interval_change:r.delta,interpretation:r.interpretation})));downloadProducerFile('content-observations.csv',contentCsv(rows,['platform','account_id','post_id','metric','observed_at','value','interval_start','interval_change','interpretation']),'text/csv;charset=utf-8')};
async function contentSheetAction(action){const epoch=authEpoch;$('content-sheet-notice').textContent=action==='setup'?'Setting up post mapping headers…':'Queueing stored Sheet writes…';try{const d=await contentRequest('/api/content/sheets/'+action,{});if(epoch!==authEpoch)return;await loadContentAvailability();if(epoch===authEpoch)$('content-sheet-notice').textContent=action==='setup'?'Post mapping setup response: '+(d.status||'returned')+'. No deletion plan was created.':'Sheet mirror '+(d.status||'queued')+'. Refresh status to inspect the result; previously confirmed deletion links may be processed.'}catch(e){if(epoch===authEpoch)$('content-sheet-notice').textContent='The operation could not be verified. Check the message below before retrying.';throw e}}
contentGuarded('content-sheet-setup',()=>contentSheetAction('setup'));contentGuarded('content-sheet-sync',()=>contentSheetAction('sync'));
contentGuarded('content-refresh',()=>loadContent());contentGuarded('content-more',()=>loadContent(true));contentGuarded('content-plot',loadContentChart);contentGuarded('content-cleanup-refresh',loadContentCleanup);contentGuarded('content-plan',previewContentPlan);contentGuarded('content-status-refresh',loadContentAvailability);contentGuarded('meta-sync',syncContentMeta);
// Confirmation owns its disabled state; the generic guard would re-enable it after completion.
$('content-queue-confirm').onclick=async()=>{if($('content-queue-confirm').disabled)return;try{await confirmContentQueue()}catch(e){e.contentScope='cleanup';e.feedbackTarget='content-error-confirm';contentError(e)}};

let metaPollTimer=null;
function contentPlotSeries(series){const hours=Number($('content-chart-window').value)||0,age=$('content-chart-axis').value==='age';return series.map(s=>{const published=+sourceDate(s.post.published_at);return {...s,rows:s.rows.filter(r=>(!hours||$('content-chart-mode').value!=='interval'||Date.parse(r.interval_start)>=published)&&(!hours||(published&&r.time>=published&&r.time<=published+hours*3600000))&&(!age||published&&r.time>=published)).map(r=>({...r,time:age?r.time-published:r.time}))}});}
function contentWindowSummary(series){const hours=Number($('content-chart-window').value)||0;return series.map(s=>{const pub=+sourceDate(s.post.published_at),rows=s.rows.filter(r=>!hours||pub&&r.time>=pub&&r.time<=pub+hours*3600000),rates=rows.filter(r=>r.delta!==null&&r.delta>=0&&r.interval_ms>0&&(!hours||Date.parse(r.interval_start)>=pub)).map(r=>({...r,rate:r.delta/(r.interval_ms/3600000)}));const peak=rates.reduce((best,r)=>!best||r.rate>best.rate?r:best,null),latest=rates.at(-1),fade=peak?.rate>0&&latest&&latest.time>peak.time?100*(1-latest.rate/peak.rate):null;return 'Post '+s.post.post_id+': '+rows.length+' observations'+(hours?' within first '+hours+' h':'')+(rows.length&&pub&&rows[0].time>pub?' · early history unavailable':'')+(peak?' · peak observed rate '+peak.rate.toFixed(2)+'/h over '+(peak.interval_ms/3600000).toFixed(2)+' h':' · interval rate unavailable')+(fade!==null?' · latest observed rate '+fade.toFixed(1)+'% below peak':'');}).join(' | ');}
for(const id of ['content-chart-axis','content-chart-window'])$(id).onchange=()=>renderContentChart();
async function refreshMetaProgress(){const epoch=authEpoch,d=await contentRequest('/api/meta/status');if(epoch!==authEpoch)return;setDeskJobLoading('meta-job-loading','Meta collection '+(d.status==='running'?'running…':'queued · waiting for collection…'),['queued','running'].includes(d.status));const r=d.last_result;const text='Meta '+d.status+' · automatic collection '+(d.enabled?'enabled':'disabled')+' · last completion '+contentDate(d.last_success)+(r?' · '+r.platform+' '+r.asset_id+' / '+r.phase+': '+r.media_fetched+' fetched, '+r.posts_registered+' registered, '+r.metric_failures+' metric failures':'')+(d.error_code?' · '+d.error_code:'');$('meta-progress').textContent=text;$('meta-notice').textContent=text;$('meta-account-progress').innerHTML='<table><thead><tr><th>Account</th><th>Attempt</th><th>Phase</th><th>History pagination</th><th>Stored posts</th><th>Result</th></tr></thead><tbody>'+(d.accounts||[]).map(a=>'<tr><td>'+esc(a.name||a.id)+' · '+esc(a.platform)+'</td><td>'+esc(contentDate(a.attempted_at))+'</td><td>'+esc(a.phase)+'</td><td>'+esc(a.history_complete?'API exhausted':'Incomplete / unchecked')+'</td><td>'+a.stored_posts+'</td><td>'+esc(a.last_error||a.last_result?.outcome||'Not checked')+'</td></tr>').join('')+'</tbody></table>';return d;}
async function loadMetaCoverage(){const d=await contentRequest('/api/meta/coverage'),counts={};for(const r of d.rows||[])counts[r.stale?'stale':r.status]=(counts[r.stale?'stale':r.status]||0)+1;$('meta-coverage-summary').textContent=Object.entries(counts).map(([k,n])=>k.replaceAll('_',' ')+': '+n).join(' · ')+' · '+(d.rows||[]).length+' / '+(d.total||0)+' coverage checks represented. Unchecked candidates are not confirmed available.';const a=await contentRequest('/api/meta/account-observations');$('meta-account-observations').innerHTML='<table><thead><tr><th>Account</th><th>Metric</th><th>Reporting window</th><th>Value / breakdown</th><th>Observed UTC</th></tr></thead><tbody>'+[...(a.rows||[]),...(a.breakdowns||[])].map(r=>'<tr><td>'+esc(r.asset_id)+'</td><td>'+esc(r.metric)+'</td><td>'+esc(r.source_period)+'</td><td>'+esc(r.breakdowns?JSON.stringify(r.breakdowns):contentCount(r.value))+'</td><td>'+esc(contentDate(r.observed_at))+'</td></tr>').join('')+'</tbody></table>';}
async function syncContentMeta(){const epoch=authEpoch;clearTimeout(metaPollTimer);$('meta-notice').textContent='Queueing Meta collection…';await contentRequest('/api/meta/sync',{});let checks=0;const poll=async()=>{if(epoch!==authEpoch||!token)return;try{const d=await refreshMetaProgress();if(!d)return;if(d.status==='queued'||d.status==='running'){if(++checks<30)metaPollTimer=setTimeout(poll,10000);else $('meta-notice').textContent+=' · Still pending; use Refresh status to continue checking.';}else{if(contentView==='inventory')await loadContent();await refreshMetaProgress();}}catch(e){if(epoch===authEpoch&&e.name!=='AbortError')$('meta-notice').textContent=e.message;}};await poll();}

// Warm nearby previews only; all requests share a bounded queue.
let contentGroupRows=[];
const previewRow=i=>String(i).startsWith('g')?contentGroupRows[Number(String(i).slice(1))]:contentVisible[Number(i)];
const previewIndexes=()=>contentView==='cleanup'?contentGroupRows.map((_,i)=>'g'+i):contentVisible.map((_,i)=>i);

const previewBusyBoxes=new Set();
function setPreviewLoading(box,label){if(!box)return;previewBusyBoxes.add(box);box.classList.add('preview-loading');box.dataset.loadingLabel=label;box.setAttribute('aria-busy','true');box.setAttribute('aria-label',label);}
function clearPreviewLoading(box){if(!box)return;previewBusyBoxes.delete(box);box.classList.remove('preview-loading');delete box.dataset.loadingLabel;box.removeAttribute('aria-busy');box.setAttribute('aria-label','Media preview. Focus or hover to see the full image.');}
let previewObserver=null,previewQueue=[],previewActive=0,previewGeneration=0,previewResumeTimer=null,previewNextRequest=0;
const previewCache=new Map(),previewSettlers=new Set();
function stopAutoPreviews(clear=false){
 for(const box of previewBusyBoxes)clearPreviewLoading(box);
 previewGeneration++;clearTimeout(previewResumeTimer);previewResumeTimer=null;for(const done of previewSettlers)done();previewObserver?.disconnect();previewObserver=null;
 for(const job of previewQueue)job.resolve();previewQueue=[];
 for(const [key,controller] of inflight)if(key.startsWith('content:/api/content/preview?'))controller.abort();
 if(typeof document.querySelectorAll==='function')for(const media of document.querySelectorAll('#content-cards img, #content-cards video, #content-group-cards img, #content-group-cards video')){media.removeAttribute('src');if(media.tagName==='VIDEO'){media.pause();media.load();}}
 if(clear){previewCache.clear();previewNextRequest=0;}
}
function startAutoPreviews(){
 if(typeof IntersectionObserver==='undefined'||!token||!['inventory','cleanup'].includes(contentView)||(contentView==='inventory'&&$('content-layout').value==='table'))return;
 const generation=previewGeneration;
 previewObserver=new IntersectionObserver(entries=>{
  if(generation!==previewGeneration||!token)return;
  for(const entry of entries){const box=entry.target;if(entry.isIntersecting){if(!box.dataset.previewAttempted){box.dataset.previewAttempted='1';loadContentPreview(box.id.replace('content-preview-',''));}}else{
   previewQueue=previewQueue.filter(job=>{if(job.box!==box)return true;delete box.dataset.previewAttempted;clearPreviewLoading(box);job.resolve();return false;});
  }}
 },{rootMargin:'1800px 0px',threshold:0});
 for(const i of previewIndexes()){const box=$('content-preview-'+i);if(box)previewObserver.observe(box);}
}
function loadContentPreview(index){
 const box=$('content-preview-'+index);if(!box||!previewRow(index)||!token)return Promise.resolve();
 if(box._previewJob)return box._previewJob;
 const generation=previewGeneration;
 const pending=new Promise(resolve=>{previewQueue.push({index,box,generation,resolve});});
 box._previewJob=pending;setPreviewLoading(box,'Preview queued…');drainPreviews();
 return pending.finally(()=>{if(box._previewJob===pending){delete box._previewJob;clearPreviewLoading(box);}});
}
function drainPreviews(){
 if(!token)return;
 clearTimeout(previewResumeTimer);previewResumeTimer=null;
 if(previewQueue.length&&Date.now()<previewNextRequest){for(const job of previewQueue)setPreviewLoading(job.box,'Waiting for preview service…');previewResumeTimer=setTimeout(drainPreviews,previewNextRequest-Date.now());return;}
 previewQueue.sort((a,b)=>{const distance=j=>{const r=j.box.getBoundingClientRect?.();if(!r)return 0;const h=globalThis.innerHeight||800;return r.bottom<0?-r.bottom:r.top>h?r.top-h:0;};return distance(a)-distance(b);});
 while(previewActive<2&&previewQueue.length){const job=previewQueue.shift();if(job.generation!==previewGeneration){job.resolve();continue;}
  previewActive++;let retry=false;performContentPreview(job.index,job.box.dataset.refreshPreview==='1').catch(e=>{
   if(e.previewRetry&&job.generation===previewGeneration&&token&&(e.deferred||(job.retries||0)<2)){
    retry=true;if(!e.deferred)job.retries=(job.retries||0)+1;previewQueue.push(job);
   }else if(e.previewRetry&&job.generation===previewGeneration&&token){clearPreviewLoading(job.box);job.box.innerHTML='<div class="preview-placeholder">Preview service is busy. <button class="btn" data-preview="'+job.index+'">Retry preview</button></div>';}
  }).finally(()=>{previewActive--;if(!retry)job.resolve();drainPreviews();});
  if(Date.now()<previewNextRequest)break;
 }
}
async function previewResponse(row,force=false){
 const key=contentKey(row),cached=previewCache.get(key);if(!force&&cached&&Date.now()-cached.at<120000&&(!['VIDEO','REELS'].includes(row.media_type)||cached.data.kind==='video'))return cached.data;
 const stored=safeContentMedia(row.preview_url);
 if(!force&&stored&&(!['VIDEO','REELS','POST'].includes(row.media_type)||row.preview_type==='video'))return {available:true,url:stored,kind:row.preview_type==='video'?'video':'image',stored:true};
 if(Date.now()<previewNextRequest)throw Object.assign(Error('Preview requests paced'),{previewRetry:true,deferred:true});
 previewNextRequest=Date.now()+6000+Math.floor(Math.random()*3000);
 let data;try{data=await contentRequest('/api/content/preview?'+new URLSearchParams({platform:row.platform,account_id:row.account_id,post_id:row.post_id,refresh:'1'}));}catch(e){
  if(/store_rate_limited|HTTP 429/.test(e.message)){previewNextRequest=Math.max(previewNextRequest,Date.now()+60000+Math.floor(Math.random()*30000));e.previewRetry=true;}throw e;
 }
 if(data.available&&safeContentMedia(data.url)){previewCache.delete(key);previewCache.set(key,{at:Date.now(),data});while(previewCache.size>80)previewCache.delete(previewCache.keys().next().value);}
 return data;
}

function waitForPreviewMedia(media){return new Promise(resolve=>{
 let timer,settled=false;const done=(result='cancelled')=>{if(settled)return;settled=true;clearTimeout(timer);previewSettlers.delete(done);resolve(result);};
 previewSettlers.add(done);timer=setTimeout(()=>done('timeout'),12000);
 media.onload=()=>done('ready');media.onloadedmetadata=()=>done('ready');
 const failed=media.onerror;media.onerror=()=>{failed?.();done('error');};
});}

const contentInfoPinned=new Set();
function relativeContentDate(value,now=Date.now()){
 const d=sourceDate(value);if(!d)return 'Unknown time';const seconds=Math.floor((now-d.getTime())/1000),n=Math.abs(seconds);
 if(n<60)return seconds<0?'In a moment':'Just now';const [size,unit]=n>=86400?[86400,'d']:n>=3600?[3600,'h']:[60,'m'];
 return seconds<0?'In '+Math.floor(n/size)+unit:Math.floor(n/size)+unit+' ago';
}
function contentTimeBlock(value){return '<span class="post-time"><strong data-relative-time="'+esc(value||'')+'">'+esc(relativeContentDate(value))+'</strong><span>'+esc(contentDate(value))+'</span></span>';}
function contentGalleryCard(r,i){
 const pinned=contentInfoPinned.has(contentKey(r)),selected=contentSelection.has(contentKey(r));
 return '<article class="content-card gallery-card'+(selected?' is-selected':'')+(pinned?' info-open':'')+'" id="content-card-'+i+'"'+(String(i).startsWith('g')?' data-decision="'+groupDecision(r).tone+'"':'')+'><header class="gallery-summary" id="content-summary-'+i+'">'+gallerySummary(r,i,Number(String(i).replace('g',''))+1)+'</header>'+
 '<div class="media-preview" id="content-preview-'+i+'" tabindex="0" aria-label="Media preview. Focus or hover to see the full image."><div class="preview-placeholder"><strong>'+esc(r.media_type||'Media')+'</strong><button class="btn" data-preview="'+i+'">Load preview</button><span class="preview-message">Preview loads as you approach</span></div></div>'+
 '<div class="post-corner'+(pinned?' is-pinned':'')+'" data-post-corner="'+i+'"><button class="post-info-toggle" data-info-toggle="'+i+'" aria-label="Post details for '+esc(r.account_handle||r.account_id)+'" aria-controls="post-info-'+i+'" aria-expanded="'+pinned+'" aria-pressed="'+pinned+'">i</button>'+
 '<section class="post-info" id="post-info-'+i+'" aria-label="Post details" '+(pinned?'':'hidden')+'><div class="post-info-heading">'+platformBadge(r.platform)+'<button class="btn" data-info-hide="'+i+'">Hide details</button></div>'+
 '<h3>'+esc(r.account_handle||r.account_id||'Unknown account')+'</h3>'+contentTimeBlock(r.published_at)+
 '<div class="tags"><span class="tag">'+esc(r.media_type||'Unknown media type')+'</span>'+contentState(r.delete_status||'Stored')+'</div>'+
 '<p class="content-caption">'+esc(r.caption||'No caption collected')+'</p>'+
 '<div class="post-id">Post '+esc(r.post_id)+'</div><div class="content-links">'+contentPostLinks(r)+'</div><div class="post-info-bottom">'+(String(i).startsWith('g')?'<span class="sub">Duplicate candidate · '+esc(r._groupEvidence||'Review the original posts before planning.')+'</span>':contentCheckbox(r,i))+'</div><div class="sub">First collected '+contentTimeBlock(r.first_seen)+'</div></section></div></article>';
}
function setContentInfo(index,open,pin){
 const row=previewRow(index),panel=$('post-info-'+index),card=$('content-card-'+index);if(!row||!panel||!card)return;
 const key=contentKey(row);if(pin===true)contentInfoPinned.add(key);if(pin===false)contentInfoPinned.delete(key);
 const pinned=contentInfoPinned.has(key),shown=open||pinned;panel.hidden=!shown;
 const corner=card.querySelector('.post-corner'),button=card.querySelector('[data-info-toggle]');
 corner.classList.toggle('is-pinned',pinned);card.classList.toggle('info-open',shown);button.setAttribute('aria-expanded',String(shown));button.setAttribute('aria-pressed',String(pinned));
}
for(const gallery of [$('content-cards'),$('content-group-cards')]){
gallery.addEventListener('pointerover',e=>{if(e.pointerType==='touch')return;const corner=e.target.closest('[data-post-corner]');if(corner&&!corner.contains(e.relatedTarget))setContentInfo(corner.dataset.postCorner,true);});
gallery.addEventListener('pointerout',e=>{const corner=e.target.closest('[data-post-corner]');if(corner&&!corner.contains(e.relatedTarget)&&!corner.contains(document.activeElement))setContentInfo(corner.dataset.postCorner,false);});
gallery.addEventListener('focusin',e=>{const corner=e.target.closest('[data-post-corner]');if(corner)setContentInfo(corner.dataset.postCorner,true);});
gallery.addEventListener('focusout',e=>{const corner=e.target.closest('[data-post-corner]');if(corner&&!corner.contains(e.relatedTarget))setContentInfo(corner.dataset.postCorner,false);});
gallery.addEventListener('click',e=>{const toggle=e.target.closest('[data-info-toggle]'),hide=e.target.closest('[data-info-hide]');if(toggle){const i=toggle.dataset.infoToggle,pinned=contentInfoPinned.has(contentKey(previewRow(i)));setContentInfo(i,!pinned,!pinned);}else if(hide){const i=hide.dataset.infoHide;$('content-card-'+i).querySelector('[data-info-toggle]').focus();setContentInfo(i,false,false);}});
gallery.addEventListener('keydown',e=>{if(e.key!=='Escape')return;const corner=e.target.closest('[data-post-corner]');if(corner){const i=corner.dataset.postCorner;$('content-card-'+i).querySelector('[data-info-toggle]').focus();setContentInfo(i,false,false);e.preventDefault();}});
}
setInterval(()=>{if(!token||typeof document.querySelectorAll!=='function')return;if(contentView==='cleanup')updateGroupPresentation();for(const node of document.querySelectorAll('[data-relative-time]'))node.textContent=relativeContentDate(node.dataset.relativeTime);},60000);
