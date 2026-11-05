<!-- SH01 DIRECT SHEETS FOLLOW-UP BEGIN -->
> **Current storage instructions:** the existing Cloudflare Worker calls the Google Sheets API directly using its existing Google OAuth credentials. No Apps Script project, gateway URL or gateway secret is required. Follow [../SHEETS-MIGRATION.md](../SHEETS-MIGRATION.md): deploy with `SHEETS_STORAGE_READY=0`, verify the live write guard and all-table copy, then set `SHEETS_STORAGE_READY=1`. Cloud deployment and cutover remain pending until verified. Existing optional business-sheet write flags and platform credentials remain in their current scopes. Older storage/deployment instructions below are historical where they differ from this guide.
<!-- SH01 DIRECT SHEETS FOLLOW-UP END -->

# Dashboard producer subsystem

This handbook describes the Cloudflare Operations Dashboard correction, not the FastAPI server's deployment handbook.

## Entry points

- `dashboard.html`: editable dashboard; producer markup/logic are embedded from `producer-view.html` and `producer-view.js` by `build_ui.py`.
- `producer-policy.js`: authoritative Streamables eligibility, consumed states, threshold provenance, URL handling.
- `sheets-sync.js`: OAuth refresh, read-only Sheets collection, D1 version publication, source/state API.
- `audit_sources.py` → `producer-sources.json`: metadata-only workflow source register.
- `worker.js`: generated UI/register/collector plus existing authenticated APIs and Meta integration. Commit regenerated changes; do not independently edit the generated producer block.
- `sync.py`: archive importer; archive stock is retained for reference, not presented as live v2 stock.
- `verify_producers.py`: read-only deployed verification; no secrets or row values printed.
- `docs/PRODUCER-AUDIT.md`: findings, evidence, tests, deployment and explicit remaining gaps.

## Evidence distinction

**Code-confirmed:** `staged` + `yes`, account aggregation, `count < min_ready_streamables`, source nodes and literal graph links in the inspected handoff.

**Operator-reported:** Google OAuth/Sheets read preflight previously passed; dashboard is deployed through GitHub/Cloudflare; current account suspension is independently managed.

**Snapshot-observed:** 70 workflows, 3,295 nodes and schedule account associations in the October 29 handoff.

**Unverified:** present n8n graph, hidden CFG values, runtime branch/account selection, live Drive folder mapping, Pinterest fetched-result inventory, Telegram account routing and source-specific authorization. Unknown quantities stay null.

## Invariants

- Do not infer producer sources using substring searches on account or workflow names.
- Do not merge stock across workbooks/tabs or apply account-level thresholds to individual creators.
- Every green/amber stock badge must be backed by a successful recent stock snapshot; threshold provenance stays visible.
- Keep input inventories separate from publisher sinks, search query pools, queues, and generation APIs.
- No credential values, complete workflow bodies, encrypted backups, or secret-bearing URLs in repository additions.
- Keep this document and the evidence register updated with relevant code/schema/collector changes.

## Content registry upgrade (November 4, 2026)

Baseline dashboard commit db554c98391e99089b6667f4851175e35ebda685. New content-ledger.js/content-schema.sql hold published post identities, observations, candidate groups, preview-first cleanup plans and the Sheets outbox. Generated Worker includes editable content-view sources and meta-worker.js. Read [CONTENT-UPGRADE.md](../CONTENT-UPGRADE.md), [publisher/deletion workflows](../workflows/README.md) and [Python inventory companion](../server_extensions/README.md) before deployment.

Source-confirmed: strict producer eligibility retained; workflow-schedule timings/links rendered; D1 mapping projection uses meta-posts-to-id; explicit plans can append clickouts URLS; deletion requires a separate configured executor and typed confirmation. The write flag does not grant OAuth scopes. Meta collection is bounded and per-asset/metric partial, not an assertion of complete platform analytics.

Operator-observed at previous checkpoint: successful live Sheets sync, seven stock pools, 1,291 items checked, 70 exported workflows. This evidence does not validate the new content collector. New source remains locally tested only until deployed and verified. Unknown provider permissions, complete publishing-hook coverage and present n8n runtime graphs remain explicit.


## Documentation/configuration follow-up (November 4, 2026)

[Configuration register](../CONFIGURATION-MATRIX.md) lists service-specific
secrets, flags, sheets, credentials and schedules. [Deployment tracker](../DEPLOYMENT-TRACKER.md)
separates the operator-reported local patch/rebuild from unverified rollout.
`wrangler.jsonc` now retains UI-managed ordinary variables via `keep_vars: true`.
The optional cross-repo installer updates the SH01 FastAPI README/handbook,
router assembly, explicit dependency and subsystem docs together. It does not
activate services. Existing `OPS_INGEST_TOKEN` error collection and new companion
`INGEST_TOKEN` are distinct variable names with the same ingestion destination.
Update these registers with non-secret commit/version/runtime evidence.

Installer correction: app.py wiring now uses a validated syntax-tree location,
preserving unrelated local edits. Full-file hashing still protects other code
replacements. A failed validation changes neither selected repository.


## Meta sync setup diagnostics
The sync endpoint exposes only allowlisted error categories. Credential parsing precedes the job-start record, so status=never does not prove that no request reached the Worker. Unknown errors remain generic; credential values and raw exceptions are withheld.


### Meta setup-stage diagnostics
Schema lookup, UUID creation and job claim report fixed failure categories only. Raw exceptions, SQL and credentials remain withheld.


### Job-claim failure detail
Authenticated Meta sync errors include scrubbed job-claim exception messages only. Runtime string values, the parsed Meta token, URLs and credential-shaped strings are removed. No Meta response bodies are included. This diagnostic does not establish provider access.


## Google Sheets request compatibility fix
The direct Sheets adapter uses redirect: manual and rejects HTTP 3xx. Cloudflare Workers rejects redirect: error before sending a request; the previous handler mislabeled this store_network_unavailable. Rebuild and deploy before retrying migration. Keep SHEETS_STORAGE_READY=0 until all table hashes match.


## Sheets collector failure diagnostics
Collector errors are logged before the failure-state storage write and at
the scheduler boundary. Only fixed error categories are emitted; raw
exceptions, credentials and worksheet values are excluded. Worker outcome
`ok` does not establish collector success. Confirm an advancing last_success
and status=ok. This diagnostic change does not repair collection failures.


## Direct Sheets internal snapshot read fix
Internal snapshots read one revision-checked bundle instead of repeatedly
reading entire tables for each 1,000-row transport page. External pagination
and atomic commit guards remain unchanged. Transport logs expose only fixed
categories: subrequest_limit, request_timeout, or fetch_exception; no raw
exceptions, URLs, credentials or row values. Local storage tests passed,
including a 9,037-row snapshot requiring three reads. Live recovery must be
confirmed by an advancing last_success and status=ok.


## Google access-token cache repair
Storage access tokens now have a five-minute cache lifetime. A Google HTTP
401 invalidates the rejected cached token and retries once with refreshed
authentication. Repeated rejection remains an error. No credentials or raw
provider errors are logged. Local storage tests passed, including expiry
and bounded authentication retry; live recovery requires verification.
