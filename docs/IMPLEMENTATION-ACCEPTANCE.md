# Implementation and acceptance — 5 November 2026

## Evidence boundary

This revision is code and local-test evidence. It does not claim a Cloudflare/Render deployment, a successful Meta permission grant, an imported n8n workflow, or a completed real deletion. The operator's earlier evidence showed 21 discovered assets, successful Instagram media views/reach, failed Facebook post insight requests, and disabled optional Sheet mirroring. Those observations predate this revision.

## Changes and remaining live checks

| Requirement | Implementation in this revision | Live acceptance still needed |
| --- | --- | --- |
| Meta coverage | Candidate catalog for media, Page/account metrics, account profile counts and Instagram demographic/interaction breakdowns; unchecked and stale checks displayed | Confirm candidates against each account/version/permission; the catalog is not a guarantee of every metric Meta might expose |
| Facebook metrics | Probe `post_media_view`; collect likes/comments/shares independently; retain reaction breakdowns; stop using impressions as the sole post metric | Confirm views response and permissions on known posts; code 100 alone is not proof of deprecation |
| Page/account analytics | Rotating probes, closed UTC-day request boundaries, total_value parameters, explicit daily/point-in-time/lifetime semantics | Check provider reporting-day semantics and returned values; demographic thresholds may withhold results |
| Per-post progress | Oldest unchecked/due metric first, persisted checks, stored-post revisits, hourly refresh/retry and seven-day unsupported cooldown | Observe a complete account/media pass and provider rate limits |
| Discovery/backfill | Discovery cursor advances independently; least-recently-attempted account selection; recent/history/story/revisit/account phases; failed accounts cannot starve others | Reconcile expected accounts and a sample of historical posts; API exhaustion is not full-history proof |
| Comparisons | UTC or hours-since-publication axis; first 24 h/7 d/30 d windows; actual interval rates, observed peak/latest decline and unavailable early history | Multiple genuine snapshots; no reconstruction of missing early performance |
| Sync feedback | Queued/running/completed/partial/failed/stale status, bounded polling, per-account attempts, history and latest collection result | Observe production queued→running→completion and unattended collection |
| Publisher hooks | Existing explicit hook instrumenter plus offline coverage audit and final-ID attestations | Private final-node mappings, credential binding, imports and one successful publication per intended path |
| Sheet mirror | Existing opt-in mapping/clickouts outbox and setup controls retained; verification exposes flags and pending operations | Set write flag/scope only when intended; verify setup, mapping and outbox drain |
| Duplicate scanner | Mounted FastAPI router, private atomic resume CLI, inactive n8n batch template, authenticated readiness endpoint, Tumblr notes | Deploy server/configure accounts; measure representative image/video accuracy and actual instance resources |
| Cleanup | Existing dry-run/ownership/confirmation gates; ambiguous provider outcome reports manual review | Verify preview and status callback with a non-production target; actual destructive acceptance requires a specifically approved target |
| Non-Sheet sources | Exact registry-ID observation API; bounded mapped Drive inventory collector; activity/on-demand observation contract and UI freshness | Supply actual mappings and credentials; Telegram/Pinterest/other providers need their own producing workflow or collector, not invented finite-stock counts |
| Failure logging | Bounded Python ERROR telemetry mounted on root logger; inactive n8n failure template; offline error-workflow attachment/audit | Deploy on intended services; bind n8n credential/error workflow and verify a controlled failure on each intended source |
| Media previews | Explicit provider refresh for known Meta media; HTTPS CDN validation; image/video distinction; open-original fallback | Test real playable media, expired/deleted/permission-denied media and CDN expiry |
| Producer verifier | Paced GETs, bounded transient retries, fixed safe error codes, up to two full snapshot restarts, no redirects | Rerun against deployment and retain count-only PASS output |
| Documentation | Current entry points below supersede historical D1/cron setup; no new gateway, Apps Script or database | Record deployed revisions and external settings without secrets |
| Acceptance/recovery | Read-only `verify_dashboard.py`; complete backup digest/key validation and in-memory restore rehearsal | Run all-table backup, verify it, test an isolated live restore and record unattended operation |

## Current storage and schedules

