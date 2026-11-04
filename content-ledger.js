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
async function contentReady(env) {return !!(await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='content_posts'").first());}
async function upsertPosts(env,posts,source='publisher') {
 if(!Array.isArray(posts)||!posts.length||posts.length>10)throw Error('maximum_10_posts_per_request');
 const records=posts.map(postRecord),at=contentNow(),stmts=[];
 for(const p of records){
  stmts.push(env.DB.prepare(`INSERT INTO content_posts(platform,account_id,post_id,account_handle,permalink,media_type,published_at,caption,workflow_id,workflow_url,preview_url,preview_type,metrics,fingerprint,first_seen,last_seen) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(platform,account_id,post_id) DO UPDATE SET account_handle=excluded.account_handle,permalink=excluded.permalink,media_type=excluded.media_type,published_at=COALESCE(excluded.published_at,content_posts.published_at),caption=CASE WHEN excluded.caption<>'' THEN excluded.caption ELSE content_posts.caption END,workflow_id=CASE WHEN excluded.workflow_id<>'' THEN excluded.workflow_id ELSE content_posts.workflow_id END,workflow_url=CASE WHEN excluded.workflow_url<>'' THEN excluded.workflow_url ELSE content_posts.workflow_url END,preview_url=CASE WHEN excluded.preview_url<>'' THEN excluded.preview_url ELSE content_posts.preview_url END,preview_type=CASE WHEN excluded.preview_type<>'' THEN excluded.preview_type ELSE content_posts.preview_type END,metrics=json_patch(content_posts.metrics,excluded.metrics),fingerprint=COALESCE(excluded.fingerprint,content_posts.fingerprint),last_seen=excluded.last_seen`).bind(p.platform,p.account_id,p.post_id,p.account_handle,p.permalink,p.media_type,p.published_at,p.caption,p.workflow_id,p.workflow_url,p.preview_url,p.preview_type,JSON.stringify(p.metrics),p.fingerprint,at,at));
  if(Object.keys(p.metrics).length)stmts.push(env.DB.prepare('INSERT INTO content_observations(platform,account_id,post_id,observed_at,metrics) VALUES(?,?,?,?,?) ON CONFLICT DO NOTHING').bind(p.platform,p.account_id,p.post_id,at,JSON.stringify(p.metrics)));
  const key=[p.platform,p.account_id,p.post_id].join(':');
  stmts.push(env.DB.prepare("INSERT INTO content_sheet_outbox(record_key,kind,payload,status,updated_at) VALUES(?,'post',?,'pending',?) ON CONFLICT(record_key) DO UPDATE SET payload=excluded.payload,status='pending',updated_at=excluded.updated_at").bind(key,JSON.stringify({platform:p.platform,account_id:p.account_id,post_id:p.post_id}),at));
 }
 await env.DB.batch(stmts);return {accepted:records.length,source,sheet_mirror:'pending'};
}
async function contentList(env,u) {
 const where=[],args=[];for(const k of ['platform','account_id'])if(u.searchParams.get(k)){where.push(k+'=?');args.push(k==='platform'?contentPlatform(u.searchParams.get(k)):contentID(u.searchParams.get(k)));}
 if(u.searchParams.get('q')){where.push('(lower(caption) LIKE ? OR lower(account_handle) LIKE ? OR post_id=?)');let q=u.searchParams.get('q').slice(0,46);while(new TextEncoder().encode(q).length>46)q=q.slice(0,-1);args.push('%'+q.toLowerCase()+'%','%'+q.toLowerCase()+'%',q);}
 for(const [key,op] of [['from','>='],['to','<=']])if(u.searchParams.get(key)){const v=u.searchParams.get(key);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!iso(v))throw Error('invalid_date');where.push('published_at '+op+' ?');args.push(v+(key==='to'?'T23:59:59.999Z':'T00:00:00.000Z'));}
 const limit=Math.min(100,Math.max(1,Math.trunc(Number(u.searchParams.get('limit'))||50))),offset=Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0));
 const rows=(await env.DB.prepare('SELECT * FROM content_posts'+(where.length?' WHERE '+where.join(' AND '):'')+' ORDER BY published_at DESC,platform,account_id,post_id LIMIT ? OFFSET ?').bind(...args,limit+1,offset).all()).results;
 return {rows:rows.slice(0,limit).map(publicPost),has_more:rows.length>limit,next_offset:rows.length>limit?offset+limit:null};
}
async function duplicateGroup(env,id) {
 const g=await env.DB.prepare('SELECT * FROM content_duplicate_groups WHERE group_id=?').bind(contentID(id)).first();if(!g)throw Error('group_not_found');
 const ids=JSON.parse(g.members),rows=(await env.DB.prepare('SELECT * FROM content_posts WHERE platform=? AND account_id=? AND post_id IN (SELECT value FROM json_each(?))').bind(g.platform,g.account_id,g.members).all()).results;
 return {...g,members:rows.map(publicPost),missing_members:ids.filter(id=>!rows.some(r=>r.post_id===id)),evidence:JSON.parse(g.evidence),review_status:'candidate_requires_confirmation'};
}
async function ingestGroups(env,groups) {
 if(!Array.isArray(groups)||groups.length>10)throw Error('maximum_10_groups');const statements=[];
 for(const x of groups){const id=contentID(x.group_id),platform=contentPlatform(x.platform),account=contentID(x.account_id),ids=[...new Set((x.members||[]).map(contentID))];
  if(ids.length<2||ids.length>100||!['IMAGE','VIDEO'].includes(x.media_type)||JSON.stringify(x.evidence||{}).length>4000)throw Error('invalid_duplicate_group');
  const rows=(await env.DB.prepare('SELECT post_id,media_type FROM content_posts WHERE platform=? AND account_id=? AND post_id IN (SELECT value FROM json_each(?))').bind(platform,account,JSON.stringify(ids)).all()).results;
  if(rows.length!==ids.length||rows.some(r=>(['VIDEO','REELS'].includes(r.media_type)?'VIDEO':r.media_type)!==x.media_type))throw Error('mixed_or_missing_group_members');
  statements.push(env.DB.prepare('INSERT INTO content_duplicate_groups(group_id,platform,account_id,media_type,algorithm,confidence,members,evidence,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(group_id) DO UPDATE SET members=excluded.members,evidence=excluded.evidence,updated_at=excluded.updated_at').bind(id,platform,account,x.media_type,clean(x.algorithm,100),'candidate',JSON.stringify(ids.sort()),JSON.stringify(x.evidence||{}),contentNow()));
 }if(statements.length)await env.DB.batch(statements);return {accepted:statements.length};
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
 await env.DB.prepare('INSERT INTO content_cleanup_plans(plan_id,group_id,payload,source_digest,expires_at) VALUES(?,?,?,?,?)').bind(plan_id,group.group_id,JSON.stringify(payload),source_digest,expires_at).run();
 return {plan_id,...payload,expires_at,warning:'Queueing clickouts links can cause your existing deletion workflow to delete these posts. Confirm the candidate group and keep policy.'};
}
async function queueCleanup(env,b) {
 if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1')throw Error('sheet_writes_disabled');
 const p=await env.DB.prepare('SELECT * FROM content_cleanup_plans WHERE plan_id=?').bind(contentID(b.plan_id)).first();
 if(!p||p.committed||Date.parse(p.expires_at)<Date.now())throw Error('plan_missing_used_or_expired');
 const data=JSON.parse(p.payload);if(b.confirmation!==data.confirmation)throw Error('confirmation_mismatch');
 if(await producerHash(JSON.stringify(await duplicateGroup(env,p.group_id)))!==p.source_digest)throw Error('group_or_metrics_changed_preview_again');
 const at=contentNow(),records=data.remove.map(x=>({request_id:crypto.randomUUID(),platform:data.platform,account_id:data.account_id,post_id:x.post_id,permalink:x.permalink}));
 // Guard every insertion with committed=0. D1 batch executes these statements transactionally.
 await env.DB.batch([
  env.DB.prepare(`INSERT OR IGNORE INTO content_deletion_queue(request_id,platform,account_id,post_id,permalink,status,reason,created_at,updated_at) SELECT json_extract(value,'$.request_id'),json_extract(value,'$.platform'),json_extract(value,'$.account_id'),json_extract(value,'$.post_id'),json_extract(value,'$.permalink'),'awaiting_sheet','confirmed_duplicate_plan',?,? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM content_cleanup_plans WHERE plan_id=? AND committed=0)`).bind(at,at,JSON.stringify(records),p.plan_id),
  env.DB.prepare(`INSERT OR IGNORE INTO content_sheet_outbox(record_key,kind,payload,status,updated_at) SELECT 'delete:'||q.request_id,'clickouts',json_object('request_id',q.request_id,'platform',q.platform,'account_id',q.account_id,'post_id',q.post_id,'permalink',q.permalink),'pending',? FROM content_deletion_queue q WHERE q.request_id IN (SELECT json_extract(value,'$.request_id') FROM json_each(?))`).bind(at,JSON.stringify(records)),
  env.DB.prepare(`UPDATE content_posts SET delete_status='awaiting_sheet' WHERE platform=? AND account_id=? AND post_id IN(SELECT json_extract(value,'$.post_id') FROM json_each(?)) AND EXISTS(SELECT 1 FROM content_cleanup_plans WHERE plan_id=? AND committed=0)`).bind(data.platform,data.account_id,JSON.stringify(records),p.plan_id),
  env.DB.prepare('UPDATE content_cleanup_plans SET committed=1 WHERE plan_id=? AND committed=0').bind(p.plan_id)
 ]);return {queued:records.length,keep:data.keep,keep_strategy:data.keep_strategy,status:'awaiting_sheet',execution:'not_yet_deleted'};
}
async function contentStatus(env){
 const ready=await contentReady(env);if(!ready)return {schema_ready:false,error_code:'apply_content_schema_sql'};
 const sync=await env.DB.prepare("SELECT status,last_attempt,last_success,error_code FROM content_jobs WHERE id='sheet_mirror'").first();
 const counts=(await env.DB.prepare('SELECT status,COUNT(*) count FROM content_sheet_outbox GROUP BY status').all()).results;
 const meta_sync=await env.DB.prepare("SELECT status,last_attempt,last_success,error_code FROM content_jobs WHERE id='meta_collect'").first();
 return {meta_sync,meta_sync_enabled:env.META_SYNC_ENABLED==='1',schema_ready:true,sheet_write_enabled:env.GOOGLE_SHEETS_WRITE_ENABLED==='1',post_sheet:POST_SHEET,clickouts_sheet:'clickouts',mirror:sync,outbox:counts,delete_execution:'requires_configured_executor',schedule_interval_minutes:10};
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
 const db=env.DB,lease=crypto.randomUUID(),at=contentNow();
 const claim=await db.prepare("UPDATE content_jobs SET lease=?,lease_until=?,status='running',last_attempt=?,error_code=NULL WHERE id='sheet_mirror' AND (lease_until IS NULL OR lease_until<?)").bind(lease,Date.now()+300000,at,Date.now()).run();
 if(!claim.meta.changes)return {status:'already_running'};
 try{
  const pending=(await db.prepare("SELECT * FROM content_sheet_outbox WHERE status='pending' ORDER BY updated_at LIMIT 10").all()).results;
  if(pending.length){const token=await sheetToken(env),postRows=await readSheet(env,token,POST_SHEET);
   if(!postRows.length||postRows[0].join('|')!==POST_HEADERS.join('|'))throw Error('setup_post_sheet_first');
   const clickRows=pending.some(r=>r.kind==='clickouts')?await readSheet(env,token,'clickouts'):null;
   const clickCol=clickRows?clickRows[0]?.findIndex(h=>String(h).trim().toUpperCase()==='URLS'):-1;
   if(clickRows&&clickCol<0)throw Error('clickouts_URLS_column_missing');
   const updates=[],done=[],clickAppends=[];let nextPost=postRows.length+1;
   for(const row of pending){const data=JSON.parse(row.payload);
    if(row.kind==='post'){
     const p=await db.prepare('SELECT * FROM content_posts WHERE platform=? AND account_id=? AND post_id=?').bind(data.platform,data.account_id,data.post_id).first();if(!p)throw Error('outbox_post_missing');
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
    await db.batch(clickAppends.map(x=>db.prepare("UPDATE content_sheet_outbox SET status='uncertain',error_code='append_outcome_pending' WHERE record_key=?").bind(x.row.record_key)));
    // No automatic retry after an ambiguous append. It might have triggered deletion already.
    await contentSheetWrite(env,token,'/values/'+encodeURIComponent("'clickouts'!A:"+sheetCol(clickCol))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{values:clickAppends.map(x=>x.values)});
   }
   const statements=[];for(const row of done){statements.push(db.prepare("UPDATE content_sheet_outbox SET status='synced',error_code=NULL WHERE record_key=? AND updated_at=?").bind(row.record_key,row.updated_at));if(row.kind==='clickouts'){const d=JSON.parse(row.payload);statements.push(db.prepare("UPDATE content_deletion_queue SET status='queued_clickouts',updated_at=? WHERE request_id=? AND status='awaiting_sheet'").bind(contentNow(),d.request_id));statements.push(db.prepare("UPDATE content_posts SET delete_status='queued_clickouts' WHERE platform=? AND account_id=? AND post_id=? AND delete_status='awaiting_sheet'").bind(d.platform,d.account_id,d.post_id));}}if(statements.length)await db.batch(statements);
  }
  await db.prepare("UPDATE content_jobs SET status='ok',last_success=?,error_code=NULL,lease=NULL,lease_until=NULL WHERE id='sheet_mirror' AND lease=?").bind(contentNow(),lease).run();return {status:'ok',processed:pending.length};
 }catch(e){const code=/^(google_|sheet_|post_sheet|setup_post|clickouts_|outbox_)/.test(e.message)?e.message.slice(0,80):'sheet_mirror_failed';await db.prepare("UPDATE content_jobs SET status='failed',error_code=?,lease=NULL,lease_until=NULL WHERE id='sheet_mirror' AND lease=?").bind(code,lease).run();return {status:'failed',error_code:code};}
}
async function contentApi(req,env,ctx) {
 const u=new URL(req.url),p=u.pathname;
 if(p==='/api/content/status')return json(await contentStatus(env));
 if(!await contentReady(env))return json({error:'Apply content-schema.sql in D1 Console first',code:'content_schema_missing'},503);
 if(p==='/api/ingest/posts'&&req.method==='POST')return json(await upsertPosts(env,(await body(req)).posts));
 if(p==='/api/ingest/duplicate-groups'&&req.method==='POST')return json(await ingestGroups(env,(await body(req)).groups));
 if(p==='/api/ingest/fingerprints'&&req.method==='GET'){
  const rows=(await env.DB.prepare('SELECT post_id,fingerprint FROM content_posts WHERE platform=? AND account_id=? AND fingerprint IS NOT NULL ORDER BY post_id LIMIT 101 OFFSET ?').bind(contentPlatform(u.searchParams.get('platform')),contentID(u.searchParams.get('account_id')),Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0))).all()).results;
  return json({fingerprints:rows.slice(0,100).map(r=>({...r,fingerprint:JSON.parse(r.fingerprint)})),has_more:rows.length>100});
 }
 if(p==='/api/content/sheets/setup'&&req.method==='POST')return json(await setupContentSheet(env));
 if(p==='/api/content/sheets/sync'&&req.method==='POST'){ctx.waitUntil(mirrorContentSheets(env));return json({status:'queued'},202);}
 if(p==='/api/content/plan'&&req.method==='POST')return json(await planCleanup(env,await body(req)));
 if(p==='/api/content/queue'&&req.method==='POST')return json(await queueCleanup(env,await body(req)));
 if(p==='/api/content/queue'&&req.method==='GET'){
  const rows=(await env.DB.prepare('SELECT * FROM content_deletion_queue ORDER BY created_at DESC LIMIT 500').all()).results;
  const state=await sheetStatus(env),meta=await sourceMeta(env,state),sheet=meta?.clickouts;
  const seen=new Set(rows.map(r=>r.permalink));for(const entry of sheet?.rows||[]){if(seen.has(entry.permalink))continue;let platform='unknown';const h=new URL(entry.permalink).hostname;if(h==='instagram.com'||h.endsWith('.instagram.com'))platform='instagram';else if(h==='facebook.com'||h.endsWith('.facebook.com'))platform='facebook';else if(h==='tumblr.com'||h.endsWith('.tumblr.com'))platform='tumblr';rows.push({request_id:'sheet-row-'+entry.row,platform,account_id:'',post_id:'',permalink:entry.permalink,status:'sheet_listed_unverified',reason:'Observed in clickouts URLS; mapping/actual deletion not verified',created_at:state.last_success});seen.add(entry.permalink);}
  return json({rows:rows.slice(0,500),limit:500,has_more:rows.length>500,clickouts_read:sheet?.status||'unavailable',clickouts_truncated:sheet?.truncated||false,sheet_status:await contentStatus(env)});
 }
 if(p==='/api/content/groups'&&req.method==='GET'){const ids=(await env.DB.prepare('SELECT group_id FROM content_duplicate_groups ORDER BY updated_at DESC LIMIT 20').all()).results;const rows=[];for(const x of ids)rows.push(await duplicateGroup(env,x.group_id));return json({rows,limit:20});}
 if(p==='/api/content'&&req.method==='GET')return json(await contentList(env,u));
 if(p==='/api/content/series'&&req.method==='GET'){
  const platform=contentPlatform(u.searchParams.get('platform')),account=contentID(u.searchParams.get('account_id')),id=contentID(u.searchParams.get('post_id')),metric=u.searchParams.get('metric');if(!CONTENT_METRICS.has(metric))throw Error('unsupported_metric');
  const data=(await env.DB.prepare('SELECT observed_at,metrics FROM content_observations WHERE platform=? AND account_id=? AND post_id=? ORDER BY observed_at LIMIT 2001').bind(platform,account,id).all()).results;
  const rows=data.slice(0,2000).flatMap(r=>{const v=JSON.parse(r.metrics)[metric];return Number.isFinite(v)?[{observed_at:r.observed_at,value:v}]:[]});return json({rows,metric,truncated:data.length>2000,first_observed:rows[0]?.observed_at||null,meaning:'Snapshot totals and observed interval deltas, not event timestamps or reconstructed past growth.'});
 }
 if(p==='/api/content/preview'&&req.method==='GET'){
  const row=await env.DB.prepare('SELECT preview_url,preview_type FROM content_posts WHERE platform=? AND account_id=? AND post_id=?').bind(contentPlatform(u.searchParams.get('platform')),contentID(u.searchParams.get('account_id')),contentID(u.searchParams.get('post_id'))).first();const v=contentPreview(row?.preview_url);
  return json({url:v,kind:row?.preview_type||'image',available:!!v,expires_warning:'Provider CDN links can expire. Sync again to refresh; an absent preview does not mean the post was deleted.'});
 }
 if(p==='/api/ingest/resolve-post'&&req.method==='POST'){
  const b=await body(req),platform=contentPlatform(b.platform),permalink=canonicalPostURL(b.permalink,platform),rows=(await env.DB.prepare('SELECT p.platform,p.account_id,p.post_id,p.permalink,p.delete_status,q.request_id FROM content_posts p LEFT JOIN content_deletion_queue q ON q.platform=p.platform AND q.account_id=p.account_id AND q.post_id=p.post_id WHERE p.platform=? AND p.permalink=?').bind(platform,permalink).all()).results;
  if(rows.length!==1)throw Error('post_mapping_missing_or_ambiguous');return json({post:rows[0]});
 }
 if(p==='/api/ingest/deletion-result'&&req.method==='POST'){
  const b=await body(req);if(!['deleted','failed','manual_required'].includes(b.status))throw Error('invalid_deletion_result');
  const q=await env.DB.prepare('SELECT * FROM content_deletion_queue WHERE request_id=?').bind(contentID(b.request_id)).first();if(!q)throw Error('queue_request_not_found');
  await env.DB.batch([env.DB.prepare('UPDATE content_deletion_queue SET status=?,reason=?,updated_at=? WHERE request_id=?').bind(b.status,clean(b.reason,100),contentNow(),q.request_id),env.DB.prepare('UPDATE content_posts SET delete_status=? WHERE platform=? AND account_id=? AND post_id=?').bind(b.status,q.platform,q.account_id,q.post_id)]);return json({ok:true});
 }
 return error('Not found',404);
}
