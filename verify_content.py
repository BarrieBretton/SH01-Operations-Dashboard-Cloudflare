"""Read-only production checkpoint. Prints counts/status, never row values or tokens."""
import getpass,json,os
from urllib.request import Request,urlopen
from urllib.error import HTTPError,URLError
from urllib.parse import urlsplit
BASE=os.environ.get('OPS_DASHBOARD_URL','https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev').rstrip('/')
def main():
 u=urlsplit(BASE)
 if u.scheme!='https' or u.username or u.password or u.path or u.query:raise SystemExit('Invalid dashboard HTTPS origin')
 token=os.environ.get('DASHBOARD_TOKEN') or getpass.getpass('Dashboard token (hidden): ')
 def get(path):
  try:
   with urlopen(Request(BASE+path,headers={'Authorization':'Bearer '+token,'User-Agent':'SH01-Operations-Collector/1.0','Accept':'application/json'}),timeout=30) as r:return json.load(r)
  except HTTPError as e:raise SystemExit('Dashboard HTTP '+str(e.code)) from None
  except (URLError,ValueError,TimeoutError):raise SystemExit('Dashboard unreachable or invalid response') from None
 state=get('/api/content/status')
 if not state.get('schema_ready'):raise SystemExit('Complete SHEETS-MIGRATION.md setup')
 print('PASS content storage and authenticated API; backend:',state.get('storage_backend'))
 print('Optional mapping/clickouts writes enabled:',state.get('sheet_write_enabled'))
 print('Mirror:',json.dumps(state.get('mirror')))
 print('Meta collector:',json.dumps(state.get('meta_sync')))
 print('Pending/uncertain/synced mirror counts:',json.dumps(state.get('outbox')))
 offset=0;count=0
 while True:
  data=get('/api/content?limit=100&offset='+str(offset));count+=len(data.get('rows',[]))
  if not data.get('has_more'):break
  offset=data['next_offset']
  if offset>100000:raise SystemExit('Verification cap reached; count incomplete')
 groups=get('/api/content/groups');queue=get('/api/content/queue');sources=get('/api/producer-sources')
 print('Content records:',count,'candidate groups returned:',len(groups.get('rows',[])),'queue entries returned:',len(queue.get('rows',[])))
 print('Schedule evidence:',sources.get('schedule_evidence'),'rows:',len(sources.get('schedule',[])))
 print('No writes performed. Group/queue endpoints report bounded lists; inspect UI caps.')
 print('This does not verify live preview playback, publisher hooks, provider deletion permissions, or scheduled execution.')
if __name__=='__main__':main()