Use the existing Worker and workbook with `SHEETS_STORAGE_READY=1` after the already completed cutover. **Do not repeat migration or reset storage for this upgrade.** No schema columns or tabs are added. Progress/observations use existing `content_collect_state` JSON records and existing Meta tables. The old D1 binding remains for migration history only; normal dashboard requests use direct Google Sheets storage.

The only Cloudflare trigger is `* * * * *`. One bounded job is chosen per tick. Sheets stock and optional mirror jobs are due every ten minutes; Meta is due every 60 seconds by default, configurable with `META_SYNC_INTERVAL_SECONDS` (60–3600). This is a due interval, not a promise every account refreshes each minute. A run handles one account and one phase, a media page of at most two posts and at most twelve actual Graph requests including retries. Google/storage requests have their own existing limits. `META_SYNC_ENABLED=1` enables automatic collection; manual sync still queues a bounded run.

## Build and deploy through existing Git integration

1. Review the dashboard and companion-server PRs. Build the dashboard using `python build_ui.py`; commit generated `worker.js` and `dashboard.html` with component sources.
2. Merge/deploy each reviewed PR through the existing GitHub integrations. No global Node/Wrangler install is required on the operator's Windows machine. Keep the current production storage-ready setting and existing secrets.
3. Configure FastAPI `SOCIAL_INVENTORY_API_KEY`, `SOCIAL_ACCOUNTS_JSON`, `OPS_DASHBOARD_URL`, and `OPS_INGEST_TOKEN` in the existing service environment. Each account points to its own token environment-variable name. See `server_extensions/README.md`. Installation does not enable deletion.
4. Run `python verify_dashboard.py`, `python verify_producers.py`, and `python verify_content.py` from the dashboard repo. Prompts hide the dashboard token. Reports contain counts/status only. Refresh Availability and inspect current account progress and fresh capability rows.
5. Run `python backup_sheets.py`, then `python verify_backup.py PRIVATE-SHEETS-BACKUPS/<backup>.zip`. The second command is offline and performs no live restore.
6. For a configured social account: `python run_social_scan.py instagram <account-id> --batches 1 --checkpoint PRIVATE-SCAN-<account-id>.json`. Set the social API key locally, never in chat. Repeat with the same checkpoint; provider exhaustion stops the run. Cursors expire after 24 hours and are private. A timeout retains the checkpoint for replay; check server status before retrying.
7. Import the inactive templates from `workflows/`, bind credential references, and review publisher/error mappings using a private export. `audit_integrations.py` emits IDs/counts, never node parameters. Heuristic candidates require review; the audit cannot attest live wiring.
8. Enable optional business-sheet writes only when intended. Queued clickouts links may be consumed by an existing deletion executor. This revision does not toggle that flag or the deletion flag.

## Source observation contract

`POST /api/ingest/source-observations` uses the ingest key. Each observation requires an existing `source_id`, `measurement` (`inventory`, `activity`, `on_demand`), `status`, and a recent `checked_at`. Optional count/completeness/reason are allowlisted. `remaining` always remains unknown: a Drive file count or successful API probe is not a count of eligible unused stock. Only the latest timestamp is retained per exact source ID.

`collect_source_observations.py` accepts a private JSON file shaped as `{"sources":[{"source_id":"<exact registry ID>","kind":"google_drive","folder_id":"<folder ID>","token_env":"DRIVE_ACCESS_TOKEN"}]}`. Reads are bounded to ten pages. Add `--submit` to deliver observations. Other source workflows can submit the same contract after their actual provider call. No Telegram history or Pinterest stock is inferred from credentials or a source name.

## Provider documentation and uncertainty

Reference entry points: [Meta Insights](https://developers.facebook.com/docs/graph-api/reference/insights/), [Instagram User Insights](https://developers.facebook.com/docs/instagram-platform/reference/instagram-user/insights/), and [Meta's Postman collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api). The developer-reference pages were rate limited during this implementation. Candidate names therefore remain independently probed; this change does not assert universal availability or silently reinterpret impressions as views. Raw provider messages, credentials, cursors and media URLs are excluded from diagnostics.

## Acceptance record

Record deployment commit/version, verification date, counts, account/history progress, fresh supported/unsupported reasons, configured workflow IDs, mirror counts and backup digest results. Do not record secret values, provider responses, signed media URLs or cursor values. A passing mock/local test is not a production acceptance record. Pending live items in the matrix stay pending until this evidence exists.
