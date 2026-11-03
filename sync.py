"""Run in Kaggle or locally to sync a SH01 handoff and optional live Google/n8n APIs.

Requires only Python standard library. Do not print or save API credentials.
This imports metadata; it never reads the encrypted database or raw execution data.
"""
import argparse
import hashlib
import json
import os
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from collections import defaultdict
from datetime import datetime, timezone


def env(name):
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError("Missing environment variable: " + name)
    return value


def fetch(url, headers=None):
    req = urllib.request.Request(url, headers=headers or {"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=25) as response:
        return json.load(response)


def post(host, token, route, data):
    body = json.dumps(data, ensure_ascii=False).encode()
    req = urllib.request.Request(host.rstrip("/") + route, body, method="POST", headers={
        "Content-Type": "application/json", "X-INGEST-KEY": token,
    })
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            if response.status != 200:
                raise RuntimeError("Ingestion returned unexpected HTTP status")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Ingestion rejected HTTP {e.code} at {route}") from None


def normalize(s):
    return str(s or "").strip()


def ready(approved, status):
    a, s = normalize(approved).lower(), normalize(status).lower()
    return a in ("yes", "true", "approved", "1", "y") and s not in (
        "used", "published", "consumed", "done", "posted", "completed", "deleted",
    )


def workbook_tabs(z, spreadsheet_id, access_token):
    index = json.loads(z.read("core_sheets/index.json"))
    tab_index = {t["title"]: t for t in index["tabs"]}
    if access_token:
        sid = spreadsheet_id or index.get("spreadsheet_id")
        if not sid:
            raise RuntimeError("Google Sheets workbook ID is unavailable")
        for title in ("streamables", "streamables-yt", "workflow-schedule"):
            if title not in tab_index:
                continue
            range_value = urllib.parse.quote("'" + title.replace("'", "''") + "'!A1:Z20000")
            endpoint = "https://sheets.googleapis.com/v4/spreadsheets/" + urllib.parse.quote(sid, safe="") + "/values/" + range_value
            try:
                data = fetch(endpoint, {"Authorization": "Bearer " + access_token})
            except urllib.error.HTTPError as e:
                raise RuntimeError(f"Google Sheets HTTP {e.code}; live sync aborted") from None
            yield title, data.get("values") or []
    else:
        for title in ("streamables", "streamables-yt", "workflow-schedule"):
            if title not in tab_index:
                continue
            path = "core_sheets/tabs/" + str(tab_index[title]["sheet_id"]) + ".json"
            yield title, json.loads(z.read(path)).get("display_values") or []


def dictionaries(rows):
    if not rows:
        return []
    header = [normalize(x).lower() for x in rows[0]]
    return [dict(zip(header, list(row) + [""] * max(0, len(header) - len(row)))) for row in rows[1:]]


def ingest_producers(z, host, token, spreadsheet_id, access_token, threshold):
    workflows = [json.loads(line) for line in z.read("n8n_workflow_review/workflows.jsonl").splitlines() if line]
    # Workflow text is already redacted in this export; use it only to identify
    # references, never store node bodies or values in the dashboard.
    refs = [(normalize(w.get("name")), json.dumps(w.get("nodes", []), ensure_ascii=False).lower()) for w in workflows]
    groups = defaultdict(list)
    seen_names = set()
    schedule_accounts = set()
    for title, rows in workbook_tabs(z, spreadsheet_id, access_token):
        for row_number, row in enumerate(dictionaries(rows), 2):
            if title == "workflow-schedule":
                for account in normalize(row.get("associated accounts")).split(","):
                    if account.strip():
                        schedule_accounts.add(account.strip())
                continue
            account = normalize(row.get("account"))
            creator = normalize(row.get("creator_handle"))
            if not account and not creator:
                account = "Unattributed / " + title
            name = account or creator
            producer_id = hashlib.sha256((account.lower() + "\0" + creator.lower()).encode()).hexdigest()[:32]
            seen_names.add(name.lower())
            group = groups[producer_id]
            entry = {"item_id": title + ":" + str(row_number),
                     "item_label": normalize(row.get("caption"))[:140] or "Row " + str(row_number),
                     "item_url": normalize(row.get("yt_link")) or normalize(row.get("public drive link")),
                     "status": normalize(row.get("status")), "approved": normalize(row.get("approved")),
                     "ready": ready(row.get("approved"), row.get("status")), "origin": title}
            group.append((account, creator, entry))
    for producer_id, tuples in groups.items():
        account, creator = tuples[0][:2]
        words = tuple(s for s in (account, creator) if len(s) >= 3)
        used_by = sorted({name for name, contents in refs if any(s.lower() in name.lower() or s.lower() in contents for s in words)})[:100]
        items = [t[2] for t in tuples]
        for offset in range(0, max(1, len(items)), 300):
            post(host, token, "/api/ingest/producer", {
                "producer_id": producer_id, "name": account or creator, "account": account,
                "creator_handle": creator, "threshold": threshold,
                "workflow_names": used_by, "sheet_backed": True,
                "reset": offset == 0, "items": items[offset:offset + 300],
            })
    # Accounts mentioned by the scheduling sheet but without a stock row are
    # surfaced as unknown, not incorrectly shown as consumed.
    for name in sorted(schedule_accounts):
        if name.lower() in seen_names:
            continue
        producer_id = hashlib.sha256(("schedule\0" + name.lower()).encode()).hexdigest()[:32]
        post(host, token, "/api/ingest/producer", {
            "producer_id": producer_id, "name": name, "account": name,
            "sheet_backed": False, "workflow_names": sorted({w for w, s in refs if name.lower() in s})[:100],
            "threshold": threshold, "reset": True, "items": [],
        })
    workflow_only = 0
    for name, _ in refs:
        if "producer" not in name.lower() or name.lower() in seen_names:
            continue
        producer_id = hashlib.sha256(("workflow\0" + name.lower()).encode()).hexdigest()[:32]
        post(host, token, "/api/ingest/producer", {
            "producer_id": producer_id, "name": name, "sheet_backed": False,
            "workflow_names": [name], "threshold": threshold, "reset": True, "items": [],
        })
        workflow_only += 1
    print("Producer groups synchronized:", len(groups), "schedule-only:",
          len(schedule_accounts - seen_names), "workflow-only:", workflow_only)


def ingest_snapshot_failures(z, host, token, workflow_url):
    names = {w["id"]: normalize(w.get("name")) for w in
             (json.loads(line) for line in z.read("n8n_workflow_review/workflows.jsonl").splitlines() if line)}
    rows = json.loads(z.read("n8n_public_db/tables/public.execution_entity.json"))
    failures = []
    for row in rows:
        if normalize(row.get("status")).lower() not in ("error", "failed", "crashed"):
            continue
        at = row.get("stoppedAt") or row.get("startedAt") or row.get("createdAt")
        if not at:
            continue
        wid = normalize(row.get("workflowId"))
        failures.append({"source": "n8n", "event_id": "snapshot:" + normalize(row.get("id")),
                         "happened_at": at, "workflow_name": names.get(wid, "Unknown workflow"),
                         "workflow_url": workflow_url.rstrip("/") + "/workflow/" + urllib.parse.quote(wid),
                         "service": "Active database snapshot", "message": "Failed execution; detailed error not in readable snapshot"})
    for offset in range(0, len(failures), 100):
        post(host, token, "/api/ingest/event", {"events": failures[offset:offset + 100]})
    print("Historical n8n failure metadata synchronized:", len(failures))


def ingest_live_n8n(host, token, base_url, api_key, label, max_pages=20):
    if not base_url or not api_key:
        return
    headers = {"X-N8N-API-KEY": api_key, "Accept": "application/json"}
    cursor = None
    count = 0
    for _ in range(max_pages):
        params = {"status": "error", "limit": 100}
        if cursor:
            params["cursor"] = cursor
        try:
            data = fetch(base_url.rstrip("/") + "/api/v1/executions?" + urllib.parse.urlencode(params), headers)
        except urllib.error.HTTPError as e:
            print("n8n", label, "HTTP", e.code, "— live sync unavailable")
            return
        page = data.get("data", [])
        rows = []
        for x in page:
            at = x.get("stoppedAt") or x.get("startedAt")
            if not at or not x.get("id"):
                continue
            wid = normalize(x.get("workflowId"))
            rows.append({"source": "n8n", "event_id": label + ":" + normalize(x["id"]),
                         "happened_at": at, "workflow_name": normalize(x.get("workflowName")) or wid,
                         "workflow_url": base_url.rstrip("/") + "/workflow/" + urllib.parse.quote(wid),
                         "service": label, "message": "Execution failed; full run data deliberately not ingested"})
        if rows:
            post(host, token, "/api/ingest/event", {"events": rows})
        count += len(rows)
        cursor = data.get("nextCursor")
        if not cursor:
            break
        time.sleep(.2)
    print("Live n8n", label, "failure metadata synchronized:", count)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--archive", required=True, help="Path to SH01-Shareable-Handoff ZIP")
    p.add_argument("--threshold", type=int, default=3)
    p.add_argument("--skip-live-n8n", action="store_true")
    args = p.parse_args()
    host, key = env("OPS_DASHBOARD_URL"), env("OPS_INGEST_TOKEN")
    with zipfile.ZipFile(args.archive) as z:
        if z.testzip():
            raise RuntimeError("Handoff ZIP is corrupt")
        ingest_producers(z, host, key, os.getenv("GOOGLE_SHEETS_SPREADSHEET_ID", ""),
                         os.getenv("GOOGLE_SHEETS_ACCESS_TOKEN", ""), args.threshold)
        ingest_snapshot_failures(z, host, key, os.getenv("N8N_WORKFLOW_BASE_URL", "https://n8n-prod-1.vivojaymail.workers.dev"))
    if not args.skip_live_n8n:
        for label in ("A", "B"):
            ingest_live_n8n(host, key, os.getenv(f"N8N_{label}_BASE_URL", ""),
                            os.getenv(f"N8N_{label}_API_KEY", ""), label)


if __name__ == "__main__":
    main()
