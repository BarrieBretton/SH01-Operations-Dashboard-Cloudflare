# Published content, previews, schedules and cleanup

See [CONFIGURATION-MATRIX.md](CONFIGURATION-MATRIX.md) for every runtime setting and [DEPLOYMENT-TRACKER.md](DEPLOYMENT-TRACKER.md) for the staged rollout. The documentation follow-up adds `keep_vars: true` so Git deploys preserve ordinary UI-managed variables.

## What this change delivers

Three main dashboard sections remain: Failures, Producers, and Content & analytics. Content has Library, Compare, Cleanup, and Availability panels. The library has platform badges, preview controls, per-post metadata, filters, and original links. Comparisons show observed totals/intervals and corrections; CSV/SVG exports preserve provenance. Producer schedules come from **workflow-schedule**, with exact timings, run text, account associations and workflow links, labeled Asia/Kolkata. It does not invent a next run from arbitrary sheet text.

D1 stores API-returned IDs, platform/account identity, canonical permalinks, workflow references, metric observations, media fingerprints, candidate groups and explicit cleanup requests. `meta-posts-to-id` is a human-readable projection. Existing `clickouts` remains the deletion-input sheet; its existing `URLS` column is used. Listings read from it are labeled **sheet_listed_unverified** because a row alone cannot prove a deletion succeeded.

## Apply to this dashboard repository

Baseline: `master` commit `db554c98391e99089b6667f4851175e35ebda685`. The Python patch refuses unrecognized edits and creates a local backup. It writes source files only; it does not deploy, edit Sheets, or delete posts.

```powershell
python .\apply_dashboard_content_upgrade.py --check
python .\apply_dashboard_content_upgrade.py
python .\build_ui.py
```

In Cloudflare dashboard, open **Storage & databases → D1 → sh01-operations-dashboard-cloudflare → Console**. Run the complete contents of **content-schema.sql** once. It is additive/repeatable. Existing failure, producer and Meta records remain. Keep `meta-schema.sql` applied from the earlier deployment.

Then stage the files listed in `CONTENT-CHANGED-FILES.txt`, review the staged summary, commit and push. No local Node installation is required; Node tests were run while preparing the patch. The source build is Python-only and the generated Worker is included.

```powershell
$paths = Get-Content .\CONTENT-CHANGED-FILES.txt
foreach ($path in $paths) { git add -- $path }
git diff --cached --stat
git commit -m "Add content registry, previews, schedules and explicit cleanup planning"
git push origin master
```

Wrangler configuration preserves the current Worker/D1 binding and existing ten-minute Sheets cron. It adds a staggered Meta cron at minutes 5,15,25,35,45,55, disabled until `META_SYNC_ENABLED=1`.

## Cloudflare runtime settings

Use **Worker → Settings → Variables and Secrets**, not Git build environment variables. Existing `DB`, `DASHBOARD_TOKEN`, `INGEST_TOKEN`, `META_SYSVAR` and Google credentials remain in use.

| Setting | Effect |
| --- | --- |
| `META_GRAPH_VERSION` | Explicit Graph version. Default `v24.0` preserves the prior project version, not a claim it is latest. Match your verified application capabilities. |
| `META_SYNC_ENABLED=1` | Enable the added bounded incremental Meta cron. Manual **Sync Meta** also works. |
| `GOOGLE_SHEETS_WRITE_ENABLED=1` | Opt in to the dedicated post mapping projection and confirmed clickouts writes. Default is disabled. |
| `N8N_WORKFLOW_BASE_URL` | Optional workflow link base. Defaults to your existing n8n Cloudflare proxy. |

Your Google refresh token must authorize `https://www.googleapis.com/auth/spreadsheets` for writing, and its account must be an editor of the workbook. An existing read-only token may need reconsent through your established OAuth flow. Setting the write flag cannot grant permissions. Keep the same operational workbook ID; do not replace the separate configuration workbook in the handoff notebook.

