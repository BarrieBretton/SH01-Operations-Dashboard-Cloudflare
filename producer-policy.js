// The Streamables eligibility rule is shared by ingestion and live snapshots.
const PRODUCER_POLICY_VERSION = 2;
const producerText = x => String(x ?? '').trim();
const producerAccount = x => producerText(x).replace(/^@/, '').toLowerCase();
const consumedStates = new Set(['uploaded','used','published','consumed','done','posted','completed','deleted']);
function producerStatusValue(row) {
 const status=producerText(row.status).toLowerCase(), state=producerText(row.state).toLowerCase();
 if(status && state && status!==state)return {value:status,conflict:true};
 return {value:status||state,conflict:false};
}
function producerReady(row) {const s=producerStatusValue(row);return !s.conflict && s.value==='staged' && producerText(row.approved).toLowerCase()==='yes';}
function producerConsumed(row) {const s=producerStatusValue(row);return !s.conflict && consumedStates.has(s.value);}
function producerURL(value) {
 try {const u=new URL(String(value));if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return '';
 if(u.hostname==='api.telegram.org' && /\/bot[^/]+/.test(u.pathname))return '';
 u.hash='';for(const k of [...u.searchParams.keys()])if(/token|secret|password|auth|signature|api.?key|credential|x-amz|x-goog|policy/i.test(k))u.searchParams.delete(k);
 return u.href;
 } catch {return '';}
}
function producerThreshold(env,tab,account) {
 // CFG values were redacted. Never silently call a fallback the workflow setting.
 let map={};try{map=JSON.parse(env.PRODUCER_MIN_READY_JSON||'{}')}catch{throw Error('sheet_invalid_threshold_config')}
 const specified=map[tab+':'+account];
 if(specified!==undefined && (!Number.isInteger(specified)||specified<1||specified>100000))throw Error('sheet_invalid_threshold_config');
 return {threshold:specified??3,threshold_source:specified===undefined?'dashboard_default_workflow_CFG_unverified':'operator_configured',threshold_operator:'<'};
}
function producerStockState(p) {
 if(p.measurement!=='measured'||p.ready_count===null)return 'unknown';
 if(p.source_stale)return 'stale';
 if(p.ready_count===0)return p.total_count>0&&p.consumed_count===p.total_count?'consumed':'empty';
 return p.ready_count<p.threshold?'low':'ready';
}
