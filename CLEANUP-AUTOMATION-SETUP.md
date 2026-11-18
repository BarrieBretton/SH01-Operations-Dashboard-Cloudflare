# Social reconciliation and automatic B2 cleanup

Deploy backend main and dashboard master from this patch. Existing manual B2 delete routes remain disabled in the desk. Installing or deploying does not enable a B2 schedule.

## Social queue

Open Content & analytics > Duplicates & queue > Verify executor results. The desk reads the backend's authenticated `/social/clickouts/evidence` endpoint, matches request ID, platform, account, post ID and permalink, and accepts `done` only with a matching durable provider receipt. No social DELETE, requeue or `/run` call occurs. The scheduled worker also reconciles approximately every ten minutes, subject to availability and Sheets quota.

Completed requests move to Completed history. Manual-required/blocked records retain their reasons. Executor reconciliation diagnostics lists legacy `added` records and cases without verified receipts. `added` is NOT silently changed to pending. Missing/inaccessible post previews never prove deletion.

The pull path uses existing MEDIA_CLIP_API_KEY and OPS_INFRA_MEDIA_URL and does not require setting OPS_INGEST_TOKEN. The optional existing callback remains compatible. Both deployments must use the same main backend and workbook.

## B2 schedule

Open Infrastructure > B2 Browse files > Automatic cleanup schedule > Load schedule / history. Choose top K (1–25), daily local time and an IANA timezone (default Asia/Kolkata). Set Enabled and Save schedule when ready. This explicitly authorizes automatic deletion without per-run dialogs. If today's time has already passed, the next scheduler tick can start the run. Pause by clearing Enabled and saving; an already-dispatched request cannot be cancelled.

Schedules, occurrence records and version intents are stored in `_sh01_b2_cleanup_state` in the existing workbook. It is a hidden, whole-sheet warning-protected internal tab, excluded by the established padlock reference rule. Do not edit or delete this tab, its named-range guard, or version intents manually.

The existing Cloudflare cron sends a wake-up tick to the control-plane backend. No new n8n workflow or Redis service is used. The backend that owns the configured B2 slot needs its existing Google Sheets dependencies/credentials (`sheets_helper.get_credentials()`), SPREADSHEET_ID, CONTROL_PLANE_API_KEY, and OPS_DASHBOARD_URL (the standard SH01 desk URL is the default). The desk needs its existing CONTROL_PLANE_API_KEY and OPS_INFRA_CONTROL_URL pointing to that backend. Metadata verifies the scanner and scheduler workbook IDs agree. Existing Cron Triggers must remain enabled; execution starts at the next available tick, not at an exact-second guarantee.

Each occurrence lists all versions in the key's permitted scope (bounded at 10,000), scans every qualifying sheet using the existing canonical matcher, and chooses at most K eligible uploaded versions ordered by byte size descending, then name/version ID. All matching statuses must be exactly `uploaded` in `streamables`/`streamables-yt`; any other qualifying reference protects the version. Unknown references block affected files (global unresolved identities block all). Hide markers are excluded.

Every subsequent file gets a new complete workbook scan; each selected version is verified with B2 immediately before its durable attempt record and DELETE. Google Sheets/B2 do not offer a shared atomic snapshot: workbook edits after their read can race a provider call. Runs stop on scan/provider/storage failures, expiration, configuration changes or incomplete pagination. Quota failures stop the occurrence rather than silently using old evidence. Keep K small initially (e.g. 1–3); full rescans trade execution time for fresher evidence.

A durable per-version intent is written BEFORE each DELETE. Failed/uncertain requests are never automatically retried, even on future days. A claimed daily occurrence is never automatically replayed after a crash. The history retains results and confirmed bytes reclaimed. A `running` record that stops updating after a backend restart must be reviewed; there is no automatic resume. Previous-attempt versions may consume positions in top K and will be skipped, not replaced with an unreviewed alternative. The version ledger is bounded by the existing 10,001-row state protocol; capacity/write failures stop work.

## Deployment checks (read-only)

- `GET /social/clickouts/evidence` with the media API key: verify exact receipts are returned.
- `GET /infra/desk/b2/automation?slot=<slot>` with the control-plane key: initially enabled=false.
- Desk: Verify executor results; verify completed history and inspect the manual-review/added diagnostics.
- B2: Load schedule/history. Keep paused until the desired K/time are saved intentionally.

Automated tests use fake providers and stores. No live posts or B2 objects were deleted during development. No live service availability, credentials or cron configuration was verified here.
