import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import worker from './worker.js';
const source=fs.readFileSync(new URL('./b2-references.js',import.meta.url),'utf8');
const ui=fs.readFileSync(new URL('./b2-reference-view.js',import.meta.url),'utf8');
function ctx(){const nodes={};const c={URL,URLSearchParams,AbortSignal,Date,Map,Set,JSON,console,setTimeout,clearTimeout,$:id=>nodes[id]??=( {value:'',textContent:'',disabled:false}),esc:String};vm.createContext(c);vm.runInContext(source+'\n'+ui,c);return c;}
const cell=v=>({effectiveValue:{stringValue:v}}),head=['file_url','status'].map(cell);
const objects=[{file_id:'id-1',name:'folder/a b.mp4'},{file_id:'id-2',name:'folder/a b.mp4'},{file_id:'id-3',name:'folder/a b.mp4.extra'}];
const sheet={id:1,title:'Streamables',mode:'included',designated:true,header_row:1,default_bucket:null};
function match(c,rows,s=sheet,h=head){return c.b2MatchCells(s,h,rows.map(r=>({values:r.map(x=>typeof x==='object'?x:cell(x))})),1,'bucket',objects);}
function scan(refs=[],issues=[]){return {complete:true,finished_at:new Date().toISOString(),references:refs,issues};}
const obj={...objects[0],action:'upload'};
test('native, path-style S3 and virtual-host S3 URLs preserve exact bucket/key and decode once',()=>{
 const c=ctx();for(const u of ['https://f005.backblazeb2.com/file/bucket/folder/a%20b.mp4?Authorization=SECRET','https://s3.us-west-004.backblazeb2.com/bucket/folder/a%20b.mp4','https://bucket.s3.us-west-004.backblazeb2.com/folder/a%20b.mp4']){const x=c.b2Identity(u);assert.equal(x.bucket,'bucket');assert.equal(x.name,'folder/a b.mp4');}
 assert.equal(c.b2Identity('https://f005.backblazeb2.com/file/bucket/a%252Fb').name,'a%2Fb');
 assert.equal(c.b2Identity('https://f005.backblazeb2.com/file/bucket/a/../b').name,'a/../b');
 assert.equal(c.b2Identity('https://f005.backblazeb2.com/file/bucket/a+b').name,'a+b');
 assert.equal(c.b2Identity('https://backblazeb2.com.evil.test/file/bucket/a').unknown_url,true);
});
test('no basename/substrings, case folding, path collapse, or different bucket matches',()=>{
 const c=ctx();for(const v of ['a b.mp4','folder/A b.mp4','https://f005.backblazeb2.com/file/other/folder/a%20b.mp4','folder/a b.mp4-extra'])assert.equal(match(c,[[v,'uploaded']]).references.length,0);
});
test('path refs protect all versions; exact ID refs conservatively protect the entire object key',()=>{
 const c=ctx();for(const v of ['https://f005.backblazeb2.com/file/bucket/folder/a%20b.mp4','id-1','https://api005.backblazeb2.com/b2api/v3/b2_download_file_by_id?fileId=id-1']){
 const d=match(c,[[v,'uploaded']]);assert.equal(d.references.length,2);assert.equal(d.references[0].row,2);assert.equal(d.references[0].column,'file_url');assert.equal(d.issues.length,0);
 }
});
test('plain paths require verified bucket context; unresolved paths cannot authorize eligibility',()=>{
 const c=ctx(),d=match(c,[['folder/a b.mp4','uploaded']]);assert.equal(d.references[0].uncertain,true);assert.equal(c.b2Classify(obj,scan(d.references)).deletion_eligibility,'Unable to determine');
 const good=match(c,[['folder/a b.mp4','uploaded']],{...sheet,default_bucket:'bucket'});assert.equal(good.references[0].uncertain,false);assert.equal(c.b2Classify(obj,scan(good.references)).deletion_eligibility,'Eligible');
});
test('exact uploaded status only, including missing/error/duplicate status columns',()=>{
 const c=ctx();for(const status of ['uploaded','Uploaded','UPLOADED',' uploaded','uploaded ','processing','',true,1,null]){
 const d=match(c,[['id-1',{effectiveValue:typeof status==='string'?{stringValue:status}:typeof status==='number'?{numberValue:status}:typeof status==='boolean'?{boolValue:status}:{}}]]);
 const out=c.b2Classify(obj,scan(d.references));assert.equal(out.deletion_eligibility,status==='uploaded'?'Eligible':'Ineligible',String(status));if(status!=='uploaded')assert.match(out.deletion_ineligibility_reason,/row: 2/);
 }
 for(const headers of [['file_url'],['file_url','Status'],['file_url','status','status']])assert.equal(c.b2Classify(obj,scan(match(c,[['id-1','uploaded']],sheet,headers.map(cell)).references)).deletion_eligibility,'Ineligible');
});
test('all combinations of designated and non-designated references, all reasons retained',()=>{
 const c=ctx();for(const a of ['uploaded','processing'])for(const b of ['uploaded','queued'])for(const archive of [false,true]){
 let refs=[...match(c,[['id-1',a]]).references,...match(c,[['id-1',b]],{...sheet,id:2,title:'Streamables-VT'}).references];
 if(archive)refs.push(...match(c,[['id-1','uploaded']],{...sheet,id:3,title:'Archive',designated:false}).references);
 const d=c.b2Classify(obj,scan(refs));assert.equal(d.workbook_references.length,archive?3:2);assert.equal(d.deletion_eligibility,a==='uploaded'&&b==='uploaded'&&!archive?'Eligible':'Ineligible');
 if(a!=='uploaded')assert.match(d.deletion_ineligibility_reason,/Streamables, column/);if(b!=='uploaded')assert.match(d.deletion_ineligibility_reason,/Streamables-VT/);if(archive)assert.match(d.deletion_ineligibility_reason,/Archive.*overriding/);
 }
});
test('only complete, fresh, issue-free scans may declare objects unreferenced/eligible',()=>{
 const c=ctx();assert.equal(c.b2Classify(obj,scan()).deletion_eligibility,'Eligible');
 for(const s of [null,{...scan(),complete:false},{...scan(),finished_at:new Date(Date.now()-600001).toISOString()},scan([],[{sheet:'Unknown',reason:'scan failed'}])]){const d=c.b2Classify(obj,s);assert.equal(d.deletion_eligibility,'Unable to determine');assert.match(d.workbook_reference_status,/Unknown/);assert.ok(d.deletion_ineligibility_reason);}
 assert.equal(c.b2Classify({...obj,action:'hide'},scan()).deletion_eligibility,'Ineligible');
});
test('hyperlinks, rich-text links and JSON refs deduplicate per cell without losing other coordinates',()=>{
 const c=ctx(),url='https://f005.backblazeb2.com/file/bucket/folder/a%20b.mp4';
 const d=match(c,[[{...cell(url),hyperlink:url,textFormatRuns:[{format:{link:{uri:url}}}]},'uploaded'],[JSON.stringify({items:[url]}),'uploaded']]);
 assert.equal(d.issues.length,0);assert.equal(d.references.length,4);assert.deepEqual(Array.from(new Set(d.references.map(r=>r.row))),[2,3]);
});
test('malformed B2 URL, unresolved IDs and formula errors block no-reference classification',()=>{
 const c=ctx();for(const v of ['https://f005.backblazeb2.com/file/bucket/%ZZ','https://api005.backblazeb2.com/b2api/v3/b2_download_file_by_id?fileId=missing',{effectiveValue:{errorValue:{type:'REF'}}}]){const d=match(c,[[v,'uploaded']]);assert.ok(d.issues.length);assert.equal(c.b2Classify(obj,scan(d.references,d.issues)).deletion_eligibility,'Unable to determine');}
});
test('padlock rule discovers unprotected tabs and excludes whole-sheet protection without operator flags',()=>{
 const c=ctx(),s={properties:{sheetId:7,title:'streamables-yt',gridProperties:{rowCount:1000,columnCount:70}}},policy={sheets:{}};
 assert.equal(c.b2SheetInfo(s,policy).mode,'included');assert.equal(c.b2SheetInfo(s,policy).designated,true);
 for(const title of ['streamables','streamables-yt','Archive','streamables-VT'])assert.equal(c.b2SheetInfo({...s,properties:{...s.properties,title}},policy).designated,['streamables','streamables-yt'].includes(title));
 for(const warningOnly of [true,false])for(const range of [{sheetId:7},{sheetId:7,startRowIndex:0,endRowIndex:1000,startColumnIndex:0,endColumnIndex:70}])assert.equal(c.b2SheetInfo({...s,protectedRanges:[{range,warningOnly}]},policy).mode,'excluded');
 assert.equal(c.b2SheetInfo({...s,protectedRanges:[{range:{sheetId:7,startRowIndex:1,endRowIndex:2}}]},policy).mode,'included');
 assert.equal(c.b2SheetInfo({...s,properties:{...s.properties,title:'New tab'}},policy).mode,'included');
});
test('reference and eligibility filters combine rather than replacing each other',()=>{
 const c=ctx();c.$('b2-reference-filter').value='Referenced';c.$('b2-eligibility-filter').value='Eligible';
 assert.equal(c.b2ReferenceFilter({workbook_reference_status:'Referenced',deletion_eligibility:'Eligible'}),true);
 assert.equal(c.b2ReferenceFilter({workbook_reference_status:'Unreferenced',deletion_eligibility:'Eligible'}),false);
 assert.equal(c.b2ReferenceFilter({workbook_reference_status:'Referenced',deletion_eligibility:'Ineligible'}),false);
});
test('actual Worker routes use existing auth, scan all columns beyond AZ, and return reference-only evidence',async()=>{
 const env={DASHBOARD_TOKEN:'fixture',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_REFRESH_TOKEN:'fixture',GOOGLE_SHEETS_SPREADSHEET_ID:'book',OPS_B2_WORKBOOK_POLICY_JSON:JSON.stringify({version:1,workbook_id:'book',sheets:{1:{title:'Streamables',mode:'include',no_log_button:true,unlocked:true}}})};
 const old=globalThis.fetch,calls=[];globalThis.fetch=async(url,opt)=>{
  calls.push([url,opt]);if(url==='https://oauth2.googleapis.com/token')return Response.json({access_token:'fixture'});
  const u=new URL(url),range=u.searchParams.get('ranges');assert.equal(opt.method,undefined);assert.equal(opt.redirect,'manual');
  if(!range)return Response.json({spreadsheetId:'book',sheets:[{properties:{sheetId:1,title:'Streamables',gridProperties:{rowCount:2,columnCount:60}}}]});
  assert.match(range,/BH/);const mask=u.searchParams.get('fields');assert.equal((mask.match(/\(/g)||[]).length,(mask.match(/\)/g)||[]).length);
  const h=Array.from({length:60},()=>cell(''));h[0]=cell('status');h[59]=cell('b2_url');const data=Array.from({length:60},()=>cell(''));data[0]=cell('uploaded');data[59]=cell('https://f005.backblazeb2.com/file/bucket/folder/a%20b.mp4');
  return Response.json({sheets:[{properties:{sheetId:1},data:[{rowData:range.endsWith('BH1')?[{values:h}]:[{values:h},{values:data}]}]}]});
 };
 const req=(path,payload,auth='fixture')=>new Request('https://desk.test/api/infra/control'+path,{method:payload?'POST':'GET',headers:{Authorization:'Bearer '+auth},...(payload?{body:JSON.stringify(payload)}:{})});
 try{
  assert.equal((await worker.fetch(req('/b2/workbook',null,'bad'),env,{})).status,401);assert.equal(calls.length,0);
  const meta=await (await worker.fetch(req('/b2/workbook'),env,{})).json();assert.equal(meta.sheets.length,1);
  const r=await worker.fetch(req('/b2/reference-scan',{fingerprint:meta.fingerprint,sheet_id:1,start_row:0,bucket:'bucket',objects}),env,{});assert.equal(r.status,200);const result=await r.json();assert.equal(result.references.length,2);assert.equal(result.references[0].column,'b2_url');assert.equal(result.references[0].row,2);assert.equal(result.next_row,null);assert.equal(result.references[0].cell,'BH2');assert.equal(result.references[0].a1_location,"'Streamables'!BH2");assert.equal(result.references[0].cell_url,'https://docs.google.com/spreadsheets/d/book/edit#gid=1&range=BH2');
  const bad=await worker.fetch(req('/b2/reference-scan',{fingerprint:'old'}),env,{});assert.equal(bad.status,409);
  assert.ok(calls.every(([u])=>!u.includes('delete')&&!u.includes('batchUpdate')));
 }finally{globalThis.fetch=old;}
});

