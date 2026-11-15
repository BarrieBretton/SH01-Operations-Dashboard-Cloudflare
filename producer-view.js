// Runs inside the dashboard closure; all source labels are escaped at rendering.
let sourceReport=null,sourceRows=[],sourcePage=0;
function status(p){if(p.measurement!=='measured'||p.ready_count===null)return 'unknown';if(isStale(p))return 'stale';if(!p.ready_count)return p.total_count>0&&p.consumed_count===p.total_count?'consumed':'empty';return p.ready_count<p.threshold?'low':'ready'}
function stockBadge(s){const colors={consumed:'red',empty:'red',low:'amber',ready:'green',stale:'amber',unknown:'muted'};const titles={consumed:'Consumed',empty:'No eligible items',low:'Low inventory',ready:'Ready',stale:'Stale',unknown:'Unknown'};return '<span class="badge '+colors[s]+'">'+titles[s]+'</span>'}
let producerLoad=null,producerRowsSignature=null;
function loadProducers(){
 if(producerLoad)return producerLoad;
 const epoch=authEpoch,button=$('refresh-producers');button.disabled=true;button.textContent='Checking stored data…';
 const work=loadProducerSnapshot(epoch);producerLoad=work;
 return work.finally(()=>{if(producerLoad===work){producerLoad=null;button.disabled=false;button.textContent='Refresh stored data';}});
}
async function loadProducerSnapshot(epoch){
 setActionFeedback('producer-error','');setActionFeedback('producer-sources-error','');$('producer-refresh-status').textContent='Checking saved stock and source evidence…';
 let checkedAt='',sourceAt='',changed=false;
 const stock=api('/api/producers').then(d=>{
  if(epoch!==authEpoch||!token)return;
  const signature=JSON.stringify(d.rows||[]);changed=producerRowsSignature!==signature;producerRowsSignature=signature;
  producerList=d.rows||[];const health=d.sync||{};setDeskJobLoading('producer-job-loading','Source collection '+(health.status==='running'?'running…':'queued · waiting for collection…'),['queued','running'].includes(health.status));sourceAt=health.last_success||'';checkedAt=new Date().toISOString();
  $('sheet-health').textContent='Source collection: '+(health.status||'never')+' · last successful collection: '+contentDate(sourceAt)+' · '+(health.stale?'STALE / UNVERIFIED':'within 30 minutes')+' · scheduled every 10 minutes'+(health.error_code?' · '+health.error_code:'');
  renderProducers();
  $('producer-refresh-status').textContent='Dashboard checked '+contentDate(checkedAt)+' · '+(changed?'Stored stock updated.':'Stored stock unchanged.')+' Checking source evidence…';
  return d;
 });
 const sources=api('/api/producer-sources').then(s=>{
  if(epoch!==authEpoch||!token)return;
  sourceReport=s;
 const selected=$('source-kind').value;
 $('source-kind').innerHTML='<option value="">All kinds</option>'+[...new Set((s.rows||[]).map(x=>x.kind))].sort().map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('');$('source-kind').value=selected;
 $('source-coverage').textContent=(s.coverage?.workflows||0)+' workflows / '+(s.coverage?.nodes||0)+' nodes inventoried from '+s.source_archive+'. Workflow definitions are an export snapshot, not live n8n health. Account routing evidence: '+s.schedule_evidence+'. Unknown inventory is never zero.';
 $('source-queues').innerHTML=(s.references||[]).map(r=>'<tr><td>'+esc(r.tab)+'</td><td>'+esc(r.status)+(r.error_code?'<div class="sub">'+esc(r.error_code)+'</div>':'')+'</td><td>'+esc(r.rows??'Unknown')+'</td><td>'+esc(JSON.stringify(r.status_counts||{}))+'</td></tr>').join('');
 $('source-issues').textContent=(s.coverage?.unresolved_code_nodes||0)+' nodes contain I/O or redacted code requiring runtime evidence; '+(s.coverage?.unresolved_subworkflow_calls||0)+' subworkflow targets unresolved. '+(s.schedule||[]).filter(r=>!r.workflow_id).length+' current schedule rows do not match a unique exported workflow. Credential values, CFG settings and dynamic folder/channel choices are not inferred.';

  renderSources();renderProducerSchedule();return s;
 });
 const results=await Promise.allSettled([stock,sources]);if(epoch!==authEpoch||!token)return;
 results.forEach((r,i)=>{if(r.status==='rejected'&&r.reason.name!=='AbortError')setActionFeedback(i===0?'producer-error':'producer-sources-error',r.reason.message);});
 const messages=results.map((r,i)=>r.status==='rejected'&&r.reason.name!=='AbortError'?(i===0?'Stored stock':'Source evidence')+': '+r.reason.message:'').filter(Boolean);
 $('producer-refresh-status').textContent=(checkedAt?'Dashboard checked '+contentDate(checkedAt)+' · Source collected '+contentDate(sourceAt)+' · '+(changed?'Stored stock updated.':'Stored stock unchanged.'):'Stored stock was not refreshed; previous values remain visible.')+(messages.length?' Some data could not be refreshed; see the message beside that section.':'')+' Display checks run every 60 seconds while this page is visible. Use Queue Sheets sync to request new source collection.';
 if(checkedAt&&!$('producer-view').classList.contains('hidden'))$('freshness').textContent='Producer dashboard checked '+contentDate(checkedAt);
}

