# SH01 Operations Dashboard

Cloudflare dashboard for failure summaries, live producer stock, source evidence, published content, observed analytics, duplicate review and explicit cleanup queues. Normal storage is the existing Google workbook through the Sheets API.

Start with [the project handbook](docs/PROJECT_HANDBOOK.md) and [implementation/acceptance guide](docs/IMPLEMENTATION-ACCEPTANCE.md). The latter records implemented changes, current schedules and outstanding live checks.

## Build and verification

```powershell
python .\build_ui.py
python .\verify_dashboard.py
python .\verify_producers.py
python .\verify_content.py
```

The last three commands verify the deployed service; credentials are supplied locally. Use the existing GitHub→Cloudflare deployment. For an already migrated deployment, retain `SHEETS_STORAGE_READY=1`; this upgrade adds no storage schema and needs no repeat migration, new database or Apps Script.

## Source map

- `worker-runtime.js`: authentication, request routing, minute scheduler, failures and ingestion.
- `sheets-store.js`, `store-schema.json`: revision-guarded direct Sheets storage.
- `producer-policy.js`, `sheets-sync.js`, `producer-view.*`: stock eligibility, account/tab pools, scheduling evidence and UI.
- `source-observations.js`, `collect_source_observations.py`: explicit source evidence and bounded Drive inventory.
- `meta-worker.js`: discovery, account/media probes, cursor progress, capability evidence and preview refresh.
- `content-ledger.js`, `content-view.*`: library, observations, comparisons, duplicate plans, mirror and queues.
- `server_extensions/`: bounded scanner and separately gated deletion companion; installed in the coordinated FastAPI change.
- `workflows/`: inactive publisher/cleanup/failure/scanner templates, explicit mapping tools and coverage audit.
- `backup_sheets.py`, `verify_backup.py`: complete private backup and offline restore rehearsal.

The Worker does not execute social deletion. The companion requires explicit ownership verification, account opt-in, server opt-in and exact confirmation. Importing a template does not activate it. Provider availability and full live workflow coverage require their own acceptance evidence.

## Local tests

```bash
node --test *.test.mjs
python -m unittest test_completion test_producers test_sheets_migration
python -m unittest discover -s workflows -p 'test_*.py'
python -m unittest discover -s server_extensions -p 'test_*.py'
```

Node is needed for developer tests, not the Python build on the operator's Windows machine. Tests use local fixtures, not production credentials.
