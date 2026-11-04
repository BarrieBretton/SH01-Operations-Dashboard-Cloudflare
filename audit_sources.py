"""Build a metadata-only source inventory from a readable SH01 workflow handoff.

Never executes node code, decodes encrypted files, or copies parameters/headers.
Run: python audit_sources.py --archive path/to/handoff.zip
Then python build_ui.py and commit the regenerated inventory with the Worker.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent

def label(value):
    s = str(value or "")
    if len(s) > 200 or re.search(r"eyJ[\w-]+\.[\w-]+\.[\w-]+|Bearer\s|(?:token|password|secret|api.?key)\s*[=:]", s, re.I):
        return "[label withheld]"
    return s

def literal(value):
    if isinstance(value, dict):
        value = value.get("value")
    if not isinstance(value, (str, int)):
        return None
    s = str(value)
    if s == "=" or re.search(r"\{\{|REDACTED|WITHHELD", s, re.I):
        return None
    return s

def build(archive):
    with zipfile.ZipFile(archive) as z:
        raw = z.read("n8n_workflow_review/workflows.jsonl")
        ws = [json.loads(x) for x in raw.splitlines() if x.strip()]
        idx = json.loads(z.read("core_sheets/index.json"))
        tabs = {str(t["sheet_id"]): t["title"] for t in idx["tabs"]}
        schedule = next(t for t in idx["tabs"] if t["title"] == "workflow-schedule")
        rows = json.loads(z.read("core_sheets/tabs/"+str(schedule["sheet_id"])+".json"))["display_values"]
    by_id = {w["id"]: w for w in ws}
    if len(by_id) != len(ws):
        raise RuntimeError('Duplicate workflow IDs in export')
    by_name = defaultdict(list)
    for w in ws:
        by_name[w["name"]].append(w["id"])
    sources, calls, issues, scheduled = [], [], [], []
    catalog = []
    for w in ws:
        nodes = w.get("nodes", [])
        names = {n["name"] for n in nodes}
        edges = defaultdict(set)
        for src, types in w.get("connections", {}).items():
            for branches in types.values():
                for branch in branches:
                    for link in branch:
                        dst = link["node"]
                        if src in names and dst in names:
                            edges[src].add(dst)
                        else:
                            issues.append({"workflow_id":w["id"], "reason":"dangling_graph_reference"})
        starts = [n["name"] for n in nodes if any(k in n.get("type", "").lower() for k in ("trigger", "webhook")) and not n.get("disabled")]
        reachable = set(starts)
        stack = list(starts)
        while stack:
            for dest in edges[stack.pop()]:
                if dest not in reachable:
                    reachable.add(dest); stack.append(dest)
        hidden = sum(bool(re.search(r"REDACTED|WITHHELD", json.dumps(n.get("parameters", {})), re.I)) for n in nodes)
        catalog.append({"id":w["id"],"name":label(w["name"]),"active_at_export":bool(w.get("active")),"node_count":len(nodes),"nodes_with_redacted_parameters":hidden})
        for n in nodes:
            t = n.get("type", "").split(".")[-1]; p = n.get("parameters", {})
            operation = literal(p.get("operation")) or ("read" if t == "googleSheets" else "default")
            kind, role, tab, host = None, None, None, None
            workbook_hash = None
            if t == "executeWorkflow":
                target = literal(p.get("workflowId"))
                calls.append({"workflow_id":w["id"],"node_id":n.get("id"),"target_workflow_id":target if target in by_id else None,"disabled":bool(n.get("disabled")),"reachable":n["name"] in reachable,"resolution":"literal_id" if target in by_id else "unresolved"})
            if t == "googleSheets":
                workbook = literal(p.get('documentId'))
                if workbook and re.fullmatch(r'[A-Za-z0-9_-]{20,}', workbook):
                    workbook_hash=hashlib.sha256(workbook.encode()).hexdigest()
                v = p.get("sheetName", {})
                tab = (v.get("cachedResultName") if isinstance(v,dict) else None) or tabs.get(literal(v)) or literal(v)
                kind = "google_sheets"
                role = "write_sink" if operation in ("update","append","appendOrUpdate","clear","delete","create","remove") else ("stock_pool" if tab in ("streamables","streamables-yt") else "queue" if tab in ("telegram_audio_social_queue","media-edit-clips","telegram-storage") else "search_query_pool" if tab=="pinterest-search-queries" else "scheduler_config" if tab=="workflow-schedule" else "sheet_input")
            elif t == "googleDrive":
                kind, role = "google_drive", "write_sink" if operation in ("move","upload","delete","create","share","copy","update") or p.get("resource")=="folder" else "file_input"
            elif t == "telegramTrigger":
                kind, role = "telegram", "event_input"
            elif t in ("webhook","readBinaryFile","readWriteFile","postgres","airtable","awsS3","gmail","microsoftOutlook","gitlab"):
                kind, role = t, "input_or_storage_operation"
            elif t in ("httpRequest","httpRequestTool"):
                u = p.get("url", "")
                m = re.search(r"https?://([a-zA-Z0-9.-]+)(?:/|$)", u) if isinstance(u,str) else None
                host = m.group(1).lower() if m else None
                if host and "pinterest" in host and host.endswith("rapidapi.com"):
                    kind, role = "pinterest_rapidapi", "on_demand_search"
                elif host in ("api-inference.huggingface.co","queue.fal.run","api.piapi.ai","api.wavespeed.ai","api.elevenlabs.io","api.creatomate.com"):
                    kind, role = "generation_api", "on_demand_generation"
                elif host == "sh01.vivojaymail.workers.dev":
                    kind, role = "sh01_api", "service_dependency"
                elif host in ("graph.facebook.com","graph.threads.net","api.x.com","api.twitter.com","api.upload-post.com","backend.blotato.com","api.imgbb.com","hooks.zapier.com","api.canva.com","www.nyckel.com"):
                    kind, role = "external_api", "api_dependency"
                else:
                    kind, role = "http_unresolved" if host is None else "http_other", "unresolved_input_or_output"
            elif t in ("executeCommand","code"):
                # Do not interpret arbitrary code. Count its uncertainty separately.
                if any(x in json.dumps(p) for x in ("fetch(","axios","requests.","curl ","wget ","http://","https://")) or re.search(r"REDACTED|WITHHELD", json.dumps(p),re.I):
                    issues.append({"workflow_id":w["id"],"node_id":n.get("id"),"reason":"code_io_or_redacted_logic_unresolved"})
            if kind:
                sid = hashlib.sha256((w["id"]+"\0"+str(n.get("id") or n["name"])).encode()).hexdigest()[:24]
                sources.append({"source_id":sid,"workflow_id":w["id"],"workflow_name":label(w["name"]),"active_at_export":bool(w.get("active")),"node_id":label(n.get("id")),"node_name":label(n["name"]),"node_type":t,"operation":label(operation),"kind":kind,"role":role,"tab":label(tab) if tab else None,"endpoint_host":host,"disabled":bool(n.get("disabled")),"reachable_from_trigger":n["name"] in reachable,"accounts":[],"account_evidence":[],"measurement":"not_connected","remaining":None,"has_redacted_parameters":bool(re.search(r"REDACTED|WITHHELD",json.dumps(p),re.I))})
                if kind=='google_sheets':sources[-1]['workbook_id_sha256']=workbook_hash
    headers = [str(h).strip().lower() for h in rows[0]]
    for rownum, cells in enumerate(rows[1:],2):
        row = dict(zip(headers,cells)); name = str(row.get("workflow", ""))
        ids = by_name.get(name, [])
        accounts = sorted({label(a.strip().lstrip("@").lower()) for a in str(row.get("associated accounts", "")).split(",") if a.strip()})
        scheduled.append({"row":rownum,"workflow_name":label(name),"workflow_id":ids[0] if len(ids)==1 else None,"accounts":accounts,"resolution":"exact_unique_name" if len(ids)==1 else "unresolved_name"})
    downstream = defaultdict(set)
    for c in calls:
        if c["target_workflow_id"] and not c["disabled"] and c["reachable"]:
            downstream[c["workflow_id"]].add(c["target_workflow_id"])
    for route in scheduled:
        seen, todo = set(), [route["workflow_id"]] if route["workflow_id"] else []
        while todo:
            wid = todo.pop()
            if wid in seen: continue
            seen.add(wid); todo.extend(downstream[wid]-seen)
        for source in sources:
            if source["workflow_id"] in seen and not source["disabled"] and source["reachable_from_trigger"]:
                source["accounts"] = sorted(set(source["accounts"]+route["accounts"]))
                source["account_evidence"].append({"schedule_row":route["row"],"via":"exact_schedule_workflow" if source["workflow_id"]==route["workflow_id"] else "literal_subworkflow_call","branch_selection":"unverified"})
    stamp=re.search(r'(20\d{2})(\d{2})(\d{2})-\d{6}',Path(archive).name)
    return {"schema_version":2,"source_archive":Path(archive).name,"workflow_sha256":hashlib.sha256(raw).hexdigest(),"evidence_date":"-".join(stamp.groups()) if stamp else "unknown","scope":"All exported workflows, including inactive and disabled nodes. Associations are static evidence, not execution proof. No account-name substring matching.","coverage":{"workflows":len(ws),"nodes":sum(len(w.get('nodes',[])) for w in ws),"integration_nodes":len(sources),"unresolved_code_nodes":sum(i['reason']=='code_io_or_redacted_logic_unresolved' for i in issues),"unresolved_subworkflow_calls":sum(c['resolution']=='unresolved' for c in calls)},"workflows":catalog,"sources":sources,"calls":calls,"schedule":scheduled,"issues":issues}

def main():
    parser=argparse.ArgumentParser();parser.add_argument("--archive", required=True);args=parser.parse_args()
    report=build(args.archive)
    (ROOT/"producer-sources.json").write_text(json.dumps(report,indent=2,ensure_ascii=True)+"\n",encoding="utf-8")
    print("Source metadata inventoried:",report["coverage"])
    print("No node code, credential values, media URLs or sheet row payloads copied.")

if __name__=="__main__":main()