test('canonical cell links escape sheet titles and retain each separate coordinate',()=>{
 const c=ctx();const refs=[{sheet:"Owner's archive",sheet_id:9,column:'file_url',column_letter:'BC',row:42},{sheet:'Other',sheet_id:10,column:'b2_path',column_letter:'AA',row:18}].map(r=>c.b2ReferenceCoordinates(r,'book_123'));
 assert.equal(refs[0].a1_location,"'Owner''s archive'!BC42");
 assert.equal(refs[0].cell_url,'https://docs.google.com/spreadsheets/d/book_123/edit#gid=9&range=BC42');
 assert.equal(refs[1].cell_url,'https://docs.google.com/spreadsheets/d/book_123/edit#gid=10&range=AA18');
 for(const r of refs){assert.match(c.b2ReferenceLink(r),/target="_blank" rel="noopener noreferrer"/);assert.ok(c.b2ReferenceLink(r).includes(r.cell_url));}
 assert.doesNotMatch(c.b2ReferenceLink({...refs[0],cell_url:'javascript:alert(1)'}),/<a /);
});

test('JSON control data cannot become a file reference column heading',()=>{
 const c=ctx(),value=JSON.stringify({revision:12221,recent:[{id:'foo',digest:'bar'}]});
 const d=c.b2MatchCells({...sheet,title:'internal',designated:false},[cell('control'),cell(value)],[{values:[cell('control'),cell(value)]}],0,'bucket',objects);
 assert.equal(d.issues.length,0);assert.equal(d.references.length,0);
});
test('read-only retry waits on 429 and preserves the same chunk; non-quota failures do not retry',async()=>{
 const c=ctx();let calls=0,waits=[];c.infraRequest=async()=>{if(++calls===1)throw Error('b2_workbook_http_429');return {ok:true};};c.b2ReferencePause=async ms=>waits.push(ms);
 assert.equal((await c.b2ReferenceRead(()=>true,'/b2/reference-scan',{start_row:0})).ok,true);assert.equal(calls,2);assert.deepEqual(waits,[65000]);
 calls=0;c.infraRequest=async()=>{calls++;throw Error('b2_workbook_http_403')};await assert.rejects(c.b2ReferenceRead(()=>true,'/b2/workbook'),/403/);assert.equal(calls,1);
 await assert.rejects(c.b2ReferenceRead(()=>true,'/b2/delete',{}),/Not a read-only/);
});

test('reference header labels are not unresolved file values',()=>{
 const c=ctx();const d=c.b2MatchCells(sheet,head,[{values:head}],0,'bucket',objects);assert.equal(d.issues.length,0);
});
