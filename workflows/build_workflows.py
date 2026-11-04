#!/usr/bin/env python3
"""Rebuild the two credential-free, inactive n8n workflow templates."""
import json
from pathlib import Path
import uuid
from instrument_publishers import http_node

ROOT = Path(__file__).resolve().parent


def node(name, kind, version, params, position, notes=''):
    return {'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'sh01-workflow-template-v1:' + name)),
            'name': name, 'type': 'n8n-nodes-base.' + kind, 'typeVersion': version,
            'parameters': params, 'position': position, 'notes': notes, 'notesInFlow': bool(notes)}


def code(name, source, position):
    return node(name, 'code', 2, {'mode': 'runOnceForAllItems', 'jsCode': source}, position)


def edge(target):
    return {'node': target, 'type': 'main', 'index': 0}


def workflow(name, nodes, connections):
    return {'name': name, 'active': False, 'nodes': nodes, 'connections': connections,
            'settings': {'executionOrder': 'v1', 'saveManualExecutions': False,
                         'saveDataSuccessExecution': 'none', 'saveDataErrorExecution': 'all'},
            'pinData': {}, 'tags': []}


def build():
    trigger = node('Published post input', 'executeWorkflowTrigger', 1.1,
                   {'inputSource': 'passthrough'}, [0, 0],
                   'Call only after final publication succeeds. Input post_id is the final published object ID, never an upload/container ID.')
    validate = code('Validate published record', (ROOT / 'published_record_validation.js').read_text(), [300, 0])
    send = http_node(str(uuid.uuid5(uuid.NAMESPACE_URL, 'sh01-register-template-send')),
                     'Register published post', [600, 0])
    register = workflow('SH01 register published post', [trigger, validate, send], {
        trigger['name']: {'main': [[edge(validate['name'])]]},
        validate['name']: {'main': [[edge(send['name'])]]}})
    start = node('Clickouts request', 'executeWorkflowTrigger', 1.1,
                 {'inputSource': 'passthrough'}, [0, 0], 'No schedule or webhook. Default mode=preview. The sheet branch never executes deletion.')
    prepare = code('Prepare request', (ROOT / 'delete_prepare_request.js').read_text(), [260, 0])
    choose = node('Read clickouts sheet', 'if', 2.2, {'conditions': {
        'options': {'caseSensitive': True, 'leftValue': '', 'typeValidation': 'strict', 'version': 2},
        'conditions': [{'id': 'source-is-sheet', 'leftValue': '={{ $json.source }}', 'rightValue': 'sheet',
                        'operator': {'type': 'string', 'operation': 'equals'}}], 'combinator': 'and'},
        'options': {}}, [520, 0])
    sheet = node('Read URLS from clickouts', 'googleSheets', 4.6, {
        'resource': 'sheet', 'operation': 'read',
        'documentId': {'__rl': True, 'value': '={{ $json.document_id }}', 'mode': 'id'},
        'sheetName': {'__rl': True, 'value': '={{ $json.sheet_name }}', 'mode': 'name'}, 'options': {}}, [780, -150],
        'Bind Google Sheets OAuth. Pass document_id for the existing workbook (DOCUMENT_ID is intentionally not guessed). Sheet defaults to clickouts; URL column must be named URLS. This node only reads rows.')
    normalize = (ROOT / 'delete_normalize_rows.js').read_text()
    sheet_normalize = code('Normalize sheet previews', "const config = $('Prepare request').first().json;\nconst rows = $input.all().map((i, index) => ({platform: i.json.platform, permalink: i.json.URLS, account_id: i.json.account_id, __input_index: index})).filter(r => r.permalink !== null && r.permalink !== undefined && !(typeof r.permalink === 'string' && !r.permalink.trim())).map(r => ({...r, permalink: typeof r.permalink === 'string' ? r.permalink.trim() : r.permalink}));\n" + normalize, [1040, -150])
    input_normalize = code('Normalize supplied targets', 'const config = $input.first().json;\nconst rows = config.items;\n' + normalize, [780, 150])
    delete = node('Preview or execute reviewed deletion', 'httpRequest', 4.2, {
        'method': 'POST', 'url': 'https://sh01.vivojaymail.workers.dev/social/posts/delete',
        'authentication': 'genericCredentialType', 'genericAuthType': 'httpHeaderAuth',
        'sendBody': True, 'specifyBody': 'json', 'jsonBody': '={{ $json }}',
        'options': {'timeout': 120000}}, [1320, 0],
        'Bind HTTP Header Auth: X-API-KEY for this social endpoint. No automatic retry: inspect an uncertain result before trying again. Server must independently verify ownership, exact confirmation and its execution-enable flag.')
    delete['retryOnFail'] = False
    deletion = workflow('SH01 clickouts deletion - preview first', [start, prepare, choose, sheet, sheet_normalize, input_normalize, delete], {
        start['name']: {'main': [[edge(prepare['name'])]]}, prepare['name']: {'main': [[edge(choose['name'])]]},
        choose['name']: {'main': [[edge(sheet['name'])], [edge(input_normalize['name'])]]},
        sheet['name']: {'main': [[edge(sheet_normalize['name'])]]},
        sheet_normalize['name']: {'main': [[edge(delete['name'])]]}, input_normalize['name']: {'main': [[edge(delete['name'])]]}})
    for filename, value in [('register-published-post.n8n.json', register), ('clickouts-deletion.n8n.json', deletion)]:
        (ROOT / filename).write_text(json.dumps(value, indent=2) + '\n', encoding='utf-8')


if __name__ == '__main__':
    build()
