import io,json,unittest
from urllib.error import HTTPError
from read_only_client import ReadOnlyClient,VerificationError
from collect_source_observations import drive_inventory
from unittest.mock import patch
class ClientTests(unittest.TestCase):
 def test_oauth_rejection_is_not_retried_or_echoed(self):
  class Opener:
   def open(self,*a,**k):raise HTTPError('https://x',503,'',{},io.BytesIO(b'{"error":"store_google_oauth_rejected","token":"secret"}'))
  with self.assertRaises(VerificationError) as e:ReadOnlyClient('https://x','private',opener=Opener(),sleep=lambda x:None).get('/api/producers')
  self.assertEqual(e.exception.category,'store_google_oauth_rejected');self.assertNotIn('secret',str(e.exception))
 def test_conflict_restarts_instead_of_mixing_pages(self):
  class Opener:
   def open(self,*a,**k):raise HTTPError('https://x',409,'',{},io.BytesIO(b'{"error":"snapshot_changed_retry"}'))
  with self.assertRaises(VerificationError) as e:ReadOnlyClient('https://x','private',opener=Opener()).get('/api/producers')
  self.assertEqual(e.exception.status,409)
 def test_pacing_and_retry_are_bounded(self):
  calls=[];waits=[]
  class Opener:
   def open(self,*a,**k):calls.append(1);raise HTTPError('https://x',429,'',{},io.BytesIO(b'{}'))
  with self.assertRaises(VerificationError):ReadOnlyClient('https://x','private',opener=Opener(),sleep=waits.append,clock=lambda:0).get('/api/producers')
  self.assertEqual(len(calls),4);self.assertTrue(all(x<=60 for x in waits))
 def test_drive_inventory_is_bounded_and_explicitly_partial(self):
  counter=[]
  def request(*a):counter.append(1);return {'files':[{'id':'x'}],'nextPageToken':str(len(counter))}
  with patch.dict('os.environ',{'DRIVE_TOKEN':'secret'}):r=drive_inventory({'folder_id':'folder','token_env':'DRIVE_TOKEN'},request)
  self.assertEqual(r['count'],10);self.assertFalse(r['complete']);self.assertEqual(r['reason'],'page_limit')
if __name__=='__main__':unittest.main()

class BackupTests(unittest.TestCase):
 def test_all_table_restore_rehearsal_and_digest_tamper(self):
  import tempfile,zipfile
  from pathlib import Path
  from verify_backup import verify,SCHEMA,digest
  def write(path,tamper=False):
   with zipfile.ZipFile(path,'w') as z:
    for table in SCHEMA:z.writestr(table+'.json','[]')
    z.writestr('manifest.json',json.dumps({'tables':{t:{'rows':0,'sha256':'bad' if tamper else digest(t,[])} for t in SCHEMA}}))
  with tempfile.TemporaryDirectory() as root:
   p=Path(root)/'test.zip';write(p);self.assertEqual(verify(p)['tables'],len(SCHEMA));self.assertFalse(verify(p)['live_restore_verified']);write(p,True)
   with self.assertRaises(ValueError):verify(p)
