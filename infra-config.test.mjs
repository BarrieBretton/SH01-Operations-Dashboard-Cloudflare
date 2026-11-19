import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
const inventory=JSON.parse(fs.readFileSync(new URL('./infra-config.json',import.meta.url)));
const source=fs.readFileSync(new URL('./infra-config-api.js',import.meta.url),'utf8');
test('Render secret requires admin, accepts only reviewed keys, rejects drift, verifies single PUT and redacts values',async()=>{
 const env={INFRA_CONFIG_ADMIN_KEY:'admin',INFRA_SERVICE_ID_D0YA:'srv-test',RENDER_D0YA_API_KEY:'manager',RENDER_C_API_KEY:'hidden-new'};
 let value='hidden-old',puts=0;
 const fetch=async(url,o)=>{if(!url.includes('/env-vars/'))return Response.json({serviceDetails:{url:inventory.nodes.d0ya.url}});
 if(o.method==='PUT'){puts++;value=JSON.parse(o.body).value;return new Response(null,{status:204})}return Response.json({value})};
 const call=vm.runInNewContext(source+';cfgRoute',{CFG_INVENTORY:inventory,authorized:async(a,b)=>a===b,crypto:webcrypto,TextEncoder,fetch,Response,AbortSignal});
 async function act(action,expected,admin='admin',key='RENDER_C_API_KEY'){return call(new Request('https://example.invalid',{method:'POST',headers:{'X-Infra-Admin':admin},body:JSON.stringify({target:'d0ya',key,action,expected})}),env,'/config/change')}
 assert.equal((await act('preview',null,'wrong')).status,403);
 assert.equal((await act('preview',null,'admin','UNKNOWN')).status,400);
 const preview=await (await act('preview')).json();assert.equal(preview.state,'different');assert.ok(!JSON.stringify(preview).includes('hidden'));
 value='changed';assert.equal((await act('apply',preview.expected)).status,409);assert.equal(puts,0);
 const fresh=await (await act('preview')).json();assert.equal((await (await act('apply',fresh.expected)).json()).verified,true);assert.equal(puts,1);
});
test('Cloudflare preserves unrelated binding by name and verifies updated BACKENDS',async()=>{
 let text='https://sh01.onrender.com';let changes=0;
 const fetch=async(url,o)=>{if(o.method==='PATCH'){const b=JSON.parse(o.body.get('settings')).bindings;
 assert.deepEqual(b.find(x=>x.name==='ROUTER_STATE'),{name:'ROUTER_STATE',type:'inherit'});text=b.find(x=>x.name==='BACKENDS').text;changes++}
 return Response.json({result:{bindings:[{name:'BACKENDS',type:'plain_text',text},{name:'ROUTER_STATE',type:'kv_namespace'}]}})};
 const call=vm.runInNewContext(source+';cfgRoute',{CFG_INVENTORY:inventory,authorized:async()=>true,crypto:webcrypto,TextEncoder,fetch,Response,FormData,AbortSignal});
 const go=async(action,expected)=>call(new Request('https://example.invalid',{method:'POST',body:JSON.stringify({target:'sh01',key:'BACKENDS',action,expected})}),{INFRA_CONFIG_ADMIN_KEY:'key',INFRA_CF_ACCOUNT_ID:'id',INFRA_CF_TOKEN:'token'},'/config/change');
 const p=await (await go('preview')).json();assert.ok(p.expected);assert.equal((await (await go('apply',p.expected)).json()).verified,true);assert.equal(changes,1);
});
test('workbook merge preserves unrelated rows and secret values containing equals signs',async()=>{
 const els=new Map();const el=id=>{if(!els.has(id))els.set(id,{value:'',textContent:''});return els.get(id)};
 let copied='';const ctx=vm.createContext({$:el,lock(){},checkIdleSession:()=>true,navigator:{clipboard:{writeText:async x=>{copied=x}}}});
 vm.runInContext(fs.readFileSync(new URL('./infra-config-ui.js',import.meta.url),'utf8'),ctx);
 ctx.inventory=inventory;vm.runInContext('cfgData={inventory}',ctx);
 el('cfg-target').value='d0ya';el('cfg-original').value='OTHER=private=a=b\nSH01_ROLE=old\nRENDER_C_API_KEY=fake==';
 await el('cfg-copy').onclick();assert.ok(copied.startsWith('OTHER=private=a=b\nSH01_ROLE=controller\nRENDER_C_API_KEY=fake==\n'));assert.equal(el('cfg-original').value,'');
 copied='';el('cfg-original').value='X=a\nX=b';await el('cfg-copy').onclick();assert.equal(copied,'');assert.match(el('cfg-result').textContent,/duplicate/);
});

