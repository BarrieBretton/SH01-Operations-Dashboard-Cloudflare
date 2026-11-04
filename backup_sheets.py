"""Read a revision-consistent private backup of all internal dashboard Sheets tables."""
import getpass,json,os,time,zipfile
from pathlib import Path
from migrate_d1_to_sheets import WorkerStorageClient,SCHEMA,digest
url=os.getenv('OPS_DASHBOARD_URL','https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev').rstrip('/')
key=os.getenv('DASHBOARD_TOKEN') or getpass.getpass('Dashboard token (hidden): ')
client=WorkerStorageClient(url,key)
for attempt in range(3):
 start=client.call({'op':'health'})['revision'];data={}
 for table in SCHEMA:
  rows,rev=client.rows(table)
  if rev!=start:break
  data[table]=rows
 else:
  if client.call({'op':'health'})['revision']==start:break
else:raise SystemExit('Storage changed during backup. Briefly pause dashboard writers and retry.')
if len(data)!=len(SCHEMA):raise SystemExit('Backup was incomplete; no file written')
root=Path('PRIVATE-SHEETS-BACKUPS');root.mkdir(exist_ok=True);root.chmod(0o700)
path=root/('dashboard-'+time.strftime('%Y%m%d-%H%M%S',time.gmtime())+'.zip')
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'wb') as f,zipfile.ZipFile(f,'w',zipfile.ZIP_DEFLATED) as z:
 for table,rows in data.items():z.writestr(table+'.json',json.dumps(rows,ensure_ascii=True))
 z.writestr('manifest.json',json.dumps({'revision':start,'tables':{t:{'rows':len(rows),'sha256':digest(t,rows)} for t,rows in data.items()}}))
print('Private backup:',path,'tables:',len(data))
print('Keep private; this contains operational data. Copy it to your private backup location.')
