"""Read-only verification of the deployed Sheets-backed dashboard. Prints counts only."""
import os,getpass
from migrate_d1_to_sheets import request_json
base=os.getenv('OPS_DASHBOARD_URL','https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev').rstrip('/')
token=os.getenv('DASHBOARD_TOKEN') or getpass.getpass('Dashboard token (hidden): ')
def call(path):return request_json(base+path,headers={'Authorization':'Bearer '+token})
s=call('/api/storage/status')
assert s.get('backend')=='google_sheets' and s.get('cutover_ready') and s.get('guard_verified') and s.get('transport')=='direct_google_api','Sheets storage is not ready'
print('PASS Sheets backend and cutover flag; tables:',s['tables'])
import time
for path in ['/api/failures','/api/producers','/api/meta/assets','/api/meta/content','/api/meta/capabilities','/api/content','/api/content/groups','/api/content/queue']:
 time.sleep(5)
 data=call(path);assert isinstance(data.get('rows'),list),path+' has no row list'
 print('PASS',path,'returned rows:',len(data['rows']))
state=call('/api/content/status');assert state.get('storage_backend')=='google_sheets'
print('PASS content storage; optional clickouts/mapping writes:',state['sheet_write_enabled'])
print('Read-only verification complete. Live Google/Meta ingestion and provider permissions require a successful collector run.')