test('configuration requests accept a normal response and stop at upstream redirects', async () => {
 const urls = [];
 const first = 'https://management.example.test/resource';
 let status = 200;
 const fetch = async (url, options) => {
  urls.push(url);
  if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
  assert.equal(options.redirect, 'manual');
  return new Response('fixture', {status, headers: {Location: 'https://elsewhere.example.test/private'}});
 };
 const call = vm.runInNewContext(source + ';cfgFetch', {fetch, AbortSignal});
 const headers = {Authorization: 'Bearer fixture'};
 assert.equal(await (await call(first, headers)).text(), 'fixture');
 for (status of [301, 302, 303, 307, 308]) {
  await assert.rejects(call(first, headers), e => e.message === 'Upstream redirect rejected (HTTP ' + status + ')');
 }
 assert.deepEqual(urls, Array(6).fill(first));
});

test('dashboard config overview retains healthy results when a production probe redirects', async () => {
 const {default: worker} = await import('./worker.js');
 const previousFetch = globalThis.fetch;
 let callCount = 0;
 globalThis.fetch = async (url, options) => {
  const {hostname, pathname} = new URL(url);
  assert.equal(options.redirect, 'manual');
  callCount++;
  if (hostname === 'infra-control.vivojaymail.workers.dev') {
   assert.equal(options.headers['X-API-KEY'], 'fixture-control');
   if (pathname === '/infra/status') {
    return Response.json({active: {render: 'render-c'}, available: {render: ['render-c']}},
     {headers: {'x-backend-used': 'fixture-controller'}});
   }
   if (pathname.includes('/router/')) return Response.json({effective_order: ['fixture-backend']});
   return Response.json({suspended: 'not_suspended'});
  }
  assert.equal(options.headers['X-API-KEY'], undefined);
  if (hostname === 'sh01.vivojaymail.workers.dev') {
   return new Response(null, {status: 307, headers: {Location: 'https://elsewhere.example.test/private'}});
  }
  assert.equal(hostname, 'n8n-prod-1.vivojaymail.workers.dev');
  return new Response(null, {headers: {'x-backend-used': 'fixture-n8n'}});
 };
 try {
  const url = 'https://desk.test/api/infra/control/config';
  const env = {DASHBOARD_TOKEN: 'fixture-dashboard', CONTROL_PLANE_API_KEY: 'fixture-control'};
  assert.equal((await worker.fetch(new Request(url), env, {})).status, 401);
  assert.equal(callCount, 0);
  const response = await worker.fetch(new Request(url, {headers: {Authorization: 'Bearer fixture-dashboard'}}), env, {});
  assert.equal(response.status, 200);
  const overview = await response.json();
  assert.equal(overview.status.active.render, 'render-c');
  assert.equal(overview.status.master, 'fixture-controller');
  assert.equal(overview.routers.find(r => r.role === 'n8n').answered, 'fixture-n8n');
  assert.equal(overview.routers.find(r => r.role === 'sh01').error, 'Upstream redirect rejected (HTTP 307)');
  assert.equal(JSON.stringify(overview).includes('elsewhere.example.test'), false);
 } finally {
  globalThis.fetch = previousFetch;
 }
});