function renderProducers(){
 reconcileProducerExpansions();
 const focused=document.activeElement?.id;
 const terms=$('producer-search').value.trim().toLowerCase().split(/\s+/),desired=$('producer-status').value,fresh=$('producer-fresh').value;
 const rows=producerList.filter(p=>terms.every(t=>(p.name+' '+p.account+' '+p.source_tab+' '+(p.creators||[]).join(' ')+' '+workflowRefs(p).join(' ')).toLowerCase().includes(t))&&(!desired||(desired==='awaiting'?approvalCount(p)>0:status(p)===desired))&&(!fresh||(fresh==='stale')===isStale(p)));
 const order=$('producer-sort').value,rank={consumed:0,empty:0,low:1,stale:2,unknown:3,ready:4};
 rows.sort((a,b)=>order==='name'?String(a.name).localeCompare(b.name):order==='remaining'?a.ready_count-b.ready_count:order==='approval'?(approvalCount(b)??-1)-(approvalCount(a)??-1)||String(a.name).localeCompare(b.name):rank[status(a)]-rank[status(b)]||String(a.name).localeCompare(b.name));filteredProducers=rows;
 const pending=producerList.map(approvalCount),eligible=producerList.map(p=>producerCount(p.ready_count)),sum=values=>values.reduce((n,x)=>n+(x??0),0),total=values=>values.length&&values.every(x=>x!==null)?sum(values):'Unknown';
 $('producer-stats').innerHTML=[['Stock pools',producerList.length],['Eligible items',total(eligible)],['Staged · awaiting approval',total(pending)],['No eligible / consumed pools',producerList.filter(p=>['empty','consumed'].includes(status(p))).length],['Low pools',producerList.filter(p=>status(p)==='low').length],['Stale / unknown pools',producerList.filter(p=>['stale','unknown'].includes(status(p))).length]].map(([label,n])=>'<span>'+esc(label)+'<strong>'+esc(n)+'</strong></span>').join('');
 $('producer-approval-summary').textContent='Totals cover all loaded stock pools; table filters do not change these totals. '+(producerList.some(isStale)?'Includes last known counts from '+producerList.filter(isStale).length+' stale pools. ':'')+(pending.some(x=>x===null)?sum(pending)+' awaiting approval counted so far; '+pending.filter(x=>x===null).length+' pools need a new Sheets sync for this breakdown. ':'')+'Approve reviewed staged rows in the source Sheet, then wait for source collection or use Queue Sheets sync. Rows still staged will move into eligible; rows already used by a workflow may instead be consumed.';
 $('producers').innerHTML=rows.map(p=>{
  const awaiting=approvalCount(p),count=producerCount(p.ready_count),entry=producerExpansions.get(p.producer_id),dom=producerDomId(p.producer_id);
  const measured=[p.total_count,p.ready_count,p.consumed_count].every(v=>producerCount(v)!==null),difference=p.total_count-p.ready_count-p.consumed_count-(awaiting??0),other=measured&&difference>=0?difference:'Unknown';
  const approval=awaiting===null?'<strong>Not collected yet</strong><div class="sub">Queue Sheets sync to measure approval backlog.</div>':'<strong>'+esc(awaiting)+' awaiting approval</strong><div class="sub">'+esc(p.staged_approval_no_count)+' no · '+esc(p.staged_approval_blank_count)+' blank · '+esc(p.staged_approval_other_count)+' other approval value</div>';
  const toggle=count>0?'<button class="btn producer-expand'+(entry?.loading?' is-loading':'')+'" id="'+esc(dom)+'-toggle" data-producer-toggle="'+esc(p.producer_id)+'" aria-expanded="'+Boolean(entry?.open)+'" aria-controls="'+esc(dom)+'-children" aria-label="'+(entry?.open?'Collapse':'Expand')+' '+esc(count)+' eligible items for '+esc(p.name)+'"><span aria-hidden="true">'+(entry?.open?'▾':'▸')+'</span> '+(entry?.open?'Hide':'View')+' '+esc(count)+' eligible</button>':'<span class="sub">'+(count===0?'No eligible items':'Eligibility unknown')+'</span>';
  return '<tr class="producer-pool"><td><strong>'+esc(p.name)+'</strong>'+tagList([p.source_tab,'Account-level pool',...(p.creators||[])])+'</td><td><strong>'+esc(count??'Unknown')+' eligible</strong><div class="sub">'+esc(p.total_count)+' total · '+esc(p.consumed_count)+' consumed · '+esc(other)+(awaiting===null?' other (approval not measured)':' other')+'</div><div class="sub">Low below '+esc(p.threshold)+' · '+esc(p.threshold_source)+(p.status_conflicts?' · '+esc(p.status_conflicts)+' conflicting statuses':'')+'</div></td><td class="approval-count">'+approval+'</td><td>'+stockBadge(status(p))+'</td><td>'+tagList(workflowRefs(p))+'<div class="sub">'+esc(p.reference_status)+'</div></td><td>'+contentTimeBlock(p.updated_at)+'</td><td>'+toggle+'</td></tr>'+producerExpansionHTML(p);
 }).join('');
 $('producer-empty').classList.toggle('hidden',rows.length>0);
 if(focused?.startsWith('producer-')&&(focused.endsWith('-toggle')||focused.endsWith('-more')))$(focused)?.focus?.({preventScroll:true});
}

