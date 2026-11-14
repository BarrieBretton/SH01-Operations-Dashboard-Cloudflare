// Explicitly bound source observations. Never infer finite stock from API availability.
async function ingestSourceObservations(req,env){
 const b=await body(req);if(!Array.isArray(b.observations)||b.observations.length>50)throw Error('maximum_50_source_observations');
 const rows=b.observations.map(x=>{const source=SOURCE_REGISTRY.sources.find(s=>s.source_id===x.source_id);if(!source)throw Error('unknown_source_id');
 if(!['inventory','activity','on_demand'].includes(x.measurement)||!['available','unavailable','partial'].includes(x.status))throw Error('invalid_source_observation');
 const at=iso(x.checked_at);if(!at||Math.abs(Date.now()-Date.parse(at))>86400000)throw Error('source_observation_time_invalid');
 const count=Number.isInteger(x.count)&&x.count>=0?x.count:null;
 return {id:'source:'+source.source_id,payload:JSON.stringify({source_id:source.source_id,measurement:x.measurement,status:x.status,checked_at:at,count,complete:x.complete===true,reason:['provider_rejected','network_unavailable','page_limit','not_configured','probe_succeeded'].includes(x.reason)?x.reason:'unspecified',remaining:null})};});
 await env.STORE.transact(['content_collect_state'],tx=>{for(const r of rows){const old=tx.find('content_collect_state',{id:r.id});if(!old||JSON.parse(old.payload).checked_at<=JSON.parse(r.payload).checked_at)tx.put('content_collect_state',r)}});return json({accepted:rows.length});
}
