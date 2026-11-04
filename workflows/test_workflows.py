import copy
import json
from pathlib import Path
import tempfile
import unittest

from instrument_publishers import FIELDS, INGEST_URL, MARKER, instrument, write_private

ROOT = Path(__file__).resolve().parent


def fixture():
    return [{'id': 'wf-1', 'name': 'Example publisher', 'active': True,
             'nodes': [
                 {'id': 'publish-node', 'name': 'Final publication success', 'type': 'n8n-nodes-base.httpRequest',
                  'position': [100, 100], 'parameters': {'method': 'POST'},
                  'credentials': {'httpHeaderAuth': {'id': 'existing-credential-reference', 'name': 'Existing reference'}}},
                 {'id': 'downstream-node', 'name': 'Existing downstream', 'type': 'n8n-nodes-base.noOp', 'parameters': {}}],
             'connections': {'Final publication success': {
                 'main': [[{'node': 'Existing downstream', 'type': 'main', 'index': 0}]],
                 'error': [[{'node': 'Existing downstream', 'type': 'error', 'index': 0}]]}},
             'settings': {'executionOrder': 'v1'}},
            {'id': 'wf-2', 'name': 'Unmapped', 'active': True, 'nodes': [], 'connections': {}}]


def mappings():
    return {'schema_version': 1, 'mappings': [{'workflow_id': 'wf-1', 'node_id': 'publish-node',
            'output_index': 0, 'final_published_id_verified': True,
            'success_expression': '={{ $json.publish_succeeded === true }}',
            'fields': {field: '={{ $json.' + field + ' }}' for field in FIELDS}}]}


class InstrumentationTests(unittest.TestCase):
    def test_original_nodes_credentials_edges_and_input_preserved(self):
        original = fixture()
        before = copy.deepcopy(original)
        output, report = instrument(original, mappings())
        self.assertEqual(original, before)
        self.assertEqual(len(output), 1)
        result = output[0]
        self.assertFalse(result['active'])
        self.assertEqual(result['nodes'][:2], before[0]['nodes'])
        source_before = before[0]['connections']['Final publication success']
        source_after = result['connections']['Final publication success']
        self.assertEqual(source_after['main'][0][:-1], source_before['main'][0])
        self.assertEqual(source_after['error'], source_before['error'])
        self.assertEqual(len(result['nodes']), 5)
        self.assertTrue(all('credentials' not in n for n in result['nodes'][2:]))
        self.assertEqual(report['workflows'][1]['status'], 'skipped_no_mapping')
        self.assertNotIn('existing-credential-reference', json.dumps(report))
        self.assertNotIn('success_expression', json.dumps(report))

    def test_repeat_is_idempotent(self):
        output, _ = instrument(fixture(), mappings())
        repeated, report = instrument(output, mappings())
        self.assertEqual(output, repeated)
        self.assertEqual(report['workflows'][0]['hooks'][0]['status'], 'already_present')

    def test_changed_mapping_refused(self):
        output, _ = instrument(fixture(), mappings())
        changed = mappings()
        changed['mappings'][0]['fields']['platform'] = "={{ 'instagram' }}"
        with self.assertRaisesRegex(ValueError, 'differs'):
            instrument(output, changed)

    def test_unmapped_export_is_inventory_only(self):
        output, report = instrument(fixture(), {'schema_version': 1, 'mappings': []})
        self.assertEqual(output, [])
        self.assertEqual(len(report['workflows']), 2)
        self.assertEqual(report['workflows'][0]['inventory'][0]['node_id'], 'publish-node')

    def test_missing_or_unverified_mapping_fails(self):
        for mutation in ('unknown-workflow', 'unknown-node', 'no-attestation', 'no-field', 'no-predicate', 'no-output'):
            with self.subTest(mutation=mutation):
                value = mappings()
                target = value['mappings'][0]
                if mutation == 'unknown-workflow': target['workflow_id'] = 'absent'
                if mutation == 'unknown-node': target['node_id'] = 'absent'
                if mutation == 'no-attestation': target['final_published_id_verified'] = False
                if mutation == 'no-field': del target['fields']['post_id']
                if mutation == 'no-predicate': del target['success_expression']
                if mutation == 'no-output': del target['output_index']
                with self.assertRaises(ValueError): instrument(fixture(), value)

    def test_existing_second_output_is_preserved(self):
        original = fixture()
        original[0]['connections']['Final publication success']['main'].append([{'node': 'Existing downstream', 'type': 'main', 'index': 0}])
        value = mappings()
        value['mappings'][0]['output_index'] = 1
        output, _ = instrument(original, value)
        self.assertEqual(output[0]['connections']['Final publication success']['main'][0], original[0]['connections']['Final publication success']['main'][0])
        self.assertEqual(output[0]['connections']['Final publication success']['main'][1][:-1], original[0]['connections']['Final publication success']['main'][1])

    def test_no_overwrite_private_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'out.json'
            write_private(path, {'ok': True})
            with self.assertRaises(FileExistsError): write_private(path, {'ok': False})
            self.assertEqual(json.loads(path.read_text()), {'ok': True})


