// Meta analytics extension for the dashboard. Bundled into worker.js by build_single_worker.py.
// META_SYSVAR may be a token or JSON containing access_token/token. Never persist either.
const META_VERSION='v24.0';
const IG_METRICS={IMAGE:['views','reach','likes','comments','saved','shares','total_interactions'],VIDEO:['views','reach','likes','comments','saved','shares','total_interactions'],CAROUSEL_ALBUM:['views','reach','likes','comments','saved','shares','total_interactions'],REELS:['views','reach','likes','comments','saved','shares','total_interactions','ig_reels_avg_watch_time','ig_reels_video_view_total_time','clips_replays_count','reels_skip_rate'],STORY:['views','reach','replies','shares','navigation','taps_forward','taps_back','exits','follows','profile_visits']};
const IG_ACCOUNT_METRICS=['reach','views','accounts_engaged','total_interactions','follower_count','profile_views','website_clicks'];
const PAGE_METRICS=['page_impressions','page_post_engagements','page_fans','page_fan_adds','page_views_total'];
function metaCredential(raw){if(!raw||typeof raw!=='string')throw Error('META_SYSVAR missing');let v=raw.trim();if(v.startsWith('{')){let obj;try{obj=JSON.parse(v)}catch{throw Error('META_SYSVAR structure invalid')}v=obj.access_token||obj.token||obj.page_access_token||obj.user_access_token;if(typeof v!=='string')throw Error('META_SYSVAR has no supported access token field')}if(!/^[A-Za-z0-9._-]{20,}$/.test(v))throw Error('META_SYSVAR credential format unsupported');return v}
async function graph(path,token,params={},version=META_VERSION){if(!/^v[0-9]+\.0$/.test(version))throw Error('invalid_graph_version');let u=new URL('https://graph.facebook.com/'+version+'/'+path.replace(/^\//,''));for(let [k,v] of Object.entries(params))u.searchParams.set(k,String(v));let attempts=0;while(true){let res;try{res=await fetch(u.toString(),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)})}catch{throw Error('network_unavailable')}if(res.status===429||res.status>=500){if(attempts++<2){await new Promise(r=>setTimeout(r,400*2**attempts));continue}throw Error('rate_limited_or_unavailable')}let obj;try{obj=await res.json()}catch{throw Error('invalid_graph_response')}if(!res.ok||obj.error){let code=obj?.error?.code||res.status;throw Error('Graph error '+String(code).slice(0,8))}return obj}}
async function graphPages(path,token,params,max=10){let all=[],cursor;for(let i=0;i<max;i++){let data=await graph(path,token,{...params,...(cursor?{after:cursor}:{})});if(!Array.isArray(data.data))throw Error('unexpected_pagination');all.push(...data.data);let next=data.paging?.cursors?.after;if(!next||next===cursor||!data.paging?.next)break;cursor=next}return all}
async function metaIssue(db,asset,kind,metric,reason){await db.put('meta_capabilities',{asset_id:asset,kind,metric,status:'unavailable',reason:reason.slice(0,100),checked_at:contentNow()});}
function safeMetricValues(raw){let values=[];for(let v of raw?.values||[])if(typeof v.value==='number'&&Number.isFinite(v.value))values.push({at:v.end_time||null,value:v.value});return values}

async function metaSync(env){
 await contentReady(env);
 const db=env.STORE,token=metaCredential(env.META_SYSVAR),version=env.META_GRAPH_VERSION||META_VERSION,lease=crypto.randomUUID();
 const lock=await db.claim('content_jobs','meta_collect',lease,600000);
 if(!lock)return {status:'already_running'};
 try{
  const assetRows=[],mediaRows=[],snapshotRows=[],capabilityRows=[];const buffered={put:async(t,row)=>{if(t!=='meta_capabilities')throw Error('invalid_buffer_table');capabilityRows.push(row);}};
  let state=await db.find('content_collect_state',{id:'meta'});state=state?JSON.parse(state.payload):{};
  // Page tokens are transient. Never store access_token or a paging.next URL in storage.
  let discovered;try{discovered=await graph('me/accounts',token,{fields:'id,name,instagram_business_account,access_token',limit:10,...(state.pages_after?{after:state.pages_after}:{})},version)}catch(e){if(!/^Graph error (100|200)$/.test(e.message))throw e;discovered={data:[]};}
  let pages=discovered.data||[];
  if(!pages.length){try{const me=await graph('me',token,{fields:'id,name,instagram_business_account'},version);if(me.id)pages=[me]}catch{}}
  const assets=[];for(const page of pages){if(!page.id)continue;assets.push({id:String(page.id),platform:'facebook',name:page.name||'',page_id:null,token:page.access_token||token});if(page.instagram_business_account?.id)assets.push({id:String(page.instagram_business_account.id),platform:'instagram',name:page.name||'',page_id:String(page.id),token:page.access_token||token});}
  if(!assets.length)throw Error('no_accessible_pages_on_discovery_page');
  for(const a of assets)assetRows.push({id:a.id,platform:a.platform,name:clean(a.name,200),page_id:a.page_id,updated_at:contentNow()});
  const index=(state.asset_index||0)%assets.length,asset=assets[index],st=state[asset.id]||{},phase=st.phase||'recent',stats={status:'ok',asset_id:asset.id,platform:asset.platform,phase,media:0,metric_failures:0,api_version:version,collection:'bounded_incremental',history_complete:false};
  const edge=asset.platform==='instagram'?(phase==='stories'?'stories':'media'):'published_posts';
  const fields=asset.platform==='instagram'?'id,media_type,media_product_type,timestamp,caption,permalink,thumbnail_url,media_url,like_count,comments_count':'id,created_time,message,permalink_url,full_picture';
  const cursor=phase==='history'?st.after:phase==='stories'?st.story_after:st.recent_after;
  const page=await graph(asset.id+'/'+edge,asset.token,{fields,limit:2,...(cursor?{after:cursor}:{})},version);stats.more_available=!!page.paging?.next;
  if(page.paging?.next&&!page.paging?.cursors?.after)throw Error('media_cursor_missing');
  const posts=[];
  for(const item of page.data||[]){
   const kind=asset.platform==='instagram'?(phase==='stories'?'STORY':item.media_product_type==='REELS'?'REELS':item.media_type||'IMAGE'):'POST';
   // Active Stories without stable permalinks remain in meta_content; do not fabricate a shareable URL.
   mediaRows.push({id:String(item.id),asset_id:asset.id,platform:asset.platform,kind,published_at:item.timestamp||item.created_time||'',caption:clean(item.caption||item.message,1200),permalink:producerURL(item.permalink||item.permalink_url||''),thumbnail_url:contentPreview(item.thumbnail_url||item.full_picture||item.media_url),first_seen:contentNow(),last_seen:contentNow()});
   const metrics=metricObject({likes:item.like_count,comments:item.comments_count});
   const catalog=asset.platform==='instagram'?(IG_METRICS[kind]||[]):['post_impressions','post_engaged_users'];
   const metricOffset=(st.metric_cursor||0)%Math.max(1,catalog.length),candidates=[...catalog,...catalog].slice(metricOffset,metricOffset+Math.min(2,catalog.length));
   stats.metric_candidates=candidates;stats.metric_rotation=true;
   for(const metric of candidates){try{
    const res=await graph(String(item.id)+'/insights',asset.token,{metric},version);const entry=(res.data||[]).find(x=>x.name===metric),v=entry?.total_value?.value??entry?.values?.at(-1)?.value;
    if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('metric_returned_no_numeric_value');
    if(CONTENT_METRICS.has(metric))metrics[metric]=v;
    snapshotRows.push({asset_id:String(item.id),kind,metric,observed_at:contentNow(),value:v,source_period:'lifetime'});capabilityRows.push({asset_id:String(item.id),kind,metric,status:'available',reason:version+'; cumulative count; '+String(item.id)+'/insights',checked_at:contentNow()});
   }catch(e){stats.metric_failures++;await metaIssue(buffered,String(item.id),kind,metric,version+'; '+e.message);}}
   const permalink=item.permalink||item.permalink_url;
   if(permalink){try{canonicalPostURL(permalink,asset.platform);posts.push({platform:asset.platform,account_id:asset.id,account_handle:asset.name,post_id:String(item.id),permalink,media_type:kind,published_at:item.timestamp||item.created_time,caption:item.caption||item.message||'',preview_url:item.media_url||item.full_picture||item.thumbnail_url,preview_type:['VIDEO','REELS'].includes(kind)?'video':'image',metrics})}catch{await metaIssue(buffered,String(item.id),kind,'registry_permalink','unsupported_or_missing_canonical_permalink');}}
   stats.media++;
  }

  if(phase==='history'){st.after=page.paging?.next?page.paging?.cursors?.after:null;st.history_complete=!st.after;st.phase=asset.platform==='instagram'?'stories':'recent';}
  else if(phase==='stories'){st.story_after=page.paging?.next?page.paging?.cursors?.after:null;st.phase='recent';}else{st.recent_after=page.paging?.next?page.paging?.cursors?.after:null;st.phase=st.history_complete?(asset.platform==='instagram'?'stories':'recent'):'history';}
  st.metric_cursor=(st.metric_cursor||0)+2;state[asset.id]=st;state.asset_index=index+1;
  if(state.asset_index>=assets.length){state.asset_index=0;state.pages_after=discovered.paging?.next?discovered.paging?.cursors?.after:null;}
  stats.history_complete=!!st.history_complete;stats.status=stats.metric_failures?'partial':'ok';
  const records=posts.map(postRecord),at=contentNow();
  await db.transact(['content_jobs','content_collect_state','meta_assets','meta_content','meta_snapshots','meta_capabilities','content_posts','content_observations','content_sheet_outbox'],tx=>{
   const job=tx.find('content_jobs',{id:'meta_collect'});if(job.lease!==lease||job.lease_until<Date.now())throw Error('store_job_lease_lost');
   for(const row of assetRows)tx.put('meta_assets',row);
   for(const row of mediaRows){const old=tx.find('meta_content',{id:row.id});tx.put('meta_content',{...row,first_seen:old?.first_seen||row.first_seen});}
   for(const row of snapshotRows)tx.put('meta_snapshots',row);for(const row of capabilityRows)tx.put('meta_capabilities',row);
   mergePostRecords(tx,records,at);
   tx.put('content_collect_state',{id:'meta',payload:JSON.stringify(state)});
   Object.assign(job,{status:stats.status,last_success:at,error_code:null,lease:null,lease_until:null});
  });return stats;
 }catch(e){const reason=/^Graph error [0-9]+$/.test(e.message)||/^[a-z_]+$/.test(e.message)?e.message:'meta_collection_failed';await db.finish('content_jobs','meta_collect',lease,{status:'failed',error_code:reason});throw Error(reason);}
}
async function metaApi(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(p==='/api/meta/sync'&&req.method==='POST'){try{metaCredential(env.META_SYSVAR);return json({ok:true,result:await queueStoredJob(env,'meta_collect')},202)}catch(e){const codes={'META_SYSVAR missing':'meta_credential_missing','META_SYSVAR structure invalid':'meta_credential_invalid_json','META_SYSVAR has no supported access token field':'meta_credential_token_field_missing','META_SYSVAR credential format unsupported':'meta_credential_format_unsupported'};return json({error:codes[e.message]||(/^[a-z][a-z0-9_]{2,100}$/.test(e.message||'')?e.message:'meta_sync_failed_check_job_status')},503)}}
 if(req.method!=='GET')return error('Not found',404);
 const tables={'/api/meta/assets':['meta_assets','platform','name'],'/api/meta/content':['meta_content','-published_at'],'/api/meta/capabilities':['meta_capabilities','asset_id','kind','metric']};
 if(tables[p]){const [table,...order]=tables[p],all=storeSort(await env.STORE.rows(table),...order),limit=table==='meta_content'?1000:10000;return json({rows:all.slice(0,limit),truncated:all.length>limit});}
 if(p==='/api/meta/series'){const id=u.searchParams.get('id'),metric=u.searchParams.get('metric');if(!/^\d{5,30}$/.test(id||'')||!/^[a-z_]{2,70}$/.test(metric||''))return error('Invalid selection',400);const rows=storeSort((await env.STORE.rows('meta_snapshots')).filter(r=>r.asset_id===id&&r.metric===metric),'observed_at');return json({rows:rows.slice(0,5000),truncated:rows.length>5000});}
 return error('Not found',404);
}
