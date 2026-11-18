// Infrastructure state is session-local; no credentials or file inventories persisted.
let infraRows=[],infraRun=0,b2Generation=0,b2Slot='',b2Cursor=null,b2Rows=[],b2Selection=new Set(),b2Busy=false,b2CanDelete=false,b2Plan=null,b2Complete=false,b2Visible=100,b2Budget=null;
const infraControllers=new Set();
function infraBytes(n){if(!Number.isFinite(n))return 'Unknown';const units=['B','KiB','MiB','GiB','TiB'];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return n.toLocaleString(undefined,{maximumFractionDigits:2})+' '+units[i];}
function infraError(id,e){if(e.name!=='AbortError')$(id).textContent=e.message||'Request failed';}
async function infraRequest(scope,path,payload){
 if(!checkIdleSession())throw new DOMException('Locked','AbortError');
 const epoch=authEpoch,c=new AbortController();infraControllers.add(c);const timer=setTimeout(()=>c.abort(),path==='/b2/delete'?75000:35000);
 try{
  const r=await fetch('/api/infra/'+scope+path,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(payload===undefined?{}:{'Content-Type':'application/json'})},...(payload===undefined?{}:{body:JSON.stringify(payload)}),signal:c.signal,cache:'no-store'});
  if(epoch!==authEpoch||!token)throw new DOMException('Locked','AbortError');
  if(r.status===401){lock();throw new DOMException('Locked','AbortError');}
  let d;try{d=await r.json()}catch{throw Error('Invalid response; refresh this section.');}
  if(!r.ok)throw Error(d.error||'Infrastructure request failed ('+r.status+')');
  return d;
 }catch(e){if(c.signal.aborted&&epoch===authEpoch)throw Error(payload?'Request timed out; outcome may be unknown. Refresh files before any new deletion.':'Request timed out. Retry this section.');throw e;}
 finally{clearTimeout(timer);infraControllers.delete(c);}
}
function infraDonut(value,label){const p=Math.max(0,Math.min(100,Number(value)||0));return '<div class="infra-donut" style="--fill:'+p+'%" role="img" aria-label="'+esc(label)+'"><span>'+Math.round(Number(value)||0)+'%</span></div>';}
function infraGroup(row){
 if(/^(b2:|postgres:|social_db$|redis$|google$|imagekit$|cloudinary$)/.test(row.id))return 'storage';
 if(/^(runtime$|render:|router:|queue$|sla$|cloudflare$)/.test(row.id))return 'compute';
 return 'integrations';
}
function infraIcon(group){
 const paths={storage:'M4 6c0-4 16-4 16 0s-16 4-16 0Zm0 0v12c0 4 16 4 16 0V6M4 12c0 4 16 4 16 0',compute:'M4 3h16v7H4zM4 14h16v7H4zM7 6h1m-1 11h1m4-11h5m-5 11h5',integrations:'M9 8V3m6 5V3M6 8h12v3a6 6 0 0 1-12 0Zm6 9v5'};
 return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+paths[group]+'"/></svg>';
}
function infraDecimalBytes(n){
 if(!Number.isFinite(n))return 'Unknown';
 const units=['B','KB','MB','GB','TB'];let i=0;while(n>=1000&&i<4){n/=1000;i++;}
 return n.toLocaleString(undefined,{maximumFractionDigits:2})+' '+units[i];
}
function infraServiceIcon(row){
 const id=row.id.split(':')[0];
 const paths={
  b2:'M4 6h16l-2 15H6ZM3 6h18M8 3h8M8 11h8M9 15h6',
  postgres:'M4 5c0-4 16-4 16 0s-16 4-16 0Zm0 0v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0',
  redis:'m3 7 9-4 9 4-9 4Zm0 5 9 4 9-4M3 17l9 4 9-4',
  google:'M5 2h10l4 4v16H5ZM15 2v5h4M8 11h8M8 15h8M8 19h8M11 11v8',
  imagekit:'M3 4h18v16H3ZM3 17l6-7 5 5 3-3 4 5M16 8h1',
  cloudinary:'M6 17a4 4 0 0 1-1-8 7 7 0 0 1 13-2 5 5 0 0 1 1 10M7 20l5-6 5 6',
  telegram:'m2 10 20-8-5 20-6-7-5 3 1-6Zm5 2L22 2M11 15 22 2',
  n8n:'M5 5v14M5 12h8l5-7M13 12l5 7M3 3h4v4H3ZM16 3h4v4h-4ZM16 17h4v4h-4ZM3 17h4v4H3Z',
  kite:'M3 3v18h18M6 15l5-5 4 3 6-8M16 5h5v5',
  youtube:'M2 5h20v14H2ZM10 8l6 4-6 4Z',
  meta:'M2 16C2 3 7 3 12 12s10 9 10-1S17 1 12 12 2 23 2 16Z',
  threads:'M19 5C9-4 1 5 4 16s20 7 17-3S8 4 9 12s9 4 7-5',
  tumblr:'M9 3v14c0 5 6 5 9 3M5 8h12M12 3v14c0 2 3 2 5 1',
  x:'M4 3h5l11 18h-5ZM20 3 4 21',
  cloudflare:'M4 16a4 4 0 0 1 1-8 7 7 0 0 1 13 0 4 4 0 0 1 2 8ZM3 20h18',
  router:'M9 3h6v6H9ZM3 16h6v6H3ZM15 16h6v6h-6ZM12 9v4M6 16v-3h12v3',
  sla:'M12 3a9 9 0 1 0 .01 0M12 7v6l4 2',
  queue:'M7 5h14M7 12h14M7 19h14M2 4h2v2H2ZM2 11h2v2H2ZM2 18h2v2H2Z',
  runtime:'M6 6h12v12H6ZM9 9h6v6H9ZM9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4M18 9h4m-4 6h4',
  render:'M3 3h18v7H3ZM3 14h18v7H3ZM7 6h1m-1 11h1M12 6h5m-5 11h5',
  pulsetic:'M2 12h5l3-8 4 16 3-8h5'
 };
 const key=id==='social_db'?'postgres':id;
 const color={b2:'#ffb099',postgres:'#90c9ff',redis:'#ff9aab',google:'#83e2ab',imagekit:'#c5b4ff',telegram:'#83d9ff',n8n:'#ffafc9',kite:'#ffd78b',youtube:'#ff9898',meta:'#9ab8ff',cloudflare:'#ffcb86',runtime:'#b7c4ff',sla:'#f4d38b'}[key]||'#9ed6cd';
 return '<span class="infra-service-icon" style="--service-color:'+color+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(paths[key]||'M5 5h14v14H5ZM9 9h6v6H9Z')+'"/></svg></span>';
}
// User-supplied account cap reference, NOT live provider telemetry or a per-bucket limit.
// Applies only to the named bucket shown alongside the supplied account screenshot.
const infraB2CapReferences={sh0001:{bytes:10000000000,observed:'16 Nov 2026'}};
function infraB2Reference(row){return row.id.startsWith('b2:')?infraB2CapReferences[row.bucket]||null:null;}
function infraMetric(m,row){
 const b2=row.id.startsWith('b2:'),valid=Number.isFinite(m.used),reference=infraB2Reference(row);
 const complete=!!row.storage_usage?.complete&&row.storage_usage.scope==='bucket'&&!row.prefix;
 const operatorLimit=Number.isFinite(m.limit)&&m.limit>0;
 const cap=operatorLimit?m.limit:b2&&complete&&reference?reference.bytes:null;
 const p=valid&&cap?100*m.used/cap:null;
 const fmt=b2?infraDecimalBytes:infraBytes;
 const label=b2?(complete?'Bucket file-version storage':'Listed file-version storage · partial/prefix'):m.label;
 const capLabel=operatorLimit?'operator budget':'account cap reference';
 const value=m.unit==='bytes'?fmt(m.used):String(m.used);
 return '<div class="infra-metric">'+(p===null?'':infraDonut(p,b2?'Bucket bytes equal '+p.toFixed(1)+'% of '+capLabel:m.label+': '+Math.round(p)+'% used'))+'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(b2&&valid?'<small>'+esc(infraBytes(m.used))+' · '+esc(m.used.toLocaleString())+' bytes</small>':'')+'<small>'+(cap?'Compared with '+esc(m.unit==='bytes'?fmt(cap):String(cap))+' '+capLabel:'limit unknown')+' · '+esc(m.source)+'</small></div></div>'+(b2&&cap?'<p class="infra-cap-note">'+(operatorLimit?'Configured operator budget.':'Account cap reference from your '+esc(reference.observed)+' screenshot; not automatically refreshed.')+' This ring compares one bucket with that reference. It does not show account utilization or remaining upload allowance.</p>':'');
}
function infraManageIndex(row,index){
 if(!row.id.startsWith('b2:'))return -1;
 if(row.scope==='control')return index;
 return row.bucket_id?infraRows.findIndex(r=>r.scope==='control'&&r.id.startsWith('b2:')&&r.bucket_id===row.bucket_id&&r.prefix===row.prefix):-1;
}
function renderInfra(){
 const healthy=infraRows.filter(r=>r.status==='healthy').length,total=infraRows.length,unknown=infraRows.filter(r=>['unchecked','not_configured'].includes(r.status)).length;
 const attention=total-healthy-unknown;
 $('infra-summary').innerHTML=total?[[total,'Components','neutral'],[healthy,'Checks passed','good'],[attention,'Need attention','bad'],[unknown,'Unchecked / unconfigured','neutral']].map(([n,label,tone])=>'<div class="infra-stat '+tone+'"><strong>'+n+'</strong><span>'+label+'</span></div>').join(''):'<div class="infra-empty"><strong>No inventory loaded</strong><p>Refresh checks to connect. If a source is unavailable, see its error below. No health percentage can be calculated yet.</p></div>';
 const filter=$('infra-filter').value||'all';
 const groups=[['storage','Storage & files','Bucket usage, databases and media storage'],['compute','Compute & routing','Serving instances, queues and infrastructure control'],['integrations','Connected services','Publishing, automation and external APIs']];
 $('infra-cards').innerHTML=groups.map(([group,label,description])=>{
  const rows=infraRows.map((r,i)=>({r,i})).filter(({r})=>infraGroup(r)===group&&(filter==='all'||filter==='storage'&&group==='storage'||filter==='attention'&&!['healthy','unchecked','not_configured'].includes(r.status)||filter==='unchecked'&&['unchecked','not_configured'].includes(r.status)));
  if(!rows.length)return '';
  return '<section class="infra-section"><div class="infra-section-title"><span class="infra-icon">'+infraIcon(group)+'</span><div><h3>'+label+' <small>'+rows.length+'</small></h3><p>'+description+'</p></div></div><div class="infra-grid">'+rows.map(({r,i})=>{
   const b2=r.id.startsWith('b2:'),manage=infraManageIndex(r,i),usage=r.storage_usage;
   const metrics=(r.metrics||[]).map(m=>infraMetric(m,r)).join('');
   return '<article class="infra-card" data-state="'+esc(r.status)+'"><div class="infra-card-top">'+infraServiceIcon(r)+'<span class="infra-state" data-state="'+esc(r.status)+'">'+esc(r.status.replaceAll('_',' '))+'</span></div><h4>'+esc(r.name)+'</h4><span class="infra-scope">'+(r.scope==='control'?'Control plane':'Media instance')+'</span>'+metrics+(b2&&!metrics?'<div class="infra-metric"><div><span>Stored file versions</span><strong>Awaiting measurement</strong><small>Refresh checks to read bucket metadata.</small></div></div>':'')+(usage?'<p class="infra-scan">'+(usage.complete?'✓ Complete listing':'◷ Partial listing')+' · '+usage.versions+' uploaded versions · '+esc(usage.scope)+'</p>':'')+'<p>'+esc(r.note||'Awaiting read-only check.')+'</p>'+(manage>=0?'<button class="btn infra-primary" data-b2-open="'+manage+'">Browse files &amp; review deletion →</button>':b2?'<p class="infra-hint">File management requires a matching bucket and prefix on the control plane. Its storage card provides the browse button.</p>':'')+'<details class="infra-card-details"><summary>Details &amp; measurement scope</summary><p>'+esc(r.quota_note||'')+'</p><small>'+(r.checked_at?'Checked '+esc(new Date(r.checked_at).toLocaleString()):'Not checked')+'</small>'+(b2?'<p>Account caps and daily transactions are separate from these bucket bytes. <a href="https://www.backblaze.com/docs/cloud-storage-use-partner-api-reports" target="_blank" rel="noopener noreferrer">Backblaze usage reports ↗</a></p>':'')+'</details></article>';
  }).join('')+'</div></section>';
 }).join('')||(total?'<p class="infra-empty">No components match this filter.</p>':'');
}
$('infra-filter').onchange=renderInfra;
async function loadInfra(){
 const run=++infraRun,epoch=authEpoch;$('infra-refresh').disabled=true;$('infra-error').textContent='';$('infra-progress').textContent='Loading infrastructure inventories…';infraRows=[];renderInfra();
 try{
  const results=await Promise.allSettled(['control','runtime'].map(async scope=>({scope,data:await infraRequest(scope,'/inventory')})));
  if(run!==infraRun||epoch!==authEpoch)return;
  const notes=[];
  results.forEach((result,i)=>{if(result.status==='fulfilled'){const {scope,data}=result.value;infraRows.push(...data.rows.map(r=>({...r,scope})));notes.push(scope+' ['+data.instance+']: '+data.coverage);}else notes.push((i?'Media':'Control plane')+' unavailable: '+result.reason.message);});
  $('infra-coverage').textContent=notes.join(' | ');renderInfra();
  const queue=infraRows.filter(r=>r.can_probe);let completed=0;
  async function worker(){while(queue.length&&run===infraRun&&epoch===authEpoch){const item=queue.shift();try{const result=await infraRequest(item.scope,'/check?'+new URLSearchParams({component:item.id}));if(run!==infraRun||epoch!==authEpoch)return;Object.assign(item,result);}catch(e){if(run!==infraRun||epoch!==authEpoch)return;item.status='unavailable';item.note=e.message;}completed++;$('infra-progress').textContent='Checked '+completed+' components…';renderInfra();}}
  await Promise.all([worker(),worker(),worker()]);
  if(run===infraRun&&epoch===authEpoch)$('infra-progress').textContent=(results.every(r=>r.status==='rejected')?'Inventory unavailable':results.some(r=>r.status==='rejected')?'Checks finished · one inventory unavailable':'Checks finished')+' · '+new Date().toLocaleTimeString();
 }catch(e){if(epoch===authEpoch)infraError('infra-error',e);}
 finally{if(run===infraRun&&epoch===authEpoch)$('infra-refresh').disabled=false;}
}
function setB2Busy(busy){b2Busy=busy;for(const id of ['b2-reload','b2-more','b2-review','b2-clear'])$(id).disabled=busy;renderB2();}
function renderB2(){
 b2RenderActivity();
 for(const row of b2Rows)Object.assign(row,b2Classify(row,b2ReferenceScan));
 for(const id of b2Selection)if(!b2Rows.some(r=>r.file_id===id&&r.deletion_eligibility==='Eligible'))b2Selection.delete(id);
 $('b2-scan-references').disabled=b2Busy||b2ReferenceBusy||!b2Complete;
 const q=$('b2-search').value.toLowerCase(),sort=$('b2-sort').value,folder=$('b2-folder').value||'';
 const folders=new Set();for(const row of b2Rows){const parts=row.name.split('/');parts.pop();let path='';for(const part of parts){path+=part+'/';folders.add(path);}}
 $('b2-folder').innerHTML='<option value="">All folders</option>'+Array.from(folders).sort().map(f=>'<option value="'+esc(f)+'" '+(f===folder?'selected':'')+'>'+esc(f)+'</option>').join('');
 $('b2-folder').value=folder;
 const rows=b2Rows.filter(r=>r.name.startsWith(folder)&&r.name.toLowerCase().includes(q)&&b2ReferenceFilter(r)).sort((a,b)=>sort==='size-asc'?a.size-b.size:sort==='name'?a.name.localeCompare(b.name):sort==='newest'?b.uploaded_at-a.uploaded_at:b.size-a.size);
 $('b2-rows').innerHTML=rows.slice(0,b2Visible).map(r=>'<tr><td><input type="checkbox" data-b2-id="'+esc(r.file_id)+'" aria-label="Select '+esc(r.name)+' version '+esc(r.file_id)+'" '+(b2Selection.has(r.file_id)?'checked ':'')+(b2Busy||b2ReferenceBusy||r.deletion_eligibility!=='Eligible'?'disabled':'')+'></td><td>'+esc(r.name)+'<br><small>'+esc(r.file_id)+'</small></td><td>'+esc(infraDecimalBytes(r.size))+'<br><small>'+esc(infraBytes(r.size))+'</small>'+'</td><td>'+esc(new Date(r.uploaded_at).toISOString())+'</td><td>'+esc(r.action)+'</td>'+b2ReferenceCells(r)+'</tr>').join('');
 $('b2-show-more').hidden=rows.length<=b2Visible;
 $('b2-review').disabled=b2Busy||b2ReferenceBusy||!b2Selection.size;
 $('b2-more').disabled=b2Busy||!b2Cursor;
 const selected=b2Rows.filter(r=>b2Selection.has(r.file_id)),bytes=b2Rows.filter(r=>r.action==='upload').reduce((n,r)=>n+r.size,0);
 $('b2-usage').innerHTML=b2Budget&&b2Complete?'<div class="infra-summary">'+infraDonut(100*bytes/b2Budget,'Listed uploaded version bytes against operator storage budget')+'<span>Listed version storage / operator budget</span></div>':'';
 $('b2-selected').textContent=selected.length+' / 10 selected · '+infraBytes(selected.reduce((n,r)=>n+r.size,0));
 $('b2-progress').textContent=(b2Busy?'Working… · ':'')+b2Rows.length+' versions loaded · '+infraDecimalBytes(bytes)+' ('+infraBytes(bytes)+')'+' in uploaded versions · '+(b2Complete?'Listing complete at read time':'PARTIAL listing: load remaining pages for whole-bucket size ordering')+(b2Budget?' · operator storage budget '+infraBytes(b2Budget):' · storage budget unknown')+(!b2CanDelete?' · reference review only; deletion disabled':'');
}
async function loadB2(reset=false){
 if(b2Busy||b2ReferenceBusy||!b2Slot)return;const generation=b2Generation,epoch=authEpoch;
 if(reset){b2ResetReferences();b2Rows=[];b2Selection.clear();b2Cursor=null;b2Complete=false;b2Plan=null;b2Visible=100;$('b2-results').textContent='';}
 $('b2-error').textContent='';setB2Busy(true);
 try{const d=await infraRequest('control','/b2/files?'+new URLSearchParams({slot:b2Slot,...(b2Cursor?{cursor:b2Cursor}:{})}));if(epoch!==authEpoch||generation!==b2Generation)return;
  const existing=new Map(b2Rows.map(r=>[r.file_id,r]));for(const r of d.rows)existing.set(r.file_id,r);b2Rows=[...existing.values()];b2Cursor=d.next_cursor;b2Complete=!d.next_cursor;b2CanDelete=false;b2Bucket=d.bucket;b2Budget=d.storage_budget;
  $('b2-scope').textContent='Slot '+b2Slot+' · bucket '+d.bucket+(d.prefix?' · restricted prefix '+d.prefix:'')+' · '+d.scope;
 }catch(e){if(epoch===authEpoch&&generation===b2Generation)infraError('b2-error',e);}
 finally{if(epoch===authEpoch&&generation===b2Generation)setB2Busy(false);}
}
async function openB2(slot){if(b2Busy||b2ReferenceBusy){$('b2-error').textContent='Wait for the current file operation to finish.';return;}b2Generation++;b2AutoReset();b2Slot=slot;$('b2-sort').value='size-desc';$('b2-search').value='';$('b2-folder').value='';$('b2-manager').classList.remove('hidden');$('b2-manager').scrollIntoView({behavior:'smooth'});await loadB2(true);const generation=b2Generation;for(let pages=1;pages<20&&b2Cursor&&generation===b2Generation&&!$('infra-view').classList.contains('hidden');pages++){const count=b2Rows.length;await loadB2(false);if(b2Rows.length===count)break;}if(b2Complete)await b2ScanWorkbook();}
$('infra-cards').addEventListener('click',e=>{const b=e.target.closest('[data-b2-open]');if(b)openB2(infraRows[Number(b.dataset.b2Open)].id.slice(3));});
$('b2-rows').addEventListener('change',e=>{const id=e.target.dataset.b2Id;if(!id||b2Busy||b2ReferenceBusy)return;if(!b2Rows.some(r=>r.file_id===id&&b2Classify(r,b2ReferenceScan).deletion_eligibility==='Eligible')){e.target.checked=false;return;}if(e.target.checked){if(b2Selection.size>=10){e.target.checked=false;$('b2-error').textContent='Select at most 10 versions per confirmation.';return;}b2Selection.add(id);}else b2Selection.delete(id);b2Plan=null;renderB2();});
$('b2-folder').onchange=()=>{b2Visible=100;renderB2();};
$('b2-search').oninput=()=>{b2Visible=100;renderB2();};$('b2-sort').onchange=()=>{b2Visible=100;renderB2();};
$('b2-show-more').onclick=()=>{b2Visible+=100;renderB2();};$('b2-reload').onclick=()=>loadB2(true);$('b2-more').onclick=()=>loadB2(false);$('b2-clear').onclick=()=>{b2Selection.clear();b2Plan=null;renderB2();};
$('b2-review').onclick=()=>{
 renderB2();const rows=b2Rows.filter(r=>b2Selection.has(r.file_id));
 $('b2-results').textContent=rows.map(r=>r.name+' · '+r.file_id+'\n'+r.workbook_reference_status+' · '+r.deletion_eligibility+'\n'+r.workbook_references.map(b2ReferenceLocation).join('\n')).join('\n\n')+'\nRead-only evidence. No deletion request was sent.';
};
$('b2-confirm-input').oninput=()=>{$('b2-delete').disabled=true;};
$('b2-cancel').onclick=()=>{b2Plan=null;$('b2-confirm').close?.();};
$('b2-delete').onclick=()=>{$('b2-error').textContent='Deletion is disabled: workbook reference review only.';};
$('infra-refresh').onclick=loadInfra;
const infraOldTab=tab;
tab=function(which){$('infra-view').classList.toggle('hidden',which!=='infra');$('tab-infra').setAttribute('aria-selected',which==='infra');if(which==='infra'){banner();cancelCleanupRetry();stopAutoPreviews();for(const name of ['failures','producers','meta']){$('tab-'+name).setAttribute('aria-selected','false');$(name==='failures'?'failure-view':name==='producers'?'producer-view':'meta-view').classList.add('hidden');}if(!infraRows.length)loadInfra();}else infraOldTab(which);};
$('tab-infra').onclick=()=>tab('infra');
const infraOldLock=lock;
lock=function(){b2AutoReset();b2ResetReferences();b2Bucket='';infraRun++;b2Generation++;for(const c of infraControllers)c.abort();infraControllers.clear();infraRows=[];b2Rows=[];b2Selection.clear();b2Slot='';b2Cursor=null;b2Plan=null;b2Busy=false;b2CanDelete=false;$('b2-confirm').close?.();$('infra-view').classList.add('hidden');$('b2-manager').classList.add('hidden');$('infra-refresh').disabled=false;for(const id of ['infra-cards','infra-summary','infra-coverage','infra-progress','infra-error','b2-rows','b2-results','b2-error','b2-scope','b2-confirm-files','b2-confirm-summary','b2-progress','b2-selected','b2-usage'])$(id).replaceChildren();$('b2-confirm-input').value='';$('b2-folder').innerHTML='<option value="">All folders</option>';$('b2-folder').value='';infraOldLock();$('failure-view').classList.remove('hidden');$('tab-failures').setAttribute('aria-selected','true');$('tab-infra').setAttribute('aria-selected','false');};

