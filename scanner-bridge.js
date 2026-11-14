// Scanner reads the existing catalogue. No Meta credentials cross this interface.
function scannerKind(row){
 if(['VIDEO','REELS'].includes(row.media_type))return 'VIDEO';
 if(row.media_type==='IMAGE')return 'IMAGE';
 if(['CAROUSEL','CAROUSEL_ALBUM'].includes(row.media_type))return 'CAROUSEL';
 if(row.media_type==='POST'){try{const fp=JSON.parse(row.fingerprint||'null');if(['IMAGE','VIDEO'].includes(fp?.media_type))return fp.media_type;}catch{}}
 return null;
}
async function scannerAccounts(env){
 const {tables}=await env.STORE.snapshot(['meta_assets','content_posts']);const out=new Map();
 for(const a of tables.meta_assets)if(['facebook','instagram'].includes(a.platform))out.set(a.platform+':'+a.id,{platform:a.platform,account_id:a.id,handle:a.name||a.id,stored_posts:0});
 for(const row of tables.content_posts){if(!['facebook','instagram'].includes(row.platform)||row.delete_status!=='published')continue;const k=row.platform+':'+row.account_id;const a=out.get(k)||{platform:row.platform,account_id:row.account_id,handle:row.account_handle||row.account_id,stored_posts:0};a.stored_posts++;out.set(k,a);}
 return {rows:[...out.values()].sort((a,b)=>(a.platform+':'+a.account_id).localeCompare(b.platform+':'+b.account_id)),source:'dashboard_catalogue',coverage:{full_history_verified:false,scope:'Stored accounts and published posts; collection coverage is owned by the dashboard'}};
}
async function scannerPosts(env,u){
 const platform=contentPlatform(u.searchParams.get('platform')),account=contentID(u.searchParams.get('account_id'));
 const after=u.searchParams.get('after')||'';if(after)contentID(after);
 const rows=(await env.STORE.rows('content_posts')).filter(r=>r.platform===platform&&r.account_id===account&&r.delete_status==='published'&&(!after||r.post_id>after)).sort((a,b)=>a.post_id<b.post_id?-1:a.post_id>b.post_id?1:0);
 const selected=rows.slice(0,20).map(r=>({platform:r.platform,account_id:r.account_id,post_id:r.post_id,media_type:r.media_type,scan_kind:scannerKind(r),permalink:r.permalink,account_handle:r.account_handle,published_at:r.published_at,caption:r.caption,workflow_id:r.workflow_id,workflow_url:r.workflow_url}));
 return {rows:selected,next_after:rows.length>20?selected.at(-1).post_id:null,source:'dashboard_catalogue',full_history_verified:false};
}
async function scannerFingerprints(env,rows){
 if(!Array.isArray(rows)||rows.length>10)throw Error('maximum_10_fingerprints');
 await env.STORE.transact(['content_posts'],tx=>{for(const r of rows){
  const row=tx.find('content_posts',{platform:contentPlatform(r.platform),account_id:contentID(r.account_id),post_id:contentID(r.post_id)});
  if(!row||row.delete_status!=='published')throw Error('scanner_post_missing_or_unpublished');
  const fp=r.fingerprint;if(!fp||fp.algorithm!=='sh01-social-perceptual'||fp.version!==1||!['IMAGE','VIDEO'].includes(fp.media_type)||JSON.stringify(fp).length>40000)throw Error('invalid_fingerprint');
  if(row.media_type!=='POST'&&scannerKind(row)!==fp.media_type)throw Error('scanner_media_type_mismatch');
  row.fingerprint=JSON.stringify(fp);
 }});return {accepted:rows.length,observations_created:0};
}
const scannerMediaCache=new Map();
async function scannerMedia(env,u){
 const where={platform:contentPlatform(u.searchParams.get('platform')),account_id:contentID(u.searchParams.get('account_id')),post_id:contentID(u.searchParams.get('post_id'))};
 const row=await env.STORE.find('content_posts',where);if(!row||row.delete_status!=='published')throw Error('scanner_post_missing_or_unpublished');
 const force=u.searchParams.get('refresh')==='1';const kind=scannerKind(row),stored=contentPreview(row.preview_url);
 if(!force&&row.media_type!=='POST'&&stored&&((kind==='IMAGE'&&row.preview_type==='image')||(kind==='VIDEO'&&row.preview_type==='video')))return {available:true,url:stored,kind:row.preview_type,media_type:kind,source:'stored'};
 if(kind==='CAROUSEL')return {available:false,media_type:'CAROUSEL',reason:'carousel_metadata_only'};
 const scope=await producerHash(JSON.stringify([env.GOOGLE_SHEETS_SPREADSHEET_ID,env.GOOGLE_CLIENT_ID,env.GOOGLE_REFRESH_TOKEN,env.META_SYSVAR,env.META_GRAPH_VERSION]));
 const key=JSON.stringify([scope,where]);const cached=scannerMediaCache.get(key);if(cached&&Date.now()<cached.until)return cached.promise;
 const entry={until:Date.now()+25000,promise:null};
 entry.promise=(async()=>{
  const asset=await env.STORE.find('meta_assets',{id:row.account_id});if(!asset)return {available:false,reason:'asset_not_collected'};
  const token=metaCredential(env.META_SYSVAR),version=env.META_GRAPH_VERSION||META_VERSION,budget={calls:0,deadline:Date.now()+20000};
  const page=await graph(asset.page_id||asset.id,token,{fields:'id,access_token'},version,budget),credential=page.access_token||token;
  let source='',type=null;
  if(row.platform==='instagram'){
   const data=await graph(row.post_id,credential,{fields:'id,media_type,media_url'},version,budget);
   type=data.media_type==='VIDEO'?'VIDEO':data.media_type==='IMAGE'?'IMAGE':data.media_type==='CAROUSEL_ALBUM'?'CAROUSEL':null;source=data.media_url||'';
  }else if(row.platform==='facebook'){
   const data=await graph(row.post_id,credential,{fields:'id,attachments{media_type,type,media,target,subattachments}'},version,budget);
   const list=data.attachments?.data||[],a=list[0];
   if(list.length>1||a?.subattachments?.data?.length||a?.media_type==='album'||a?.type==='album')type='CAROUSEL';
   else if(a&&(['video'].includes(a.media_type)||String(a.type||'').startsWith('video'))){type='VIDEO';source=a.media?.source||'';const id=String(a.target?.id||'');if(!source&&/^\d+$/.test(id))source=(await graph(id,credential,{fields:'source'},version,budget)).source||'';}
   else if(a&&['photo','image'].includes(a.media_type||a.type)){type='IMAGE';source=a.media?.image?.src||'';}
  }
  const url=type==='CAROUSEL'?'':contentPreview(source);
  return {available:!!url,url,kind:type==='VIDEO'?'video':'image',media_type:type,reason:url?null:'original_media_unavailable',source:'provider_refreshed'};
 })().then(data=>{entry.until=Date.now()+previewCacheLifetime(data);return data;}).catch(e=>{scannerMediaCache.delete(key);throw e;});
 scannerMediaCache.set(key,entry);while(scannerMediaCache.size>128)scannerMediaCache.delete(scannerMediaCache.keys().next().value);return entry.promise;
}
async function scannerBridgeApi(req,env){
 const u=new URL(req.url),p=u.pathname;
 if(req.method==='GET'&&p==='/api/ingest/scanner/health')return json({ok:true,source:'dashboard_catalogue'});
 if(req.method==='GET'&&p==='/api/ingest/scanner/accounts')return json(await scannerAccounts(env));
 if(req.method==='GET'&&p==='/api/ingest/scanner/posts')return json(await scannerPosts(env,u));
 if(req.method==='GET'&&p==='/api/ingest/scanner/media')return json(await scannerMedia(env,u));
 if(req.method==='POST'&&p==='/api/ingest/scanner/fingerprints')return json(await scannerFingerprints(env,(await body(req)).rows));
 return error('Not found',404);
}
