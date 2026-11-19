let cfgData=null,cfgPlan=null,cfgSeq=0;
function cfgReset(){
 cfgSeq++;cfgData=cfgPlan=null;
 for(const id of ['cfg-admin','cfg-original'])$(id).value='';
 for(const id of ['cfg-live','cfg-result','cfg-target','cfg-key','cfg-value'])$(id).textContent='';
 $('cfg-apply').disabled=true;
}
function cfgSettings(){const t=$('cfg-target').value;return cfgData?.inventory.nodes[t]?.vars||cfgData?.inventory.workers[t]?.vars||{}}
function cfgInvalidate(){cfgSeq++;cfgPlan=null;$('cfg-result').textContent='';$('cfg-apply').disabled=true;$('cfg-value').textContent=cfgSettings()[$('cfg-key').value]||($('cfg-key').value?'Server-side secret reference (value hidden)':'')}
function cfgSelect(){const secrets=cfgData?.inventory.nodes[$('cfg-target').value]?.secrets||{};const keys=[...Object.keys(cfgSettings()),...Object.keys(secrets)];$('cfg-key').replaceChildren(...keys.map(k=>new Option(k,k)));cfgInvalidate()}
$('cfg-target').onchange=cfgSelect;$('cfg-key').onchange=cfgInvalidate;$('cfg-admin').oninput=cfgInvalidate;
$('cfg-load').onclick=async()=>{
 cfgReset();$('cfg-live').textContent='Checking registered services and production routers…';
 try{const d=await infraRequest('control','/config');cfgData=d;
 const a=d.status.active||{};
 const lines=['Master answering: '+(d.status.master||d.status.error||'Unknown'),'Selected: '+[a.render,a.postgres,a.b2].map(x=>x||'Unknown').join(' / '),''];
 lines.push('Watchdog cron: '+(d.watchdog.error||d.watchdog.join(', ')||'No trigger'));
 for(const r of d.routers)lines.push(r.role+' · '+(r.error||('maintenance '+r.maintenance+' · first '+r.first+' · HTTP '+r.http+' from '+(r.answered||'unknown'))));
 for(const s of d.services){const meta=d.inventory.nodes[s.slot+'/'+s.role]||{};lines.push(s.slot+' / '+s.role+' · '+(s.error||s.state||'Unknown')+' '+(s.suspenders||[]).join(', ')+' · '+(s.workspace||meta.workspace||'Workspace unknown')+' · '+(meta.email||'Email unknown'))}
 for(const [name,n] of Object.entries(d.inventory.nodes).filter(([k])=>!k.includes('/')))lines.push(name+' · '+n.url+' · '+(n.workspace||'Workspace unknown')+' · '+(n.email||'Email unknown'));
 $('cfg-live').textContent=lines.join('\n');
 const names=[...Object.keys(d.inventory.nodes),...Object.keys(d.inventory.workers)];
 $('cfg-target').replaceChildren(...names.map(n=>new Option(n,n)));cfgSelect();
 }catch(e){if(token)$('cfg-live').textContent=e.message}
};
async function cfgChange(action){
 if(!checkIdleSession()||!cfgData)return;
 const target=$('cfg-target').value,key=$('cfg-key').value,expected=cfgPlan;
 if(action==='apply'&&(!expected||!confirm('Apply '+key+' to '+target+'?')))return;
 cfgInvalidate();const seq=cfgSeq,epoch=authEpoch;
 $('cfg-result').textContent=action==='apply'?'Applying and checking provider…':'Checking provider…';
 try{const r=await fetch('/api/infra/control/config/change',{method:'POST',headers:{Authorization:'Bearer '+token,'X-Infra-Admin':$('cfg-admin').value,'Content-Type':'application/json'},body:JSON.stringify({target,key,action,expected}),redirect:'error'});
 const d=await r.json();if(seq!==cfgSeq||epoch!==authEpoch)return;
 if(!r.ok)throw Error(d.error||'Request failed');
 if(action==='preview'){cfgPlan=d.expected;$('cfg-result').textContent='Provider value: '+d.state+'. Proposed value shown above.';$('cfg-apply').disabled=d.state==='matches'}
 else $('cfg-result').textContent='Provider read-back verified. Runtime adoption may require deployment.';
 }catch(e){if(seq===cfgSeq)$('cfg-result').textContent=e.message}
}
$('cfg-preview').onclick=()=>cfgChange('preview');$('cfg-apply').onclick=()=>cfgChange('apply');
$('cfg-copy').onclick=async()=>{
 if(!checkIdleSession()||!cfgData)return;
 try{const vars=cfgSettings(),seen=new Set(),input=$('cfg-original').value;
 if(!Object.keys(vars).length)throw Error('No managed settings for this target.');
 const rows=input?input.replace(/\r\n/g,'\n').replace(/\n$/,'').split('\n'):[];
 const required=Object.keys(cfgData.inventory.nodes[$('cfg-target').value]?.secrets||{});
 const out=rows.map(line=>{if(!line.trim())return line;const m=/^([A-Za-z_][A-Za-z_0-9]*)=/.exec(line);if(!m||seen.has(m[1]))throw Error('Invalid or duplicate key. Check pasted rows.');seen.add(m[1]);return Object.hasOwn(vars,m[1])?m[1]+'='+vars[m[1]]:line});
 if(required.some(k=>!rows.some(line=>line.startsWith(k+'=')&&line.length>k.length+1)))throw Error('Include your existing '+required.join(', ')+' row locally to produce a complete block.');
 for(const [k,v] of Object.entries(vars))if(!seen.has(k))out.push(k+'='+v);
 await navigator.clipboard.writeText(out.join('\n'));$('cfg-original').value='';$('cfg-result').textContent=input?'Updated column copied.':'Managed rows copied. Paste existing rows first for a full replacement.';
 }catch(e){$('cfg-result').textContent=e.message}
};

const cfgPreviousLock=lock;
lock=function(){cfgReset();return cfgPreviousLock.apply(this,arguments)};
