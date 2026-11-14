import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./meta-worker.js',import.meta.url),'utf8');
function setup(fetch){return vm.createContext({fetch,URL,AbortSignal,setTimeout,contentPreview:u=>u});}
test('Graph requests use a Workers-supported redirect mode',async()=>{
 let calls=0;const c=setup(async(u,o)=>{assert.equal(o.redirect,'manual');calls++;return {status:200,ok:true,json:async()=>({data:[]})};});vm.runInContext(source,c);
 await vm.runInContext("graph('me/accounts','test-token')",c);assert.equal(calls,1);
});
test('Graph redirects are rejected without following or reading the body',async()=>{
 let calls=0;const c=setup(async()=>{calls++;return {status:302,json:()=>{throw Error('body must not be read')}};});vm.runInContext(source,c);
 await assert.rejects(vm.runInContext("graph('me/accounts','test-token')",c),/graph_redirect_rejected/);assert.equal(calls,1);
});
test('Facebook preview refresh uses the supported shared transport',async()=>{
 let calls=0;const c=setup(async(u,o)=>{assert.equal(o.redirect,'manual');calls++;return {status:200,ok:true,json:async()=>calls===1?{access_token:'page-token'}:{full_picture:'https://example.fbcdn.net/image.jpg'}};});vm.runInContext(source,c);
 c.env={META_SYSVAR:'a'.repeat(30),STORE:{find:async()=>({id:'123'})}};c.row={platform:'facebook',account_id:'123',post_id:'123_456'};
 const result=await vm.runInContext('metaPreview(env,row)',c);assert.equal(result.available,true);assert.equal(result.kind,'image');assert.equal(calls,2);
});
