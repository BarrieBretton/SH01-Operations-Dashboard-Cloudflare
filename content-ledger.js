// Durable published-post registry and explicit, preview-first cleanup plans.
// Nothing in this module deletes a social post. clickouts is a destructive-workflow input.
const CONTENT_METRICS = new Set(['views','reach','likes','comments','shares','saved','total_interactions','notes']);
const POST_SHEET = 'meta-posts-to-id';
const POST_HEADERS = ['record_key','platform','account_id','account_handle','post_id','permalink','media_type','published_at','workflow_id','workflow_url','first_seen','last_seen','delete_status'];
const contentNow = () => new Date().toISOString();
function contentID(v) { const s=String(v??''); if(!/^[A-Za-z0-9_.:@-]{1,160}$/.test(s))throw Error('invalid_identifier'); return s; }
function contentPlatform(v) {if(!['instagram','facebook','tumblr'].includes(v))throw Error('invalid_platform');return v;}
function canonicalPostURL(value,platform) {
 const u=new URL(String(value));if(u.protocol!=='https:'||u.username||u.password)throw Error('invalid_permalink');
 const host=u.hostname.toLowerCase().replace(/^www\./,'');
 if(platform==='instagram'){
  if(host!=='instagram.com'||!/^\/(?:p|reel|tv)\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))throw Error('unsupported_instagram_permalink');
  return 'https://www.instagram.com'+u.pathname.replace(/\/$/,'')+'/';
 }
 if(platform==='facebook'){
  if(!['facebook.com','m.facebook.com','web.facebook.com'].includes(host))throw Error('unsupported_facebook_permalink');
  const out=new URL('https://www.facebook.com'+u.pathname.replace(/\/$/,''));
  for(const key of ['story_fbid','id','v'])if(u.searchParams.has(key))out.searchParams.set(key,u.searchParams.get(key));
  if(!/^\/[A-Za-z0-9_.\/-]+$/.test(out.pathname)||(!out.pathname.includes('/posts/')&&!out.pathname.includes('/videos/')&&!out.pathname.startsWith('/reel/')&&!out.search))throw Error('ambiguous_facebook_permalink');
  out.searchParams.sort();return out.href;
 }
 if(platform==='tumblr'){
  if(!(host==='tumblr.com'||host.endsWith('.tumblr.com')))throw Error('unsupported_tumblr_permalink');
  const a=u.pathname.match(/^\/post\/(\d+)/),b=u.pathname.match(/^\/([A-Za-z0-9_-]+)\/(\d+)/);
  if(a&&host!== 'tumblr.com')return 'https://www.tumblr.com/'+host.slice(0,-11)+'/'+a[1];
  if(b&&host==='tumblr.com')return 'https://www.tumblr.com/'+b[1]+'/'+b[2];
  throw Error('ambiguous_tumblr_permalink');
 }
 throw Error('invalid_platform');
}
function contentPreview(value) {
 if(!value)return '';try{const u=new URL(value),h=u.hostname.toLowerCase();
  if(u.protocol!=='https:'||u.username||u.password||!['cdninstagram.com','fbcdn.net','tumblr.com'].some(s=>h===s||h.endsWith('.'+s)))return '';
  if([...u.searchParams.keys()].some(k=>/access.?token|api.?key|password|authorization/i.test(k)))return '';
  u.hash='';return u.href;
 }catch{return '';}
}
function metricObject(obj) {
 const out={};for(const [k,v] of Object.entries(obj||{}))if(CONTENT_METRICS.has(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0)out[k]=v;return out;
}
function postRecord(x) {
 const platform=contentPlatform(x.platform),account_id=contentID(x.account_id),post_id=contentID(x.post_id);
 if(!['IMAGE','VIDEO','REELS','STORY','CAROUSEL','CAROUSEL_ALBUM','POST'].includes(x.media_type))throw Error('invalid_media_type');
 const published_at=x.published_at?iso(x.published_at):null;if(x.published_at&&!published_at)throw Error('invalid_published_time');
 const preview_url=contentPreview(x.preview_url),preview_type=['image','video'].includes(x.preview_type)?x.preview_type:'';
 let fingerprint=null;if(x.fingerprint){const s=JSON.stringify(x.fingerprint);if(s.length>40000||!x.fingerprint.algorithm||!Number.isInteger(x.fingerprint.version))throw Error('invalid_fingerprint');fingerprint=s;}
 return {platform,account_id,post_id,permalink:canonicalPostURL(x.permalink,platform),account_handle:clean(x.account_handle,150),media_type:x.media_type,published_at,caption:clean(x.caption,2000),workflow_id:x.workflow_id?contentID(x.workflow_id):'',workflow_url:producerURL(x.workflow_url||''),preview_url,preview_type,metrics:metricObject(x.metrics),fingerprint};
}
function publicPost(r) {return {...r,metrics:JSON.parse(r.metrics||'{}'),fingerprint:undefined,preview_url:contentPreview(r.preview_url)};}
async function contentReady(env){return !!env.STORE;}
function mergePostRecords(tx,records,at){
  for(const p of records){const w={platform:p.platform,account_id:p.account_id,post_id:p.post_id},old=tx.find('content_posts',w),row={...p,metrics:JSON.stringify({...JSON.parse(old?.metrics||'{}'),...p.metrics}),first_seen:old?.first_seen||at,last_seen:at,delete_status:old?.delete_status||'published'};
   if(old){for(const k of ['caption','workflow_id','workflow_url','preview_url','preview_type'])if(!row[k])row[k]=old[k];row.published_at=row.published_at??old.published_at;row.fingerprint=row.fingerprint??old.fingerprint;}
   tx.put('content_posts',row);if(Object.keys(p.metrics).length)tx.put('content_observations',{...w,observed_at:at,metrics:JSON.stringify(p.metrics)});
   tx.put('content_sheet_outbox',{record_key:[p.platform,p.account_id,p.post_id].join(':'),kind:'post',payload:JSON.stringify(w),status:'pending',error_code:null,updated_at:at});
  }

}
async function upsertPosts(env,posts,source='publisher'){
 if(!Array.isArray(posts)||!posts.length||posts.length>10)throw Error('maximum_10_posts_per_request');const records=posts.map(postRecord),at=contentNow();
 await env.STORE.transact(['content_posts','content_observations','content_sheet_outbox'],tx=>{
  mergePostRecords(tx,records,at);
 });return {accepted:records.length,source,sheet_mirror:'pending'};
}
async function contentList(env,u){
 let rows=await env.STORE.rows('content_posts');for(const k of ['platform','account_id'])if(u.searchParams.get(k)){const v=k==='platform'?contentPlatform(u.searchParams.get(k)):contentID(u.searchParams.get(k));rows=rows.filter(r=>r[k]===v);}
 const q=(u.searchParams.get('q')||'').slice(0,100).toLowerCase();if(q)rows=rows.filter(r=>String(r.caption).toLowerCase().includes(q)||String(r.account_handle).toLowerCase().includes(q)||r.post_id.toLowerCase()===q);
 for(const key of ['from','to'])if(u.searchParams.get(key)){const v=u.searchParams.get(key);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!iso(v))throw Error('invalid_date');const date=v+(key==='to'?'T23:59:59.999Z':'T00:00:00.000Z');rows=rows.filter(r=>r.published_at&&(key==='from'?r.published_at>=date:r.published_at<=date));}
 const limit=Math.min(100,Math.max(1,Math.trunc(Number(u.searchParams.get('limit'))||50))),offset=Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0));storeSort(rows,'-published_at','platform','account_id','post_id');return {rows:rows.slice(offset,offset+limit).map(publicPost),has_more:rows.length>offset+limit,next_offset:rows.length>offset+limit?offset+limit:null};
}
function groupFromTables(groups,posts,id){const g=groups.find(x=>x.group_id===id);if(!g)throw Error('group_not_found');const ids=JSON.parse(g.members),rows=posts.filter(r=>r.platform===g.platform&&r.account_id===g.account_id&&ids.includes(r.post_id));storeSort(rows,'post_id');return {...g,members:rows.map(publicPost),missing_members:ids.filter(id=>!rows.some(r=>r.post_id===id)),evidence:JSON.parse(g.evidence),review_status:'candidate_requires_confirmation'};}
async function duplicateGroup(env,id){const {tables}=await env.STORE.snapshot(['content_duplicate_groups','content_posts']);return groupFromTables(tables.content_duplicate_groups,tables.content_posts,contentID(id));}
async function ingestGroups(env,groups){
 if(!Array.isArray(groups)||groups.length>10)throw Error('maximum_10_groups');
 await env.STORE.transact(['content_duplicate_groups','content_posts'],tx=>{for(const x of groups){const id=contentID(x.group_id),platform=contentPlatform(x.platform),account=contentID(x.account_id),ids=[...new Set((x.members||[]).map(contentID))];if(ids.length<2||ids.length>100||!['IMAGE','VIDEO'].includes(x.media_type)||JSON.stringify(x.evidence||{}).length>4000)throw Error('invalid_duplicate_group');const rows=tx.rows('content_posts').filter(r=>r.platform===platform&&r.account_id===account&&ids.includes(r.post_id));if(rows.length!==ids.length||rows.some(r=>(['VIDEO','REELS'].includes(r.media_type)?'VIDEO':r.media_type)!==x.media_type))throw Error('mixed_or_missing_group_members');tx.put('content_duplicate_groups',{group_id:id,platform,account_id:account,media_type:x.media_type,algorithm:clean(x.algorithm,100),confidence:'candidate',members:JSON.stringify(ids.sort()),evidence:JSON.stringify(x.evidence||{}),updated_at:contentNow()});}});return {accepted:groups.length};
}
function rankDuplicateMembers(members,k,strategy,metric) {
 if(!['best','worst'].includes(strategy))throw Error('explicit_keep_strategy_required');
 if(!Number.isInteger(k)||k<1||k>=members.length)throw Error('keep_count_must_be_between_1_and_n_minus_1');
 if(!CONTENT_METRICS.has(metric))throw Error('unsupported_ranking_metric');
 if(members.some(p=>!Number.isFinite(p.metrics?.[metric])||p.delete_status!=='published'))throw Error('missing_metrics_or_already_queued_member');
 const ranked=[...members].sort((a,b)=>strategy==='best'?b.metrics[metric]-a.metrics[metric]||a.post_id.localeCompare(b.post_id):a.metrics[metric]-b.metrics[metric]||a.post_id.localeCompare(b.post_id));
 return {keep:ranked.slice(0,k).map(p=>p.post_id),remove:ranked.slice(k),excluded_missing_metrics:[]};
}
async function planCleanup(env,b) {
 const group=await duplicateGroup(env,b.group_id);if(group.missing_members.length)throw Error('missing_group_members');
 const ranked=rankDuplicateMembers(group.members,b.keep_count,b.keep_strategy,b.metric);
 const source_digest=await producerHash(JSON.stringify(group)),plan_id=crypto.randomUUID(),expires_at=new Date(Date.now()+600000).toISOString();
 const payload={...ranked,group_id:group.group_id,platform:group.platform,account_id:group.account_id,keep_count:b.keep_count,keep_strategy:b.keep_strategy,metric:b.metric,ranking_basis:'latest_observed_lifetime_total; publication_age_not_adjusted',confirmation:'QUEUE '+ranked.remove.length+' LINKS'};
 await env.STORE.put('content_cleanup_plans',{plan_id,group_id:group.group_id,payload:JSON.stringify(payload),source_digest,expires_at,committed:0});
 return {plan_id,...payload,expires_at,warning:'Queueing clickouts links can cause your existing deletion workflow to delete these posts. Confirm the candidate group and keep policy.'};
}
async function queueCleanup(env,b){
 if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1')throw Error('sheet_writes_disabled');
 return env.STORE.transact(['content_cleanup_plans','content_duplicate_groups','content_posts','content_deletion_queue','content_sheet_outbox'],async tx=>{
  const p=tx.find('content_cleanup_plans',{plan_id:contentID(b.plan_id)});if(!p||p.committed||Date.parse(p.expires_at)<Date.now())throw Error('plan_missing_used_or_expired');const data=JSON.parse(p.payload);if(b.confirmation!==data.confirmation)throw Error('confirmation_mismatch');
  const group=groupFromTables(tx.rows('content_duplicate_groups'),tx.rows('content_posts'),p.group_id);if(await producerHash(JSON.stringify(group))!==p.source_digest)throw Error('group_or_metrics_changed_preview_again');
  const at=contentNow();for(const x of data.remove){const w={platform:data.platform,account_id:data.account_id,post_id:x.post_id};if(tx.find('content_deletion_queue',w))throw Error('post_already_queued');const request_id=crypto.randomUUID(),rec={request_id,...w,permalink:x.permalink};tx.put('content_deletion_queue',{...rec,status:'awaiting_sheet',reason:'confirmed_duplicate_plan',created_at:at,updated_at:at});tx.put('content_sheet_outbox',{record_key:'delete:'+request_id,kind:'clickouts',payload:JSON.stringify(rec),status:'pending',error_code:null,updated_at:at});Object.assign(tx.find('content_posts',w),{delete_status:'awaiting_sheet'});}
  p.committed=1;return {queued:data.remove.length,keep:data.keep,keep_strategy:data.keep_strategy,status:'awaiting_sheet',execution:'not_yet_deleted'};
 });
}
async function contentStatus(env){
 const {tables}=await env.STORE.snapshot(['content_jobs','content_sheet_outbox']);const counts={};for(const r of tables.content_sheet_outbox)counts[r.status]=(counts[r.status]||0)+1;
 return {storage_backend:'google_sheets',meta_sync:tables.content_jobs.find(r=>r.id==='meta_collect'),meta_sync_enabled:env.META_SYNC_ENABLED==='1',schema_ready:true,sheet_write_enabled:env.GOOGLE_SHEETS_WRITE_ENABLED==='1',post_sheet:POST_SHEET,clickouts_sheet:'clickouts',mirror:tables.content_jobs.find(r=>r.id==='sheet_mirror'),outbox:Object.entries(counts).map(([status,count])=>({status,count})),delete_execution:'requires_configured_executor',schedule_interval_minutes:10};
}
async function contentSheetWrite(env,token,path,data){
 const r=await fetch('https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID)+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw Error('google_write_http_'+r.status);return r.json();
}
async function setupContentSheet(env){
 if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1')throw Error('sheet_writes_disabled');const token=await sheetToken(env);
 const root='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID);
 const info=await sheetJSON(root+'?fields=sheets.properties.title',{headers:{Authorization:'Bearer '+token}});
 if(!(info.sheets||[]).some(s=>s.properties.title===POST_SHEET))await contentSheetWrite(env,token,':batchUpdate',{requests:[{addSheet:{properties:{title:POST_SHEET}}}]});
 const existing=await readSheet(env,token,POST_SHEET);
 if(existing.length&&existing[0].join('|')!==POST_HEADERS.join('|'))throw Error('post_sheet_header_mismatch');
 if(!existing.length)await contentSheetWrite(env,token,'/values:batchUpdate',{valueInputOption:'RAW',data:[{range:"'"+POST_SHEET+"'!A1:M1",values:[POST_HEADERS]}]});
 return {ok:true,tab:POST_SHEET};
}
function sheetCol(n){let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;}
async function mirrorContentSheets(env){
 if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1'||!await contentReady(env))return {status:'disabled'};
 const db=env.STORE,lease=crypto.randomUUID(),at=contentNow();
 const claim=await db.claim('content_jobs','sheet_mirror',lease,300000);
 if(!claim)return {status:'already_running'};
 try{
  const pending=storeSort((await db.rows('content_sheet_outbox')).filter(r=>r.status==='pending'),'updated_at').slice(0,1); // Bound Google reads and Worker subrequests per cron invocation.
  if(pending.length){const token=await sheetToken(env),postRows=await readSheet(env,token,POST_SHEET);
   if(!postRows.length||postRows[0].join('|')!==POST_HEADERS.join('|'))throw Error('setup_post_sheet_first');
   const clickRows=pending.some(r=>r.kind==='clickouts')?await readSheet(env,token,'clickouts'):null;
   const clickCol=clickRows?clickRows[0]?.findIndex(h=>String(h).trim().toUpperCase()==='URLS'):-1;
   if(clickRows&&clickCol<0)throw Error('clickouts_URLS_column_missing');
   const updates=[],done=[],clickAppends=[];let nextPost=postRows.length+1;
   for(const row of pending){const data=JSON.parse(row.payload);
    if(row.kind==='post'){
     const p=await db.find('content_posts',{platform:data.platform,account_id:data.account_id,post_id:data.post_id});if(!p)throw Error('outbox_post_missing');
     const index=postRows.findIndex((r,i)=>i>0&&r[0]===row.record_key),rowNumber=index>=0?index+1:nextPost++;
     const record={...p,record_key:row.record_key};updates.push({range:"'"+POST_SHEET+"'!A"+rowNumber+':M'+rowNumber,values:[POST_HEADERS.map(k=>record[k]??'')]});
    }else{
     const already=clickRows.slice(1).some(r=>{try{return canonicalPostURL(r[clickCol],data.platform)===data.permalink}catch{return false}});
     if(!already){const values=Array(clickCol+1).fill('');values[clickCol]=data.permalink;clickAppends.push({row,values});}
    }done.push(row);
   }
   // Fixed-cell writes can be retried after a lost response; a fresh read reconciles prior writes.
   if(updates.length)await contentSheetWrite(env,token,'/values:batchUpdate',{valueInputOption:'RAW',data:updates});
   if(clickAppends.length){
    await db.transact(['content_sheet_outbox'],tx=>{for(const x of clickAppends){const r=tx.find('content_sheet_outbox',{record_key:x.row.record_key});if(r.updated_at!==x.row.updated_at)throw Error('outbox_changed_retry');Object.assign(r,{status:'uncertain',error_code:'append_outcome_pending'});}});
    // No automatic retry after an ambiguous append. It might have triggered deletion already.
    await contentSheetWrite(env,token,'/values/'+encodeURIComponent("'clickouts'!A:"+sheetCol(clickCol))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{values:clickAppends.map(x=>x.values)});
   }
   await db.transact(['content_sheet_outbox','content_deletion_queue','content_posts'],tx=>{for(const row of done){const r=tx.find('content_sheet_outbox',{record_key:row.record_key});if(r.updated_at!==row.updated_at)continue;Object.assign(r,{status:'synced',error_code:null});if(row.kind==='clickouts'){const d=JSON.parse(row.payload),q=tx.find('content_deletion_queue',{request_id:d.request_id}),p=tx.find('content_posts',{platform:d.platform,account_id:d.account_id,post_id:d.post_id});if(q?.status==='awaiting_sheet')Object.assign(q,{status:'queued_clickouts',updated_at:contentNow()});if(p?.delete_status==='awaiting_sheet')p.delete_status='queued_clickouts';}}});

  }
  await db.finish('content_jobs','sheet_mirror',lease,{status:'ok',last_success:contentNow(),error_code:null});return {status:'ok',processed:pending.length};
 }catch(e){const code=/^(google_|sheet_|post_sheet|setup_post|clickouts_|outbox_)/.test(e.message)?e.message.slice(0,80):'sheet_mirror_failed';await db.finish('content_jobs','sheet_mirror',lease,{status:'failed',error_code:code});return {status:'failed',error_code:code};}
}
async function contentApi(req,env,ctx) {
 const u=new URL(req.url),p=u.pathname;
 if(p==='/api/content/status')return json(await contentStatus(env));
 
 if(p==='/api/ingest/posts'&&req.method==='POST')return json(await upsertPosts(env,(await body(req)).posts));
 if(p==='/api/ingest/duplicate-groups'&&req.method==='POST')return json(await ingestGroups(env,(await body(req)).groups));
 if(p==='/api/ingest/fingerprints'&&req.method==='GET'){
  const rows=storeSort((await env.STORE.rows('content_posts')).filter(r=>r.platform===contentPlatform(u.searchParams.get('platform'))&&r.account_id===contentID(u.searchParams.get('account_id'))&&r.fingerprint),'post_id').slice(Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0)),Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0))+101).map(({post_id,fingerprint})=>({post_id,fingerprint}));
  return json({fingerprints:rows.slice(0,100).map(r=>({...r,fingerprint:JSON.parse(r.fingerprint)})),has_more:rows.length>100});
 }
 if(p==='/api/content/sheets/setup'&&req.method==='POST')return json(await setupContentSheet(env));
 if(p==='/api/content/sheets/sync'&&req.method==='POST'){return json(await queueStoredJob(env,'sheet_mirror'),202);}
 if(p==='/api/content/plan'&&req.method==='POST')return json(await planCleanup(env,await body(req)));
 if(p==='/api/content/queue'&&req.method==='POST')return json(await queueCleanup(env,await body(req)));
 if(p==='/api/content/queue'&&req.method==='GET'){
  const rows=storeSort(await env.STORE.rows('content_deletion_queue'),'-created_at').slice(0,501);
  const state=await sheetStatus(env),meta=await sourceMeta(env,state),sheet=meta?.clickouts;
  const seen=new Set(rows.map(r=>r.permalink));for(const entry of sheet?.rows||[]){if(seen.has(entry.permalink))continue;let platform='unknown';const h=new URL(entry.permalink).hostname;if(h==='instagram.com'||h.endsWith('.instagram.com'))platform='instagram';else if(h==='facebook.com'||h.endsWith('.facebook.com'))platform='facebook';else if(h==='tumblr.com'||h.endsWith('.tumblr.com'))platform='tumblr';rows.push({request_id:'sheet-row-'+entry.row,platform,account_id:'',post_id:'',permalink:entry.permalink,status:'sheet_listed_unverified',reason:'Observed in clickouts URLS; mapping/actual deletion not verified',created_at:state.last_success});seen.add(entry.permalink);}
  return json({rows:rows.slice(0,500),limit:500,has_more:rows.length>500,clickouts_read:sheet?.status||'unavailable',clickouts_truncated:sheet?.truncated||false,sheet_status:await contentStatus(env)});
 }
 if(p==='/api/content/groups'&&req.method==='GET'){const ids=storeSort(await env.STORE.rows('content_duplicate_groups'),'-updated_at').slice(0,20);const rows=[];for(const x of ids)rows.push(await duplicateGroup(env,x.group_id));return json({rows,limit:20});}
 if(p==='/api/content'&&req.method==='GET')return json(await contentList(env,u));
 if(p==='/api/content/series'&&req.method==='GET'){
  const platform=contentPlatform(u.searchParams.get('platform')),account=contentID(u.searchParams.get('account_id')),id=contentID(u.searchParams.get('post_id')),metric=u.searchParams.get('metric');if(!CONTENT_METRICS.has(metric))throw Error('unsupported_metric');
  const data=storeSort((await env.STORE.rows('content_observations')).filter(r=>r.platform===platform&&r.account_id===account&&r.post_id===id),'observed_at').slice(0,2001);
  const rows=data.slice(0,2000).flatMap(r=>{const v=JSON.parse(r.metrics)[metric];return Number.isFinite(v)?[{observed_at:r.observed_at,value:v}]:[]});return json({rows,metric,truncated:data.length>2000,first_observed:rows[0]?.observed_at||null,meaning:'Snapshot totals and observed interval deltas, not event timestamps or reconstructed past growth.'});
 }
 if(p==='/api/content/preview'&&req.method==='GET'){
  const row=await env.STORE.find('content_posts',{platform:contentPlatform(u.searchParams.get('platform')),account_id:contentID(u.searchParams.get('account_id')),post_id:contentID(u.searchParams.get('post_id'))});const v=contentPreview(row?.preview_url);
  return json({url:v,kind:row?.preview_type||'image',available:!!v,expires_warning:'Provider CDN links can expire. Sync again to refresh; an absent preview does not mean the post was deleted.'});
 }
 if(p==='/api/ingest/resolve-post'&&req.method==='POST'){
  const b=await body(req),platform=contentPlatform(b.platform),permalink=canonicalPostURL(b.permalink,platform),{tables}=await env.STORE.snapshot(['content_posts','content_deletion_queue']);const rows=tables.content_posts.filter(r=>r.platform===platform&&r.permalink===permalink).map(p=>({platform:p.platform,account_id:p.account_id,post_id:p.post_id,permalink:p.permalink,delete_status:p.delete_status,request_id:tables.content_deletion_queue.find(q=>q.platform===p.platform&&q.account_id===p.account_id&&q.post_id===p.post_id)?.request_id||null}));
  if(rows.length!==1)throw Error('post_mapping_missing_or_ambiguous');return json({post:rows[0]});
 }
 if(p==='/api/ingest/deletion-result'&&req.method==='POST'){
  const b=await body(req);if(!['deleted','failed','manual_required'].includes(b.status))throw Error('invalid_deletion_result');
  await env.STORE.transact(['content_deletion_queue','content_posts'],tx=>{const q=tx.find('content_deletion_queue',{request_id:contentID(b.request_id)});if(!q)throw Error('queue_request_not_found');Object.assign(q,{status:b.status,reason:clean(b.reason,100),updated_at:contentNow()});const p=tx.find('content_posts',{platform:q.platform,account_id:q.account_id,post_id:q.post_id});if(p)p.delete_status=b.status;});return json({ok:true});

 }
 return error('Not found',404);
}

