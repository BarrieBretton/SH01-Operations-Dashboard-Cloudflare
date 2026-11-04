<!-- SH01 DIRECT SHEETS FOLLOW-UP BEGIN -->
> **Current storage instructions:** the existing Cloudflare Worker calls the Google Sheets API directly using its existing Google OAuth credentials. No Apps Script project, gateway URL or gateway secret is required. Follow [SHEETS-MIGRATION.md](SHEETS-MIGRATION.md): deploy with `SHEETS_STORAGE_READY=0`, verify the live write guard and all-table copy, then set `SHEETS_STORAGE_READY=1`. Cloud deployment and cutover remain pending until verified. Existing optional business-sheet write flags and platform credentials remain in their current scopes. Older storage/deployment instructions below are historical where they differ from this guide.
<!-- SH01 DIRECT SHEETS FOLLOW-UP END -->

# Content upgrade: complete configuration register

Updated 2026-11-04. This register describes the content upgrade, not every legacy SH01 integration. Values marked secret belong in the named service's secret/environment settings, never Git, screenshots, reports or workflow JSON. An API read permission does not prove publish/delete permission.

## Deployment status

The operator reported applying the 39-file dashboard patch and running `python build_ui.py` successfully. Migration, commit/push, deployment, new secrets, Sheet writes, companion deployment and n8n imports are **not yet verified**. Use [DEPLOYMENT-TRACKER.md](DEPLOYMENT-TRACKER.md) to record those separately.

## 1. Cloudflare Operations Dashboard Worker

Target: **sh01-operations-dashboard-cloudflare**, origin **https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev**. Configure runtime settings under Worker → Settings → Variables and Secrets, not the Git build environment.

| Name | Kind | Action / value | Required for |
| --- | --- | --- | --- |
| `DB` | D1 binding | Keep the existing database `sh01-operations-dashboard-cloudflare`; binding name must stay `DB`. Do not create a second database. | All persisted dashboard data |
| `DASHBOARD_TOKEN` | Secret | Keep existing private dashboard token. | Browser sign-in and read-only verification |
| `INGEST_TOKEN` | Secret | Keep existing ingestion token; authorized collectors must use the same value. | Publisher, scanner and error ingestion |
| `META_SYSVAR` | Secret | Keep existing supported token/string or structured credential. No credential is sent to the browser. | Meta asset discovery and collection |
| `GOOGLE_CLIENT_ID` | Runtime value or secret | Keep the OAuth client used for the successful Sheets sync. | Sheets |
| `GOOGLE_CLIENT_SECRET` | Secret | Keep the matching client secret. | Sheets |
| `GOOGLE_REFRESH_TOKEN` | Secret | Keep for reads; replace after reconsent **only if** it lacks write scope and you enable writing. | Sheets |
| `GOOGLE_SHEETS_SPREADSHEET_ID` | Runtime value | Keep the **operational workbook**, containing `streamables`, `streamables-yt`, `workflow-schedule`, `clickouts`. Do not use the separate environment-variable workbook. | Sheets |
| `META_GRAPH_VERSION` | Runtime value | Set explicitly to `v24.0` to match the supplied code baseline, or a version you have verified. This is not a claim that v24.0 is newest. | Versioned Meta requests |
| `META_SYNC_ENABLED` | Runtime value | Add `1` when scheduled Meta collection is wanted; unset/`0` disables that cron's collection. | Automatic Meta sync |
| `GOOGLE_SHEETS_WRITE_ENABLED` | Runtime value | Initially `0`/unset. Set `1` after the write-authorized token and worksheet ownership are verified. Enables mapping projection and **confirmed** clickouts queue writes together. | Sheet setup/mirroring/cleanup queue |
| `N8N_WORKFLOW_BASE_URL` | Optional runtime value | Default `https://n8n-prod-1.vivojaymail.workers.dev`. Change only if the workflow links use another origin. | Schedule/workflow links |
| `PRODUCER_MIN_READY_JSON` | Optional JSON runtime value | Preserve any existing overrides. Example shape: `{"streamables:ACCOUNT":3}`. Supply only verified thresholds; absence does not establish the hidden CFG threshold. | Producer threshold overrides |

**Deployment configuration:** the follow-up patch sets top-level `keep_vars: true` in `wrangler.jsonc`. This preserves UI-managed ordinary variables that are absent from `vars`; any values explicitly declared in `vars` still take precedence. Secrets remain outside the file. Keep the existing Worker name, database ID, `main: worker.js`, repository root and Git deployment command `npx wrangler deploy`.

