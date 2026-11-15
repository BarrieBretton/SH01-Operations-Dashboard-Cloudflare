"""Read-only post-deploy validation. Set OPS_DASHBOARD_URL and DASHBOARD_TOKEN.

GET requests only. Prints counts/validation results, never credentials or rows.
"""
from read_only_client import ReadOnlyClient, VerificationError
import json
import getpass
import os
from urllib.parse import urlencode, urlsplit, quote
from urllib.request import Request, urlopen
from urllib.error import HTTPError

def main():
 host=os.getenv('OPS_DASHBOARD_URL','https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev').rstrip('/');token=os.getenv('DASHBOARD_TOKEN') or getpass.getpass('Dashboard token (hidden): ')
 u=urlsplit(host)
 if u.scheme!='https' or not u.hostname or u.username or u.password or u.query or u.fragment or u.path not in ('','/') or not token:
  raise SystemExit('Set HTTPS OPS_DASHBOARD_URL and DASHBOARD_TOKEN locally.')
 client=ReadOnlyClient(host,token,pace=15)
 get=client.get
 for attempt in range(3):
  try:
   verify(client);return
  except VerificationError as e:
   if e.status!=409 or attempt==2:raise
   print('Snapshot changed; restarting full verification',attempt+1,'of 2')
   client.sleep(20)

def verify(client):
 get=client.get
 data=get('/api/producers');catalog=get('/api/producer-sources')
 assert data.get('policy_version')==2,'Wrong deployed version'
 assert not data.get('warning'),'Queue Sheets sync first; no corrected snapshot yet'
 assert data.get('sync',{}).get('status')=='ok','Latest stock sync did not succeed'
 assert not data['sync']['stale'],'Latest stock snapshot is stale'
 seen=set();total=0
 for p in data['rows']:
  group=(p['source_tab'],p['account']);assert group not in seen,'Mixed/duplicate pool';seen.add(group)
  count=ready=consumed=waiting=no=blank=other=0;offset=0;ids=set()
  assert p.get('approval_breakdown_version')==1,'Queue Sheets sync to collect the approval breakdown first'
  while offset is not None:
   page=get('/api/producers/'+quote(p['producer_id'],safe='')+'/items?'+urlencode({'version':p['version'],'offset':offset}))
   assert page['version']==p['version'],'Snapshot changed during read'
   for row in page['rows']:
    assert row['item_id'] not in ids,'Duplicate item';ids.add(row['item_id']);count+=1
    expected=not row.get('status_conflict') and row['status'].strip().lower()=='staged' and row['approved'].strip().lower()=='yes'
    assert bool(row['ready'])==expected,'Eligibility mismatch';ready+=expected;consumed+=bool(row.get('consumed'))
    approval=row['approved'].strip().lower()
    if not row.get('status_conflict') and row['status'].strip().lower()=='staged' and approval!='yes':
     waiting+=1;no+=approval=='no';blank+=approval=='';other+=approval not in ('no','')
   offset=page['next_offset']
  assert (count,ready,consumed)==(p['total_count'],p['ready_count'],p['consumed_count']),'Summary/items mismatch';total+=count
  assert (waiting,no,blank,other)==(p['staged_unapproved_count'],p['staged_approval_no_count'],p['staged_approval_blank_count'],p['staged_approval_other_count']),'Approval breakdown/items mismatch'
 assert all(s['remaining'] is None for s in catalog['rows']),'Unmeasured source was given a remaining count'
 print('PASS strict eligibility, per-tab/account pools, item pagination, snapshot totals, approval breakdown and unknown-source handling')
 print('Stock pools:',len(seen),'items checked:',total,'workflow definitions inventoried:',catalog['coverage']['workflows'])
 print('Routing evidence:',catalog['schedule_evidence'])
 print('Optional tab reads unavailable:',sum(r['status']!='ok' for r in catalog['references']))
 print('No worksheet values or credentials printed; no writes performed.')

if __name__=='__main__':main()