function renderSources(){
 if(!sourceReport)return;
 const terms=$('source-search').value.trim().toLowerCase().split(/\s+/),kind=$('source-kind').value,scope=$('source-scope').value,state=$('source-state').value;
 sourceRows=(sourceReport.rows||[]).filter(s=>terms.every(t=>[s.workflow_name,s.node_name,s.kind,s.role,s.tab,s.endpoint_host,...s.accounts].join(' ').toLowerCase().includes(t))&&(!kind||s.kind===kind)&&(scope==='all'||!['write_sink','api_dependency','service_dependency','scheduler_config'].includes(s.role))&&(state==='all'||(state==='relevant'?(!s.disabled&&s.reachable_from_trigger&&(s.active_at_export||s.account_evidence.length)):(!s.reachable_from_trigger||s.role.includes('unresolved')||s.has_redacted_parameters))));
 sourcePage=Math.max(0,Math.min(sourcePage,Math.max(0,Math.ceil(sourceRows.length/100)-1)));
 $('source-rows').innerHTML=sourceRows.slice(sourcePage*100,sourcePage*100+100).map(s=>'<tr><td><strong>'+link((sourceReport.workflow_base_url||'').replace(/\/$/,'')+'/workflow/'+encodeURIComponent(s.workflow_id),s.workflow_name)+'</strong><div class="sub">'+esc(s.node_name)+'</div>'+tagList([s.active_at_export?'Active at export':'Inactive at export',s.disabled?'Node disabled':s.reachable_from_trigger?'Graph-reachable':'Disconnected / no trigger path'])+'</td><td>'+tagList([s.kind,s.role])+'<div class="sub">'+esc(s.tab||s.endpoint_host||'Dynamic / undisclosed locator')+'</div></td><td>'+tagList(s.accounts)+(s.accounts.length?'':'Unresolved / no explicit account route')+'<div class="sub">'+esc(s.account_evidence.length?'Exact schedule match / literal call chain; branch selection unverified':'No account-name guessing')+'</div></td><td><span class="badge muted">'+esc(s.kind==='pinterest_rapidapi'?'On demand; finite stock not defined':'Remaining inventory unknown')+'</span><div class="sub">'+esc(s.has_redacted_parameters?'Redacted parameters present. ':'')+esc(s.observation?(s.observation.stale?'Stale · ':'')+s.observation.measurement+' · '+s.observation.status+' · count '+(s.observation.count??'Unknown')+(s.observation.complete?' · complete response':' · partial / unknown scope')+' · '+contentDate(s.observation.checked_at):s.kind==='google_sheets'?'See measured stock or tab state summaries above.':'Source-specific live inventory not connected.')+'</div></td></tr>').join('');
 $('source-page').textContent=sourceRows.length+' matching integration nodes · page '+(sourcePage+1)+' of '+Math.max(1,Math.ceil(sourceRows.length/100))+' · nodes are dependencies, not distinct stock pools';$('source-prev').disabled=sourcePage===0;$('source-next').disabled=(sourcePage+1)*100>=sourceRows.length;
}
function renderProducerSchedule(){
 if(!sourceReport)return;
 const rows=sourceReport.schedule||[];
 $('schedule-evidence').textContent='Schedule evidence: '+(sourceReport.schedule_evidence||'Unknown')+' · '+rows.length+' schedule rows. Timezone comes from the supplied schedule metadata.';
 const clock='<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8"/><path d="M10 5v5l3 2"/></svg>';
 const value=v=>v===undefined||v===null||v===''?'Unknown':typeof v==='object'?JSON.stringify(v):String(v);
 $('schedule-rows').innerHTML=rows.length?rows.map(r=>'<tr><td><strong>'+(r.workflow_url||r.workflow_id?link(r.workflow_url||(sourceReport.workflow_base_url||'').replace(/\/$/,'')+'/workflow/'+encodeURIComponent(r.workflow_id),r.workflow_name||r.workflow_id):esc(r.workflow_name||'Unresolved workflow'))+'</strong><div class="sub">Sheet row '+esc(r.row??r.source_row??'Unknown')+'</div></td><td>'+tagList(r.accounts||[])+'</td><td><span class="clock-label">'+clock+esc(value(r.timings))+'</span><div class="sub">'+esc(r.timezone||'Timezone unverified')+'</div></td><td>'+contentState(value(r.run))+'</td><td>'+contentState(r.resolution||'Unverified')+'</td></tr>').join(''):'<tr><td colspan="5" class="empty">No schedule records are available.</td></tr>';
}
const producerExpansions=new Map();
const producerDomId=id=>'producer-'+encodeURIComponent(id);
const producerCount=v=>Number.isSafeInteger(v)&&v>=0?v:null;
function approvalCount(p){return p.approval_breakdown_version===1?producerCount(p.staged_unapproved_count):null;}
function stopProducerExpansion(entry){entry.run=null;entry.loading=false;entry.pending=null;inflight.get('/api/producers/'+encodeURIComponent(entry.id)+'/items')?.abort();}
function clearProducerExpansions(){for(const entry of producerExpansions.values())stopProducerExpansion(entry);producerExpansions.clear();}
function reconcileProducerExpansions(){
 for(const [id,entry] of producerExpansions){const p=producerList.find(x=>x.producer_id===id);
  if(!p||!(producerCount(p.ready_count)>0)){stopProducerExpansion(entry);producerExpansions.delete(id);continue;}
  if(entry.version!==p.version||entry.count!==p.ready_count){stopProducerExpansion(entry);producerExpansions.set(id,{id,version:p.version,count:p.ready_count,open:entry.open,rows:[],next:0,loaded:false,notice:'The source snapshot changed. Reload eligible items to see the current rows.'});}
 }
}
function eligibleItemRows(rows){return rows.map(x=>'<tr><td>'+esc(x.origin)+' · row '+esc(x.source_row??x.item_id)+'</td><td>'+esc(x.creator_handle||'Not recorded')+'</td><td>'+link(x.item_url,x.item_label||'Open source ↗')+'</td><td>'+esc(x.status)+'</td><td>'+esc(x.approved)+'</td></tr>').join('');}
function producerExpansionHTML(p){
 if(!(producerCount(p.ready_count)>0))return '';
 const entry=producerExpansions.get(p.producer_id),dom=producerDomId(p.producer_id);
 if(!entry?.open)return '<tr id="'+esc(dom)+'-children" class="producer-children hidden"><td colspan="7"></td></tr>';
 const rows=entry.rows||[],loading=entry.loading;
 const control=loading?'<p class="loading-indicator is-loading" role="status">Loading eligible items…</p>':entry.error?'<p class="action-feedback" role="status">'+esc(entry.error)+'</p>':'';
 const action=!loading&&(!entry.loaded||entry.error||entry.next!==null)?'<button class="btn" id="'+esc(dom)+'-more" data-producer-more="'+esc(p.producer_id)+'">'+(entry.error?'Retry eligible items':entry.loaded?'Load more eligible items':'Load eligible items')+'</button>':'';
 return '<tr id="'+esc(dom)+'-children" class="producer-children"><td colspan="7"><section class="producer-item-detail" aria-label="Eligible items for '+esc(p.name)+'"><h4>'+esc(p.name)+' · '+esc(rows.length)+' / '+esc(p.ready_count)+' eligible items loaded</h4><p class="sub">Source: '+esc(p.source_tab)+' · collected '+esc(contentDate(p.updated_at))+(isStale(p)?' · stale snapshot':'')+'. Staged and approved=yes only.</p>'+(entry.notice?'<p class="sub">'+esc(entry.notice)+'</p>':'')+'<div class="scroll" aria-busy="'+Boolean(loading)+'"><table><thead><tr><th>Source row</th><th>Creator / handle</th><th>Source link</th><th>Status</th><th>Approved</th></tr></thead><tbody>'+eligibleItemRows(rows)+'</tbody></table></div>'+control+action+(entry.loaded&&entry.next===null&&!entry.error?'<p class="sub">All '+esc(rows.length)+' eligible items from this snapshot are shown.</p>':'')+'</section></td></tr>';
}
async function showItems(id){
 const p=producerList.find(x=>x.producer_id===id);if(!p||!(producerCount(p.ready_count)>0))return;
 reconcileProducerExpansions();let entry=producerExpansions.get(id);
 if(entry?.open){entry.open=false;stopProducerExpansion(entry);renderProducers();return;}
 if(!entry){entry={id,version:p.version,count:p.ready_count,rows:[],next:0,loaded:false};producerExpansions.set(id,entry);}
 entry.open=true;renderProducers();if(!entry.loaded)return loadProducerEligibleItems(id);
}
async function loadProducerEligibleItems(id){
 const entry=producerExpansions.get(id);if(!entry?.open||!token)return;if(entry.pending)return entry.pending;if(entry.loaded&&entry.next===null)return;
 const epoch=authEpoch,run={},offset=entry.loaded?entry.next:0;entry.run=run;entry.loading=true;entry.error='';entry.notice='';renderProducers();
 const current=()=>epoch===authEpoch&&producerExpansions.get(id)===entry&&entry.run===run&&entry.open;
 const work=(async()=>{
  try{
   const data=await api('/api/producers/'+encodeURIComponent(id)+'/items?'+new URLSearchParams({version:entry.version,offset:String(offset),eligibility:'ready'}));if(!current())return;
   if(data.version!==entry.version||data.eligibility!=='ready'||data.total!==entry.count||!Array.isArray(data.rows))throw Error('Eligible items do not match the displayed snapshot. Refresh stored data, then reopen this row.');
   const rows=data.rows,ids=new Set(entry.rows.map(x=>x.item_id));
   for(const row of rows){if(typeof row.item_id!=='string'||ids.has(row.item_id)||Number(row.ready)!==1||row.status_conflict||String(row.status).trim().toLowerCase()!=='staged'||String(row.approved).trim().toLowerCase()!=='yes')throw Error('Unexpected item eligibility or duplicate row. Refresh stored data before retrying.');ids.add(row.item_id);}
   const total=entry.rows.length+rows.length,next=data.next_offset;
   if(next===null?total!==data.total:!Number.isSafeInteger(next)||next!==offset+rows.length||!rows.length||next>=data.total)throw Error('Eligible item pagination is incomplete. Refresh stored data before retrying.');
   entry.rows.push(...rows);entry.next=next;entry.loaded=true;
  }catch(e){if(current())entry.error=e.name==='AbortError'?'Loading eligible items timed out. Retry this row.':e.message||'Eligible items could not be loaded.';}
  finally{if(current()){entry.loading=false;entry.pending=null;entry.run=null;renderProducers();}}
 })();entry.pending=work;return work;
}

