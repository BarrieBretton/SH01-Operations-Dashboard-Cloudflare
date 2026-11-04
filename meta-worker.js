// Meta analytics extension for the dashboard. Bundled into worker.js by build_single_worker.py.
// META_SYSVAR may be a token or JSON containing access_token/token. Never persist either.
const META_VERSION='v24.0';
const IG_METRICS={IMAGE:['views','reach','likes','comments','saved','shares','total_interactions'],VIDEO:['views','reach','likes','comments','saved','shares','total_interactions'],CAROUSEL_ALBUM:['views','reach','likes','comments','saved','shares','total_interactions'],REELS:['views','reach','likes','comments','saved','shares','total_interactions','ig_reels_avg_watch_time','ig_reels_video_view_total_time','clips_replays_count','reels_skip_rate'],STORY:['views','reach','replies','shares','navigation','taps_forward','taps_back','exits','follows','profile_visits']};
const IG_ACCOUNT_METRICS=['reach','views','accounts_engaged','total_interactions','follower_count','profile_views','website_clicks'];
const PAGE_METRICS=['page_impressions','page_post_engagements','page_fans','page_fan_adds','page_views_total'];
function metaCredential(raw){if(!raw||typeof raw!=='string')throw Error('META_SYSVAR missing');let v=raw.trim();if(v.startsWith('{')){let obj;try{obj=JSON.parse(v)}catch{throw Error('META_SYSVAR structure invalid')}v=obj.access_token||obj.token||obj.page_access_token||obj.user_access_token;if(typeof v!=='string')throw Error('META_SYSVAR has no supported access token field')}if(!/^[A-Za-z0-9._-]{20,}$/.test(v))throw Error('META_SYSVAR credential format unsupported');return v}
async function graph(path,token,params={},version=META_VERSION){if(!/^v[0-9]+\.0$/.test(version))throw Error('invalid_graph_version');let u=new URL('https://graph.facebook.com/'+version+'/'+path.replace(/^\//,''));for(let [k,v] of Object.entries(params))u.searchParams.set(k,String(v));let attempts=0;while(true){let res;try{res=await fetch(u.toString(),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)})}catch{throw Error('network_unavailable')}if(res.status===429||res.status>=500){if(attempts++<2){await new Promise(r=>setTimeout(r,400*2**attempts));continue}throw Error('rate_limited_or_unavailable')}let obj;try{obj=await res.json()}catch{throw Error('invalid_graph_response')}if(!res.ok||obj.error){let code=obj?.error?.code||res.status;throw Error('Graph error '+String(code).slice(0,8))}return obj}}
async function graphPages(path,token,params,max=10){let all=[],cursor;for(let i=0;i<max;i++){let data=await graph(path,token,{...params,...(cursor?{after:cursor}:{})});if(!Array.isArray(data.data))throw Error('unexpected_pagination');all.push(...data.data);let next=data.paging?.cursors?.after;if(!next||next===cursor||!data.paging?.next)break;cursor=next}return all}
async function metaIssue(db,asset,kind,metric,reason){await db.prepare('INSERT INTO meta_capabilities(asset_id,kind,metric,status,reason,checked_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(asset_id,kind,metric) DO UPDATE SET status=excluded.status,reason=excluded.reason,checked_at=CURRENT_TIMESTAMP').bind(asset,kind,metric,'unavailable',reason.slice(0,100)).run()}
function safeMetricValues(raw){let values=[];for(let v of raw?.values||[])if(typeof v.value==='number'&&Number.isFinite(v.value))values.push({at:v.end_time||null,value:v.value});return values}
async function metricProbe(db,id,kind,metric,token,params={}){try{let data=await graph(id+'/insights',token,{metric,...params});let series=(data.data||[]).filter(x=>x.name===metric).flatMap(x=>safeMetricValues(x));await db.prepare('INSERT INTO meta_capabilities(asset_id,kind,metric,status,reason,checked_at) VALUES(?,?,?,?,?,CURRENT_TIMESTAMP) ON CONFLICT(asset_id,kind,metric) DO UPDATE SET status=excluded.status,reason=excluded.reason,checked_at=CURRENT_TIMESTAMP').bind(id,kind,metric,'available','').run();for(let item of series){let at=item.at||new Date().toISOString();await db.prepare('INSERT INTO meta_snapshots(asset_id,kind,metric,observed_at,value,source_period) VALUES(?,?,?,?,?,?) ON CONFLICT(asset_id,kind,metric,observed_at) DO UPDATE SET value=excluded.value').bind(id,kind,metric,at,item.value,params.period||'lifetime').run()}return series.length}catch(e){await metaIssue(db,id,kind,metric,e.message);return 0}}
// Each run records one small page for one asset; successive runs advance history.
async function metaSync(env){
 if(!await contentReady(env))throw Error('content_schema_missing');
 const db=env.DB,token=metaCredential(env.META_SYSVAR),version=env.META_GRAPH_VERSION||META_VERSION,lease=crypto.randomUUID();
 const lock=await db.prepare("UPDATE content_jobs SET lease=?,lease_until=?,status='running',last_attempt=?,error_code=NULL WHERE id='meta_collect' AND (lease_until IS NULL OR lease_until<?)").bind(lease,Date.now()+240000,contentNow(),Date.now()).run();
 if(!lock.meta.changes)return {status:'already_running'};
 try{
  let state=await db.prepare("SELECT payload FROM content_collect_state WHERE id='meta'").first();state=state?JSON.parse(state.payload):{};
  // Page tokens are transient. Never store access_token or a paging.next URL in D1.
  let discovered;try{discovered=await graph('me/accounts',token,{fields:'id,name,instagram_business_account,access_token',limit:10,...(state.pages_after?{after:state.pages_after}:{})},version)}catch(e){if(!/^Graph error (100|200)$/.test(e.message))throw e;discovered={data:[]};}
  let pages=discovered.data||[];
  if(!pages.length){try{const me=await graph('me',token,{fields:'id,name,instagram_business_account'},version);if(me.id)pages=[me]}catch{}}
  const assets=[];for(const page of pages){if(!page.id)continue;assets.push({id:String(page.id),platform:'facebook',name:page.name||'',page_id:null,token:page.access_token||token});if(page.instagram_business_account?.id)assets.push({id:String(page.instagram_business_account.id),platform:'instagram',name:page.name||'',page_id:String(page.id),token:page.access_token||token});}
  if(!assets.length)throw Error('no_accessible_pages_on_discovery_page');
  await db.batch(assets.map(a=>db.prepare('INSERT INTO meta_assets(id,platform,name,page_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,page_id=excluded.page_id,updated_at=excluded.updated_at').bind(a.id,a.platform,a.name,a.page_id,contentNow())));
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
   await db.prepare('INSERT INTO meta_content(id,asset_id,platform,kind,published_at,caption,permalink,thumbnail_url,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET caption=excluded.caption,permalink=excluded.permalink,thumbnail_url=excluded.thumbnail_url,last_seen=excluded.last_seen').bind(String(item.id),asset.id,asset.platform,kind,item.timestamp||item.created_time||'',clean(item.caption||item.message,1200),item.permalink||item.permalink_url||'',contentPreview(item.thumbnail_url||item.full_picture||item.media_url),contentNow(),contentNow()).run();
   const metrics=metricObject({likes:item.like_count,comments:item.comments_count});
   const catalog=asset.platform==='instagram'?(IG_METRICS[kind]||[]):['post_impressions','post_engaged_users'];
   const metricOffset=(st.metric_cursor||0)%Math.max(1,catalog.length),candidates=[...catalog,...catalog].slice(metricOffset,metricOffset+Math.min(2,catalog.length));
   stats.metric_candidates=candidates;stats.metric_rotation=true;
   for(const metric of candidates){try{
    const res=await graph(String(item.id)+'/insights',asset.token,{metric},version);const entry=(res.data||[]).find(x=>x.name===metric),v=entry?.total_value?.value??entry?.values?.at(-1)?.value;
    if(typeof v!=='number'||!Number.isFinite(v)||v<0)throw Error('metric_returned_no_numeric_value');
    if(CONTENT_METRICS.has(metric))metrics[metric]=v;
    await db.prepare('INSERT INTO meta_snapshots(asset_id,kind,metric,observed_at,value,source_period) VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').bind(String(item.id),kind,metric,contentNow(),v,'lifetime').run();
    await db.prepare("INSERT INTO meta_capabilities(asset_id,kind,metric,status,reason,checked_at) VALUES(?,?,?,'available',?,?) ON CONFLICT(asset_id,kind,metric) DO UPDATE SET status=excluded.status,reason=excluded.reason,checked_at=excluded.checked_at").bind(String(item.id),kind,metric,version+'; cumulative count; '+String(item.id)+'/insights',contentNow()).run();
   }catch(e){stats.metric_failures++;await metaIssue(db,String(item.id),kind,metric,version+'; '+e.message);}}
   const permalink=item.permalink||item.permalink_url;
   if(permalink){try{canonicalPostURL(permalink,asset.platform);posts.push({platform:asset.platform,account_id:asset.id,account_handle:asset.name,post_id:String(item.id),permalink,media_type:kind,published_at:item.timestamp||item.created_time,caption:item.caption||item.message||'',preview_url:item.media_url||item.full_picture||item.thumbnail_url,preview_type:['VIDEO','REELS'].includes(kind)?'video':'image',metrics})}catch{await metaIssue(db,String(item.id),kind,'registry_permalink','unsupported_or_missing_canonical_permalink');}}
   stats.media++;
  }
  if(posts.length)await upsertPosts(env,posts,'meta_api');
  if(phase==='history'){st.after=page.paging?.next?page.paging?.cursors?.after:null;st.history_complete=!st.after;st.phase=asset.platform==='instagram'?'stories':'recent';}
  else if(phase==='stories'){st.story_after=page.paging?.next?page.paging?.cursors?.after:null;st.phase='recent';}else{st.recent_after=page.paging?.next?page.paging?.cursors?.after:null;st.phase=st.history_complete?(asset.platform==='instagram'?'stories':'recent'):'history';}
  st.metric_cursor=(st.metric_cursor||0)+2;state[asset.id]=st;state.asset_index=index+1;
  if(state.asset_index>=assets.length){state.asset_index=0;state.pages_after=discovered.paging?.next?discovered.paging?.cursors?.after:null;}
  await db.prepare("INSERT INTO content_collect_state(id,payload) VALUES('meta',?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify(state)).run();
  stats.history_complete=!!st.history_complete;stats.status=stats.metric_failures?'partial':'ok';
  await db.prepare("UPDATE content_jobs SET status=?,last_success=?,error_code=NULL,lease=NULL,lease_until=NULL WHERE id='meta_collect' AND lease=?").bind(stats.status,contentNow(),lease).run();return stats;
 }catch(e){const reason=/^Graph error [0-9]+$/.test(e.message)||/^[a-z_]+$/.test(e.message)?e.message:'meta_collection_failed';await db.prepare("UPDATE content_jobs SET status='failed',error_code=?,lease=NULL,lease_until=NULL WHERE id='meta_collect' AND lease=?").bind(reason,lease).run();throw Error(reason);}
}
async function metaApi(req,env){let p=new URL(req.url).pathname;if(p==='/api/meta/sync'&&req.method==='POST'){if(!env.META_SYSVAR)return json({error:'META_SYSVAR missing'},503);try{return json({ok:true,result:await metaSync(env)})}catch(e){return json({error:e.message==='META_SYSVAR missing'?e.message:'Meta sync failed; see capability inventory'},503)}}if(req.method!=='GET')return error('Not found',404);let sql=p==='/api/meta/assets'?'SELECT * FROM meta_assets ORDER BY platform,name':p==='/api/meta/content'?'SELECT * FROM meta_content ORDER BY published_at DESC LIMIT 1000':p==='/api/meta/capabilities'?'SELECT * FROM meta_capabilities ORDER BY asset_id,kind,metric':null;if(sql)return json({rows:(await env.DB.prepare(sql).all()).results});if(p==='/api/meta/series'){let u=new URL(req.url),id=u.searchParams.get('id'),metric=u.searchParams.get('metric');if(!/^\d{5,30}$/.test(id||'')||!/^[a-z_]{2,70}$/.test(metric||''))return error('Invalid selection',400);return json({rows:(await env.DB.prepare('SELECT observed_at,value,source_period FROM meta_snapshots WHERE asset_id=? AND metric=? ORDER BY observed_at LIMIT 5000').bind(id,metric).all()).results})}return error('Not found',404)}

