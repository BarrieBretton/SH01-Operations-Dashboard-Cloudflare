import unittest,json
from pathlib import Path
from attach_error_logger import attach
from audit_integrations import audit
class ObservabilityTests(unittest.TestCase):
 def test_error_attachment_preserves_existing_mapping_and_disables_export(self):
  source=[{'id':'one','active':True,'nodes':[],'settings':{}},{'id':'two','active':True,'nodes':[],'settings':{'errorWorkflow':'existing'}}]
  result,n=attach(source,'new');self.assertEqual(n,1);self.assertEqual(result[1]['settings']['errorWorkflow'],'existing');self.assertTrue(source[0]['active']);self.assertFalse(result[0]['active'])
 def test_templates_are_inactive_and_do_not_save_payloads(self):
  for f in ['failure-logger.n8n.json','social-inventory.n8n.json']:
   d=json.loads((Path(__file__).parent/f).read_text());self.assertFalse(d['active']);self.assertEqual(d['settings']['saveDataErrorExecution'],'none');self.assertTrue(all(not n.get('credentials') for n in d['nodes']))
 def test_audit_does_not_echo_private_parameters(self):
  w=[{'id':'one','active':True,'nodes':[{'id':'http1','type':'n8n-nodes-base.httpRequest','parameters':{'method':'POST','url':'https://secret.example/token-secret'}}]}]
  report=audit(w,{'schema_version':1,'mappings':[]});self.assertEqual(report['unmapped_candidates'],1);self.assertNotIn('token-secret',json.dumps(report));self.assertFalse(report['full_live_coverage_verified'])