**Schedules:** the upgrade declares `*/10 * * * *` for Sheets/outbox and `5,15,25,35,45,55 * * * *` for Meta. Cloudflare schedules use UTC. Verify these two triggers after deployment; do not add duplicate UI schedules. Flags still control whether optional writes/Meta sync run. No automatic duplicate-scanning or deletion schedule is installed.

## 2. D1

Run the full **content-schema.sql** in the existing D1 database's Console before testing content endpoints. It adds eight `content_*` tables; it is repeatable. Keep existing failures/producers/Meta/Sheets tables and their prior migrations. Do not drop/recreate the database. Back up before migration with `python backup_d1.py` if available; keep the SQL export private.

There is no new D1 password, new binding, R2 bucket or KV namespace for this upgrade. Worker restarts do not erase committed D1 rows. Recovery windows and private exports are still relevant for accidental changes and historical data.

## 3. Google Cloud and the operational workbook

| Item | Action |
| --- | --- |
| Google Sheets API | Keep enabled in the OAuth client's project. |
| OAuth scope | For writes, authorize `https://www.googleapis.com/auth/spreadsheets`; readonly scope cannot append/update. A flag cannot expand a token's grant. |
| Google identity | The authorized Google account must be an editor of this workbook for writes. |
| Consent configuration | Check the OAuth app's publishing/organization status and refresh-token lifetime. External apps in Testing with these scopes can produce short-lived refresh tokens; verify before depending on unattended operation. |
| Redirect URI | Reuse the existing OAuth flow and its exact registered URI when reconsenting. The Worker uses refresh-token exchange; this upgrade does not add a browser callback or require changing an existing `http://localhost:8080` callback. |
| `meta-posts-to-id` | After enabling writes, use Content & analytics → Availability → **Set up mapping sheet**. Creates the tab if absent and refuses conflicting headers. No new workbook. |
| `clickouts` | Retain the existing tab and exact `URLS` column. Determine which current workflow consumes it before queueing a real deletion. A queued row may trigger that older consumer regardless of this companion's delete flag. |
| `workflow-schedule` | Retain existing schema/timing values. Dashboard shows observed schedule evidence with workflow links; it does not edit cadence or activate workflows. |
| `streamables`, `streamables-yt` | Retain existing schema. Eligible stock remains exactly `status=staged` and `approved=yes`; unrelated Drive/Pinterest/Telegram sources stay distinct. |

The mapping projection uses these columns, in order:

`record_key, platform, account_id, account_handle, post_id, permalink, media_type, published_at, workflow_id, workflow_url, first_seen, last_seen, delete_status`

D1 owns the registry; the new tab is a projection. Do not manually reorder/delete projection rows during a mirror. A failed/ambiguous clickouts append is quarantined as `uncertain`, not blindly retried. There is no cross-system exactly-once transaction.

## 4. Existing FastAPI repo and Render workers

Repo: **BarrieBretton/sh01-fastapi-server**, branch `main`. The companion must actually be installed in this checkout; dashboard repo files alone do not install a Render endpoint. The follow-up patch's optional `--fastapi-repo` installs both modules, adds routers, adds explicit OAuth dependency, and updates README/handbook/docs/tests. It does not deploy anything.

Configure the **worker services selected to serve these routes**, not every master indiscriminately. If the public SH01 proxy can switch between A/B workers, both eligible backends need the code and required config. Masters can share the same Git code while leaving the social key unset, keeping these endpoints unavailable there. Start with low scan bounds on small instances.

| Name | Kind | Action / value |
| --- | --- | --- |
| `OPS_DASHBOARD_URL` | Runtime value | `https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev` (origin only, no path/query) |
| `INGEST_TOKEN` | Secret | Same value as dashboard Worker `INGEST_TOKEN`; required by this companion. |
| `SOCIAL_INVENTORY_API_KEY` | New secret | A separate random long key; caller uses `X-API-KEY`. Also signs scan cursors. Do not substitute media/control-plane keys. |
| `SOCIAL_ACCOUNTS_JSON` | JSON runtime config | Explicit owned-account registry. Dashboard account ID → platform, handle, provider ID, credential **environment-variable names**, optional workflow ID, `allow_delete:false`. See server guide. |
| Referenced `token_env` variables | Secrets | Actual authorized Meta bearer tokens as referenced by the registry. Facebook needs the correct owned Page identity. A structured `META_SYSVAR` JSON value cannot be used as a bearer token here. |
| Referenced `oauth_env` variables | Secrets | Tumblr consumer key/secret and token/secret. Reuse existing environment names where valid, e.g. the existing per-account Tumblr variables. No need to duplicate them under example names. |
| `META_GRAPH_VERSION` | Runtime value | Match the dashboard's verified version; supplied default `v24.0`. |
| `SOCIAL_SCAN_MAX_SECONDS` | Optional runtime value | Default `120`, clamp 15–300; reserve additional delivery time. Start with `max_posts:5` when testing the actual proxy/host. |
| `SOCIAL_ENABLE_ORB` | Optional runtime value | Keep `0`/unset initially. `1` requires optional `opencv-python-headless` in the build and actual resource testing. |
| `SOCIAL_DELETE_ENABLED` | Runtime value | Keep `0`/unset for initial deployment. Actual deletion requires `1`, account `allow_delete:true`, `dry_run:false`, ownership verification and exact confirmation. |
| `OPS_INGEST_TOKEN` | Existing error-logger secret | Keep if the older `sh01_error_handler.py` is installed. It uses this name while the new companion uses `INGEST_TOKEN`. Both can hold the same dashboard ingestion token. Do not rename/remove it blindly. |

