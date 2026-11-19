"""Capture one deployed infra script for review in the private config repository."""
import argparse
import getpass
import json
import re
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler

root = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument('script', choices=json.loads((root/'infra-config.json').read_text())['workers'])
args = parser.parse_args()
account = input('Cloudflare account ID: ').strip()
if not re.fullmatch('[a-fA-F0-9]{32}', account):
    parser.error('Invalid account ID')
url = f'https://api.cloudflare.com/client/v4/accounts/{account}/workers/scripts/{args.script}'
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None
request = Request(url, headers={'Authorization': 'Bearer '+getpass.getpass('Cloudflare token: ').strip()})
with build_opener(NoRedirect()).open(request, timeout=60) as response:
    kind = response.headers.get_content_type()
    if kind not in ('application/javascript','text/javascript','application/octet-stream','multipart/form-data','multipart/mixed'):
        raise SystemExit('Unexpected provider response type: '+kind)
    data=response.read()
    multi=kind.startswith('multipart/')
    if multi:
        data=('Content-Type: '+response.headers['Content-Type']+'\r\nMIME-Version: 1.0\r\n\r\n').encode('ascii')+data
folder=root/'infra-worker-snapshots'
folder.mkdir(exist_ok=True)
path=folder/(args.script+('.mime' if multi else '.js'))
with path.open('xb') as stream:
    stream.write(data)
print('Review before staging:',path)
