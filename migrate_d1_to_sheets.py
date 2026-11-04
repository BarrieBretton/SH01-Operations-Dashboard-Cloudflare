"""Copy the frozen dashboard D1 tables to Sheets and verify exact row hashes.
No provider/operational-sheet writes. No D1 writes. Uses Python standard library.
"""
import argparse,hashlib,json,os,time,getpass,math,urllib.request,urllib.error,uuid
from pathlib import Path
from urllib.parse import urlencode,urlsplit
ROOT=Path(__file__).resolve().parent
SCHEMA=json.loads((ROOT/'store-schema.json').read_text())
def normalize(value):
 if isinstance(value,float) and math.isfinite(value) and value.is_integer():return int(value)
 if isinstance(value,list):return [normalize(x) for x in value]
 if isinstance(value,dict):return {k:normalize(v) for k,v in value.items()}
 return value
def canonical(value):return json.dumps(normalize(value),sort_keys=True,separators=(',',':'),ensure_ascii=True,allow_nan=False)
def identity(table,row):return json.dumps([row[k] for k in SCHEMA[table]['keys']],separators=(',',':'),ensure_ascii=False)
def digest(table,rows):return hashlib.sha256(canonical(sorted(rows,key=lambda r:identity(table,r))).encode()).hexdigest()
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):raise RuntimeError('Redirect rejected; use the Worker HTTPS origin')
def request_json(url,data=None,headers=None):
 req=urllib.request.Request(url,data=data,headers={'User-Agent':'SH01-Operations-Collector/3.0',**(headers or {})})
 try:
  with urllib.request.build_opener(NoRedirect()).open(req,timeout=90) as r:return json.load(r)
 except urllib.error.HTTPError as e:
  # Only our restricted category alphabet may leave an error response.
  import re
  try:code=json.load(e).get('error','')
  except (ValueError,TypeError,AttributeError):code=''
  if re.fullmatch(r'(?:store_|sheets_storage_)[a-z0-9_]{1,100}',str(code)):raise RuntimeError(code) from None
  raise RuntimeError('Request rejected HTTP '+str(e.code)) from None
 except (urllib.error.URLError,TimeoutError,ValueError):raise RuntimeError('Connection failed or response was not JSON') from None
class WorkerStorageClient:
 """Private Worker API client. No Apps Script URL, key or Google credential locally."""
 def __init__(self,url,key):
  u=urlsplit(url)
  if u.scheme!='https' or not u.hostname or u.username or u.password or u.path not in ('','/') or u.query or u.fragment:raise RuntimeError('Use the dashboard HTTPS origin without a path')
  self.url,self.key,self.last=url.rstrip('/'),key,0
 def call(self,payload):
  payload=dict(payload)
  if payload.get('op')=='commit':payload.setdefault('request_id',str(uuid.uuid4()))
  body=json.dumps(payload,separators=(',',':'),ensure_ascii=False).encode()
  if len(body)>890000:raise RuntimeError('Migration batch too large; no partial batch sent')
  for attempt in range(3):
   # Every Worker operation makes several Sheets reads. Pace migration to stay
   # below the per-user quota; source D1 reads are not throttled here.
   delay=5-(time.monotonic()-self.last)
   if delay>0:time.sleep(delay)
   self.last=time.monotonic()
   try:
    r=request_json(self.url+'/api/storage/transfer',body,{'Content-Type':'application/json','Authorization':'Bearer '+self.key})
    if not r.get('ok'):raise RuntimeError('Storage request failed')
    return r
   except RuntimeError as e:
    if attempt==2 or str(e) not in ('store_network_unavailable','store_rate_limited','store_google_unavailable','Connection failed or response was not JSON'):raise
    time.sleep(10*(attempt+1))
 def setup(self):
  return request_json(self.url+'/api/storage/setup',b'{}',{'Content-Type':'application/json','Authorization':'Bearer '+self.key})
 def rows(self,table):
  rows=[];offset=0;revision=None
  while True:
   r=self.call({'op':'read','tables':[table],'offsets':{table:offset}})
   if revision is not None and revision!=r['revision']:raise RuntimeError('Destination changed during read; pause collectors')
   revision=r['revision'];part=r['tables'][table];rows.extend(part['rows']);offset=part['next']
   if offset is None:return rows,revision
 def merge(self,table,rows):
  # Key-based idempotent upserts; a repeated run checks values and writes only differences.
  current,rev=self.rows(table);existing={identity(table,r):r for r in current};changes=[]
  for r in rows:
   key=identity(table,r)
   if existing.get(key)!=r:changes.append({'table':table,'key':key,'row':r})
  while changes:
   batch=[];size=0
   while changes and len(batch)<200:
    n=len(canonical(changes[0]))
    if batch and size+n>700000:break
    batch.append(changes.pop(0));size+=n
   result=self.call({'op':'commit','revision':rev,'changes':batch});rev=result['revision']