class TemplateTests(unittest.TestCase):
    def load(self, filename):
        return json.loads((ROOT / filename).read_text())

    def test_templates_are_inactive_and_have_valid_graphs(self):
        for filename in ['register-published-post.n8n.json', 'clickouts-deletion.n8n.json']:
            with self.subTest(filename=filename):
                workflow = self.load(filename)
                self.assertIs(workflow['active'], False)
                nodes = workflow['nodes']
                names = {n['name'] for n in nodes}
                self.assertEqual(len(names), len(nodes))
                self.assertEqual(len({n['id'] for n in nodes}), len(nodes))
                self.assertTrue(all('credentials' not in n for n in nodes))
                self.assertFalse(workflow['pinData'])
                self.assertEqual(sum(n['type'] == 'n8n-nodes-base.executeWorkflowTrigger' for n in nodes), 1)
                self.assertFalse(any(n['type'] in {'n8n-nodes-base.scheduleTrigger', 'n8n-nodes-base.webhook'} for n in nodes))
                for source, kinds in workflow['connections'].items():
                    self.assertIn(source, names)
                    for branches in kinds.values():
                        for branch in branches:
                            for connection in branch: self.assertIn(connection['node'], names)

    def test_registration_contract_and_embedded_validation(self):
        workflow = self.load('register-published-post.n8n.json')
        code = next(n for n in workflow['nodes'] if n['type'] == 'n8n-nodes-base.code')
        self.assertEqual(code['parameters']['jsCode'], (ROOT / 'published_record_validation.js').read_text())
        http = next(n for n in workflow['nodes'] if n['type'] == 'n8n-nodes-base.httpRequest')
        self.assertEqual(http['parameters']['url'], INGEST_URL)
        self.assertEqual(http['parameters']['jsonBody'], '={{ { posts: [$json] } }}')
        self.assertEqual(http['parameters']['genericAuthType'], 'httpHeaderAuth')

    def test_deletion_contract_no_automatic_execute(self):
        workflow = self.load('clickouts-deletion.n8n.json')
        by_name = {n['name']: n for n in workflow['nodes']}
        http = by_name['Preview or execute reviewed deletion']
        self.assertFalse(http['retryOnFail'])
        self.assertEqual(http['parameters']['url'], 'https://sh01.vivojaymail.workers.dev/social/posts/delete')
        self.assertEqual(http['parameters']['genericAuthType'], 'httpHeaderAuth')
        prepare = by_name['Prepare request']['parameters']['jsCode']
        self.assertEqual(prepare, (ROOT / 'delete_prepare_request.js').read_text())
        self.assertIn("raw.mode === undefined ? 'preview'", prepare)
        self.assertIn("source === 'sheet' && mode !== 'preview'", prepare)
        self.assertIn("mode === 'execute' && config.items.length !== 1", prepare)
        normalize = (ROOT / 'delete_normalize_rows.js').read_text()
        self.assertIn('dry_run: true', normalize)
        self.assertIn('body.dry_run = false', normalize)
        self.assertIn('row.confirmation', normalize)
        sheet = by_name['Read URLS from clickouts']['parameters']
        self.assertEqual(sheet['operation'], 'read')
        sheet_code = by_name['Normalize sheet previews']['parameters']['jsCode']
        self.assertIn('i.json.URLS', sheet_code)
        self.assertNotIn('i.json.confirmation', sheet_code)
        self.assertTrue(sheet_code.endswith(normalize))


if __name__ == '__main__':
    unittest.main()
