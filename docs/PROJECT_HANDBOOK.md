# Operations Dashboard project handbook

**Current implementation baseline:** dashboard `d628a76` plus this reviewed change; companion server based on `daa29fa`. Deployment is a separate evidence item. Read [implementation and acceptance](IMPLEMENTATION-ACCEPTANCE.md) before operating or continuing development.

## Architecture

The existing Cloudflare Worker serves the authenticated UI and APIs, runs one bounded job per minute tick, and uses revision-guarded Google Sheets storage. The operational workbook also supplies producer stock and optional mapping/clickouts tabs. Source definitions derive from the inspected 70-workflow inventory; live graph configuration remains external. The existing FastAPI service hosts bounded media scanning and explicitly gated deletion. n8n performs publication and can invoke registered child workflows. These systems use different scoped keys.

## Invariants

- Streamables ready means trimmed/case-normalized `staged` AND `yes`, with conflicting statuses rejected. Consumed states, low thresholds and source freshness are separate.
- Stock pools are workbook/tab/account identities. Source inventory counts and API availability do not become eligible stock counts.
- Unknown metrics remain unknown. Media lifetime observations, account reporting windows, profile point-in-time counts and structured breakdowns remain distinct.
- Comparisons use observed snapshots only. Peak/fade labels describe sampled rates; no missing early history is invented.
- Discovery, registration, metric support and backfill exhaustion have separate progress evidence. Collector success alone proves none of them complete.
- Provider tokens remain transient. Diagnostics include static categories, IDs and counts, excluding captions, raw messages, tokens, cursors and URLs.
- Registration accepts final published IDs and canonical links. Publisher mappings require explicit final-output verification.
- Cleanup plans require current group/metric evidence and typed confirmation. The Worker queues links; the companion separately checks ownership, opt-in and execution confirmation. Ambiguous deletion outcomes require manual review.
- Existing optional business-sheet write flags retain their scope. The internal storage write requirement is distinct from optional mapping/clickouts writes.
- Generated `worker.js`/`dashboard.html` must be rebuilt from editable components in the same change.

## Evidence register

**Operator-observed before this change:** producer verifier PASS for seven pools/1,291 items/70 workflow definitions; live-sheet routing; no unavailable optional tab reads. Meta discovery showed 21 assets; later Instagram views/reach refreshed while Facebook insight probes returned code 100. Optional mapping writes were disabled and four outbox items were pending.

**Code/local tests:** see `IMPLEMENTATION-ACCEPTANCE.md` and `TEST-RESULTS.md` for the changed functionality and local checks.

**Unverified:** current deployments, granted permissions, complete real account history, all publisher/error routes, real scanner accuracy/resource use, mirror drain, expired media playback, cleanup completion, unattended operation and isolated live restore. Neither an old screenshot nor a test fixture upgrades these to verified.

## Operational entry points

- `GET /api/meta/status`: safe job/account progress; no token or cursor values.
- `GET /api/meta/coverage`: paged candidate/check matrix including unchecked and stale status.
- `GET /api/meta/account-observations`: bounded account values and latest breakdowns with reporting windows.
- `POST /api/meta/sync`: queue one bounded run; UI polls status for up to five minutes.
- `GET /api/content/preview?...&refresh=1`: refresh a known Meta object's preview from the provider.
- `POST /api/ingest/source-observations`: exact registry-ID evidence from explicitly configured sources.
- Existing content/producer/failure/Sheet APIs retain authentication and storage boundaries.

Do not apply historical D1 initial-setup instructions to an already migrated Worker. The current trigger is `* * * * *`; due times and Meta throttling are documented in the acceptance guide. Keep this handbook and the acceptance record current with code/configuration changes.
