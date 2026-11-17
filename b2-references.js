// Read-only workbook evidence. These labels are never authorization to delete.
const B2_REFERENCE_VERSION='workbook-references-v1';
function b2Column(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
function b2Value(c){return c?.effectiveValue?.stringValue??c?.effectiveValue?.numberValue??c?.effectiveValue?.boolValue??c?.userEnteredValue?.stringValue??'';}
function b2Policy(env){
 if(!env.OPS_B2_WORKBOOK_POLICY_JSON)return {sheets:{}};
 let p;try{p=JSON.parse(env.OPS_B2_WORKBOOK_POLICY_JSON)}catch{throw Error('b2_workbook_policy_invalid')}
 if(p.version!==1||p.workbook_id!==env.GOOGLE_SHEETS_SPREADSHEET_ID||!p.sheets||Array.isArray(p.sheets))throw Error('b2_workbook_policy_invalid');
 return p;
}
function b2SheetInfo(s,policy){
 const p=s.properties,c=policy.sheets[String(p.sheetId)],protections=s.protectedRanges||[];
 const whole=protections.some(r=>r.range&&(r.range.startRowIndex??0)===0&&(r.range.startColumnIndex??0)===0&&
  (r.range.endRowIndex===undefined||r.range.endRowIndex>=p.gridProperties?.rowCount)&&
  (r.range.endColumnIndex===undefined||r.range.endColumnIndex>=p.gridProperties?.columnCount));
 // The operator meant sheet-tab protection, not a separate Log button.
 // Partial ranges are retained in matching; they do not exclude an entire sheet.
 const mode=whole?'excluded':'included';
 const reason=whole?'Whole-sheet protection: excluded by the padlock-sheet rule.':'No whole-sheet protection: included in workbook matching.';
 const header=c?.title===p.title&&Number.isInteger(c?.header_row)&&c.header_row>0?c.header_row:1;
 return {id:p.sheetId,title:p.title,mode,reason,header_row:header,rows:p.gridProperties?.rowCount||0,columns:p.gridProperties?.columnCount||0,
  designated:mode==='included'&&(['streamables','streamables-yt'].includes(p.title)),
  default_bucket:mode==='included'&&c?.title===p.title&&typeof c?.default_bucket==='string'?c.default_bucket:null,
  type:p.sheetType||'GRID',has_protection:!!protections.length};
}
async function b2SheetGet(env,token,query){
 const url='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)+'?'+new URLSearchParams(query);
 const r=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('b2_workbook_http_'+r.status);
 let d;try{d=await r.json()}catch{throw Error('b2_workbook_invalid_json')}
 return d;
}
async function b2WorkbookMetadata(env,token){
 const policy=b2Policy(env),d=await b2SheetGet(env,token,{fields:'sheets(properties,protectedRanges(range,warningOnly)),spreadsheetId'});
 if(d.spreadsheetId!==env.GOOGLE_SHEETS_SPREADSHEET_ID||!Array.isArray(d.sheets)||!d.sheets.length)throw Error('b2_workbook_metadata_invalid');
 const sheets=d.sheets.map(s=>b2SheetInfo(s,policy)).sort((a,b)=>a.id-b.id);
 const fingerprint=await producerHash(JSON.stringify([d.spreadsheetId,sheets.map(s=>s.mode==='excluded'?{id:s.id,title:s.title,mode:s.mode}:s)]));
 return {version:B2_REFERENCE_VERSION,fingerprint,sheets,observed_at:new Date().toISOString(),
  issues:sheets.filter(s=>s.mode==='unreviewed').map(s=>({sheet:s.title,reason:s.reason})),
  note:'Read-only observations, not an atomic workbook snapshot or deletion authorization. Protected sheets are excluded automatically; partial cell-range protections do not exclude entire tabs.'};
}
// Decode URL path segments once. Never normalize case, Unicode, slashes or dot segments in object keys.
function b2Identity(value){
 const s=String(value).trim();
 if(/^(?:b2|s3):\/\//i.test(s)){const m=s.match(/^(?:b2|s3):\/\/([^/]+)\/(.+)$/i);return m?{bucket:m[1],name:m[2]}:{uncertain:true};}
 if(!/^https?:\/\//i.test(s))return null;
 let u;try{u=new URL(s)}catch{return /backblaze|backblazeb2/i.test(s)?{uncertain:true}:null;}
 const host=u.hostname.toLowerCase();
 if(!host.endsWith('.backblazeb2.com')&&host!=='backblazeb2.com')return {unknown_url:true};
 // Use the original path: WHATWG URL would silently collapse /../ and encoded dot segments.
 const m=s.match(/^https?:\/\/[^/]+(\/[^?#]*)?/i),path=m?.[1]||'/';
 if(u.username||u.password)return {uncertain:true};
 const id=u.searchParams.get('fileId');
 if(id&&/\/b2_download_file_by_id$/.test(path))return {file_id:id};
 try{
  let parts=path.slice(1).split('/'),bucket,name;
  if(/^s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(host)){bucket=decodeURIComponent(parts.shift()||'');name=decodeURIComponent(parts.join('/'));}
  else if(/^(.+)\.s3\.[a-z0-9-]+\.backblazeb2\.com$/.test(host)){bucket=host.split('.s3.')[0];name=decodeURIComponent(parts.join('/'));}
  else if(parts[0]==='file'){parts.shift();bucket=decodeURIComponent(parts.shift()||'');name=decodeURIComponent(parts.join('/'));}
  else return {uncertain:true};
  return bucket&&name?{bucket,name}:{uncertain:true};
 }catch{return {uncertain:true};}
}
function b2CellTokens(cell){
 const v=b2Value(cell),tokens=new Set(typeof v==='string'&&v.trim()?[v.trim()]:[]);
 if(cell.hyperlink)tokens.add(cell.hyperlink);
 for(const r of cell.textFormatRuns||[])if(r.format?.link?.uri)tokens.add(r.format.link.uri);
 if(cell.userEnteredFormat?.textFormat?.link?.uri)tokens.add(cell.userEnteredFormat.textFormat.link.uri);
 const formula=cell.userEnteredValue?.formulaValue||'';
 // Literal URLs in formulas and structured text. Dynamic formulas use evaluated values/hyperlinks.
 for(const match of (String(v)+' '+formula).matchAll(/(?:https?:\/\/|b2:\/\/)[^\s"<>]+/gi))tokens.add(match[0]);
 if(typeof v==='string'&&/^[\[{]/.test(v.trim())){
  try{let count=0;const walk=(x,depth)=>{if(++count>2000||depth>10)throw Error('limit');if(typeof x==='string')tokens.add(x.trim());else if(Array.isArray(x))x.forEach(y=>walk(y,depth+1));else if(x&&typeof x==='object')Object.values(x).forEach(y=>walk(y,depth+1));};walk(JSON.parse(v),0);tokens.delete(v.trim());}catch{/* Potential B2 strings still inspected; malformed structured B2 cells flagged below. */}
 }
 return [...tokens];
}
function b2MatchCells(sheet,header,cells,start,bucket,objects){
 const byId=new Map(),byName=new Map(),refs=[],issues=[],seen=new Set();
 for(const o of objects){byId.set(o.file_id,o);if(!byName.has(o.name))byName.set(o.name,[]);byName.get(o.name).push(o);}
 const headers=header.map((c,n)=>{const v=String(b2Value(c));return v.length<=120&&!/[{}\[\]\r\n]/.test(v)?v:b2Column(n);}),statusColumns=headers.flatMap((h,i)=>h==='status'?[i]:[]);
 const bucketColumns=headers.flatMap((h,i)=>['bucket','bucket_name','b2_bucket','b2_bucket_name'].includes(h.toLowerCase().trim())?[i]:[]);
 for(let i=0;i<cells.length;i++){
  const rowNumber=start+i+1;
  const row=cells[i].values||[],status=statusColumns.length===1?b2Value(row[statusColumns[0]]):null;
  const statusProblem=rowNumber<=sheet.header_row?'Reference occurs in/before header; no data-row status':statusColumns.length!==1?'Missing or duplicate exact status column':row[statusColumns[0]]?.effectiveValue?.errorValue?'Status formula error':null;
  const bucketValues=[...new Set(bucketColumns.map(n=>String(b2Value(row[n])).trim()).filter(Boolean))];
  const contextualBucket=bucketValues.length===1?bucketValues[0]:bucketValues.length?null:sheet.default_bucket;
  for(let j=0;j<row.length;j++){
   const cell=row[j],column=headers[j]||b2Column(j),location={sheet:sheet.title,sheet_id:sheet.id,column,column_letter:b2Column(j),row:rowNumber};
   const typed=/b2|backblaze|file.?id|file.?path|file.?url|object.?key/i.test(column);
   if(cell.effectiveValue?.errorValue){issues.push({...location,reason:'Cell formula error; a reference could not be resolved.'});continue;}
   for(const token of b2CellTokens(cell)){
    let identity=b2Identity(token),matched=[],uncertain=false;
    if(identity?.file_id){if(byId.has(identity.file_id))matched=byName.get(byId.get(identity.file_id).name);else issues.push({...location,reason:'B2 file ID is absent from this complete inventory; its bucket/key is unresolved.'});}
    else if(identity?.name){if(identity.bucket===bucket)matched=byName.get(identity.name)||[];}
    else if(identity?.uncertain){issues.push({...location,reason:'Malformed or unsupported B2 reference; manual resolution required.'});}
    else if(byId.has(token)){matched=byName.get(byId.get(token).name);}
    else if(byName.has(token)){
     if(!contextualBucket||contextualBucket===bucket){matched=byName.get(token);uncertain=!contextualBucket;}
    }else if(identity?.unknown_url&&typed){issues.push({...location,reason:'Custom/unknown URL in a file reference column; bucket/key cannot be verified.'});}
    else if(rowNumber>sheet.header_row&&!identity&&typed&&token&&!['status','bucket','bucket_name','b2_bucket','b2_bucket_name'].includes(column.toLowerCase())&&!/^(?:n\/a|null|none)$/i.test(token)){
     // A path in a verified bucket can refer to an object no longer present. An unknown ID cannot.
     if(!contextualBucket||/id/i.test(column))issues.push({...location,reason:'Unresolved file reference; no canonical bucket/path or matching version ID.'});
    }
    for(const o of matched){
     const key=JSON.stringify([o.file_id,sheet.id,rowNumber,j]);if(seen.has(key))continue;seen.add(key);
     refs.push({...location,file_id:o.file_id,designated:sheet.designated,status,status_problem:statusProblem,
      uncertain:uncertain||sheet.mode!=='included',resolution:uncertain?'Unqualified path has no verified bucket context':sheet.mode!=='included'?sheet.reason:'Canonical identity matched'});
    }
   }
  }
 }
 const unique=[...new Map(issues.map(x=>[JSON.stringify(x),x])).values()];
 return {references:refs,issues:unique};
}
function b2ReferenceCoordinates(reference,workbookId){
 const cell=reference.column_letter+reference.row;
 return {...reference,workbook_id:workbookId,cell,a1_location:"'"+reference.sheet.replaceAll("'","''")+"'!"+cell,
  cell_url:'https://docs.google.com/spreadsheets/d/'+encodeURIComponent(workbookId)+'/edit#gid='+reference.sheet_id+'&range='+encodeURIComponent(cell)};
}
async function b2ReferenceApi(req,env,path){
 try{
  const token=await sheetToken(env),meta=await b2WorkbookMetadata(env,token);
  if(path==='/b2/workbook'&&req.method==='GET')return json(meta);
  if(path!=='/b2/reference-scan'||req.method!=='POST')return error('infra_route_not_allowed',404);
  const input=await body(req);
  if(input.fingerprint!==meta.fingerprint)return error('b2_workbook_changed_restart_scan',409);
  if(typeof input.bucket!=='string'||!input.bucket||!Array.isArray(input.objects)||input.objects.length>10000||input.objects.some(o=>typeof o.file_id!=='string'||!o.file_id||typeof o.name!=='string'||!o.name)||new Set(input.objects.map(o=>o.file_id)).size!==input.objects.length)return error('b2_reference_inventory_invalid',400);
  const sheet=meta.sheets.find(s=>s.id===input.sheet_id);
  if(!sheet||sheet.mode==='excluded'||sheet.type!=='GRID'||!sheet.columns||sheet.columns>20000)return error('b2_sheet_not_scannable',409);
  const start=input.start_row;if(!Number.isInteger(start)||start<0||start>=sheet.rows)return error('b2_sheet_range_invalid',400);
  const end=Math.min(sheet.rows,start+Math.max(1,Math.floor(50000/sheet.columns)));
  const title="'"+sheet.title.replaceAll("'","''")+"'!",last=b2Column(sheet.columns-1);
  const fields='sheets(properties(sheetId),data(startRow,rowData(values(effectiveValue,userEnteredValue,hyperlink,textFormatRuns(format(link)),userEnteredFormat(textFormat(link))))))';
  // One grid request includes header and chunk. Do not fetch the header separately.
  const ranges=[title+'A'+(start+1)+':'+last+end];
  if(sheet.header_row<start+1||sheet.header_row>end)ranges.unshift(title+'A'+sheet.header_row+':'+last+sheet.header_row);
  const query=new URLSearchParams({fields});for(const range of ranges)query.append('ranges',range);
  const data=await b2SheetGet(env,token,query);
  const grids=data.sheets?.find(s=>s.properties?.sheetId===sheet.id)?.data;
  if(!Array.isArray(grids))throw Error('b2_workbook_grid_invalid');
  const c=grids.find(g=>(g.startRow||0)===start);
  const h=grids.find(g=>sheet.header_row-1>=(g.startRow||0)&&sheet.header_row-1<(g.startRow||0)+(g.rowData?.length||0));
  if(!c)throw Error('b2_workbook_grid_invalid');
  const header=h?.rowData?.[sheet.header_row-1-(h.startRow||0)]?.values||[];
  const result=b2MatchCells(sheet,header,c.rowData||[],start,input.bucket,input.objects);
  return json({...result,references:result.references.map(r=>b2ReferenceCoordinates(r,env.GOOGLE_SHEETS_SPREADSHEET_ID)),sheet_id:sheet.id,fingerprint:meta.fingerprint,start_row:start,end_row:end,next_row:end<sheet.rows?end:null,observed_at:new Date().toISOString()});
 }catch(e){return error(/^(b2_|missing_GOOGLE_|google_)[a-zA-Z0-9_]+$/.test(e?.message)?e.message:'b2_reference_scan_failed',503);}
}
