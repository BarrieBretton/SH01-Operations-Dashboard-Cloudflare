// Session-only, read-only evidence; never sent as authorization to delete.
let b2Workbook=null,b2ReferenceScan=null,b2ReferenceBusy=false,b2ReferenceRun=0,b2Bucket='',b2ReferenceExpiry=null;
function b2ResetReferences(){
 b2ReferenceRun++;b2Workbook=null;b2ReferenceScan=null;b2ReferenceBusy=false;clearTimeout(b2ReferenceExpiry);b2ReferenceExpiry=null;
 b2Selection.clear();b2Plan=null;
 $('b2-workbook-report').textContent='Workbook not scanned. All files require manual review.';
 $('b2-scan-references').disabled=false;
}
function b2ReferenceLocation(r){return r.sheet+', column: '+r.column+' ('+r.column_letter+'), row: '+r.row;}
function b2Classify(row,scan){
 if(scan&&scan._indexed_count!==scan.references.length){scan._index=new Map();for(const ref of scan.references){if(!scan._index.has(ref.file_id))scan._index.set(ref.file_id,[]);scan._index.get(ref.file_id).push(ref);}scan._indexed_count=scan.references.length;}
 const refs=scan?scan._index.get(row.file_id)||[]:[],reasons=[];
 for(const r of refs){
  const loc='Referenced in '+b2ReferenceLocation(r);
  if(r.uncertain)reasons.push(loc+'. Manual review required: '+r.resolution+'.');
  if(!r.designated)reasons.push(loc+'. Deletion prohibited because references from non-designated sheets are always protected, overriding any uploaded reference elsewhere.');
  else if(r.status_problem||r.status!=='uploaded')reasons.push(loc+'; status: '+(r.status===null?'missing / ambiguous':JSON.stringify(r.status))+'. Deletion prohibited because the exact status must be uploaded.'+(r.status_problem?' '+r.status_problem+'.':''));
 }
 const fresh=scan?.finished_at&&Date.now()-Date.parse(scan.finished_at)<600000;
 if(!scan?.complete||!fresh)reasons.push('Manual review required: workbook evidence is incomplete, unavailable or expired. Refresh the workbook scan.');
 if(scan?.issues?.length)reasons.push('Manual review required: '+scan.issues.length+' unresolved workbook issue(s). The Workbook discovery & scan evidence report identifies every affected sheet/cell and reason; unmatched objects cannot be declared safe.');
 if(row.action!=='upload')reasons.push('This row is a '+row.action+' marker, not a deletable uploaded file version.');
 const uncertain=!scan?.complete||!fresh||!!scan?.issues?.length||refs.some(r=>r.uncertain);
 return {workbook_reference_status:refs.length?'Referenced':uncertain?'Unknown — manual review':'Unreferenced',workbook_references:refs,
  deletion_eligibility:row.action!=='upload'||refs.some(r=>!r.uncertain&&(!r.designated||r.status_problem||r.status!=='uploaded'))?'Ineligible':uncertain?'Unable to determine':'Eligible',deletion_ineligibility_reason:reasons.join('\n'),manual_review:uncertain};
}
function b2ReferenceFilter(row){
 const reference=$('b2-reference-filter').value,eligibility=$('b2-eligibility-filter').value;
 return (!reference||row.workbook_reference_status===reference)&&(!eligibility||row.deletion_eligibility===eligibility);
}
function b2ReferenceLink(r){
 const label=b2ReferenceLocation(r)+(r.a1_location?' · '+r.a1_location:'');
 const safe=typeof r.cell_url==='string'&&/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]+\/edit#gid=\d+&range=[A-Z]+[1-9]\d*$/.test(r.cell_url);
 return safe?'<a href="'+esc(r.cell_url)+'" target="_blank" rel="noopener noreferrer">'+esc(label)+' ↗</a>':esc(label);
}
function b2ReferenceCells(row){return '<td>'+esc(row.workbook_reference_status)+'</td><td>'+row.workbook_references.map(r=>b2ReferenceLink(r)+'<br><small>Status: '+esc(r.status===null?'missing / ambiguous':JSON.stringify(r.status))+'</small>').join('<br>')+'</td><td><strong>'+esc(row.deletion_eligibility)+'</strong>'+(row.manual_review?'<br><small>Manual review required</small>':'')+'</td><td class="b2-reference-reasons">'+esc(row.deletion_ineligibility_reason||'N/A')+'</td>';}
function b2RenderWorkbook(){
 const scan=b2ReferenceScan,m=b2Workbook;
 $('b2-workbook-report').textContent=(m?m.sheets.map(s=>s.title+' [sheet ID '+s.id+'] — '+s.mode+'; '+s.reason+(s.designated?' Uploaded-only designation verified.':'')+' '+s.rows+' rows × '+s.columns+' columns.').join('\n'):'Workbook inventory unavailable.')+'\n\n'+(scan?'Scan: '+(scan.complete?'complete':'incomplete')+'; '+scan.references.length+' object/reference matches; '+scan.issues.length+' unresolved issues.\nStarted: '+scan.started_at+'\nFinished: '+(scan.finished_at||'scanning')+'\n'+scan.issues.map(i=>(i.sheet||'Workbook')+(i.column?' / '+i.column:'')+(i.row?' / row '+i.row:'')+': '+i.reason).join('\n'):'No scan evidence.')+'\n'+(scan?.coverage||[]).map(c=>c.sheet+': '+c.status+' · '+(c.rows_read||0)+' rows read').join('\n')+'\nEvidence expires after 10 minutes. Eligibility is not deletion authorization.';
}
// Retries are confined to read-only workbook endpoints. No mutation is retried.
async function b2ReferencePause(ms,current){
 for(let remaining=ms;remaining>0;remaining-=1000){if(!current())throw new DOMException('Scan cancelled','AbortError');await new Promise(resolve=>setTimeout(resolve,Math.min(1000,remaining)));}
 if(!current())throw new DOMException('Scan cancelled','AbortError');
}
async function b2ReferenceRead(current,path,payload){
 if(!['/b2/workbook','/b2/reference-scan'].includes(path))throw Error('Not a read-only workbook route');
 for(let attempt=0;attempt<3;attempt++){
  if(!current())throw new DOMException('Scan cancelled','AbortError');
  try{return await infraRequest('control',path,payload);}catch(e){
   if(!/^(b2_workbook_http_429|google_http_429)$/.test(e.message)||attempt===2)throw e;
   $('b2-workbook-report').textContent+='\nGoogle read quota reached. Pausing '+(65*(attempt+1))+' seconds before retrying this read.';
   await b2ReferencePause(65000*(attempt+1),current);
  }
 }
}
async function b2ScanWorkbook(){
 if(b2ReferenceBusy||b2Busy||!b2Complete||!b2Bucket)return;
 b2ResetReferences();const run=++b2ReferenceRun,generation=b2Generation,epoch=authEpoch;
 const current=()=>run===b2ReferenceRun&&generation===b2Generation&&epoch===authEpoch;
 b2ReferenceBusy=true;$('b2-scan-references').disabled=true;
 const scan={complete:false,references:[],issues:[],started_at:new Date().toISOString(),finished_at:null};b2ReferenceScan=scan;
 renderB2();
 try{
  const meta=await b2ReferenceRead(current,'/b2/workbook');if(!current())return;b2Workbook=meta;
  scan.issues.push(...meta.issues);b2RenderWorkbook();
  const objects=b2Rows.map(r=>({file_id:r.file_id,name:r.name}));
  if(objects.length>10000||JSON.stringify(objects).length>800000)throw Error('Inventory exceeds the bounded scan size. All files remain protected; narrow the configured B2 prefix.');
  let requests=0;scan.coverage=[];
  for(const sheet of [...meta.sheets].sort((a,b)=>Number(!!b.designated)-Number(!!a.designated)||a.id-b.id)){
   if(sheet.mode==='excluded'){scan.coverage.push({sheet:sheet.title,status:'excluded'});continue;}
   if(sheet.type!=='GRID'||!sheet.rows||!sheet.columns){scan.issues.push({sheet:sheet.title,reason:'Unsupported or unknown grid; manual review required.'});continue;}
   let start=0;const coverage={sheet:sheet.title,status:'scanning',rows_read:0};scan.coverage.push(coverage);
   try{
   while(start!==null){
    if(++requests>100)throw Error('Scan request limit reached; not all workbook cells were inspected.');
    if(requests>1)await b2ReferencePause(4000,current);
    const d=await b2ReferenceRead(current,'/b2/reference-scan',{bucket:b2Bucket,objects,fingerprint:meta.fingerprint,sheet_id:sheet.id,start_row:start});
    if(!current())return;
    if(d.fingerprint!==meta.fingerprint||d.sheet_id!==sheet.id||d.start_row!==start||!Number.isInteger(d.end_row)||d.end_row<=start||d.end_row>sheet.rows||d.next_row!==(d.end_row<sheet.rows?d.end_row:null)||!Array.isArray(d.references)||!Array.isArray(d.issues))throw Error('Incomplete workbook scan response; restart required.');
    scan.references.push(...d.references);scan.issues.push(...d.issues);start=d.next_row;coverage.rows_read=d.end_row;scan.last_read_at=d.observed_at;
    if(scan.references.length+scan.issues.length>50000)throw Error('Reference report size limit reached; all files remain protected.');
    b2RenderWorkbook();renderB2();
   }
   coverage.status='complete';
   }catch(e){if(!current())return;coverage.status='failed';scan.issues.push({sheet:sheet.title,reason:e.message||'Sheet read failed'});b2RenderWorkbook();}
  }
  const after=await b2ReferenceRead(current,'/b2/workbook');if(!current())return;
  if(after.fingerprint!==meta.fingerprint)throw Error('Workbook tabs or policy changed during scanning. Restart the scan.');
  scan.complete=scan.coverage.every(s=>['complete','excluded'].includes(s.status));scan.finished_at=new Date().toISOString();
  b2ReferenceExpiry=setTimeout(()=>{if(current()){b2Selection.clear();renderB2();$('b2-workbook-report').textContent+='\nEXPIRED — refresh workbook evidence.';}},600000);
 }catch(e){if(!current())return;scan.issues.push({reason:e.message||'Workbook scan failed.'});scan.finished_at=new Date().toISOString();}
 finally{if(current()){b2ReferenceBusy=false;$('b2-scan-references').disabled=false;b2RenderWorkbook();renderB2();}}
}
$('b2-scan-references').onclick=b2ScanWorkbook;
$('b2-reference-filter').onchange=$('b2-eligibility-filter').onchange=()=>{b2Visible=100;renderB2();};
$('b2-download-audit').onclick=()=>{
 const report={version:'workbook-references-v1',bucket:b2Bucket,inventory_complete:b2Complete,workbook:b2Workbook,scan:b2ReferenceScan?{...b2ReferenceScan,_index:undefined,_indexed_count:undefined}:null,objects:b2Rows.map(r=>({file_id:r.file_id,name:r.name,...b2Classify(r,b2ReferenceScan)})),note:'Read-only evidence. Not deletion authorization.'};
 const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));a.href=url;a.download='b2-workbook-reference-audit.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),0);
};
