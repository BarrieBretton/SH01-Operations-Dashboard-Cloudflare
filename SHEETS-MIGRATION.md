# Google Sheets storage — direct API migration

## Current checkpoint

The previous patch was applied locally. Its Apps Script gateway requirement is superseded by `apply_direct_sheets_followup.py`. **Do not create or deploy an Apps Script project.** The dashboard Worker now calls the official Sheets API using its existing Google OAuth credentials. Cloud deployment, live verification and data copy remain pending.

All 18 dashboard tables are covered: failures, producer imports, live inventory/state, Meta assets/content/capabilities/snapshots, published posts/observations, duplicate candidates, cleanup plans, deletion queue, outbox, jobs and collection cursors. The existing Worker URL, n8n/FastAPI ingestion APIs and platform credentials are unchanged.

Storage uses 18 `_ops_<table>` tabs plus `_ops_control` in the existing operational workbook. Existing `streamables`, `streamables-yt`, `workflow-schedule`, `clickouts`, `meta-posts-to-id` and other business tabs are preserved. The independent infrastructure media-queue D1 is outside this migration.

## 1. Apply the follow-up and build

Run from the dashboard checkout. This patch expects the successfully applied Sheets migration, not the old GitHub version. It backs up changes and refuses unknown edits. The optional FastAPI path updates documentation only; it accepts root `app.py` or `server/app.py`.

```powershell
& {
  python .\apply_direct_sheets_followup.py --check --fastapi-repo "..\sh01-fastapi-server"
  if ($LASTEXITCODE -ne 0) { throw "Check failed; stop." }
  python .\apply_direct_sheets_followup.py --fastapi-repo "..\sh01-fastapi-server"
  if ($LASTEXITCODE -ne 0) { throw "Patch failed; stop." }
  python .\build_ui.py
  if ($LASTEXITCODE -ne 0) { throw "Build failed; stop." }
  python -m unittest test_sheets_migration test_producers
  if ($LASTEXITCODE -ne 0) { throw "Tests failed; stop." }
}
```

No Node, npm or Wrangler installation is needed on Windows. JavaScript tests ran in the development runtime; see SHEETS-TEST-REPORT.md. Do not rerun the superseded original migration installer after applying this follow-up.

## 2. Existing Cloudflare Worker settings

In Workers & Pages → **sh01-operations-dashboard-cloudflare** → Settings → Variables and Secrets:

| Setting | Action |
|---|---|
| `GOOGLE_CLIENT_ID` | Keep the existing value |
| `GOOGLE_CLIENT_SECRET` | Keep as a Worker secret |
| `GOOGLE_REFRESH_TOKEN` | Keep as a Worker secret; its grant must permit Sheets writes |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Keep the operational workbook ID |
| `SHEETS_STORAGE_READY` | Set to `0` for setup/copy; change to `1` only after verified copy |
| `SHEETS_STORE_URL`, `SHEETS_STORE_KEY` | Not used; remove if you already added them |
| `DASHBOARD_TOKEN`, `INGEST_TOKEN`, `META_SYSVAR` | Keep the existing secrets |
| `GOOGLE_SHEETS_WRITE_ENABLED` | Preserve your deliberate setting. This gates optional clickouts/mapping writes, not internal storage |
| `META_SYNC_ENABLED` / Graph API version | Preserve current settings; actual Meta permissions still need a successful sync |

The same Google account must have edit access to the workbook and OAuth scope `https://www.googleapis.com/auth/spreadsheets` (or another applicable full-write scope), rather than only `spreadsheets.readonly`. If setup returns `store_google_scope_missing`, repeat consent with the same OAuth client and write scope, then replace only the refresh token. A new OAuth client or service account is not required. A generic permission error may also mean the Google account lacks workbook edit permission; it does not by itself identify the missing scope.

There are **no Apps Script properties, gateway URLs, gateway keys, new Cloudflare services, or new Google accounts** to configure. FastAPI needs no new credentials for this change.

## 3. Deploy in migration mode

Pause external publishers/collectors that send dashboard writes, or ensure they retry failed ingests. During the migration window normal APIs return an explicit unavailable response. Retain the existing dashboard D1 binding `DB` for read-only export. Existing D1 records are never deleted or modified by the migration.

Stage the complete migration manifest, including removals of superseded gateway files, then commit/push:

```powershell
& {
  $paths = Get-Content .\SHEETS-CHANGED-FILES.txt
  foreach ($path in $paths) {
    if (Test-Path -LiteralPath $path) { git add -- $path }
    else {
      git ls-files --error-unmatch -- $path *> $null
      if ($LASTEXITCODE -eq 0) { git add -u -- $path }
    }
  }
  git diff --cached --stat
  git commit -m "Use direct Google Sheets storage without Apps Script"
  if ($LASTEXITCODE -ne 0) { throw "Review Git output before pushing." }
  git push origin master
}
```

