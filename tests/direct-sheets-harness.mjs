import fs from 'node:fs';import vm from 'node:vm';import {webcrypto} from 'node:crypto';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
export async function directHarness({verify=true}={}){
 let sheets={},ranges={},writes=0,nextFailure=null,lost=false;
 const getValues=range=>{const title=range.split("'")[1],sheet=sheets[title];if(!sheet)throw Error('missing tab');return {values:structuredClone(range.endsWith('A1:B1')?sheet.data.slice(0,1):sheet.data)};};
 const batch=body=>{
  if(nextFailure!==null){const status=nextFailure;nextFailure=null;return new Response(JSON.stringify({error:{message:'PRIVATE do not disclose token'}}),{status});}
  const next=structuredClone(sheets),nr=structuredClone(ranges);
  try{for(const req of body.requests){
   if(req.addSheet){const p=req.addSheet.properties;if(next[p.title]||Object.values(next).some(s=>s.prop.sheetId===p.sheetId))throw Error('duplicate');next[p.title]={prop:structuredClone(p),data:[]};}
   else if(req.addNamedRange){const r=req.addNamedRange.namedRange;if(nr[r.namedRangeId]||Object.values(nr).some(x=>x.name===r.name))throw Error('duplicate range');nr[r.namedRangeId]=structuredClone(r);}
   else if(req.updateNamedRange){const r=req.updateNamedRange.namedRange;if(!nr[r.namedRangeId])throw Error('absent range');Object.assign(nr[r.namedRangeId],structuredClone(r));}
   else if(req.deleteNamedRange){if(!nr[req.deleteNamedRange.namedRangeId])throw Error('absent range');delete nr[req.deleteNamedRange.namedRangeId];}
   else if(req.appendDimension){const s=Object.values(next).find(x=>x.prop.sheetId===req.appendDimension.sheetId);if(!s)throw Error('absent sheet');s.prop.gridProperties.rowCount+=req.appendDimension.length;}
   else if(req.updateCells){const u=req.updateCells,s=Object.values(next).find(x=>x.prop.sheetId===u.start.sheetId);if(!s||u.start.rowIndex+u.rows.length>s.prop.gridProperties.rowCount)throw Error('outside grid');for(let i=0;i<u.rows.length;i++){const at=u.start.rowIndex+i;while(s.data.length<=at)s.data.push([]);for(let j=0;j<u.rows[i].values.length;j++){const v=u.rows[i].values[j].userEnteredValue;if(!Object.hasOwn(v,'stringValue'))throw Error('formula forbidden');s.data[at][u.start.columnIndex+j]=v.stringValue;}}}
   else if(req.addProtectedRange){}
   else throw Error('unknown request');
  }}catch{return new Response('{"error":{"message":"PRIVATE invalid request"}}',{status:400});}
  sheets=next;ranges=nr;writes++;if(lost){lost=false;throw Error('simulated response lost after successful commit');}return Response.json({});
 };
 const fetch=async(url,options={})=>{
  const u=new URL(url);
  if(u.hostname==='oauth2.googleapis.com')return Response.json({access_token:'test-private-access-token'});
  if(u.hostname!=='sheets.googleapis.com')throw Error('unexpected network destination');
  if(options.redirect!=='error')throw Error('redirect policy missing');
  if(u.pathname.endsWith(':batchUpdate'))return batch(JSON.parse(options.body));
  if(u.pathname.endsWith('/values:batchGet'))return Response.json({valueRanges:u.searchParams.getAll('ranges').map(getValues)});
  if(u.pathname.includes('/values/'))return Response.json(getValues(decodeURIComponent(u.pathname.split('/values/')[1])));
  return Response.json({sheets:Object.values(sheets).map(s=>({properties:s.prop})),namedRanges:Object.values(ranges)});
 };
 const ctx={crypto:webcrypto,structuredClone,TextEncoder,URL,URLSearchParams,AbortSignal,WeakMap,setTimeout,console,fetch,sheetToken:async()=> 'test-private-access-token'};
 vm.createContext(ctx);vm.runInContext(read('sheets-store.js').replace('__STORE_SCHEMA__',read('store-schema.json'))+';globalThis.Store=SheetStore;',ctx);
 const env={GOOGLE_CLIENT_ID:'test-client',GOOGLE_CLIENT_SECRET:'test-secret',GOOGLE_REFRESH_TOKEN:'test-refresh',GOOGLE_SHEETS_SPREADSHEET_ID:'test-book'};
 await ctx.storeSetup(env);if(verify)await ctx.storeVerifyGuard(env);
 return {ctx,env,store:new ctx.Store(env),fetch,get sheets(){return sheets},get ranges(){return ranges},get writes(){return writes},failNext:status=>{nextFailure=status},loseNext:()=>{lost=true}};
}
