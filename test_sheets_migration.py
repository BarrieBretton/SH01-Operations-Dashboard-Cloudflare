import unittest
from migrate_d1_to_sheets import canonical,digest,identity,SCHEMA,WorkerStorageClient
class MigrationTests(unittest.TestCase):
 def test_all_tables(self):self.assertEqual(len(SCHEMA),18)
 def test_numeric_canonicalization(self):self.assertEqual(canonical({'x':1.0}),canonical({'x':1}))
 def test_digest_order_and_keys(self):
  a=[{'source':'n8n','event_id':'2','message':'x'}, {'source':'n8n','event_id':'1','message':'y'}]
  self.assertEqual(digest('failures',a),digest('failures',a[::-1]))
  self.assertNotEqual(digest('failures',a),digest('failures',[{**a[0],'message':'z'},a[1]]))
 def test_large_ids_and_newlines(self):
  r={'platform':'instagram','account_id':'9223372036854775807','post_id':'2'}
  self.assertIn('"9223372036854775807"',identity('content_posts',r))
  self.assertNotEqual(canonical({'x':'a\\nb'}),canonical({'x':'a\nb'}))
 def test_destination_origin(self):
  with self.assertRaises(RuntimeError):WorkerStorageClient('https://evil.test/exec','key')
if __name__=='__main__':unittest.main()

class CursorTests(unittest.TestCase):
 def test_legacy_reads_keyset_pages_and_checks_total(self):
  import migrate_d1_to_sheets as m
  from unittest.mock import patch
  pages=[{'migration_mode':True,'total':2,'rows':[{'id':'1'}],'next_cursor':['1']}, {'migration_mode':True,'total':None,'rows':[{'id':'2'}],'next_cursor':None}]
  with patch.object(m,'request_json',side_effect=pages) as fetch:
   self.assertEqual(len(m.read_legacy('https://example.invalid','hidden','meta_assets')),2)
   self.assertIn('cursor=',fetch.call_args.args[0])
  with patch.object(m,'request_json',return_value={'migration_mode':True,'total':2,'rows':[],'next_cursor':None}):
   with self.assertRaisesRegex(RuntimeError,'row count'):m.read_legacy('https://example.invalid','hidden','meta_assets')

class WorkerClientTests(unittest.TestCase):
 def test_transfer_uses_dashboard_bearer_and_stable_retry_id(self):
  import migrate_d1_to_sheets as m
  from unittest.mock import patch
  import json
  client=m.WorkerStorageClient('https://dashboard.example','hidden-token')
  with patch.object(m,'request_json',side_effect=[RuntimeError('store_network_unavailable'),{'ok':True,'revision':1}]) as fetch,patch.object(m.time,'sleep'):
   result=client.call({'op':'commit','revision':0,'changes':[]})
   self.assertEqual(result['revision'],1)
   self.assertEqual(fetch.call_args_list[0].args[1],fetch.call_args_list[1].args[1])
   url,body,headers=fetch.call_args.args
   self.assertEqual(url,'https://dashboard.example/api/storage/transfer')
   self.assertEqual(headers['Authorization'],'Bearer hidden-token')
   self.assertNotIn('hidden-token',body.decode())
   self.assertIn('request_id',json.loads(body))
 def test_client_rejects_credentials_in_url_and_redirects(self):
  import migrate_d1_to_sheets as m
  for url in ['http://dashboard.example','https://x:y@dashboard.example','https://dashboard.example?token=x']:
   with self.assertRaises(RuntimeError):m.WorkerStorageClient(url,'hidden')
  with self.assertRaises(RuntimeError):m.NoRedirect().redirect_request(None,None,302,'',{},'https://other.example')