function downloadProducerFile(name,contents,type){const u=URL.createObjectURL(new Blob([contents],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
for(const id of ['producer-search','producer-status','producer-fresh','producer-sort'])$(id).addEventListener('input',renderProducers);
for(const id of ['source-search','source-kind','source-scope','source-state'])$(id).addEventListener('input',()=>{sourcePage=0;renderSources()});
$('source-prev').onclick=()=>{sourcePage--;renderSources()};$('source-next').onclick=()=>{sourcePage++;renderSources()};
$('export-sources').onclick=()=>{if(sourceReport)downloadProducerFile('producer-sources-evidence.json',JSON.stringify({...sourceReport,rows:sourceRows},null,2),'application/json')};
$('export-producers').onclick=()=>{const cols=['source_tab','account','ready_count','staged_unapproved_count','staged_approval_no_count','staged_approval_blank_count','staged_approval_other_count','total_count','consumed_count','threshold','threshold_source','reference_status','updated_at'];const cell=v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};downloadProducerFile('producer-stock.csv',[cols.join(','),...filteredProducers.map(p=>cols.map(k=>cell(p[k])).join(','))].join('\r\n'),'text/csv')};
$('producers').addEventListener('click',e=>{
 const toggle=e.target.closest('[data-producer-toggle]'),more=e.target.closest('[data-producer-more]');
 if(toggle)showItems(toggle.dataset.producerToggle);else if(more)loadProducerEligibleItems(more.dataset.producerMore);
});
