from pathlib import Path
import json
root=Path(__file__).parent
p=root/'worker.js'
s=p.read_text()
start=s.index('const HTML = ')
end=s.index('\nconst json = ',start)
s=s[:start]+'const HTML = '+json.dumps((root/'dashboard.html').read_text(),ensure_ascii=True)+';\n'+s[end:]
p.write_text(s)