After deployment, unlock → Content & analytics → Availability → **Set up mapping sheet**. This creates `meta-posts-to-id` if absent, writes its fixed header only when empty, and refuses incompatible existing headers. No existing tab is replaced. **Sync queued Sheet writes** or the ten-minute job mirrors pending records. If writes are disabled, D1 ingestion/analytics still work and the outbox remains visible.

The projection tab is maintained by this service. Do not reorder/delete its rows while a mirror is running. D1 is the durable identity source. `clickouts` uses append with `RAW` values and no formulas. If an append's response is ambiguous, the outbox records `uncertain` and does not automatically resend. Check the actual Sheet/downstream execution before resolving that record; absence of a URL can mean a consumer already removed it. Sheets cannot atomically commit with D1, so this is not an exactly-once distributed transaction.

## Connect publishers and backfill

Import the inactive shared publisher workflow from **workflows/** and bind its Header Auth credential to `X-INGEST-KEY`. Follow [workflows/README.md](workflows/README.md). It accepts normalized publish-result metadata and sends it to `/api/ingest/posts`. Attach it after a successful final publish response. Instagram upload container IDs and Facebook upload sessions are **not** published post IDs. Fetch the final permalink through the platform API when the publish response does not contain one.

`workflows/instrument_publishers.py` takes explicit per-publisher mappings against your own complete workflow export. It preserves existing outgoing connections and adds an independent recording branch. Redacted CFG data and opaque account selectors cannot be reconstructed safely. The patch does **not** silently modify or claim to have instrumented all 70 live n8n workflows. The existing 70-workflow source register remains an October 29 snapshot.

The Meta collector discovers accessible Facebook Pages and their linked Instagram accounts through Facebook Login credentials, accepts a Page-token fallback, and rotates small pages and metric candidates. It retains unsupported/permission errors separately. Each run reports its actual asset, partial status, history flag and candidates. It does not support Instagram Login's separate graph.instagram.com flow in this patch. It is a bounded collection baseline, not Meta Business Suite parity: account demographics, ad insights and every historical growth curve are not supplied. Saved historical rows remain; older snapshots cannot be reconstructed from today's total. API windows, missing pages and unavailable Story permalinks are limitations, not zeros. Preview CDN links can expire; sync to refresh or use Open post. The preview host list is an application allowlist, not an exhaustive official CDN contract.

The optional Python inventory scanner backfills configured own Facebook/Instagram/Tumblr accounts and fingerprints media. See [server_extensions/README.md](server_extensions/README.md). It never scrapes platform websites. Resume returned cursors until the report says discovery is complete, and inspect per-item errors and bounded cache/comparison coverage. Posts with no supported permalink are counted and skipped individually. Large accounts require further batches; a bounded scan is not an assertion of complete lifetime coverage.

## Duplicate candidates and deletion

1. Install the Python scanner in the **existing SH01 FastAPI repo**, bind its separate server secret and configured account registry, then call `/social/inventory/scan` with platform and account ID. Each scan reads provider data and writes metadata/fingerprints to dashboard D1. Only media downloads/temp processing remain on the scanning server.
2. Images and videos never match across types. Image hashes use multiple crops; optional ORB adds geometric crop evidence. Video samples are ordered and duration-aware. These are candidate matches, not perfect equivalence or copyright judgments. Cropping/re-encoding/editing can defeat a lightweight detector.
3. Review a group in Content → Cleanup. Pick a metric, keep count and **explicitly choose best or worst**. Your original example says keep the worst three; both choices are supported and neither is silently selected. With n members and keep-k, the preview names exactly n-k removal links. Equal values use a stable ID tie-break. Missing metrics or already queued members block planning. Lifetime metrics are not adjusted for post age.
4. Confirm the group and exact typed phrase shown by the preview. The queue records intent; the Sheet mirror appends links to `clickouts`. This can trigger your existing deletion workflow. Candidate detection itself never queues or deletes anything.
5. An imported fresh deletion workflow defaults to dry-run, as described in workflows/README.md. Do not run both it and an older clickouts consumer against the same rows without choosing one owner.

For API deletion, copy **social_delete.py** beside **social_inventory.py** in the SH01 repo and include its router after `app = FastAPI(...)`:

```python
from social_inventory import router as social_inventory_router
from social_delete import router as social_delete_router
app.include_router(social_inventory_router)
app.include_router(social_delete_router)
```

`POST /social/posts/delete` accepts `platform`, `permalink`, optional `account_id`, `dry_run` (default true), and `confirmation`. Header: `X-API-KEY: SOCIAL_INVENTORY_API_KEY`. It resolves the ledger mapping, verifies ownership and the remote object, and returns an exact confirmation phrase. Execution additionally requires **SOCIAL_DELETE_ENABLED=1**, **allow_delete:true** on that account's `SOCIAL_ACCOUNTS_JSON` entry, `dry_run:false`, and the exact phrase. Do not enable this during initial deployment. A permission failure is reported without secrets. A read succeeds independently of permission to delete.

Meta's current official generated SDK includes `IGMedia.api_delete()` and Page Post deletion; old blanket claims that Instagram deletion is impossible are outdated. This patch does not claim your Meta version/login/token has the required permissions. Test read-only resolution first. Facebook Page feed-post IDs and video-object IDs differ; the registry preserves the API-returned ID and does not guess one from a permalink. Tumblr uses configured owned blog + post ID. Its deletion cannot remove other people's reblogs. Ambiguous network failure after deletion requires checking the provider before retrying. D1 recovery cannot resurrect a social post deleted at the provider.

## Storage and backups

D1 data is separate from a Worker process. A Worker restart/redeployment does not erase committed rows. D1 provides durable multi-location persistence and always-on Time Travel: 7 days on Free, 30 days on Paid as of November 4, 2026. This is not a guarantee against every data-loss scenario. Accidental updates/deletes, migrations, account/database deletion and expired recovery windows still matter. Google Sheets likewise is not immune to deletion or accidental changes.

Producer stock can be re-read from Sheets. Historical errors, metric sampling curves, duplicate fingerprints and cleanup audit records may be impossible to reconstruct fully. Keep private periodic SQL exports and one before a material migration. Included **backup_d1.py** uses the official Cloudflare export API, requires your Cloudflare account ID/API token, and writes only to ignored `PRIVATE-D1-BACKUPS/`. It does not schedule backups or restore anything. Cloudflare warns export can temporarily block database queries; run at a quiet time and keep a second private copy outside this checkout.

```powershell
python .\backup_d1.py
python .\verify_content.py
```

## Verification and deployment boundaries

Tests cover producer regressions, source/generated alignment, content normalization, ID idempotency, group boundaries, keep policies, stale-plan rejection, quarantined Sheet writes, interval math/corrections, rendering escaping, auth-session races, bounded Meta collection/expired credentials, media fetching and synthetic media fingerprints, publishing graph instrumentation and deletion gates. Fixture values are test-only; production screens show API/Sheet/D1 data or explicit empty states.

No live credentials were available while preparing this change. No migration, remote posting/deletion, Google write, n8n update or deployment was performed. Browser playback and actual provider/account access require your deployed verification; the local runtime did not provide browser QA. `verify_content.py` reads production counts/status without printing values/credentials. A successful read test does not prove unattended cron runs or every external permission.

## Primary references consulted

- https://developers.cloudflare.com/d1/reference/time-travel/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/export/
- https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/igmedia.py
- https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/post.py
- https://github.com/meta/meta-embeds-for-wordpress
- https://github.com/tumblr/docs/blob/master/api.md

Native image/video elements are used for permitted API-returned media URLs; arbitrary embed HTML or external scripts are not injected. Meta's documentation site returned rate limits during research, so exact current delete permission restrictions were not independently verified there. SDK endpoint support is not proof of your token's permission.

### Local test result for this package

80 automated tests passed: 40 Node tests and 40 Python tests (27 inventory/deletion, 10 workflow instrumentation, 3 existing importer). The patch was also checked against the exact baseline, applied, reapplied idempotently, and verified to reject an unrelated local Worker edit. Generated Worker rebuild is idempotent. These are local/mocked/synthetic checks; live validation boundaries above still apply.
