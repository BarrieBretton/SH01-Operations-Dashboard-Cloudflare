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
function renderInfra(){
 const healthy=infraRows.filter(r=>r.status==='healthy').length,total=infraRows.length,unknown=infraRows.filter(r=>['unchecked','not_configured'].includes(r.status)).length;
 $('infra-summary').innerHTML=infraDonut(total?100*healthy/total:0,healthy+' of '+total+' components verified healthy')+'<div><strong>'+healthy+' / '+total+' verified healthy</strong><p>'+unknown+' unchecked or not configured · '+(total-healthy-unknown)+' need attention</p><small>Health coverage, not an uptime SLA. Checks cache for up to 60 seconds.</small></div>';
 $('infra-cards').innerHTML=infraRows.map((r,i)=>'<article class="infra-card"><h3>'+esc(r.name)+'</h3><span class="infra-state" data-state="'+esc(r.status)+'">'+esc(r.status.replaceAll('_',' '))+'</span><p>'+esc(r.note||'Awaiting read-only check.')+'</p><small>'+esc(r.scope)+' · '+(r.checked_at?esc(new Date(r.checked_at).toLocaleString()):'Not checked')+'</small>'+(r.metrics||[]).map(m=>{const valid=Number.isFinite(m.used),limit=Number.isFinite(m.limit)&&m.limit>0,p=limit&&valid?100*m.used/m.limit:null;return '<div class="infra-metric">'+(p===null?'':infraDonut(p,m.label+': '+Math.round(p)+'% used'))+'<div><strong>'+esc(m.label)+'</strong><div>'+esc(m.unit==='bytes'?infraBytes(m.used):String(m.used))+(limit?' / '+esc(m.unit==='bytes'?infraBytes(m.limit):String(m.limit)):' · limit unknown')+'</div><small>'+esc(m.source)+'</small></div></div>';}).join('')+'<p class="sub">'+esc(r.quota_note||'')+'</p>'+(r.scope==='control'&&r.id.startsWith('b2:')?'<button class="btn" data-b2-open="'+i+'">Manage files</button>':'')+'</article>').join('');
}
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
  if(run===infraRun&&epoch===authEpoch)$('infra-progress').textContent='Checks finished · '+new Date().toLocaleTimeString();
 }catch(e){if(epoch===authEpoch)infraError('infra-error',e);}
 finally{if(run===infraRun&&epoch===authEpoch)$('infra-refresh').disabled=false;}
}
function setB2Busy(busy){b2Busy=busy;for(const id of ['b2-reload','b2-more','b2-review','b2-clear'])$(id).disabled=busy;renderB2();}
function renderB2(){
 const q=$('b2-search').value.toLowerCase(),sort=$('b2-sort').value;
 const rows=b2Rows.filter(r=>r.name.toLowerCase().includes(q)).sort((a,b)=>sort==='size-asc'?a.size-b.size:sort==='name'?a.name.localeCompare(b.name):sort==='newest'?b.uploaded_at-a.uploaded_at:b.size-a.size);
 $('b2-rows').innerHTML=rows.slice(0,b2Visible).map(r=>'<tr><td><input type="checkbox" data-b2-id="'+esc(r.file_id)+'" aria-label="Select '+esc(r.name)+' version '+esc(r.file_id)+'" '+(b2Selection.has(r.file_id)?'checked ':'')+(b2Busy||!r.ticket||!b2CanDelete?'disabled':'')+'></td><td>'+esc(r.name)+'<br><small>'+esc(r.file_id)+'</small></td><td>'+esc(infraBytes(r.size))+'</td><td>'+esc(new Date(r.uploaded_at).toISOString())+'</td><td>'+esc(r.action)+'</td></tr>').join('');
 $('b2-show-more').hidden=rows.length<=b2Visible;
 $('b2-review').disabled=b2Busy||!b2CanDelete||!b2Selection.size;
 $('b2-more').disabled=b2Busy||!b2Cursor;
 const selected=b2Rows.filter(r=>b2Selection.has(r.file_id)),bytes=b2Rows.filter(r=>r.action==='upload').reduce((n,r)=>n+r.size,0);
 $('b2-usage').innerHTML=b2Budget&&b2Complete?'<div class="infra-summary">'+infraDonut(100*bytes/b2Budget,'Listed uploaded version bytes against operator storage budget')+'<span>Listed version storage / operator budget</span></div>':'';
 $('b2-selected').textContent=selected.length+' / 10 selected · '+infraBytes(selected.reduce((n,r)=>n+r.size,0));
 $('b2-progress').textContent=(b2Busy?'Working… · ':'')+b2Rows.length+' versions loaded · '+infraBytes(bytes)+' in uploaded versions · '+(b2Complete?'Listing complete at read time':'PARTIAL listing: load remaining pages for whole-bucket size ordering')+(b2Budget?' · operator storage budget '+infraBytes(b2Budget):' · storage budget unknown')+(!b2CanDelete?' · deletion unavailable (readFiles/deleteFiles capability required)':'');
}
async function loadB2(reset=false){
 if(b2Busy||!b2Slot)return;const generation=b2Generation,epoch=authEpoch;
 if(reset){b2Rows=[];b2Selection.clear();b2Cursor=null;b2Complete=false;b2Plan=null;b2Visible=100;$('b2-results').textContent='';}
 $('b2-error').textContent='';setB2Busy(true);
 try{const d=await infraRequest('control','/b2/files?'+new URLSearchParams({slot:b2Slot,...(b2Cursor?{cursor:b2Cursor}:{})}));if(epoch!==authEpoch||generation!==b2Generation)return;
  const existing=new Map(b2Rows.map(r=>[r.file_id,r]));for(const r of d.rows)existing.set(r.file_id,r);b2Rows=[...existing.values()];b2Cursor=d.next_cursor;b2Complete=!d.next_cursor;b2CanDelete=d.can_delete;b2Budget=d.storage_budget;
  $('b2-scope').textContent='Slot '+b2Slot+' · bucket '+d.bucket+(d.prefix?' · restricted prefix '+d.prefix:'')+' · '+d.scope;
 }catch(e){if(epoch===authEpoch&&generation===b2Generation)infraError('b2-error',e);}
 finally{if(epoch===authEpoch&&generation===b2Generation)setB2Busy(false);}
}
async function openB2(slot){if(b2Busy){$('b2-error').textContent='Wait for the current file operation to finish.';return;}b2Generation++;b2Slot=slot;$('b2-sort').value='size-desc';$('b2-search').value='';$('b2-manager').classList.remove('hidden');$('b2-manager').scrollIntoView({behavior:'smooth'});await loadB2(true);const generation=b2Generation;for(let pages=1;pages<20&&b2Cursor&&generation===b2Generation&&!$('infra-view').classList.contains('hidden');pages++){const count=b2Rows.length;await loadB2(false);if(b2Rows.length===count)break;}}
$('infra-cards').addEventListener('click',e=>{const b=e.target.closest('[data-b2-open]');if(b)openB2(infraRows[Number(b.dataset.b2Open)].id.slice(3));});
$('b2-rows').addEventListener('change',e=>{const id=e.target.dataset.b2Id;if(!id||b2Busy)return;if(e.target.checked){if(b2Selection.size>=10){e.target.checked=false;$('b2-error').textContent='Select at most 10 versions per confirmation.';return;}b2Selection.add(id);}else b2Selection.delete(id);b2Plan=null;renderB2();});
$('b2-search').oninput=()=>{b2Visible=100;renderB2();};$('b2-sort').onchange=()=>{b2Visible=100;renderB2();};
$('b2-show-more').onclick=()=>{b2Visible+=100;renderB2();};$('b2-reload').onclick=()=>loadB2(true);$('b2-more').onclick=()=>loadB2(false);$('b2-clear').onclick=()=>{b2Selection.clear();b2Plan=null;renderB2();};
$('b2-review').onclick=async()=>{
 if(b2Busy||!b2Selection.size)return;const epoch=authEpoch,generation=b2Generation;setB2Busy(true);$('b2-error').textContent='';
 try{const d=await infraRequest('control','/b2/preview',{slot:b2Slot,tickets:b2Rows.filter(r=>b2Selection.has(r.file_id)).map(r=>r.ticket)});if(epoch!==authEpoch||generation!==b2Generation)return;b2Plan=d;
  $('b2-confirm-summary').textContent=d.rows.length+' versions · '+infraBytes(d.bytes)+' · bucket '+d.bucket+'. Type '+d.confirmation+' to confirm. Review expires in 10 minutes.';
  $('b2-confirm-files').innerHTML=d.rows.map(r=>'<li>'+esc(r.name)+' · '+esc(infraBytes(r.size))+'<br><small>'+esc(r.file_id)+'</small></li>').join('');$('b2-confirm-input').value='';$('b2-delete').disabled=true;$('b2-confirm').showModal();$('b2-confirm-input').focus();
 }catch(e){if(epoch===authEpoch)infraError('b2-error',e);}finally{if(epoch===authEpoch&&generation===b2Generation)setB2Busy(false);}
};
$('b2-confirm-input').oninput=()=>{$('b2-delete').disabled=!b2Plan||$('b2-confirm-input').value!==b2Plan.confirmation;};
$('b2-cancel').onclick=()=>{b2Plan=null;$('b2-confirm').close?.();};$('b2-confirm').addEventListener('cancel',()=>{b2Plan=null;});
$('b2-delete').onclick=async()=>{
 if(b2Busy||!b2Plan||$('b2-confirm-input').value!==b2Plan.confirmation)return;
 const epoch=authEpoch,generation=b2Generation,plan=b2Plan;b2Plan=null;$('b2-confirm').close?.();setB2Busy(true);$('b2-error').textContent='';
 try{const d=await infraRequest('control','/b2/delete',{slot:b2Slot,plan:plan.plan,confirmation:plan.confirmation});if(epoch!==authEpoch||generation!==b2Generation)return;
  $('b2-results').textContent=d.results.map(r=>r.status.toUpperCase()+' · '+r.name+' · '+r.file_id).join('\n')+'\n'+d.instruction;
 }catch(e){if(epoch===authEpoch){$('b2-results').textContent='Deletion outcome may be unknown. Refresh files to reconcile; nothing is automatically retried.';infraError('b2-error',e);}}
 finally{if(epoch===authEpoch&&generation===b2Generation){b2Selection.clear();b2CanDelete=false;b2Cursor=null;b2Complete=false;setB2Busy(false);}}
};
$('infra-refresh').onclick=loadInfra;
const infraOldTab=tab;
tab=function(which){$('infra-view').classList.toggle('hidden',which!=='infra');$('tab-infra').setAttribute('aria-selected',which==='infra');if(which==='infra'){banner();cancelCleanupRetry();stopAutoPreviews();for(const name of ['failures','producers','meta']){$('tab-'+name).setAttribute('aria-selected','false');$(name==='failures'?'failure-view':name==='producers'?'producer-view':'meta-view').classList.add('hidden');}if(!infraRows.length)loadInfra();}else infraOldTab(which);};
$('tab-infra').onclick=()=>tab('infra');
const infraOldLock=lock;
lock=function(){infraRun++;b2Generation++;for(const c of infraControllers)c.abort();infraControllers.clear();infraRows=[];b2Rows=[];b2Selection.clear();b2Slot='';b2Cursor=null;b2Plan=null;b2Busy=false;b2CanDelete=false;$('b2-confirm').close?.();$('infra-view').classList.add('hidden');$('b2-manager').classList.add('hidden');$('infra-refresh').disabled=false;for(const id of ['infra-cards','infra-summary','infra-coverage','infra-progress','infra-error','b2-rows','b2-results','b2-error','b2-scope','b2-confirm-files','b2-confirm-summary','b2-progress','b2-selected','b2-usage'])$(id).replaceChildren();$('b2-confirm-input').value='';infraOldLock();$('failure-view').classList.remove('hidden');$('tab-failures').setAttribute('aria-selected','true');$('tab-infra').setAttribute('aria-selected','false');};
