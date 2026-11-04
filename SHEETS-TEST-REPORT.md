# Direct Sheets storage verification

## Local evidence

**53 JavaScript tests and 11 Python application/migration tests passed.** These execute application logic and a simulated Google Sheets REST API, not a live workbook. No cloud deployment, migration or provider operation was performed here.

The storage tests cover concurrent writes and exclusive job claims, stale prepared batches, lost-response replay, safe error categories, changed-record-only writes, 1,291-row pagination, Unicode/newline/formula-like text handling, growth of sheet dimensions, deletion identity uniqueness, authenticated routes, migration gates and scheduler behavior. Pending sync requests are consumed atomically with the claim; requests arriving during a job survive for a subsequent run.

Application tests cover strict producer eligibility and source attribution, stale/unknown stock, sessions, previews, content metrics, cleanup policies, uncertain clickouts writes, Meta token/permission failure handling and generated UI/source consistency. Python tests cover canonical table hashes, cursor pagination, IDs/newlines, safe destinations, auth headers and stable retry IDs.

Run in the dashboard repository:

```text
node --test producers.test.mjs sheets.test.mjs ui.test.mjs smoke.test.mjs content.test.mjs content-ui.test.mjs meta-collection.test.mjs
python -m unittest test_sheets_migration test_producers
```

The Windows operator needs Python only. Node tests run in the development/CI runtime.

## Live gate and limitations

Google's batch API documents atomic application and rejection of invalid subrequests. The adapter uses an existing named-range revision marker as an application-level precondition. It must pass a real two-writer and stale-retry probe against the target workbook before business writes are enabled. That live probe has **not** been run by the assistant.

The probe and local mocks do not certify every future provider behavior, concurrent manual edit, latency, permission or quota. All software writers must use the adapter; internal `_ops_*` tabs and the reserved named range must not be manually edited. Workbook editing warnings do not revoke owner/editor access.

The migration report must show exact hashes for all 18 tables before cutover. Real Meta analytics, preview playback, automatic jobs and external collectors require their own post-deployment evidence. Unknown provider errors remain safe categories; no secret-bearing error body is returned.

The follow-up installer expects the exact locally applied migration payload, accepts CRLF/BOM, backs up changes, removes only known unchanged gateway files, preserves unrelated FastAPI source, and refuses unknown edits before any write.

## Installer r2 — documentation preservation

The follow-up originally compared complete documentation files against reference copies containing extra trailing blank lines. Revision `2026-11-05-r2` updates only its generated migration notices and preserves other document content, including local edits and trailing newlines. Unknown code edits still stop all changes.

Fourteen installer regression tests passed, including an end-to-end run of the actual original migration installer followed by the corrected follow-up, UI build and Python tests. Coverage includes both FastAPI entrypoint layouts, CRLF/BOM, backups and known gateway-file removal, idempotency, local documentation edits, changed notices, and unchanged FastAPI application source. No live cloud operations were performed.