def read_legacy(base,token,table):
 rows=[];cursor=None;total=None
 while True:
  d=request_json(base+'/api/storage/d1-export?'+urlencode({'table':table,**({'cursor':json.dumps(cursor,separators=(',',':'))} if cursor is not None else {})}),headers={'Authorization':'Bearer '+token})
  if not d.get('migration_mode'):raise RuntimeError('Worker is not in migration mode')
  if total is None:total=d['total']
  rows.extend(d['rows']);cursor=d['next_cursor']
  if cursor is None:
   if len(rows)!=total:raise RuntimeError('Source row count mismatch')
   return rows

def main():
 p=argparse.ArgumentParser();p.add_argument('--verify-only',action='store_true');p.add_argument('--setup-only',action='store_true');p.add_argument('--report',default='sheets-migration-report.json');args=p.parse_args()
 base=os.getenv('OPS_DASHBOARD_URL','https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev').rstrip('/')
 if urlsplit(base).scheme!='https':raise SystemExit('HTTPS dashboard URL required')
 token=os.getenv('DASHBOARD_TOKEN') or getpass.getpass('Dashboard token (hidden): ')
 client=WorkerStorageClient(base,token)
 if not args.verify_only:
  setup=client.setup()
  if not setup.get('guard_verified'):raise RuntimeError('Concurrent-write guard verification failed')
  print('PASS direct Sheets setup and concurrent/stale-write checks')
 if args.setup_only:return
 health=client.call({'op':'health'})
 if not health.get('guard_verified'):raise RuntimeError('Run setup before copying records')
 catalog=request_json(base+'/api/storage/d1-export?table=__catalog',headers={'Authorization':'Bearer '+token})
 unknown=set(catalog['tables'])-set(SCHEMA)
 if unknown:raise RuntimeError('Unmapped D1 tables: '+', '.join(sorted(unknown)))
 missing=set(SCHEMA)-set(catalog['tables'])
 if missing:raise RuntimeError('Required source tables missing: '+', '.join(sorted(missing)))
 before={};report={'transport':'direct_google_api','guard_verified':True,'status':'INCOMPLETE','source':'dashboard_D1','destination':'google_sheets','tables':[],'credentials_in_report':False}
 for table in SCHEMA:
  rows=read_legacy(base,token,table);before[table]=digest(table,rows)
  if not args.verify_only:client.merge(table,rows)
  target,_=client.rows(table);expected={identity(table,r) for r in rows}
  # Only the initial seed records may remain if the source table was empty.
  seeds={'sheet_sync_state':{'[1]'},'content_jobs':{'["sheet_mirror"]','["meta_collect"]'}}.get(table,set())
  extra=[r for r in target if identity(table,r) not in expected and identity(table,r) not in seeds]
  mapped=[r for r in target if identity(table,r) in expected]
  ok=not extra and digest(table,mapped)==before[table]
  report['tables'].append({'table':table,'source_rows':len(rows),'copied_rows':len(mapped),'source_sha256':before[table],'destination_sha256':digest(table,mapped),'matched':ok,'extra_rows':len(extra)})
  print(table,':',len(rows),'rows;', 'PASS' if ok else 'FAIL')
  if not ok:Path(args.report).write_text(json.dumps(report,indent=2));raise RuntimeError('Destination mismatch; cutover blocked')
 # Re-read every source table: count-only validation would miss updates.
 for table in SCHEMA:
  if digest(table,read_legacy(base,token,table))!=before[table]:raise RuntimeError('Source changed during migration; keep writers paused and rerun')
 report['status']='PASS';report['checked_at_utc']=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime());Path(args.report).write_text(json.dumps(report,indent=2)+'\n')
 print('ALL TABLE HASHES MATCH. No D1 data was changed. Report:',args.report)
 print('Now set Worker SHEETS_STORAGE_READY=1 and deploy; then run verify_sheets_storage.py.')
if __name__=='__main__':
 try:main()
 except (RuntimeError,KeyError) as e:raise SystemExit(str(e)) from None
