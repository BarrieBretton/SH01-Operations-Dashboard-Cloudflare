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
function contentPoster(row,media){
 if(!['VIDEO','REELS'].includes(row.media_type))return '';
 const match=(media||[]).find(m=>m.platform===row.platform&&m.asset_id===row.account_id&&m.id===row.post_id);
 const poster=contentPreview(match?.thumbnail_url||(row.preview_type==='image'?row.preview_url:''));
 if(!poster||/\.(mp4|mov|m4v|webm)(?:$|[?])/i.test(poster))return '';
 const original=contentPreview(row.preview_url);
 if(row.preview_type==='video'&&original&&new URL(poster).pathname===new URL(original).pathname)return '';
 return poster;
}
// Metric availability is separate from media loading. Never infer zero from an absent field.
const contentMetricContexts=new WeakMap();
function contentMetricContext(tables){
 let context=contentMetricContexts.get(tables);if(context)return context;
 const media=new Map((tables.meta_content||[]).map(m=>[JSON.stringify([m.platform,m.asset_id,m.id]),m])),caps=new Map(),states=new Map((tables.content_collect_state||[]).map(s=>[s.id,s]));
 for(const cap of tables.meta_capabilities||[]){const key=JSON.stringify([cap.asset_id,cap.kind]);if(!caps.has(key))caps.set(key,[]);caps.get(key).push(cap);}
 context={media,caps,states};contentMetricContexts.set(tables,context);return context;
}
function contentMetricEvidence(row,tables){
 const metrics=typeof row.metrics==='string'?JSON.parse(row.metrics||'{}'):row.metrics||{};
 const context=contentMetricContext(tables),media=context.media.get(JSON.stringify([row.platform,row.account_id,row.post_id]));
 const caps=media?context.caps.get(JSON.stringify([row.post_id,media.kind]))||[]:[];
 const postState=media?JSON.parse(context.states.get('meta:post:'+row.post_id)?.payload||'{}'):{};
 const reasonState=reason=>/credential_rejected/.test(reason)?'connection_required':/permission_denied/.test(reason)?'permission_required':/metric_unsupported/.test(reason)?'unsupported':/rate_limited|budget/.test(reason)?'deferred':/no_numeric|empty_or_suppressed|not_returned/.test(reason)?'not_returned':'failed';
 const result={};
 for(const metric of CONTENT_METRICS){
  const key=row.platform==='facebook'&&metric==='views'?'post_media_view':metric;
  const cap=caps.filter(c=>c.metric===key||(row.platform==='facebook'&&metric!=='views'&&c.metric==='engagement_fields')).sort((a,b)=>String(b.checked_at||'').localeCompare(String(a.checked_at||''))||Number(a.metric==='engagement_fields')-Number(b.metric==='engagement_fields'))[0];
  const failure=postState.error&&(!cap||String(postState.checked_at)>String(cap.checked_at))?{status:reasonState(postState.error),checked_at:postState.checked_at||null}:cap?.status==='unavailable'?{status:reasonState(cap.reason||''),checked_at:cap.checked_at||null}:null;
  const numeric=typeof metrics[metric]==='number'&&Number.isFinite(metrics[metric])&&metrics[metric]>=0;
  result[metric]=numeric?{status:'available',checked_at:cap?.status==='available'?cap.checked_at||null:null,...(failure?{refresh_status:failure.status,refresh_checked_at:failure.checked_at}:{})}:failure||{status:cap?.status==='available'?'not_returned':'not_collected',checked_at:cap?.checked_at||null};
 }
 return result;
}
function contentMetricRefreshSummary(group,tables){
 const members=new Set((group.members||[]).map(p=>typeof p==='string'?p:p.post_id));
 const requests=(tables.content_collect_state||[]).filter(r=>r.id.startsWith('meta:refresh:')).map(r=>JSON.parse(r.payload||'{}')).filter(r=>r.platform===group.platform&&r.account_id===group.account_id&&members.has(r.post_id));
 return {pending:requests.filter(r=>r.status==='queued').length,checked:requests.filter(r=>r.status==='checked').length,failed:requests.filter(r=>r.status==='failed').length,last_attempt:requests.map(r=>r.checked_at).filter(Boolean).sort().at(-1)||null};
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
// Display-only account metadata. Internal identities and plan digests stay unchanged.
// Coverage uses the complete stored catalogue, not the limited duplicate-group page.
function contentScanProgress(tables,coverage){
 if(typeof autoScanCoverage!=='function')return null;
 const accounts=new Map(),key=r=>JSON.stringify([r.platform,r.account_id]);
 const add=r=>{if(['facebook','instagram'].includes(r.platform)&&r.account_id&&!accounts.has(key(r)))accounts.set(key(r),{platform:r.platform,account_id:r.account_id,eligible:0,fingerprinted:0,pending:0});};
 for(const a of tables.meta_assets||[])add({platform:a.platform,account_id:a.id});
 for(const p of tables.content_posts||[])add(p);
 for(const c of coverage)accounts.set(key(c),{...c});
 const rows=[...accounts.values()].map(c=>({...c,...contentAccountName(c,tables.meta_assets,tables.content_posts)}));
 const totals=rows.reduce((a,c)=>({eligible:a.eligible+c.eligible,fingerprinted:a.fingerprinted+c.fingerprinted,pending:a.pending+c.pending}),{eligible:0,fingerprinted:0,pending:0});
 return {scope:'stored_supported_facebook_instagram_posts',checked_at:contentNow(),full_history_verified:false,totals:{...totals,accounts:rows.length,accounts_with_posts:rows.filter(c=>c.eligible>0).length,accounts_fingerprinted:rows.filter(c=>c.eligible>0&&c.pending===0).length},accounts:rows};
}
function contentAccountName(row,assets=[],posts=[]){
 const valid=value=>{const name=String(value||'').trim();return name&&name!==String(row.account_id)&&!/^\d{10,}$/.test(name)?name.slice(0,200):'';};
 const asset=assets.find(a=>a.platform===row.platform&&String(a.id)===String(row.account_id));
 const stored=valid(asset?.name);
 if(stored)return {account_name:stored,account_name_source:row.platform==='instagram'?(stored.startsWith('@')?'instagram_profile':'stored_name'):'account_catalogue'};
 const own=valid(row.account_handle);if(own)return {account_name:own,account_name_source:'stored_post'};
 const candidates=posts.filter(r=>r.platform===row.platform&&String(r.account_id)===String(row.account_id)).sort((a,b)=>String(b.last_seen||'').localeCompare(String(a.last_seen||'')));
 for(const post of candidates){const name=valid(post.account_handle);if(name)return {account_name:name,account_name_source:'stored_post'};}
 return {account_name:'',account_name_source:'unavailable'};
}
async function contentList(env,u){
 const {tables}=await env.STORE.snapshot(['content_posts','meta_assets','meta_content','meta_capabilities','content_collect_state']);let rows=tables.content_posts.map(row=>({...row,...contentAccountName(row,tables.meta_assets),poster_url:contentPoster(row,tables.meta_content),metric_status:contentMetricEvidence(row,tables)}));for(const k of ['platform','account_id'])if(u.searchParams.get(k)){const v=k==='platform'?contentPlatform(u.searchParams.get(k)):contentID(u.searchParams.get(k));rows=rows.filter(r=>r[k]===v);}
 const q=(u.searchParams.get('q')||'').slice(0,100).toLowerCase();if(q)rows=rows.filter(r=>String(r.caption).toLowerCase().includes(q)||String(r.account_name||r.account_handle).toLowerCase().includes(q)||r.post_id.toLowerCase()===q);
 for(const key of ['from','to'])if(u.searchParams.get(key)){const v=u.searchParams.get(key);if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!iso(v))throw Error('invalid_date');const date=v+(key==='to'?'T23:59:59.999Z':'T00:00:00.000Z');rows=rows.filter(r=>r.published_at&&(key==='from'?r.published_at>=date:r.published_at<=date));}
 const limit=Math.min(100,Math.max(1,Math.trunc(Number(u.searchParams.get('limit'))||50))),offset=Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0));storeSort(rows,'-published_at','platform','account_id','post_id');return {rows:rows.slice(offset,offset+limit).map(publicPost),has_more:rows.length>offset+limit,next_offset:rows.length>offset+limit?offset+limit:null};
}
// Reconcile historical scanner batches from saved evidence only. No media/API reads.
function duplicateFingerprintMatch(a,b,work){
 const image=f=>f?.algorithm==='sh01-social-perceptual'&&f.version===1&&f.media_type==='IMAGE'&&Array.isArray(f.hashes)&&f.hashes.length>0&&f.hashes.length<=19&&f.hashes.every(h=>typeof h==='string'&&/^[a-f0-9]{16}$/.test(h))&&typeof f.gray_stddev==='number'&&Number.isFinite(f.gray_stddev);
 const valid=f=>image(f)||(f?.algorithm==='sh01-social-perceptual'&&f.version===1&&f.media_type==='VIDEO'&&typeof f.duration==='number'&&f.duration>=0.5&&f.duration<=900&&JSON.stringify(f.sample_positions)==='[0.1,0.3,0.5,0.7,0.9]'&&Array.isArray(f.frames)&&f.frames.length===5&&f.frames.every(image));
 if(!valid(a)||!valid(b)||a.media_type!==b.media_type)return false;
 if(typeof a.sha256==='string'&&/^[a-f0-9]{64}$/.test(a.sha256)&&a.sha256===b.sha256)return true;
 const pop=[0,1,1,2,1,2,2,3,1,2,2,3,2,3,3,4];
 const distance=(x,y,stop)=>{let best=65;for(const h of x.hashes)for(const k of y.hashes){if(++work.hashes>100000)throw Error('group_comparison_budget');let n=0;for(let i=0;i<16;i++)n+=pop[parseInt(h[i],16)^parseInt(k[i],16)];best=Math.min(best,n);if(best<=stop)return best;}return best;};
 // The optional ORB fallback stays in the Python scanner. These are its conservative fast paths.
 if(a.media_type==='IMAGE')return Math.min(a.gray_stddev,b.gray_stddev)>=8&&distance(a,b,4)<=4;
 if(Math.abs(a.duration-b.duration)>Math.max(1,Math.min(a.duration,b.duration)*0.04))return false;
 let informative=0,sum=0;for(let i=0;i<5;i++){if(Math.min(a.frames[i].gray_stddev,b.frames[i].gray_stddev)>=8)informative++;const d=distance(a.frames[i],b.frames[i],0);if(d>6)return false;sum+=d;}
 return informative>=4&&sum<=20;
}
function currentDuplicateGroups(groups,posts=[]){
 const buckets=new Map(),untouched=[],postMap=new Map(posts.map(p=>[JSON.stringify([p.platform,p.account_id,p.post_id]),p])),work={pairs:0,hashes:0};
 for(const g of groups){try{
  const e=JSON.parse(g.evidence),ids=JSON.parse(g.members);if(g.algorithm!=='sh01-social-perceptual'||e.method!=='complete_link_candidate_cluster'||!Number.isInteger(e.version)||!Array.isArray(ids)||ids.length>100)throw Error('other_group');
  const key=JSON.stringify([g.platform,g.account_id,g.media_type,g.algorithm,e.version]);if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push({group:g,version:e.version,members:new Set(ids),sources:[g.group_id]});
 }catch{untouched.push(g);}}
 const result=[...untouched];
 for(const bucket of buckets.values()){
  const memberships=new Map(),fingerprints=new Map(),checked=new Map();
  for(const [i,item] of bucket.entries())for(const id of item.members){if(!memberships.has(id))memberships.set(id,new Set());memberships.get(id).add(i);}
  const fp=(item,id)=>{if(!fingerprints.has(id)){let f=null;try{f=JSON.parse(postMap.get(JSON.stringify([item.group.platform,item.group.account_id,id]))?.fingerprint||'null');}catch{}fingerprints.set(id,f);}return fingerprints.get(id);};
  const pair=(item,a,b)=>{
   if(a===b||[...(memberships.get(a)||[])].some(i=>memberships.get(b)?.has(i)))return true;
   const key=JSON.stringify([a,b].sort());if(checked.has(key))return checked.get(key);
   if(item.version!==1||++work.pairs>2000||work.hashes>100000)return false;
   let match=false;try{const x=fp(item,a),y=fp(item,b);match=x?.media_type===item.group.media_type&&y?.media_type===item.group.media_type&&duplicateFingerprintMatch(x,y,work);}catch{}
   checked.set(key,match);return match;
  };
  const retained=[];
  for(const item of bucket.sort((a,b)=>b.members.size-a.members.size||a.group.group_id.localeCompare(b.group.group_id))){
   let target=null;
   for(const other of retained){const union=new Set([...other.members,...item.members]);if(union.size>100)continue;
    // Every cross-pair needs evidence: overlap alone is never enough to merge.
    if([...other.members].every(a=>[...item.members].every(b=>pair(item,a,b)))){target=other;break;}
   }
   if(target){for(const id of item.members)target.members.add(id);target.sources.push(...item.sources);if(item.group.updated_at>target.updated_at)target.updated_at=item.group.updated_at;}
   else retained.push({...item,updated_at:item.group.updated_at});
  }
  for(const item of retained){const ids=[...item.members].sort(),original=JSON.parse(item.group.members);result.push(ids.length===original.length?item.group:{...item.group,members:JSON.stringify(ids),updated_at:item.updated_at,evidence:JSON.stringify({method:'verified_group_consolidation',version:item.version,source_group_ids:item.sources.sort(),pair_count:ids.length*(ids.length-1)/2,verification:'Each pair supported by a stored complete-link group or compatible saved fingerprints.'})});}
 }
 return result;
}
function reviewedPostKeys(plans,queue){
 const key=(p,a,id)=>JSON.stringify([p,a,id]),reviewed=new Set(queue.map(q=>key(q.platform,q.account_id,q.post_id)));
 for(const plan of plans){if(!Number(plan.committed))continue;try{const d=JSON.parse(plan.payload);for(const x of [...(d.keep||[]),...(d.remove||[])])reviewed.add(key(d.platform,d.account_id,typeof x==='object'?x.post_id:x));}catch{}}
 return reviewed;
}
function duplicateReviewCoverage(group,ids,reviewed){
 const total=new Set(ids).size,count=[...new Set(ids)].filter(id=>reviewed.has(JSON.stringify([group.platform,group.account_id,id]))).length;
 return {total,reviewed:count,unreviewed:total-count,status:!count?'unreviewed':count===total?'reviewed':'partial'};
}

