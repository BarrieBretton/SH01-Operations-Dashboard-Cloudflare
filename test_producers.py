import importlib.util
import io
import json
from pathlib import Path
import unittest
import zipfile
ROOT=Path(__file__).resolve().parent
def load(name):
 spec=importlib.util.spec_from_file_location(name,ROOT/(name+'.py'));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

class ProducerTests(unittest.TestCase):
 def test_strict_predicate(self):
  m=load('sync');self.assertTrue(m.ready(' YES ',' Staged '))
  for a,s in [('yes','uploaded'),('true','staged'),('yes',''),('yes','pending')]:self.assertFalse(m.ready(a,s))

 def test_importer_is_not_name_matching(self):
  m=load('sync');calls=[];m.post=lambda host,token,route,data:calls.append(data)
  index={'spreadsheet_id':'book','tabs':[{'title':'streamables','sheet_id':1},{'title':'streamables-yt','sheet_id':2},{'title':'workflow-schedule','sheet_id':3}]}
  blob=io.BytesIO()
  with zipfile.ZipFile(blob,'w') as z:
   z.writestr('core_sheets/index.json',json.dumps(index))
   for tab in [1,2]:z.writestr(f'core_sheets/tabs/{tab}.json',json.dumps({'display_values':[['account','creator_handle','status','approved'],['a','c1','staged','yes'],['@A','c2','uploaded','yes'],['','','','']]}))
   z.writestr('core_sheets/tabs/3.json',json.dumps({'display_values':[['workflow','associated accounts'],['Pinterest','vlvt.ave']]}))
  blob.seek(0)
  with zipfile.ZipFile(blob) as z:m.ingest_producers(z,'unused','unused','','',3)
  self.assertEqual(len(calls),2);self.assertNotEqual(calls[0]['producer_id'],calls[1]['producer_id']);self.assertTrue(all(len(c['items'])==2 for c in calls));self.assertTrue(all(c['workflow_names']==[] for c in calls));self.assertFalse(calls[0]['items'][1]['ready'])

 def test_registry_associations_are_evidence_not_fuzzy_names(self):
  r=json.loads((ROOT/'producer-sources.json').read_text())
  self.assertEqual(len(r['workflows']),70)
  for a,k in [('vlvt.ave','pinterest_rapidapi'),('erika.devereux','google_drive')]:
   matched=[s for s in r['sources'] if a in s['accounts']]
   self.assertTrue(any(s['kind']==k for s in matched));self.assertFalse(any(s['role']=='stock_pool' for s in matched))
  self.assertTrue(all(not s['accounts'] for s in r['sources'] if s['disabled']))
  self.assertEqual(len({s['source_id'] for s in r['sources']}),len(r['sources']))

if __name__=='__main__':unittest.main()