Wait for Cloudflare's repository deployment to succeed. The committed Wrangler configuration keeps the existing Worker name and D1 binding, preserves dashboard variables, and installs `* * * * *`. One due collector runs per minute; normal source/Meta cadence is approximately ten minutes. Optional mapping mirroring handles one queued record per invocation to bound quota/subrequest usage. This is scheduled polling, not a realtime Sheets change feed.

FastAPI documentation can be committed separately using `SOCIAL-SHEETS-CHANGED-FILES.txt` from its own repository. No server deployment is required by those documentation-only edits. Do not stage private archives, backups or secret files.

## 4. Initialize, validate concurrency, copy and verify

```powershell
python .\migrate_d1_to_sheets.py
```

Enter only your existing **dashboard token** at the hidden prompt. Google credentials stay in the Worker. No Apps Script URL or new secret is requested.

The command:

1. Creates the 19 internal tabs without modifying existing business tabs. Repeated setup preserves records. An old/partial storage layout stops for review.
2. Runs a live internal-state probe: two conflicting revision updates must have exactly one winner, and replaying the stale update must fail. This changes only an internal control marker. Normal data commits remain disabled until this check passes.
3. Reads all 18 legacy D1 tables with keyset pagination, rejects unknown/missing tables, copies only changed rows into Sheets, and preserves IDs, nulls, JSON, literal newlines and Unicode.
4. Compares canonical hashes of every source/destination table, then re-reads source hashes to detect changes during migration. Extra destination rows block completion, except initial required job seeds.
5. Writes `sheets-migration-report.json` with counts/hashes, never credentials or row values. Reads/writes are paced for Sheets quotas; allow several minutes.

Useful commands:

```powershell
python .\migrate_d1_to_sheets.py --setup-only
python .\migrate_d1_to_sheets.py --verify-only
```

`--setup-only` creates internal tabs and runs the write guard probe; it is not a read-only check. `--verify-only` reads source/destination without changing them. None of these commands writes D1 or deletes provider content. If any verification fails, keep `SHEETS_STORAGE_READY=0` and share only the safe error/category or counts report.

## 5. Switch storage and verify

After `ALL TABLE HASHES MATCH` and report `status: PASS`:

1. Set Worker `SHEETS_STORAGE_READY=1` and deploy the settings change.
2. Run `python .\verify_sheets_storage.py` and `python .\verify_producers.py`.
3. In the dashboard, Queue Sheets sync; wait for a fresh successful snapshot. Run Sync Meta and check its actual result/capability inventory.
4. Resume external publishers/log collectors and confirm one test record appears.
5. Run `python .\backup_sheets.py` for a private backup. It uses the dashboard token and refuses an inconsistent snapshot. Briefly pause dashboard writers if a consistent backup cannot complete.

The old dashboard D1 may remain for reference. Its binding can be removed from `wrangler.jsonc` after verification if desired; do not delete the database yet. It is a pre-cutover snapshot, not a continuing backup. Rolling back after new Sheets writes requires reconciling those records first.

## Correctness, access and limits

- Every logical commit rotates one named-range revision marker in the same atomic `spreadsheets.batchUpdate` as the changed rows and control record. A stale transaction refers to a marker that no longer exists and is rejected. This is application-level coordination built from Sheets requests, **not a native Sheets database transaction API**. The live setup probe is mandatory and must pass before writes are enabled.
- A lost response is reconciled against the committed request ID before retrying. Concurrent writers reload/recompute from fresh state. No in-memory Worker lock is treated as a distributed lock.
- Only changed records are written; job claims, deletion identities, cleanup-plan checks and snapshot publication use this adapter. Read operations check revision before/after, including pagination. One internal named range remains; markers do not accumulate.
- All software writers must use the adapter. Do not manually edit, sort, rename, remove, or insert rows into `_ops_*` tabs or change `_sh01_ops_revision_guard`. These tabs have editing warnings, not a separate access boundary. Workbook owners/editors retain their Google access. Restrict workbook sharing accordingly.
- Sheets is durable hosted storage, but this is not a promise against accidental edits/deletion or quota limits. Keep private backups. The ten-million-cell workbook limit and API read/write quotas apply. No history is silently pruned. Oversized transactions fail visibly rather than partially publishing.
- Individual records are chunked as explicit text cells, preventing formula interpretation; IDs are kept as strings when supplied as strings. Credentials remain server-side. Raw Google error messages are never returned to the browser.
- Existing user authentication, producer eligibility (`staged` and `approved=yes`), non-Sheets unknown inventory, provider permissions and explicit deletion controls are preserved. No live permission/preview/Meta result is implied by local tests.

Official references: [atomic batch updates](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate), [named-range requests](https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/request), [Sheets quotas](https://developers.google.com/workspace/sheets/api/limits).


## Google Sheets request compatibility fix
The direct Sheets adapter uses redirect: manual and rejects HTTP 3xx. Cloudflare Workers rejects redirect: error before sending a request; the previous handler mislabeled this store_network_unavailable. Rebuild and deploy before retrying migration. Keep SHEETS_STORAGE_READY=0 until all table hashes match.