let b2AutoConfig=null;
function b2AutoReset(){b2AutoConfig=null;$('b2-auto-save').disabled=true;$('b2-auto-enabled').checked=false;$('b2-auto-history').replaceChildren();$('b2-auto-notice').textContent='Load the schedule before editing. Initially paused.';}
async function b2AutoLoad(){const slot=b2Slot,generation=b2Generation;$('b2-auto-load').disabled=true;$('b2-auto-notice').textContent='Loading schedule and history…';try{const d=await infraRequest('control','/b2/automation?slot='+encodeURIComponent(slot));if(slot!==b2Slot||generation!==b2Generation)return;b2AutoConfig=d.settings;$('b2-auto-enabled').checked=d.settings.enabled;$('b2-auto-k').value=d.settings.top_k;$('b2-auto-time').value=d.settings.time;$('b2-auto-zone').value=d.settings.timezone;$('b2-auto-save').disabled=false;$('b2-auto-notice').textContent=d.settings.enabled?'Automatic deletion enabled.':'Schedule paused. No automatic deletions.';$('b2-auto-history').innerHTML=(d.runs||[]).map(r=>'<details><summary>'+esc(r.started_at)+' · '+esc(r.status)+' · '+infraBytes(r.bytes_reclaimed||0)+'</summary><p>'+esc(r.error||'')+'</p><pre>'+esc(JSON.stringify(r.results,null,2))+'</pre></details>').join('')||'<p>No cleanup runs recorded.</p>';}catch(e){infraError('b2-auto-notice',e)}finally{$('b2-auto-load').disabled=false;}}
$('b2-auto-load').onclick=b2AutoLoad;
$('b2-auto-save').onclick=async()=>{if(!b2AutoConfig||b2AutoConfig.slot!==b2Slot)return;const k=Number($('b2-auto-k').value);if(!Number.isInteger(k)||k<1||k>25){$('b2-auto-notice').textContent='Choose a whole number from 1 to 25.';return;}$('b2-auto-save').disabled=true;try{await infraRequest('control','/b2/automation',{...b2AutoConfig,enabled:$('b2-auto-enabled').checked,top_k:k,time:$('b2-auto-time').value,timezone:$('b2-auto-zone').value});await b2AutoLoad();}catch(e){infraError('b2-auto-notice',e);b2AutoConfig=null;$('b2-auto-notice').textContent+=' Reload schedule to verify the saved state before retrying.';}};
