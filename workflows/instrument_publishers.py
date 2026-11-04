#!/usr/bin/env python3
"""Create private, inactive review exports from explicit publisher mappings.

No network calls. No workflow or credential discovery. Original nodes, credential
references and downstream edges are preserved. Only mapped workflows are output.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import os
from pathlib import Path
import re
import uuid

ROOT = Path(__file__).resolve().parent
INGEST_URL = 'https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev/api/ingest/posts'
FIELDS = ('platform', 'account_id', 'account_handle', 'post_id', 'permalink',
          'media_type', 'published_at', 'workflow_id', 'workflow_url')
MARKER = 'SH01 published-post registration v1'


def load_workflows(value):
    if isinstance(value, list):
        workflows = value
    elif isinstance(value, dict) and isinstance(value.get('workflows'), list):
        workflows = value['workflows']
    elif isinstance(value, dict) and isinstance(value.get('nodes'), list):
        workflows = [value]
    else:
        raise ValueError('Expected one workflow, a workflow array, or {workflows:[...]}')
    ids = []
    for workflow in workflows:
        if not isinstance(workflow, dict) or not isinstance(workflow.get('nodes'), list):
            raise ValueError('Full workflow export with nodes is required')
        if not isinstance(workflow.get('connections', {}), dict):
            raise ValueError('Invalid workflow connections')
        if not isinstance(workflow.get('id'), str) or not workflow['id']:
            raise ValueError('Every workflow requires its exact exported string id')
        ids.append(workflow['id'])
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate workflow IDs in export')
    return workflows


def mapping_list(value):
    if not isinstance(value, dict) or value.get('schema_version') != 1 or not isinstance(value.get('mappings'), list):
        raise ValueError('Expected mapping schema_version=1 and mappings array')
    seen = set()
    for mapping in value['mappings']:
        if not isinstance(mapping, dict):
            raise ValueError('Invalid publisher mapping')
        for key in ('workflow_id', 'node_id'):
            if not isinstance(mapping.get(key), str) or not mapping[key]:
                raise ValueError('Exact workflow_id and node_id strings are required')
        if mapping.get('final_published_id_verified') is not True:
            raise ValueError('Mapping must attest final_published_id_verified=true after inspecting publish output')
        output = mapping.get('output_index')
        if type(output) is not int or not 0 <= output <= 20:
            raise ValueError('Explicit main success output_index in range 0..20 is required')
        expressions = mapping.get('fields')
        if not isinstance(expressions, dict) or set(expressions) != set(FIELDS):
            raise ValueError('Mapping fields must contain exactly the nine normalized record fields')
        values = list(expressions.values()) + [mapping.get('success_expression')]
        if any(not isinstance(v, str) or not re.fullmatch(r'=\{\{\s*\S[\s\S]*\}\}', v) for v in values):
            raise ValueError('Every field and success_expression must be an n8n ={{ expression }}')
        key = (mapping['workflow_id'], mapping['node_id'], output)
        if key in seen:
            raise ValueError('Duplicate mapping for the same source output')
        seen.add(key)
    return value['mappings']


def http_node(node_id, name, position):
    return {'id': node_id, 'name': name, 'type': 'n8n-nodes-base.httpRequest',
            'typeVersion': 4.2, 'position': position,
            'parameters': {'method': 'POST', 'url': INGEST_URL,
                'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
                'sendBody': True, 'specifyBody': 'json',
                'jsonBody': '={{ { posts: [$json] } }}', 'options': {'timeout': 30000}},
            'retryOnFail': True, 'maxTries': 3, 'waitBetweenTries': 1000,
            'notesInFlow': True,
            'notes': MARKER + '\nBind an HTTP Header Auth credential: header X-INGEST-KEY. No credential is bundled. Ingestion failure fails this branch; never retry the publisher to repair the ledger.'}


def make_hook(workflow, source, mapping):
    identity = '{}:{}:{}'.format(workflow['id'], source['id'], mapping['output_index'])
    suffix = hashlib.sha256(identity.encode()).hexdigest()[:10]
    names = ['SH01 record fields ' + suffix, 'SH01 validate record ' + suffix, 'SH01 register post ' + suffix]
    ids = [str(uuid.uuid5(uuid.NAMESPACE_URL, 'sh01-registration-v1:' + identity + ':' + str(i))) for i in range(3)]
    x, y = source.get('position', [0, 0])
    assignments = [{'id': str(uuid.uuid5(uuid.NAMESPACE_URL, ids[0] + ':' + field)),
                    'name': field, 'value': mapping['fields'][field], 'type': 'string'} for field in FIELDS]
    assignments.append({'id': str(uuid.uuid5(uuid.NAMESPACE_URL, ids[0] + ':success')),
                        'name': '__sh01_publish_success', 'value': mapping['success_expression'], 'type': 'boolean'})
    nodes = [
        {'id': ids[0], 'name': names[0], 'type': 'n8n-nodes-base.set', 'typeVersion': 3.4,
         'position': [x + 300, y + 300], 'parameters': {'assignments': {'assignments': assignments},
         'includeOtherFields': False, 'options': {}}, 'notes': MARKER + '\nExplicit mapping; no account or final published ID is inferred.'},
        {'id': ids[1], 'name': names[1], 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
         'position': [x + 600, y + 300], 'parameters': {'mode': 'runOnceForAllItems',
         'jsCode': (ROOT / 'published_record_validation.js').read_text(encoding='utf-8')}, 'notes': MARKER},
        http_node(ids[2], names[2], [x + 900, y + 300]),
    ]
    edges = {names[0]: {'main': [[{'node': names[1], 'type': 'main', 'index': 0}]]},
             names[1]: {'main': [[{'node': names[2], 'type': 'main', 'index': 0}]]}}
    return nodes, edges


def instrument(export, mappings):
    originals = load_workflows(export)
    mappings = mapping_list(mappings)
    by_id = {w['id']: w for w in originals}
    for mapping in mappings:
        if mapping['workflow_id'] not in by_id:
            raise ValueError('Mapped workflow_id not found in supplied export')
    output = []
    report = {'schema_version': 1, 'network_updates': False, 'workflows': []}
    for original in originals:
        workflow = copy.deepcopy(original)
        selected = [m for m in mappings if m['workflow_id'] == workflow['id']]
        entry = {'workflow_id': workflow['id'], 'node_count': len(workflow['nodes']),
                 'status': 'skipped_no_mapping', 'hooks': [],
                 'inventory': [{'node_id': n.get('id'), 'node_name': n.get('name'),
                                'node_type': n.get('type'), 'disabled': bool(n.get('disabled'))}
                               for n in workflow['nodes'] if not n.get('notes', '').startswith(MARKER)]}
        report['workflows'].append(entry)
        if not selected:
            continue
        if len({n.get('id') for n in workflow['nodes']}) != len(workflow['nodes']):
            raise ValueError('Workflow has duplicate/missing node ids')
        if len({n.get('name') for n in workflow['nodes']}) != len(workflow['nodes']):
            raise ValueError('Workflow has duplicate node names')
        for mapping in selected:
            matches = [n for n in workflow['nodes'] if n.get('id') == mapping['node_id']]
            if len(matches) != 1:
                raise ValueError('Mapped node_id must resolve exactly once')
            source = matches[0]
            if source.get('disabled') or source.get('notes', '').startswith(MARKER):
                raise ValueError('Source must be an enabled, original final-success node')
            nodes, edges = make_hook(workflow, source, mapping)
            existing = {n['id']: n for n in workflow['nodes']}
            present = [n['id'] in existing for n in nodes]
            if any(present):
                if not all(present) or any(existing[n['id']] != n for n in nodes):
                    raise ValueError('Existing SH01 hook differs; review it manually instead of duplicating or overwriting')
                if any(workflow.get('connections', {}).get(name) != edge for name, edge in edges.items()):
                    raise ValueError('Existing SH01 hook graph differs')
                state = 'already_present'
            else:
                if any(n['name'] in {v['name'] for v in workflow['nodes']} for n in nodes):
                    raise ValueError('Hook node name collision')
                workflow['nodes'].extend(nodes)
                workflow.setdefault('connections', {}).update(edges)
                state = 'added'
            connection = workflow.setdefault('connections', {}).setdefault(source['name'], {}).setdefault('main', [])
            while len(connection) <= mapping['output_index']:
                connection.append([])
            edge = {'node': nodes[0]['name'], 'type': 'main', 'index': 0}
            if edge not in connection[mapping['output_index']]:
                if state == 'already_present':
                    raise ValueError('Existing SH01 hook is disconnected')
                connection[mapping['output_index']].append(edge)
            entry['hooks'].append({'source_node_id': source['id'], 'output_index': mapping['output_index'], 'status': state})
        workflow['active'] = False
        output.append(workflow)
        entry['status'] = 'inactive_review_export'
    return output, report


def write_private(path, value):
    path = Path(path)
    # Refuse overwrite: source exports and previously reviewed results remain intact.
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as out:
        json.dump(value, out, ensure_ascii=False, indent=2)
        out.write('\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export', required=True, help='Private full n8n workflow JSON; never a credential export')
    parser.add_argument('--mappings', required=True)
    parser.add_argument('--output', required=True, help='New private file for mapped inactive review workflows only')
    parser.add_argument('--report', required=True, help='New file for metadata-only coverage report')
    args = parser.parse_args()
    try:
        paths = [Path(v).resolve() for v in (args.export, args.mappings, args.output, args.report)]
        if len(set(paths)) != len(paths) or paths[2].exists() or paths[3].exists():
            raise ValueError('Use four distinct paths; output and report must not exist')
        result, report = instrument(json.loads(paths[0].read_text(encoding='utf-8')),
                                    json.loads(paths[1].read_text(encoding='utf-8')))
        write_private(paths[2], result)
        write_private(paths[3], report)
    except (ValueError, OSError) as exc:
        # Do not echo source JSON, expressions, headers, URLs or credential values.
        parser.exit(2, 'No live updates performed. ' + str(exc) + '\n')
    print('Prepared {} inactive workflow(s); {} skipped without mappings. No live updates performed.'.format(
        len(result), sum(w['status'] == 'skipped_no_mapping' for w in report['workflows'])))


if __name__ == '__main__':
    main()