// The picker index is complete; only preview-rich rows are limited.
function duplicateGroupIndex(env,tables,groups,coverage){
 const key=(p,a,id)=>JSON.stringify([p,a,id]),known=new Set(tables.content_posts.map(p=>key(p.platform,p.account_id,p.post_id))),reviewed=reviewedPostKeys(tables.content_cleanup_plans,tables.content_deletion_queue);
 const names=new Map();
 return groups.map(g=>{const account=JSON.stringify([g.platform,g.account_id]);if(!names.has(account))names.set(account,{...contentAccountName(g,tables.meta_assets,tables.content_posts),scan_coverage:coverage.find(c=>c.platform===g.platform&&c.account_id===g.account_id)||null,scan_status:typeof autoScanAccountSummary==='function'?autoScanAccountSummary(env,tables,g.platform,g.account_id):null});
  const ids=JSON.parse(g.members),present=ids.filter(id=>known.has(key(g.platform,g.account_id,id)));
  return {group_id:g.group_id,platform:g.platform,account_id:g.account_id,media_type:g.media_type,updated_at:g.updated_at,member_count:present.length,missing_member_count:ids.length-present.length,has_confirmed_history:present.some(id=>reviewed.has(key(g.platform,g.account_id,id))),review_coverage:duplicateReviewCoverage(g,ids,reviewed),details_loaded:false,...names.get(account)};
 });
}
function groupFromTables(groups,posts,id){const g=groups.find(x=>x.group_id===id);if(!g)throw Error('group_not_found');const ids=JSON.parse(g.members),rows=posts.filter(r=>r.platform===g.platform&&r.account_id===g.account_id&&ids.includes(r.post_id));storeSort(rows,'post_id');return {...g,members:rows.map(publicPost),missing_members:ids.filter(id=>!rows.some(r=>r.post_id===id)),evidence:JSON.parse(g.evidence),review_status:'candidate_requires_confirmation'};}
// Review annotations are read-only history. They never participate in plan digests.
function groupReviewState(group,plans,queue){
 const history=[];
 for(const p of plans){
  if(!Number(p.committed))continue;
  let d;try{d=JSON.parse(p.payload)}catch{continue}
  if(d.platform!==group.platform||d.account_id!==group.account_id)continue;
  const removed=(d.remove||[]).map(x=>typeof x==='object'?x.post_id:x),kept=(d.keep||[]).map(x=>typeof x==='object'?x.post_id:x);
  const related=queue.filter(q=>q.platform===d.platform&&q.account_id===d.account_id&&removed.includes(q.post_id));
  const confirmed_at=d.confirmed_at||related.map(q=>q.created_at).filter(Boolean).sort().at(-1)||null;
  history.push({kept,removed,confirmed_at,plan_id:p.plan_id,metric:d.metric||null,ranking:d.ranking||null});
 }
 history.sort((a,b)=>(a.confirmed_at||'').localeCompare(b.confirmed_at||'')||a.plan_id.localeCompare(b.plan_id));
 let prior=false;
 const members=group.members.map(post=>{
  let decision=null;for(const h of history){
   const kind=h.removed.includes(post.post_id)?'remove':h.kept.includes(post.post_id)?'keep':null;if(!kind)continue;
   const saved=h.ranking?.values?.find(x=>x.post_id===post.post_id);
   decision={decision:kind,confirmed_at:h.confirmed_at,plan_id:h.plan_id,ranking:saved?{metric:h.metric,version:h.ranking.version,formula:h.ranking.formula,weights:h.ranking.weights,value:saved.value,inputs:saved.inputs}:null};
  }
  const q=queue.find(q=>q.platform===post.platform&&q.account_id===post.account_id&&q.post_id===post.post_id);
  if(decision||q)prior=true;
  return {...post,cleanup_review:{...decision,queue_status:q?.status||null,queued_at:q?.created_at||null,removal_scheduled_at:null,schedule_status:'not_reported'}};
 });
 return {...group,members,has_confirmed_history:prior,review_coverage:duplicateReviewCoverage(group,[...members.map(p=>p.post_id),...(group.missing_members||[])],reviewedPostKeys(plans,queue))};
}
function cleanupGroupFromTables(tables,id){
 const group=groupFromTables(currentDuplicateGroups(tables.content_duplicate_groups,tables.content_posts),tables.content_posts,id);
 const queued=new Set(tables.content_deletion_queue.filter(q=>q.platform===group.platform&&q.account_id===group.account_id).map(q=>q.post_id));
 return {...group,excluded_from_plan:group.members.filter(p=>p.delete_status!=='published'||queued.has(p.post_id)).map(p=>p.post_id).sort()};
}
async function duplicateGroup(env,id){const {tables}=await env.STORE.snapshot(['content_duplicate_groups','content_posts','content_deletion_queue']);return cleanupGroupFromTables(tables,contentID(id));}
async function ingestGroups(env,groups){
 if(!Array.isArray(groups)||groups.length>10)throw Error('maximum_10_groups');
 await env.STORE.transact(['content_duplicate_groups','content_posts'],tx=>{for(const x of groups){const id=contentID(x.group_id),platform=contentPlatform(x.platform),account=contentID(x.account_id),ids=[...new Set((x.members||[]).map(contentID))];if(ids.length<2||ids.length>100||!['IMAGE','VIDEO'].includes(x.media_type)||JSON.stringify(x.evidence||{}).length>4000)throw Error('invalid_duplicate_group');const rows=tx.rows('content_posts').filter(r=>r.platform===platform&&r.account_id===account&&ids.includes(r.post_id));if(rows.length!==ids.length||rows.some(r=>(['VIDEO','REELS'].includes(r.media_type)?'VIDEO':r.media_type==='POST'&&r.fingerprint?JSON.parse(r.fingerprint).media_type:r.media_type)!==x.media_type))throw Error('mixed_or_missing_group_members');tx.put('content_duplicate_groups',{group_id:id,platform,account_id:account,media_type:x.media_type,algorithm:clean(x.algorithm,100),confidence:'candidate',members:JSON.stringify(ids.sort()),evidence:JSON.stringify(x.evidence||{}),updated_at:contentNow()});}});return {accepted:groups.length};
}
// A review preference, not a provider metric. Keep it out of metric ingestion/series.
function cleanupScoreWeights(value){
 const w=value===undefined?{views:1,likes:10}:value;
 if(!w||typeof w!=='object'||Array.isArray(w)||Object.keys(w).length!==2||!['views','likes'].every(k=>Object.hasOwn(w,k)&&Number.isInteger(w[k])&&w[k]>=0&&w[k]<=1000)||w.views+w.likes===0)throw Error('invalid_score_weights');
 return {views:w.views,likes:w.likes};
}
function cleanupScore(metrics,weights){
 let score=0;for(const key of ['views','likes']){if(weights[key]===0)continue;const n=metrics?.[key];if(typeof n!=='number'||!Number.isFinite(n)||n<0)return null;score+=n*weights[key];}
 return Number.isFinite(score)&&score<=Number.MAX_SAFE_INTEGER?score:null;
}
function rankDuplicateMembers(members,k,strategy,metric,requestedWeights) {
 if(!['best','worst'].includes(strategy))throw Error('explicit_keep_strategy_required');
 if(!Number.isInteger(k)||k<1||k>=members.length)throw Error('keep_count_must_be_between_1_and_n_minus_1');
 const weighted=metric==='weighted_score';if(!weighted&&!CONTENT_METRICS.has(metric))throw Error('unsupported_ranking_metric');
 const weights=weighted?cleanupScoreWeights(requestedWeights):null;
 const values=members.map(p=>({post_id:p.post_id,value:weighted?cleanupScore(p.metrics,weights):p.metrics?.[metric],inputs:weighted?{views:p.metrics?.views??null,likes:p.metrics?.likes??null}:{[metric]:p.metrics?.[metric]??null}}));
 if(members.some(p=>p.delete_status!=='published'))throw Error('already_queued_member');
 if(values.some(p=>typeof p.value!=='number'||!Number.isFinite(p.value)||p.value<0))throw Error('missing_ranking_metrics');
 const byId=new Map(values.map(p=>[p.post_id,p.value]));
 const ranked=[...members].sort((a,b)=>(strategy==='best'?byId.get(b.post_id)-byId.get(a.post_id):byId.get(a.post_id)-byId.get(b.post_id))||a.post_id.localeCompare(b.post_id));
 const ranking={version:weighted?'weighted_v1':'single_metric_v1',weights,formula:weighted?'Views × '+weights.views+' + Likes × '+weights.likes:metric,values};
 return {keep:ranked.slice(0,k).map(p=>p.post_id),remove:ranked.slice(k),excluded_missing_metrics:[],ranking};
}
async function planCleanup(env,b) {
 const group=await duplicateGroup(env,b.group_id);if(group.missing_members.length)throw Error('missing_group_members');
 const eligible=group.members.filter(p=>!group.excluded_from_plan.includes(p.post_id));
 if(eligible.length<2&&group.excluded_from_plan.length)throw Error('already_queued_member');
 const ranked=rankDuplicateMembers(eligible,b.keep_count,b.keep_strategy,b.metric,b.weights);
 const source_digest=await producerHash(JSON.stringify(group)),plan_id=crypto.randomUUID(),expires_at=new Date(Date.now()+600000).toISOString();
 const payload={...ranked,eligible_count:eligible.length,excluded_previously_queued:group.excluded_from_plan,group_id:group.group_id,platform:group.platform,account_id:group.account_id,keep_count:b.keep_count,keep_strategy:b.keep_strategy,metric:b.metric,ranking_basis:'latest_observed_lifetime_total; publication_age_not_adjusted',confirmation:'QUEUE '+ranked.remove.length+' LINKS'};
 await env.STORE.put('content_cleanup_plans',{plan_id,group_id:group.group_id,payload:JSON.stringify(payload),source_digest,expires_at,committed:0});
 return {plan_id,...payload,expires_at,warning:'Queueing clickouts links can cause your existing deletion workflow to delete these posts. Confirm the candidate group and keep policy.'};
}
async function queueCleanup(env,b){
 if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1')throw Error('sheet_writes_disabled');
 return env.STORE.transact(['content_cleanup_plans','content_duplicate_groups','content_posts','content_deletion_queue','content_sheet_outbox','content_collect_state'],async tx=>{
  const p=tx.find('content_cleanup_plans',{plan_id:contentID(b.plan_id)});if(!p||p.committed||Date.parse(p.expires_at)<Date.now())throw Error('plan_missing_used_or_expired');const data=JSON.parse(p.payload);if(b.confirmation!==data.confirmation)throw Error('confirmation_mismatch');
  const group=cleanupGroupFromTables({content_duplicate_groups:tx.rows('content_duplicate_groups'),content_posts:tx.rows('content_posts'),content_deletion_queue:tx.rows('content_deletion_queue')},p.group_id);if(await producerHash(JSON.stringify(group))!==p.source_digest)throw Error('group_or_metrics_changed_preview_again');
  const at=contentNow();for(const x of data.remove){const w={platform:data.platform,account_id:data.account_id,post_id:x.post_id};if(tx.find('content_deletion_queue',w))throw Error('post_already_queued');const request_id=crypto.randomUUID(),rec={request_id,...w,permalink:x.permalink};tx.put('content_deletion_queue',{...rec,status:'awaiting_sheet',reason:'confirmed_duplicate_plan',created_at:at,updated_at:at});tx.put('content_sheet_outbox',{record_key:'delete:'+request_id,kind:'clickouts',payload:JSON.stringify(rec),status:'pending',error_code:null,updated_at:at});Object.assign(tx.find('content_posts',w),{delete_status:'awaiting_sheet'});}
  p.payload=JSON.stringify({...data,confirmed_at:at});p.committed=1;tx.put('content_collect_state',{id:'request:sheet_mirror',payload:JSON.stringify({requested_at:at,nonce:crypto.randomUUID()})});return {confirmed_at:at,queued:data.remove.length,keep:data.keep,keep_strategy:data.keep_strategy,status:'awaiting_sheet',execution:'not_yet_deleted'};
 });
}
async function contentStatus(env,tables=null){
 if(!tables)({tables}=await env.STORE.snapshot(['content_jobs','content_sheet_outbox']));const counts={};for(const r of tables.content_sheet_outbox)counts[r.status]=(counts[r.status]||0)+1;
 return {storage_backend:'google_sheets',meta_sync:tables.content_jobs.find(r=>r.id==='meta_collect'),meta_sync_enabled:env.META_SYNC_ENABLED==='1',schema_ready:true,sheet_write_enabled:env.GOOGLE_SHEETS_WRITE_ENABLED==='1',post_sheet:POST_SHEET,clickouts_sheet:'clickouts',mirror:tables.content_jobs.find(r=>r.id==='sheet_mirror'),outbox:Object.entries(counts).map(([status,count])=>({status,count})),delete_execution:'requires_configured_executor',schedule_interval_minutes:10,meta_interval_seconds:Math.max(60,Math.min(3600,Number(env.META_SYNC_INTERVAL_SECONDS)||60))};
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
const CLICKOUT_HEADERS=['URLS','platform','account_id','post_id','request_id','queued_at'];
async function prepareMirrorTab(env,token,title){
 const root='https://sheets.googleapis.com/v4/spreadsheets/'+encodeURIComponent(env.GOOGLE_SHEETS_SPREADSHEET_ID);
 let info;try{info=await sheetJSON(root+'?fields=sheets.properties',{headers:{Authorization:'Bearer '+token}});}catch(e){throw Error('sheet_metadata_'+e.message);}
 let props=(info.sheets||[]).map(x=>x.properties).find(p=>p.title===title);
 if(!props){const added=await contentSheetWrite(env,token,':batchUpdate',{requests:[{addSheet:{properties:{title}}}]});props=added.replies?.[0]?.addSheet?.properties;if(!props||props.title!==title)throw Error('sheet_creation_unverified');}
 let rows;try{const width=Math.min(52,props.gridProperties?.columnCount||26),range="'"+title+"'!A:"+sheetCol(width-1),data=await sheetJSON(root+'/values/'+encodeURIComponent(range),{headers:{Authorization:'Bearer '+token}});rows=data.values||[];if(data.majorDimension&&data.majorDimension!=='ROWS'||!Array.isArray(rows)||rows.length>20000||rows.some(r=>!Array.isArray(r)))throw Error('sheet_invalid_shape');}catch(e){throw Error((title==='clickouts'?'clickouts':'post_sheet')+'_read_'+e.message);}
 const headers=title==='clickouts'?CLICKOUT_HEADERS:POST_HEADERS;
 if(title!== 'clickouts'&&rows.length&&rows[0].join('|')!==POST_HEADERS.join('|'))throw Error('post_sheet_header_mismatch');
 let current=rows[0]||[],normal=current.map(h=>String(h).trim().toLowerCase()),occupied=normal.filter(Boolean);
 if(new Set(occupied).size!==occupied.length)throw Error('sheet_duplicate_columns');
 if(title==='clickouts'&&rows.length&&!normal.includes('urls'))throw Error('clickouts_URLS_column_missing');
 const next=[...current];for(const name of headers)if(!normal.includes(name.toLowerCase()))next.push(name);
 if(next.length>52)throw Error('sheet_header_limit');
 if(props.gridProperties?.columnCount<next.length)await contentSheetWrite(env,token,':batchUpdate',{requests:[{appendDimension:{sheetId:props.sheetId,dimension:'COLUMNS',length:next.length-props.gridProperties.columnCount}}]});
 if(next.join('|')!==current.join('|'))await contentSheetWrite(env,token,'/values:batchUpdate',{valueInputOption:'RAW',data:[{range:"'"+title+"'!A1:"+sheetCol(next.length-1)+'1',values:[next]}]});
 if(!rows.length)rows=[next];else rows[0]=next;
 return rows;
}
function clickoutValues(data,headers,created){
 const values={urls:data.permalink,platform:data.platform,account_id:String(data.account_id),post_id:String(data.post_id),request_id:data.request_id,queued_at:created};
 return headers.map(h=>values[String(h).trim().toLowerCase()]??'');
}
async function mirrorContentSheets(env){
 if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1'||!await contentReady(env))return {status:'disabled'};
 const db=env.STORE,lease=crypto.randomUUID();if(!await db.claim('content_jobs','sheet_mirror',lease,300000))return {status:'already_running'};
 let stage='outbox';
 try{
  const {tables}=await db.snapshot(['content_sheet_outbox','content_posts','content_deletion_queue']);
  const all=storeSort(tables.content_sheet_outbox,'updated_at'),clicks=all.filter(r=>r.kind==='clickouts'&&['pending','uncertain'].includes(r.status));
  // Confirmed clickouts cannot wait behind the complete publication registry.
  const fresh=clicks.filter(r=>r.status==='pending'),postsPending=all.filter(r=>r.kind==='post'&&r.status==='pending');
  const pending=(fresh.length?[...fresh,...clicks.filter(r=>r.status==='uncertain')]:postsPending.length?postsPending:clicks).slice(0,10);
  if(!pending.length){await db.finish('content_jobs','sheet_mirror',lease,{status:'ok',last_success:contentNow(),error_code:null});return {status:'ok',processed:0};}
  stage='authorization';const token=await sheetToken(env),clickout=pending[0].kind==='clickouts',title=clickout?'clickouts':POST_SHEET;
  stage='prepare_'+title;const rows=await prepareMirrorTab(env,token,title),headers=rows[0],normal=headers.map(h=>String(h).trim().toLowerCase());
  const updates=[],done=[],appends=[],unresolved=[];let nextPost=rows.length+1;
  for(const row of pending){
   const data=JSON.parse(row.payload),post=tables.content_posts.find(p=>p.platform===data.platform&&p.account_id===data.account_id&&p.post_id===data.post_id);
   if(!post)throw Error('outbox_post_missing');
   if(!clickout){const index=rows.findIndex((r,i)=>i>0&&r[0]===row.record_key),n=index>=0?index+1:nextPost++,record={...post,record_key:row.record_key};updates.push({range:"'"+title+"'!A"+n+':M'+n,values:[POST_HEADERS.map(k=>record[k]??'')]});done.push(row);continue;}
   const queue=tables.content_deletion_queue.find(q=>q.request_id===data.request_id);
   if(!queue||queue.platform!==data.platform||queue.account_id!==data.account_id||queue.post_id!==data.post_id||queue.permalink!==data.permalink||post.permalink!==data.permalink)throw Error('outbox_identity_mismatch');
   if(queue.status!=='awaiting_sheet'){unresolved.push(row);continue;}
   const col=normal.indexOf('urls'),reqCol=normal.indexOf('request_id');
   const matches=rows.map((r,i)=>({r,i})).filter(({r,i})=>i>0&&(r[reqCol]===data.request_id||(()=>{try{return canonicalPostURL(r[col],data.platform)===data.permalink}catch{return false}})()));
   if(matches.length>1)throw Error('clickouts_duplicate_identity');
   const expected=clickoutValues(data,headers,queue.created_at);
   if(matches.length){
    const {r,i}=matches[0];
    for(const name of ['urls','platform','account_id','post_id','request_id']){const col=normal.indexOf(name),v=String(r[col]??'');if(v&&v!==expected[col]&&!(name==='urls'&&canonicalPostURL(v,data.platform)===data.permalink))throw Error('clickouts_identity_conflict');}
    // Enrich an existing URL row only in our own blank columns; retain workflow state.
    for(let col=0;col<headers.length;col++)if(expected[col]&&!(r[col]??''))updates.push({range:"'clickouts'!"+sheetCol(col)+(i+1),values:[[expected[col]]]});
    done.push(row);
   }else if(row.status==='uncertain'){unresolved.push(row);}else appends.push({row,values:expected});
  }
  stage='update_'+title;if(updates.length)await contentSheetWrite(env,token,'/values:batchUpdate',{valueInputOption:'RAW',data:updates});
  if(appends.length){
   await db.transact(['content_sheet_outbox'],tx=>{for(const x of appends){const r=tx.find('content_sheet_outbox',{record_key:x.row.record_key});if(r?.updated_at!==x.row.updated_at||r.status!=='pending')throw Error('outbox_changed_retry');Object.assign(r,{status:'uncertain',error_code:'append_outcome_pending'});}});
   stage='append_clickouts';
   try{await contentSheetWrite(env,token,'/values/'+encodeURIComponent("'clickouts'!A:"+sheetCol(headers.length-1))+':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',{values:appends.map(x=>x.values)});}
   catch(e){
    // A definite rejection wrote nothing. Network/5xx outcomes stay quarantined.
    if(/^google_write_http_(400|401|403|404|409|422|429)$/.test(e.message))await db.transact(['content_sheet_outbox'],tx=>{for(const x of appends){const r=tx.find('content_sheet_outbox',{record_key:x.row.record_key});if(r?.updated_at===x.row.updated_at)Object.assign(r,{status:'pending',error_code:e.message});}});
    throw e;
   }done.push(...appends.map(x=>x.row));
  }
  stage='record_delivery';
  await db.transact(['content_sheet_outbox','content_deletion_queue','content_posts'],tx=>{for(const row of done){const r=tx.find('content_sheet_outbox',{record_key:row.record_key});if(r?.updated_at!==row.updated_at)continue;Object.assign(r,{status:'synced',error_code:null});if(row.kind==='clickouts'){const d=JSON.parse(row.payload),q=tx.find('content_deletion_queue',{request_id:d.request_id}),p=tx.find('content_posts',{platform:d.platform,account_id:d.account_id,post_id:d.post_id});if(q?.status==='awaiting_sheet')Object.assign(q,{status:'queued_clickouts',updated_at:contentNow()});if(p?.delete_status==='awaiting_sheet')p.delete_status='queued_clickouts';}}});
  const status=unresolved.length?'needs_review':'ok',error_code=unresolved.length?'clickouts_append_outcome_uncertain':null;
  await db.finish('content_jobs','sheet_mirror',lease,{status,last_success:contentNow(),error_code});return {status,processed:done.length,uncertain:unresolved.length};
 }catch(e){const reason=/^(google_|sheet_|post_sheet|clickouts_|outbox_)/.test(e.message)?e.message:'sheet_mirror_failed',code=(stage+':'+reason).slice(0,160);await db.finish('content_jobs','sheet_mirror',lease,{status:'failed',error_code:code});return {status:'failed',error_code:code};}
}

async function contentApi(req,env,ctx) {
 const u=new URL(req.url),p=u.pathname;
 if(['/api/content/media','/api/content/poster','/api/content/comments'].includes(p)&&req.method==='POST')return contentExtrasApi(req,env);
 if(p==='/api/content/status')return json(await contentStatus(env));

 if(p==='/api/ingest/posts'&&req.method==='POST')return json(await upsertPosts(env,(await body(req)).posts));
 if(p==='/api/ingest/duplicate-groups'&&req.method==='POST')return json(await ingestGroups(env,(await body(req)).groups));
 if(p==='/api/ingest/fingerprints'&&req.method==='GET'){
  const rows=storeSort((await env.STORE.rows('content_posts')).filter(r=>r.platform===contentPlatform(u.searchParams.get('platform'))&&r.account_id===contentID(u.searchParams.get('account_id'))&&r.fingerprint&&['published','awaiting_sheet','queued_clickouts','failed'].includes(r.delete_status)),'post_id').slice(Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0)),Math.max(0,Math.trunc(Number(u.searchParams.get('offset'))||0))+101).map(({post_id,fingerprint})=>({post_id,fingerprint}));
  return json({fingerprints:rows.slice(0,100).map(r=>({...r,fingerprint:JSON.parse(r.fingerprint)})),has_more:rows.length>100});
 }
 if(p==='/api/content/sheets/setup'&&req.method==='POST')return json(await setupContentSheet(env));
 if(p==='/api/content/sheets/sync'&&req.method==='POST'){if(env.GOOGLE_SHEETS_WRITE_ENABLED!=='1')throw Error('sheet_writes_disabled');return json(await queueStoredJob(env,'sheet_mirror'),202);}
 if(p==='/api/content/plan'&&req.method==='POST')return json(await planCleanup(env,await body(req)));
 if(p==='/api/content/queue'&&req.method==='POST')return json(await queueCleanup(env,await body(req)));
 if(p==='/api/content/queue'&&req.method==='GET'){
  const {tables}=await env.STORE.snapshot(['content_deletion_queue','content_posts','meta_assets','meta_content','content_jobs','content_sheet_outbox','sheet_sync_state','sheet_live_producers','meta_capabilities','content_collect_state']);
  const posts=new Map(tables.content_posts.map(p=>[JSON.stringify([p.platform,p.account_id,p.post_id]),p])),outbox=new Map(tables.content_sheet_outbox.filter(r=>r.kind==='clickouts').map(r=>[JSON.parse(r.payload).request_id,r]));
  const rows=storeSort(tables.content_deletion_queue,'-created_at').slice(0,501).map(q=>{
   const p=posts.get(JSON.stringify([q.platform,q.account_id,q.post_id])),verified=!!p&&p.permalink===q.permalink;
   return {...(verified?{...publicPost(p),...contentAccountName(p,tables.meta_assets),poster_url:contentPoster(p,tables.meta_content),metric_status:contentMetricEvidence(p,tables)}:{}),...q,sheet_delivery:{status:outbox.get(q.request_id)?.status||'not_recorded',error_code:outbox.get(q.request_id)?.error_code||(q.status==='awaiting_sheet'?tables.content_jobs.find(j=>j.id==='sheet_mirror'&&j.status==='failed')?.error_code:null)||null},preview_available:verified&&p.delete_status!=='deleted',preview_unavailable_reason:!verified?'Post identity has not been verified. Open the original link.':p.delete_status==='deleted'?'Post is recorded as deleted.':''};
  });
  const state=tables.sheet_sync_state.find(s=>s.id===1)||{},metaRow=tables.sheet_live_producers.find(s=>s.version===state.active_version&&s.producer_id==='__producer_source_evidence_v2__'),sheet=metaRow?JSON.parse(metaRow.payload)?.clickouts:null;
  const seen=new Set(rows.map(r=>r.permalink));for(const entry of sheet?.rows||[]){if(seen.has(entry.permalink))continue;let platform='unknown';const h=new URL(entry.permalink).hostname;if(h==='instagram.com'||h.endsWith('.instagram.com'))platform='instagram';else if(h==='facebook.com'||h.endsWith('.facebook.com'))platform='facebook';else if(h==='tumblr.com'||h.endsWith('.tumblr.com'))platform='tumblr';rows.push({request_id:'sheet-row-'+entry.row,platform,account_id:'',post_id:'',permalink:entry.permalink,status:'sheet_listed_unverified',reason:'Observed in clickouts URLS; mapping/actual deletion not verified',created_at:state.last_success});seen.add(entry.permalink);}
  const visible=rows.slice(0,500);const decorated=typeof extrasDecorate==='function'?await extrasDecorate(env,visible):visible;return json({rows:decorated,limit:500,has_more:rows.length>500,clickouts_read:sheet?.status||'unavailable',clickouts_truncated:sheet?.truncated||false,sheet_status:await contentStatus(env,tables)});
 }
 if(p==='/api/content/metrics/refresh'&&req.method==='POST')return json(await metaQueueGroupMetrics(env,await body(req)),202);
 if(p==='/api/content/scan'&&req.method==='POST')return json(await autoScanPrioritize(env,await body(req)),202);
 if(p==='/api/content/groups'&&req.method==='GET'){
  const requested=u.searchParams.get('group_id');if(requested!==null)contentID(requested);
  const {tables}=await env.STORE.snapshot(['content_duplicate_groups','content_posts','content_cleanup_plans','content_deletion_queue','meta_assets','content_collect_state','meta_content','meta_capabilities']);
  const scanCoverage=typeof autoScanCoverage==='function'?autoScanCoverage(tables.content_posts):[],current=storeSort(currentDuplicateGroups(tables.content_duplicate_groups,tables.content_posts),'-updated_at','group_id');
  const indexOnly=requested===null&&u.searchParams.get('index_only')==='1';
  const groups=requested!==null?current.filter(g=>g.group_id===requested):indexOnly?[]:current.slice(0,20);
  if(requested!==null&&!groups.length)throw Error('group_not_found_refresh_groups');
  const rows=groups.map(g=>groupReviewState(groupFromTables(groups,tables.content_posts,g.group_id),tables.content_cleanup_plans,tables.content_deletion_queue)).map(group=>{
   const name=contentAccountName(group,tables.meta_assets,tables.content_posts),scan_coverage=scanCoverage.find(a=>a.platform===group.platform&&a.account_id===group.account_id)||null;
   return {...group,...name,details_loaded:true,metric_refresh:contentMetricRefreshSummary(group,tables),member_count:group.members.length,scan_coverage,scan_status:typeof autoScanAccountSummary==='function'?autoScanAccountSummary(env,tables,group.platform,group.account_id):null,members:group.members.map(row=>({...row,...name,poster_url:contentPoster(row,tables.meta_content),metric_status:contentMetricEvidence(row,tables)}))};
  });
  if(typeof extrasDecorate==='function')for(const row of rows)row.members=await extrasDecorate(env,row.members||[]);
  return json({rows,limit:requested!==null?1:indexOnly?0:20,total:current.length,...(requested===null?{index:duplicateGroupIndex(env,tables,current,scanCoverage),index_complete:true,scan_progress:contentScanProgress(tables,scanCoverage)}:{}),scope:'same_platform_and_account',removal_schedule:'not_reported'});
 }
 if(p==='/api/content'&&req.method==='GET'){const data=await contentList(env,u);if(typeof extrasDecorate==='function')data.rows=await extrasDecorate(env,data.rows);return json(data);}
 if(p==='/api/content/series'&&req.method==='GET'){
  const platform=contentPlatform(u.searchParams.get('platform')),account=contentID(u.searchParams.get('account_id')),id=contentID(u.searchParams.get('post_id')),metric=u.searchParams.get('metric');if(!CONTENT_METRICS.has(metric))throw Error('unsupported_metric');
  const data=storeSort((await env.STORE.rows('content_observations')).filter(r=>r.platform===platform&&r.account_id===account&&r.post_id===id),'observed_at').slice(0,2001);
  const rows=data.slice(0,2000).flatMap(r=>{const v=JSON.parse(r.metrics)[metric];return Number.isFinite(v)?[{observed_at:r.observed_at,value:v}]:[]});return json({rows,metric,truncated:data.length>2000,first_observed:rows[0]?.observed_at||null,meaning:'Snapshot totals and observed interval deltas, not event timestamps or reconstructed past growth.'});
 }
 if(p==='/api/content/preview'&&req.method==='GET')return json(await cachedContentPreview(env,u));
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


