// Deployment gate: edited modules and the file Cloudflare deploys must agree.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
test('deployed Worker embeds current source registry, policy, collector and UI',()=>{
 const worker=read('./worker.js');
 assert.ok(worker.includes(read('./producer-policy.js').trim()));
 assert.ok(worker.includes(read('./sheets-sync.js').trim()));
 const actual=JSON.parse(worker.split('const SOURCE_REGISTRY = ')[1].split(';\n')[0]);
 assert.deepEqual(actual,JSON.parse(read('./producer-sources.json')));
 const html=JSON.parse(worker.split('const HTML = ')[1].split(';\n')[0]);
 assert.equal(html,read('./dashboard.html'));
 assert.ok(html.includes(read('./producer-view.js').trim()));
 assert.ok(html.includes(read('./producer-view.html').trim()));
});