The current Dockerfile installs **requirements.txt**, not an arbitrary new requirements file. The follow-up patch adds `oauthlib>=3.3,<4` directly there and preserves existing FastAPI/Pydantic/Pillow pins. FFmpeg/ffprobe already appear in the inspected Dockerfile. Do not replace the Render start command or increase Uvicorn workers for this upgrade. Select/redeploy the intended Git commit on each serving backend; one successful proxy call proves only the origin that served it.

No extra Google credentials are needed in this FastAPI companion: it writes through dashboard APIs. It does not need a D1 admin token. No persistent Render disk is required for scanner state; D1 stores records, while media processing uses temporary local files.

## 5. n8n (each relevant active instance)

| Item | Action |
| --- | --- |
| Publisher registration child | Import `workflows/register-published-post.n8n.json`; bind Header Auth `X-INGEST-KEY` to dashboard `INGEST_TOKEN`. |
| Existing publishing graphs | Attach the child/recording branch after verified final publish success; map the **nine** fields in workflows/README.md. Record each workflow's integration status. The patch does not update all 70 live graphs. |
| Post identity | Use final published post ID and returned permalink; never an IG upload container or Facebook upload session. Keep IDs as strings. |
| Deletion preview template | Import `workflows/clickouts-deletion.n8n.json` inactive. Bind Google Sheets OAuth credential and Header Auth `X-API-KEY` to `SOCIAL_INVENTORY_API_KEY`. |
| Workbook selection | Set input `document_id` to the existing operational workbook; `sheet_name: clickouts`. Sheet-origin mode remains preview-only. |
| Endpoint | Template uses `https://sh01.vivojaymail.workers.dev/social/posts/delete`. All proxy origins eligible to serve it need the companion deployment. |
| Consumer ownership | Pick one clickouts deletion consumer; do not activate a second consumer alongside the existing one. No automatic provider-delete schedule is created. |
| Duplicate scanner | Optional HTTP Request to `/social/inventory/scan` with explicit `platform` and configured `account_id`; resume bounded cursors. No scan workflow/schedule is activated by installation. |

These credentials live in n8n's credential store, not inline CFG nodes, exported JSON or `N8N_*` values on the dashboard. Existing n8n database settings, encryption key, instance URLs, routing and ring roles are unchanged.

## 6. Local PowerShell tools and other infrastructure

- `verify_content.py`: uses `OPS_DASHBOARD_URL` (defaults to this dashboard), and `DASHBOARD_TOKEN` or a hidden prompt. Reads status/counts only.
- `backup_d1.py`: uses `CLOUDFLARE_ACCOUNT_ID` and an authorized `CLOUDFLARE_API_TOKEN` locally/hidden prompt. It exports privately; it does not set Worker secrets or schedule itself. The API export request must be authorized for this database.
- Existing archive importer / Python error handler use `OPS_INGEST_TOKEN`; retain when used.
- No new configuration is required in Supabase, B2, ImageKit, Cloudinary, the affiliate site, infra-control/media-queue D1, or the SLA watcher for this content upgrade. Keep their existing values. No credentials need removal or rotation merely because of this patch.
- Meta/Tumblr may require app/account authorization changes if live requests report missing access. The register records supported login paths and safe error categories; no universal new permission list is assumed. Read success does not establish delete authorization.

## References

- https://developers.cloudflare.com/workers/wrangler/configuration/#top-level-only-keys
- https://developers.cloudflare.com/workers/wrangler/commands/workers/
- https://developers.google.com/workspace/sheets/api/scopes
- https://developers.google.com/identity/protocols/oauth2#expiration
- [Feature behavior and limits](CONTENT-UPGRADE.md)
- [Companion setup](server_extensions/README.md)
- [Workflow integration](workflows/README.md)
