// Runs inside the dashboard closure; all source labels are escaped at rendering.
let sourceReport=null,sourceRows=[],sourcePage=0,itemPage=null;
function status(p){if(p.measurement!=='measured'||p.ready_count===null)return 'unknown';if(isStale(p))return 'stale';if(!p.ready_count)return p.total_count>0&&p.consumed_count===p.total_count?'consumed':'empty';return p.ready_count<p.threshold?'low':'ready'}
function stockBadge(s){const colors={consumed:'red',empty:'red',low:'amber',ready:'green',stale:'amber',unknown:'muted'};const titles={consumed:'Consumed',empty:'No eligible items',low:'Low inventory',ready:'Ready',stale:'Stale',unknown:'Unknown'};return '<span class="badge '+colors[s]+'">'+titles[s]+'</span>'}
async function loadProducers(){
 banner('Loading source evidence and measured inventory…');
 const [d,s]=await Promise.all([api('/api/producers'),api('/api/producer-sources')]);
 producerList=d.rows||[];sourceReport=s;
 const health=d.sync||{};
 $('sheet-health').textContent='Sheets: '+(health.status||'never')+' · last successful fetch: '+(health.last_success||'never')+' · '+(health.stale?'STALE / UNVERIFIED':'within 30 minutes')+' · scheduled every 10 minutes'+(health.error_code?' · '+health.error_code:'');
 const selected=$('source-kind').value;
 $('source-kind').innerHTML='<option value="">All kinds</option>'+[...new Set((s.rows||[]).map(x=>x.kind))].sort().map(k=>'<option value="'+esc(k)+'">'+esc(k)+'</option>').join('');$('source-kind').value=selected;
 $('source-coverage').textContent=(s.coverage?.workflows||0)+' workflows / '+(s.coverage?.nodes||0)+' nodes inventoried from '+s.source_archive+'. Workflow definitions are an export snapshot, not live n8n health. Account routing evidence: '+s.schedule_evidence+'. Unknown inventory is never zero.';
 $('source-queues').innerHTML=(s.references||[]).map(r=>'<tr><td>'+esc(r.tab)+'</td><td>'+esc(r.status)+(r.error_code?'<div class="sub">'+esc(r.error_code)+'</div>':'')+'</td><td>'+esc(r.rows??'Unknown')+'</td><td>'+esc(JSON.stringify(r.status_counts||{}))+'</td></tr>').join('');
 $('source-issues').textContent=(s.coverage?.unresolved_code_nodes||0)+' nodes contain I/O or redacted code requiring runtime evidence; '+(s.coverage?.unresolved_subworkflow_calls||0)+' subworkflow targets unresolved. '+(s.schedule||[]).filter(r=>!r.workflow_id).length+' current schedule rows do not match a unique exported workflow. Credential values, CFG settings and dynamic folder/channel choices are not inferred.';
 renderProducers();renderSources();renderProducerSchedule();banner(d.warning||'');$('freshness').textContent='Stored data refreshed '+new Date().toLocaleString();
}
function renderProducers(){
 const terms=$('producer-search').value.trim().toLowerCase().split(/\s+/),desired=$('producer-status').value,fresh=$('producer-fresh').value;
 const rows=producerList.filter(p=>terms.every(t=>(p.name+' '+p.account+' '+p.source_tab+' '+(p.creators||[]).join(' ')+' '+workflowRefs(p).join(' ')).toLowerCase().includes(t))&&(!desired||status(p)===desired)&&(!fresh||(fresh==='stale')===isStale(p)));
 const order=$('producer-sort').value,rank={consumed:0,empty:0,low:1,stale:2,unknown:3,ready:4};
 rows.sort((a,b)=>order==='name'?String(a.name).localeCompare(b.name):order==='remaining'?a.ready_count-b.ready_count:rank[status(a)]-rank[status(b)]||String(a.name).localeCompare(b.name));filteredProducers=rows;
 $('producer-stats').innerHTML=[['Stock pools',producerList.length],['No eligible / consumed',producerList.filter(p=>['empty','consumed'].includes(status(p))).length],['Low',producerList.filter(p=>status(p)==='low').length],['Stale / unknown',producerList.filter(p=>['stale','unknown'].includes(status(p))).length]].map(([label,n])=>'<span>'+esc(label)+'<strong>'+n+'</strong></span>').join('');
 $('producers').innerHTML=rows.map(p=>'<tr><td><strong>'+esc(p.name)+'</strong>'+tagList([p.source_tab,'Account-level pool',...(p.creators||[])])+'</td><td><strong>'+esc(p.ready_count)+' eligible</strong><div class="sub">'+esc(p.total_count)+' total · '+esc(p.consumed_count)+' consumed · '+esc(p.total_count-p.ready_count-p.consumed_count)+' other</div><div class="sub">Low below '+esc(p.threshold)+' · '+esc(p.threshold_source)+(p.status_conflicts?' · '+esc(p.status_conflicts)+' conflicting statuses':'')+'</div></td><td>'+stockBadge(status(p))+'</td><td>'+tagList(workflowRefs(p))+'<div class="sub">'+esc(p.reference_status)+'</div></td><td>'+esc(p.updated_at||'Unknown')+'</td><td><button class="btn item-button" data-id="'+esc(p.producer_id)+'">See items</button></td></tr>').join('');
 $('producer-empty').classList.toggle('hidden',rows.length>0);
}
function renderSources(){
 if(!sourceReport)return;
 const terms=$('source-search').value.trim().toLowerCase().split(/\s+/),kind=$('source-kind').value,scope=$('source-scope').value,state=$('source-state').value;
 sourceRows=(sourceReport.rows||[]).filter(s=>terms.every(t=>[s.workflow_name,s.node_name,s.kind,s.role,s.tab,s.endpoint_host,...s.accounts].join(' ').toLowerCase().includes(t))&&(!kind||s.kind===kind)&&(scope==='all'||!['write_sink','api_dependency','service_dependency','scheduler_config'].includes(s.role))&&(state==='all'||(state==='relevant'?(!s.disabled&&s.reachable_from_trigger&&(s.active_at_export||s.account_evidence.length)):(!s.reachable_from_trigger||s.role.includes('unresolved')||s.has_redacted_parameters))));
 sourcePage=Math.max(0,Math.min(sourcePage,Math.max(0,Math.ceil(sourceRows.length/100)-1)));
 $('source-rows').innerHTML=sourceRows.slice(sourcePage*100,sourcePage*100+100).map(s=>'<tr><td><strong>'+link((sourceReport.workflow_base_url||'').replace(/\/$/,'')+'/workflow/'+encodeURIComponent(s.workflow_id),s.workflow_name)+'</strong><div class="sub">'+esc(s.node_name)+'</div>'+tagList([s.active_at_export?'Active at export':'Inactive at export',s.disabled?'Node disabled':s.reachable_from_trigger?'Graph-reachable':'Disconnected / no trigger path'])+'</td><td>'+tagList([s.kind,s.role])+'<div class="sub">'+esc(s.tab||s.endpoint_host||'Dynamic / undisclosed locator')+'</div></td><td>'+tagList(s.accounts)+(s.accounts.length?'':'Unresolved / no explicit account route')+'<div class="sub">'+esc(s.account_evidence.length?'Exact schedule match / literal call chain; branch selection unverified':'No account-name guessing')+'</div></td><td><span class="badge muted">'+esc(s.kind==='pinterest_rapidapi'?'On demand; finite stock not defined':'Remaining inventory unknown')+'</span><div class="sub">'+esc(s.has_redacted_parameters?'Redacted parameters present. ':'')+esc(s.kind==='google_sheets'?'See measured stock or tab state summaries above.':'Source-specific live inventory not connected.')+'</div></td></tr>').join('');
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
async function showItems(id){
 const p=producerList.find(x=>x.producer_id===id);if(!p)return;
 itemPage={id,version:p.version,offset:0};$('items').replaceChildren();$('item-title').textContent=p.name+' · '+p.source_tab;$('item-panel').classList.remove('hidden');await loadItemPage();$('item-panel').scrollIntoView({behavior:'smooth',block:'nearest'});
}
async function loadItemPage(){
 if(!itemPage)return;const current=itemPage;
 const d=await api('/api/producers/'+encodeURIComponent(current.id)+'/items?'+new URLSearchParams({version:current.version,offset:String(current.offset)}));if(itemPage!==current)return;
 $('items').insertAdjacentHTML('beforeend',d.rows.map(x=>'<tr><td>'+esc(x.origin)+' · '+esc(x.source_row??x.item_id)+'<div class="sub">'+esc(x.creator_handle)+'</div></td><td>'+link(x.item_url,x.item_label||'Open item')+'</td><td>'+esc(x.status)+(x.status_conflict?' · CONFLICT':'')+'</td><td>'+esc(x.approved)+'</td><td>'+esc(x.ready?'Eligible':x.consumed?'Consumed':x.status_conflict?'Status conflict':'Not eligible')+'</td></tr>').join(''));
 current.offset=d.next_offset;$('more-items').classList.toggle('hidden',d.next_offset===null);
}
function downloadProducerFile(name,contents,type){const u=URL.createObjectURL(new Blob([contents],{type})),a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)}
for(const id of ['producer-search','producer-status','producer-fresh','producer-sort'])$(id).addEventListener('input',renderProducers);
for(const id of ['source-search','source-kind','source-scope','source-state'])$(id).addEventListener('input',()=>{sourcePage=0;renderSources()});
$('source-prev').onclick=()=>{sourcePage--;renderSources()};$('source-next').onclick=()=>{sourcePage++;renderSources()};
$('export-sources').onclick=()=>{if(sourceReport)downloadProducerFile('producer-sources-evidence.json',JSON.stringify({...sourceReport,rows:sourceRows},null,2),'application/json')};
$('export-producers').onclick=()=>{const cols=['source_tab','account','ready_count','total_count','consumed_count','threshold','threshold_source','reference_status','updated_at'];const cell=v=>{let s=String(v??'');if(/^\s*[=+@-]/.test(s)||/^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};downloadProducerFile('producer-stock.csv',[cols.join(','),...filteredProducers.map(p=>cols.map(k=>cell(p[k])).join(','))].join('\r\n'),'text/csv')};
$('close-items').onclick=()=>{itemPage=null;$('item-panel').classList.add('hidden');for(const [k,c] of inflight)if(k.endsWith('/items'))c.abort()};
guarded('more-items',loadItemPage);
