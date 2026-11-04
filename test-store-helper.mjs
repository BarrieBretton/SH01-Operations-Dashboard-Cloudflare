// In-memory SQLite is a test oracle only; deployed storage uses Sheets.
import fs from 'node:fs';import vm from 'node:vm';
const code=fs.readFileSync(new URL('./sheets-store.js',import.meta.url),'utf8').replace('__STORE_SCHEMA__',fs.readFileSync(new URL('./store-schema.json',import.meta.url),'utf8'));
export function attachStore(env,sql,ctx){
 const scope={structuredClone,console};vm.createContext(scope);vm.runInContext(code+';globalThis.Store=SheetStore;globalThis.sortRows=storeSort;',scope);
 const store=new scope.Store(env);store.snapshot=async tables=>({revision:0,tables:Object.fromEntries(tables.map(t=>[t,sql.prepare('SELECT * FROM '+t).all()]))});
 scope.storeRPC=async (_e,p)=>{if(p.op==='health')return {ok:true};sql.exec('BEGIN');try{for(const op of p.changes){const schema=JSON.parse(fs.readFileSync(new URL('./store-schema.json',import.meta.url)))[op.table],key=JSON.parse(op.key);if(op.remove)sql.prepare('DELETE FROM '+op.table+' WHERE '+schema.keys.map(k=>'"'+k+'"=?').join(' AND ')).run(...key);else{const keys=Object.keys(op.row);sql.prepare('INSERT INTO '+op.table+'('+keys.map(k=>'"'+k+'"').join(',')+') VALUES('+keys.map(()=>'?').join(',')+') ON CONFLICT('+schema.keys.map(k=>'"'+k+'"').join(',')+') DO UPDATE SET '+keys.map(k=>'"'+k+'"=excluded."'+k+'"').join(',')).run(...keys.map(k=>op.row[k]));}}sql.exec('COMMIT');return {ok:true};}catch(e){sql.exec('ROLLBACK');throw e;}};
 env.STORE=store;ctx.storeSort=scope.sortRows;ctx.storeRPC=scope.storeRPC;ctx.structuredClone=structuredClone;return store;
}
