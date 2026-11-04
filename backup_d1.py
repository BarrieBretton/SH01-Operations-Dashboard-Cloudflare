"""Export D1 to a private SQL file using Python only; no restore or deletion.
Cloudflare warns the export can temporarily block database queries.
"""
import getpass,hashlib,json,os,re,time
from datetime import datetime,timezone
from pathlib import Path
from urllib.request import Request,urlopen,build_opener,HTTPRedirectHandler
from urllib.parse import urlsplit
from urllib.error import HTTPError,URLError
class NoRedirect(HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def main():
 account=os.environ.get('CLOUDFLARE_ACCOUNT_ID') or input('Cloudflare account ID: ').strip()
 if not re.fullmatch(r'[0-9a-f]{32}',account):raise SystemExit('Invalid account ID')
 token=os.environ.get('CLOUDFLARE_API_TOKEN') or getpass.getpass('Cloudflare D1 API token (hidden): ')
 config=json.loads(Path('wrangler.jsonc').read_text(encoding='utf-8-sig'));database=next(x['database_id'] for x in config['d1_databases'] if x['binding']=='DB')
 url=f'https://api.cloudflare.com/client/v4/accounts/{account}/d1/database/{database}/export'
 opener=build_opener(NoRedirect());payload={'output_format':'polling'}
 for _ in range(180):
  try:
   req=Request(url,data=json.dumps(payload).encode(),headers={'Authorization':'Bearer '+token,'Content-Type':'application/json','User-Agent':'SH01-Operations-Collector/1.0'},method='POST')
   with opener.open(req,timeout=30) as response: data=json.load(response)
  except HTTPError as e:raise SystemExit('Cloudflare export HTTP '+str(e.code)) from None
  except (URLError,TimeoutError,ValueError):raise SystemExit('Export request failed; no credential/response body printed') from None
  if not data.get('success'):raise SystemExit('Cloudflare export failed')
  result=data.get('result') or {}
  if result.get('status')=='error':raise SystemExit('Cloudflare export reported failure')
  if result.get('status')=='complete':break
  bookmark=result.get('at_bookmark')
  if not bookmark:raise SystemExit('Export response lacks polling bookmark')
  payload['current_bookmark']=bookmark;time.sleep(2)
 else:raise SystemExit('Export polling timeout')
 signed=(result.get('result') or {}).get('signed_url','');u=urlsplit(signed)
 if u.scheme!='https' or not u.hostname or u.username or u.password:raise SystemExit('Unexpected export download URL')
 directory=Path('PRIVATE-D1-BACKUPS');directory.mkdir(exist_ok=True);directory.chmod(0o700)
 path=directory/('dashboard-'+datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')+'.sql');tmp=path.with_suffix('.sql.partial');digest=hashlib.sha256();size=0
 try:
  with opener.open(Request(signed,headers={'User-Agent':'SH01-Operations-Collector/1.0'}),timeout=60) as response,os.fdopen(os.open(tmp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600),'wb') as out:
   while block:=response.read(1024*1024):out.write(block);digest.update(block);size+=len(block)
  if not size:raise ValueError('empty')
  tmp.replace(path)
 except Exception:
  tmp.unlink(missing_ok=True);raise SystemExit('Backup download incomplete; partial file removed') from None
 print('Private backup:',path,'bytes:',size,'SHA-256:',digest.hexdigest())
 print('Keep outside Git and store a copy in your private backup location. This does not schedule future backups.')
if __name__=='__main__':main()
