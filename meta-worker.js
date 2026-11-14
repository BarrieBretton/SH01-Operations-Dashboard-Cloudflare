// Bounded Meta collection. Tokens and provider paging URLs are never persisted.
const META_VERSION='v24.0';
// Candidates are probed independently. Availability is evidence, never assumed support.
const IG_METRICS={IMAGE:['views','reach','likes','comments','saved','shares','total_interactions'],VIDEO:['views','reach','likes','comments','saved','shares','total_interactions'],CAROUSEL_ALBUM:['views','reach','likes','comments','saved','shares','total_interactions'],REELS:['views','reach','likes','comments','saved','shares','total_interactions','ig_reels_avg_watch_time','ig_reels_video_view_total_time','clips_replays_count','reels_skip_rate'],STORY:['views','reach','replies','shares','navigation','follows','profile_visits']};
const IG_ACCOUNT_METRICS=['reach','views','accounts_engaged','total_interactions','likes','comments','shares','saves','replies','profile_links_taps','follows_and_unfollows'];
const PAGE_METRICS=['page_media_view','page_post_engagements','page_views_total','page_follows'];
function metaErrorCategory(e,status){
 const code=Number(e?.code),m=String(e?.message||'').toLowerCase();
 if(code===190)return 'credential_rejected';if([10,200,294].includes(code)||status===403)return 'permission_denied';
 if([4,17,32,613].includes(code)||status===429)return 'rate_limited';
 if(code===100&&/invalid metric|valid insights metric|metric.*not supported|metric.*must be/.test(m))return 'metric_unsupported';
 if(code===100)return 'invalid_parameter_or_object';return 'provider_rejected';
}
function metaReason(e){return e.category||(/^[a-z_]+$/.test(e.message)?e.message:/^Graph error [0-9]+$/.test(e.message)?e.message:'meta_collection_failed');}
function metaCatalog(platform,kind){
 if(kind==='account')return ['followers_count','follows_count','media_count'].map(field=>({metric:field,field,params:{}})).concat(IG_ACCOUNT_METRICS.map(metric=>({metric,params:{period:'day',metric_type:'total_value'}})).concat(
 ['views','reach','total_interactions'].flatMap(metric=>['follow_type','media_product_type'].map(b=>({metric,key:metric+':'+b,params:{period:'day',metric_type:'total_value',breakdown:b}}))),
 ['follower_demographics','engaged_audience_demographics','reached_audience_demographics'].flatMap(metric=>['age','gender','country','city'].map(b=>({metric,key:metric+':'+b,params:{period:'lifetime',metric_type:'total_value',timeframe:'last_30_days',breakdown:b}})))));
 if(kind==='page')return [{metric:'followers_count',field:'followers_count',params:{}}].concat(PAGE_METRICS.map(metric=>({metric,params:{period:'day'}})));
 return (platform==='instagram'?IG_METRICS[kind]||[]:['post_media_view','post_reactions_by_type_total']).map(metric=>({metric,params:{},alias:metric==='post_media_view'?'views':metric}));
}
function metaDue(catalog,id,kind,capabilities,now=Date.now()){
 return catalog.map(spec=>({spec,row:capabilities.find(r=>r.asset_id===id&&r.kind===kind&&r.metric===(spec.key||spec.metric))})).filter(({row})=>!row||now-Date.parse(row.checked_at)>= (row.status==='available'?3600000:/metric_unsupported/.test(row.reason)?604800000:3600000)).sort((a,b)=>String(a.row?.checked_at||'').localeCompare(String(b.row?.checked_at||''))).slice(0,2).map(x=>x.spec);
}
function metaObservation(entry){
 const scalar=entry?.total_value?.value??entry?.values?.at(-1)?.value;
 const numeric=typeof scalar==='number'&&Number.isFinite(scalar)&&scalar>=0;
 const breakdowns=entry?.total_value?.breakdowns;
 if(Array.isArray(breakdowns)&&breakdowns.length&&!numeric&&!breakdowns.some(b=>(b.results||[]).some(r=>Number.isFinite(r.value)&&r.value>=0)))throw Error('metric_breakdown_empty_or_suppressed');
 if(Array.isArray(breakdowns)&&breakdowns.length)return {...(numeric?{value:scalar}:{}),breakdowns:breakdowns.slice(0,8).map(b=>({dimension_keys:(b.dimension_keys||[]).map(x=>String(x).slice(0,60)),results:(b.results||[]).slice(0,100).filter(r=>Number.isFinite(r.value)&&r.value>=0).map(r=>({dimension_values:(r.dimension_values||[]).map(x=>String(x).slice(0,100)),value:r.value}))}))};
 if(numeric)return {value:scalar};
 if(scalar&&typeof scalar==='object'&&!Array.isArray(scalar)){const results=Object.entries(scalar).filter(([k,v])=>/^[a-zA-Z0-9_ -]{1,60}$/.test(k)&&Number.isFinite(v)&&v>=0).map(([k,value])=>({dimension_values:[k],value}));if(results.length)return {breakdowns:[{dimension_keys:['category'],results:results.slice(0,100)}]};}
 throw Error('metric_returned_no_numeric_value');
}
function metaCredential(raw){if(!raw||typeof raw!=='string')throw Error('META_SYSVAR missing');let v=raw.trim();if(v.startsWith('{')){let obj;try{obj=JSON.parse(v)}catch{throw Error('META_SYSVAR structure invalid')}v=obj.access_token||obj.token||obj.page_access_token||obj.user_access_token;if(typeof v!=='string')throw Error('META_SYSVAR has no supported access token field')}if(!/^[A-Za-z0-9._-]{20,}$/.test(v))throw Error('META_SYSVAR credential format unsupported');return v}
async function graph(path,token,params={},version=META_VERSION,budget=null){if(!/^v[0-9]+\.0$/.test(version))throw Error('invalid_graph_version');let u=new URL('https://graph.facebook.com/'+version+'/'+path.replace(/^\//,''));for(let [k,v] of Object.entries(params))u.searchParams.set(k,String(v));let attempts=0;while(true){if(budget&&(budget.calls>=12||Date.now()>budget.deadline))throw Error("meta_request_budget");if(budget)budget.calls++;let res;try{res=await fetch(u.toString(),{redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)})}catch{throw Error('network_unavailable')}if(res.status===429||res.status>=500){if(attempts++<2){await new Promise(r=>setTimeout(r,400*2**attempts));continue}throw Error('rate_limited_or_unavailable')}let obj;try{obj=await res.json()}catch{throw Error('invalid_graph_response')}if(!res.ok||obj.error){let code=obj?.error?.code||res.status;const e=Error('Graph error '+String(Number(code)||res.status));e.category=metaErrorCategory(obj.error,res.status);e.subcode=Number(obj.error?.error_subcode)||null;throw e}return obj}}
async function graphPages(path,token,params,max=10){let all=[],cursor;for(let i=0;i<max;i++){let data=await graph(path,token,{...params,...(cursor?{after:cursor}:{})});if(!Array.isArray(data.data))throw Error('unexpected_pagination');all.push(...data.data);let next=data.paging?.cursors?.after;if(!next||next===cursor||!data.paging?.next)break;cursor=next}return all}
async function metaIssue(db,asset,kind,metric,reason){await db.put('meta_capabilities',{asset_id:asset,kind,metric,status:'unavailable',reason:reason.slice(0,100),checked_at:contentNow()});}
function safeMetricValues(raw){let values=[];for(let v of raw?.values||[])if(typeof v.value==='number'&&Number.isFinite(v.value))values.push({at:v.end_time||null,value:v.value});return values}


async function metaSync(env){
 await contentReady(env);const db=env.STORE,token=metaCredential(env.META_SYSVAR),version=env.META_GRAPH_VERSION||META_VERSION,lease=crypto.randomUUID();
 if(!await db.claim('content_jobs','meta_collect',lease,600000))return {status:'already_running'};
 let state={},asset=null,phase='discovery';
 const budget={calls:0,deadline:Date.now()+80000},call=(p,t,q)=>graph(p,t,q,version,budget);
 try{
  const {tables}=await db.snapshot(['meta_assets','meta_content','meta_capabilities','content_collect_state']);
  state=JSON.parse(tables.content_collect_state.find(r=>r.id==='meta')?.payload||'{}');
  const capabilities=tables.meta_capabilities,assetRows=[],mediaRows=[],snapshotRows=[],capabilityRows=[],extraState=[],posts=[];
  let discovered;try{discovered=await call('me/accounts',token,{fields:'id,name,instagram_business_account,access_token',limit:10,...(state.pages_after?{after:state.pages_after}:{})});}catch(e){if(!/^Graph error (100|200)$/.test(e.message))throw e;const me=await call('me',token,{fields:'id,name,instagram_business_account'});discovered={data:me.id?[me]:[]};}
  if(!Array.isArray(discovered.data))throw Error('discovery_data_missing');
  if(discovered.paging?.next&&!discovered.paging?.cursors?.after)throw Error('discovery_cursor_missing');
  const freshTokens=new Map();for(const page of discovered.data){if(!page.id)continue;const id=String(page.id);freshTokens.set(id,page.access_token||token);assetRows.push({id,platform:'facebook',name:clean(page.name,200),page_id:null,updated_at:contentNow()});if(page.instagram_business_account?.id)assetRows.push({id:String(page.instagram_business_account.id),platform:'instagram',name:clean(page.name,200),page_id:id,updated_at:contentNow()});}
  state.pages_after=discovered.paging?.next?discovered.paging.cursors.after:null;
  if(!state.pages_after)state.discovery_completed_at=contentNow();state.discovery_checked_at=contentNow();
  const assets=[...new Map([...tables.meta_assets,...assetRows].map(a=>[a.id,a])).values()];
  if(!assets.length)throw Error('no_accessible_pages_on_discovery_page');
  // Least recently attempted account wins, including failed accounts. A bad account cannot starve the rest.
  asset=assets.sort((a,b)=>String(state[a.id]?.attempted_at||'').localeCompare(String(state[b.id]?.attempted_at||'')))[0];
  const st=state[asset.id]||{};state[asset.id]=st;st.attempted_at=contentNow();
  const phases=asset.platform==='instagram'?['recent','history','account','revisit','stories']:['recent','history','account','revisit'];
  phase=phases[(st.turn||0)%phases.length];st.turn=(st.turn||0)+1;st.phase=phase;
  const pageId=asset.page_id||asset.id;let accountToken=freshTokens.get(pageId);
  if(!accountToken){const auth=await call(pageId,token,{fields:'id,access_token'});accountToken=auth.access_token||token;}
  const stats={status:'ok',asset_id:asset.id,platform:asset.platform,phase,media:0,metric_failures:0,api_version:version,collection:'bounded_incremental',history_complete:!!st.history_complete,more_available:false};
  async function probe(id,kind,spec){const metric=spec.key||spec.metric,at=contentNow();try{
    const params={metric:spec.metric,...spec.params};if(params.period==='day'){const until=Math.floor(Date.now()/86400000)*86400;params.since=until-86400;params.until=until;}
    const res=await call(spec.field?id:id+'/insights',accountToken,spec.field?{fields:spec.field}:params),entry=spec.field?{total_value:{value:res[spec.field]}}:(res.data||[]).find(x=>x.name===spec.metric),value=metaObservation(entry);
    const source_period=spec.field?'point_in_time':params.period==='day'?'day:'+new Date(params.since*1000).toISOString().slice(0,10):params.timeframe?'lifetime:'+params.timeframe:'lifetime';
    if(value.value!==undefined)snapshotRows.push({asset_id:id,kind,metric,observed_at:at,value:value.value,source_period});
    if(value.breakdowns)extraState.push({id:'meta:breakdown:'+id+':'+metric,payload:JSON.stringify({asset_id:id,kind,metric,observed_at:at,source_period,...value})});
    capabilityRows.push({asset_id:id,kind,metric,status:'available',reason:version+'; '+source_period+(value.breakdowns?'; breakdown':'') ,checked_at:at});return value.value;
   }catch(e){stats.metric_failures++;capabilityRows.push({asset_id:id,kind,metric,status:'unavailable',reason:version+'; '+metaReason(e)+(e.subcode?'; subcode='+e.subcode:''),checked_at:at});return null;}}
  if(phase==='account'){
   const kind=asset.platform==='instagram'?'account':'page',due=metaDue(metaCatalog(asset.platform,kind),asset.id,kind,capabilities);for(const spec of due)await probe(asset.id,kind,spec);if(due.length)st.account_checked_at=contentNow();
  }else{
   const fields=asset.platform==='instagram'?'id,media_type,media_product_type,timestamp,caption,permalink,thumbnail_url,media_url,like_count,comments_count':'id,created_time,message,permalink_url,full_picture';
   let items=[];
   if(phase==='revisit'){
    const candidates=tables.meta_content.filter(r=>r.asset_id===asset.id&&r.kind!=='STORY').sort((a,b)=>{const time=r=>JSON.parse(tables.content_collect_state.find(x=>x.id==='meta:post:'+r.id)?.payload||'{}').checked_at||'';return time(a).localeCompare(time(b))||a.id.localeCompare(b.id)}).slice(0,2);
    for(const r of candidates){try{items.push(await call(r.id,accountToken,{fields}));}catch(e){extraState.push({id:'meta:post:'+r.id,payload:JSON.stringify({checked_at:contentNow(),error:metaReason(e)})});stats.metric_failures++;}}
   }else if(phase!=='history'||!st.history_complete){
    const edge=asset.platform==='instagram'?(phase==='stories'?'stories':'media'):'published_posts',cursor=phase==='history'?st.after:phase==='stories'?st.story_after:null;
    const page=await call(asset.id+'/'+edge,accountToken,{fields,limit:2,...(cursor?{after:cursor}:{})});
    if(!Array.isArray(page?.data))throw Error('media_response_data_missing');if(page.paging?.next&&!page.paging?.cursors?.after)throw Error('media_cursor_missing');
    if(cursor&&page.paging?.next&&page.paging.cursors.after===cursor)throw Error('media_cursor_not_advancing');
    items=page.data;stats.more_available=!!page.paging?.next;
    if(phase==='history'){st.after=page.paging?.next?page.paging.cursors.after:null;st.history_complete=!st.after;st.history_checked_at=contentNow();}
    if(phase==='stories')st.story_after=page.paging?.next?page.paging.cursors.after:null;
   }
   for(const item of items){
    if(!item.id)throw Error('media_id_missing');const id=String(item.id),kind=asset.platform==='instagram'?(phase==='stories'?'STORY':item.media_product_type==='REELS'?'REELS':item.media_type||'IMAGE'):'POST',at=contentNow();
    const metrics=metricObject({likes:item.like_count,comments:item.comments_count});
    if(asset.platform==='facebook'){try{const counts=await call(id,accountToken,{fields:'likes.limit(0).summary(true),comments.limit(0).summary(true),shares'});Object.assign(metrics,metricObject({likes:counts.likes?.summary?.total_count,comments:counts.comments?.summary?.total_count,shares:counts.shares?.count}));}catch(e){stats.metric_failures++;capabilityRows.push({asset_id:id,kind,metric:'engagement_fields',status:'unavailable',reason:metaReason(e),checked_at:at});}}
    for(const [metric,value] of Object.entries(metrics)){snapshotRows.push({asset_id:id,kind,metric,observed_at:at,value,source_period:'lifetime'});capabilityRows.push({asset_id:id,kind,metric,status:'available',reason:version+'; object field',checked_at:at});}
    for(const spec of metaDue(metaCatalog(asset.platform,kind),id,kind,[...capabilities,...capabilityRows])){const v=await probe(id,kind,spec);if(v!==null&&CONTENT_METRICS.has(spec.alias||spec.metric))metrics[spec.alias||spec.metric]=v;}
    mediaRows.push({id,asset_id:asset.id,platform:asset.platform,kind,published_at:item.timestamp||item.created_time||'',caption:clean(item.caption||item.message,1200),permalink:producerURL(item.permalink||item.permalink_url||''),thumbnail_url:contentPreview(item.thumbnail_url||item.full_picture||item.media_url),first_seen:at,last_seen:at});
    extraState.push({id:'meta:post:'+id,payload:JSON.stringify({checked_at:at})});
    const permalink=item.permalink||item.permalink_url;if(permalink){try{posts.push(postRecord({platform:asset.platform,account_id:asset.id,account_handle:asset.name,post_id:id,permalink,media_type:kind,published_at:item.timestamp||item.created_time,caption:item.caption||item.message||'',preview_url:item.media_url||item.full_picture||item.thumbnail_url,preview_type:item.media_url&&['VIDEO','REELS'].includes(kind)?'video':'image',metrics}));}catch{capabilityRows.push({asset_id:id,kind,metric:'registry_permalink',status:'unavailable',reason:'unsupported_canonical_permalink',checked_at:at});}}
   }
  }
  stats.media=mediaRows.length;stats.history_complete=!!st.history_complete;stats.status=stats.metric_failures?'partial':'ok';
  const at=contentNow(),result={asset_id:asset.id,platform:asset.platform,phase,checked_at:at,media_fetched:mediaRows.length,posts_registered:posts.length,missing_permalink:mediaRows.filter(r=>!r.permalink).length,rejected_permalink:capabilityRows.filter(r=>r.metric==='registry_permalink').length,metric_failures:stats.metric_failures,more_available:stats.more_available,api_calls:budget.calls,outcome:phase==='account'?'account_probed':phase==='history'&&stats.history_complete&&!st.after&&!(mediaRows.length||stats.more_available)?'history_exhausted':phase==='revisit'&&!mediaRows.length?'no_revisit_media':!mediaRows.length?'empty_response':posts.length?'collected':'no_registerable_posts'};
  st.last_result=result;st.last_error=null;state.last_result=result;
  await db.transact(['content_jobs','content_collect_state','meta_assets','meta_content','meta_snapshots','meta_capabilities','content_posts','content_observations','content_sheet_outbox'],tx=>{
   const job=tx.find('content_jobs',{id:'meta_collect'});if(job.lease!==lease||job.lease_until<Date.now())throw Error('store_job_lease_lost');
   for(const row of assetRows)tx.put('meta_assets',row);for(const row of mediaRows)tx.put('meta_content',{...row,first_seen:tx.find('meta_content',{id:row.id})?.first_seen||row.first_seen});
   for(const row of snapshotRows)tx.put('meta_snapshots',row);for(const row of capabilityRows)tx.put('meta_capabilities',row);for(const row of extraState)tx.put('content_collect_state',row);
   mergePostRecords(tx,posts,at);tx.put('content_collect_state',{id:'meta',payload:JSON.stringify(state)});Object.assign(job,{status:stats.status,last_success:at,error_code:null,lease:null,lease_until:null});
  });console.log(JSON.stringify({event:'meta_collection_result',...result}));return stats;
 }catch(e){const reason=metaReason(e);await db.transact(['content_jobs','content_collect_state'],tx=>{const job=tx.find('content_jobs',{id:'meta_collect'});if(job?.lease!==lease)return;if(asset){state[asset.id].last_error=reason;tx.put('content_collect_state',{id:'meta',payload:JSON.stringify(state)});}Object.assign(job,{status:'failed',error_code:reason,lease:null,lease_until:null});});throw Error(reason);}
}
async function metaProgress(env){
 const {tables:t}=await env.STORE.snapshot(['content_jobs','content_collect_state','meta_assets','meta_content','meta_capabilities']);
 const state=JSON.parse(t.content_collect_state.find(r=>r.id==='meta')?.payload||'{}'),job=t.content_jobs.find(r=>r.id==='meta_collect')||{},request=t.content_collect_state.find(r=>r.id==='request:meta_collect');
 const status=job.lease_until>Date.now()?'running':request?'queued':job.lease?'stale':job.status==='ok'?'completed':job.status||'never';
 return {status,enabled:env.META_SYNC_ENABLED==='1',last_attempt:job.last_attempt,last_success:job.last_success,error_code:job.error_code,queued:!!request,last_result:state.last_result||null,discovery_completed_at:state.discovery_completed_at||null,discovery_in_progress:!!state.pages_after,
 accounts:t.meta_assets.map(a=>{const st=state[a.id]||{};return {id:a.id,platform:a.platform,name:a.name,attempted_at:st.attempted_at||null,phase:st.phase||'not_checked',history_complete:st.history_complete===true,history_checked_at:st.history_checked_at||null,account_checked_at:st.account_checked_at||null,last_result:st.last_result||null,last_error:st.last_error||null,stored_posts:t.meta_content.filter(p=>p.asset_id===a.id).length}}),
 stale_capabilities:t.meta_capabilities.filter(r=>Date.now()-Date.parse(r.checked_at)>86400000).length,coverage_note:'Discovery and pagination exhaustion describe accessible API responses; they do not prove all historical content is accessible.'};
}
async function metaCoverage(env){
 const {tables:t}=await env.STORE.snapshot(['meta_assets','meta_content','meta_capabilities']);const rows=new Map(t.meta_capabilities.map(r=>[[r.asset_id,r.kind,r.metric].join('|'),r]));
 for(const item of [...t.meta_assets.map(a=>({...a,kind:a.platform==='instagram'?'account':'page'})),...t.meta_content])for(const spec of metaCatalog(item.platform,item.kind)){const metric=spec.key||spec.metric,key=[item.id,item.kind,metric].join('|');if(!rows.has(key))rows.set(key,{asset_id:item.id,kind:item.kind,metric,status:'not_checked',reason:'Awaiting bounded probe',checked_at:null});}
 return [...rows.values()].map(r=>({...r,stale:r.checked_at?Date.now()-Date.parse(r.checked_at)>86400000:false}));
}
async function metaApi(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(p==='/api/meta/sync'&&req.method==='POST'){try{metaCredential(env.META_SYSVAR);return json({ok:true,result:await queueStoredJob(env,'meta_collect')},202)}catch(e){const codes={'META_SYSVAR missing':'meta_credential_missing','META_SYSVAR structure invalid':'meta_credential_invalid_json','META_SYSVAR has no supported access token field':'meta_credential_token_field_missing','META_SYSVAR credential format unsupported':'meta_credential_format_unsupported'};return json({error:codes[e.message]||(/^[a-z][a-z0-9_]{2,100}$/.test(e.message||'')?e.message:'meta_sync_failed_check_job_status')},503)}}
 if(req.method!=='GET')return error('Not found',404);
 if(p==='/api/meta/status')return json(await metaProgress(env));
 if(p==='/api/meta/coverage'){const rows=await metaCoverage(env),offset=Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0));return json({rows:rows.slice(offset,offset+1000),next_offset:offset+1000<rows.length?offset+1000:null,total:rows.length});}
 if(p==='/api/meta/account-observations'){const {tables}=await env.STORE.snapshot(['meta_snapshots','content_collect_state']);const rows=storeSort(tables.meta_snapshots.filter(r=>['account','page'].includes(r.kind)),'-observed_at').slice(0,500),breakdowns=tables.content_collect_state.filter(r=>r.id.startsWith('meta:breakdown:')).map(r=>JSON.parse(r.payload));return json({rows,breakdowns:breakdowns.slice(0,500),limit:500});}

 const tables={'/api/meta/assets':['meta_assets','platform','name'],'/api/meta/content':['meta_content','-published_at'],'/api/meta/capabilities':['meta_capabilities','asset_id','kind','metric']};
 if(tables[p]){const [table,...order]=tables[p],all=storeSort(table==='meta_capabilities'?await metaCoverage(env):await env.STORE.rows(table),...order),limit=table==='meta_content'?1000:10000;return json({rows:all.slice(0,limit),truncated:all.length>limit});}
 if(p==='/api/meta/series'){const id=u.searchParams.get('id'),metric=u.searchParams.get('metric');if(!/^\d{1,30}(?:_\d{1,30})?$/.test(id||'')||!/^[a-z_:]{2,100}$/.test(metric||''))return error('Invalid selection',400);const rows=storeSort((await env.STORE.rows('meta_snapshots')).filter(r=>r.asset_id===id&&r.metric===metric),'observed_at');return json({rows:rows.slice(0,5000),truncated:rows.length>5000});}
 return error('Not found',404);
}


async function metaPreview(env,row){
 if(!row||!['facebook','instagram'].includes(row.platform))return null;
 const asset=await env.STORE.find('meta_assets',{id:row.account_id});if(!asset)return null;
 const token=metaCredential(env.META_SYSVAR),version=env.META_GRAPH_VERSION||META_VERSION,budget={calls:0,deadline:Date.now()+20000};
 const page=await graph(asset.page_id||asset.id,token,{fields:'id,access_token'},version,budget);
 const data=await graph(row.post_id,page.access_token||token,{fields:row.platform==='instagram'?'id,media_url,thumbnail_url,media_type':'id,full_picture'},version,budget);
 const url=contentPreview(data.media_url||data.thumbnail_url||data.full_picture);
 return {url,kind:data.media_url&&data.media_type==='VIDEO'?'video':'image',available:!!url,refreshed:true};
}
