"""Embed editable UI, producer policy, source catalog and collector in worker.js."""
from pathlib import Path
import json
ROOT=Path(__file__).resolve().parent
p=ROOT/'worker.js'
s=p.read_text(encoding='utf-8-sig')
ui=(ROOT/'dashboard.html').read_text(encoding='utf-8-sig')
for begin,end,source in [
 ('<!-- BEGIN PRODUCER VIEW -->','<!-- END PRODUCER VIEW -->','producer-view.html'),
 ('// BEGIN PRODUCER UI LOGIC','// END PRODUCER UI LOGIC','producer-view.js'),
 ('<!-- BEGIN CONTENT VIEW -->','<!-- END CONTENT VIEW -->','content-view.html'),
 ('// BEGIN CONTENT UI LOGIC','// END CONTENT UI LOGIC','content-view.js'),
 ('/* BEGIN CONTENT UI STYLES */','/* END CONTENT UI STYLES */','content-view.css'),
]:
 a=ui.index(begin)+len(begin);b=ui.index(end,a)
 ui=ui[:a]+'\n'+(ROOT/source).read_text(encoding='utf-8')+'\n'+ui[b:]
(ROOT/'dashboard.html').write_text(ui,encoding='utf-8')
start=s.index('const HTML = '); end=s.index('\nconst json = ',start)
s=s[:start]+'const HTML = '+json.dumps(ui,ensure_ascii=True)+';\n'+s[end:]
marker='// BEGIN PRODUCER V2 GENERATED'
if marker in s:
 start=s.index(marker);end=s.index('export default',s.index('// END PRODUCER V2 GENERATED',start))
else:
 start=s.index('// Automatic read-only Google Sheets collector.');end=s.index('export default',start)
registry=json.loads((ROOT/'producer-sources.json').read_text(encoding='utf-8'))
code=marker+'\nconst SOURCE_REGISTRY = '+json.dumps(registry,separators=(',',':'),ensure_ascii=True)+';\n'
for name in ['producer-policy.js','sheets-sync.js']:
 code+=(ROOT/name).read_text(encoding='utf-8')+'\n'
s=s[:start]+code+'// END PRODUCER V2 GENERATED\n'+s[end:]
a=s.index('// BEGIN CONTENT BACKEND');b=s.index('// END CONTENT BACKEND',a)+len('// END CONTENT BACKEND')
s=s[:a]+'// BEGIN CONTENT BACKEND\n'+(ROOT/'content-ledger.js').read_text()+'\n// END CONTENT BACKEND'+s[b:]
a=s.index('// Meta analytics extension');b=s.index('// BEGIN CONTENT BACKEND',a)
s=s[:a]+(ROOT/'meta-worker.js').read_text()+'\n'+s[b:]
p.write_text(s,encoding='utf-8')
print('Worker UI, producer policy, source registry and collector rebuilt.')
