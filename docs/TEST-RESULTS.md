# Local validation — 5 November 2026

- `node --test *.test.mjs`: 75 passed. Includes storage concurrency, auth, scheduler, producer policy, cleanup gates, UI session clearing, Meta per-media probe rotation, safe errors, Facebook field/view mapping, daily account semantics, structured breakdowns, publication-age windows and source-ID validation.
- `python -m unittest test_completion test_producers test_sheets_migration`: 16 passed. Includes paced retries, snapshot conflict handling, OAuth rejection redaction, bounded Drive paging, backup digest tampering and in-memory restore rehearsal.
- `python -m unittest discover -s workflows -p 'test_*.py'`: 13 passed. Includes explicit publisher mappings, review exports, cleanup normalization and inactive failure/scan templates.
- `python -m unittest discover -s server_extensions -p 'test_*.py'`: 27 passed. Includes media normalization/fingerprints, fetch restrictions, budgets, cursor replay, ingestion and cleanup gates.
- Companion repository: the same 27 social tests plus three app-integration/status/telemetry tests passed; changed Python modules compile.
- Worker and dashboard regenerated with `python build_ui.py`; component marker consistency is tested.
- Real-browser visual validation was attempted but Chromium could not launch because this execution environment rejected its process socket. DOM/behavior tests passed; a rendered browser acceptance remains required.
- No live provider requests with credentials, production deployment, Sheet flag changes, n8n import, publication or deletion were performed during local testing.

These are local results, not a complete production acceptance record. See `IMPLEMENTATION-ACCEPTANCE.md` for outstanding external evidence.