// Bounded isolate-local cache: no persistent credentials or media bytes.
const contentPreviewCache=new Map();
function previewCacheLifetime(data){
 if(!data.available)return 10000;
 let ttl=120000;
 try{const u=new URL(data.url),oe=u.searchParams.get('oe');if(oe&&/^[a-f0-9]+$/i.test(oe))ttl=Math.min(ttl,parseInt(oe,16)*1000-Date.now()-30000);}catch{return 0;}
 return Math.max(0,ttl);
}
async function cachedContentPreview(env,u){
 const where={platform:contentPlatform(u.searchParams.get('platform')),account_id:contentID(u.searchParams.get('account_id')),post_id:contentID(u.searchParams.get('post_id'))};
 const scope=await producerHash(JSON.stringify([env.GOOGLE_SHEETS_SPREADSHEET_ID||'',env.GOOGLE_CLIENT_ID||'',env.GOOGLE_REFRESH_TOKEN||'',env.META_SYSVAR||'',env.META_GRAPH_VERSION||'']));
 const key=JSON.stringify([scope,where,u.searchParams.get('refresh')==='1']);
 const cached=contentPreviewCache.get(key);if(cached&&Date.now()<cached.until)return cached.promise;
 const entry={until:Date.now()+25000,promise:null};
 entry.promise=(async()=>{
  const row=await env.STORE.find('content_posts',where),v=contentPreview(row?.preview_url);
  let data={url:v,kind:row?.preview_type||'image',available:!!v,expires_warning:'Provider media links can expire.'};
  if(row&&u.searchParams.get('refresh')==='1'){
   const fresh=await metaPreview(env,row);
   data=fresh?.available?{...fresh,expires_warning:'Refreshed from provider; playback depends on CDN availability.'}:{url:'',kind:row.preview_type||'image',available:false,reason:'provider_preview_unavailable'};
  }
  entry.until=Date.now()+previewCacheLifetime(data);return data;
 })().catch(e=>{if(contentPreviewCache.get(key)===entry)contentPreviewCache.delete(key);throw e;});
 contentPreviewCache.delete(key);contentPreviewCache.set(key,entry);
 while(contentPreviewCache.size>128)contentPreviewCache.delete(contentPreviewCache.keys().next().value);
 return entry.promise;
}
