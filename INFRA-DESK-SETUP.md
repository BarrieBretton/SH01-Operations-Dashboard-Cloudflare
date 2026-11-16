# Infrastructure desk and Backblaze file manager

Baseline: Operations desk d70463b9af53705a97e3c8e664e3aa5744f94ec6 and backend
d686f40ec0ed41d63111554612fdf91176f739cf. Implementation date: 16 November 2026.

## Install and deploy

Run the supplied standalone Python patch against BOTH local checkouts. It does not
call production APIs, delete B2 data, commit, push, or deploy. Python 3.11+ is
sufficient; no package install, admin rights, npm, or Wrangler installation needed.
Use --check first, then --apply. It validates all changed files before writing,
refuses mismatched sources, writes backups, and ships rebuilt dashboard.html and
worker.js along with editable source and tests. Reapplying the same patch is a no-op.

After reviewing the diff, deploy the backend through your existing Render/Git
workflow to the control-plane instance(s) and media instance(s) that serve these
URLs, then deploy the desk through its existing Cloudflare/Git workflow. A proxy
response verifies only the instance serving that response, not every standby.

Set these runtime secrets on the OPERATIONS DESK Cloudflare Worker:

| Setting | Value |
| --- | --- |
| CONTROL_PLANE_API_KEY | Existing control-plane key, matching the instance behind infra-control. This is NOT MEDIA_CLIP_API_KEY. |
| MEDIA_CLIP_API_KEY | Existing media key; reuse the desk's value if it already exists. |
| OPS_INFRA_CONTROL_URL | Optional origin override. Default https://infra-control.vivojaymail.workers.dev |
| OPS_INFRA_MEDIA_URL | Optional origin override. Default https://sh01.vivojaymail.workers.dev |

Keep DASHBOARD_TOKEN unchanged. The browser only sends this dashboard credential;
the Worker injects the correctly scoped server key. The bridge allows only the
new inventory/check/list/preview/delete routes, rejects redirects, and cannot
forward failover, migration, arbitrary paths or caller-selected provider URLs.
Missing monitoring keys yield explicit configuration errors. These endpoints work
even if the desk's Sheets storage is unavailable. Existing login currently checks
the Failures API; this patch does not redesign that existing sign-in dependency.

Backend: reuse the existing live INFRA_REGISTRY_JSON and referenced slot secrets.
All registered Render roles, Postgres slots and B2 slots are discovered dynamically.
The special @default B2 slot is available on the control plane only when that
instance has the three BACKBLAZE_* values. It always means that instance's configured
bucket, not an arbitrary caller-supplied bucket. Media-instance default B2 health
is also shown. To manage that media bucket, it must be configured as a matching
control-plane B2 registry slot (or its @default bucket); credentials are not copied
between hosts automatically.

Optional backend OPS_INFRA_LIMITS_JSON adds explicitly operator-defined budgets:
    {"b2:b2-a":{"storage_bytes":10000000000},"postgres:pg-a":{"storage_bytes":500000000},"imagekit":{"storage_bytes":3000000000,"bandwidth_bytes":20000000000}}

These are EXAMPLES, not claims about your plan, pricing, or free allowance. Keys
must match component IDs (b2:<actual-slot>, postgres:<actual-slot>, imagekit).
Measured container RAM limits, filesystem size and Redis maxmemory are detected.
Provider plan quotas are not guessed. ImageKit usage attempts the existing private
key; optional OPS_IMAGEKIT_USAGE_KEY can supply an account usage read key if
standard file access does not include usage. No broad key is required for file health.

No changes to requirements.txt, n8n workflows, schedules, provider retention,
Cloudflare bindings, existing deployment commands, or backend start command.

## Coverage and semantics

| Component | Evidence delivered |
| --- | --- |
| All registry Render n8n + SH01 roles | Direct origin HTTP readiness per role. Does not equate suspended state with a failed probe or assert provider account compute allowance. |
| Responding control-plane and media containers | Raw cgroup RAM including cache, Python RSS, temporary filesystem used/total. Not all processes' RSS summed, and not monthly usage. |
| All registry Supabase/Postgres slots + runtime social database | Read-only connection and pg_database_size; optional operator budget. |
| All registry B2 slots and configured default buckets | Authentication and bounded version-list access. File manager sums loaded upload-version bytes. |
| Cloudflare SH01/n8n routers + KV | Authenticated control status, maintenance and persistence indicator. No route changes. |
| Cloudflare D1 media queue | Authenticated health; not queue consumption progress or account-wide D1 usage. |
| SLA controller/watchdog | Recorded last-check age and consecutive failures. Stale >10 minutes/hard-stop requires attention; does not prove external watchdog deployment. |
| Redis | PING; used_memory/maxmemory if INFO permission is available. Does not acquire the scheduler lock. |
| Google Sheets | Read-only workbook metadata using existing backend credentials. No workbook writes. Local credential-file fallback is not loaded by this monitor. |
| Telegram | getMe authentication check; no chat messages or files fetched. |
| n8n API | One workflow metadata read; no workflow mutation or execution. |
| ImageKit | One file metadata read, plus last 30 complete UTC days of usage when authorized. Usage API may cache for six hours; agency billing can aggregate children. Not necessarily the billing cycle. |
| Kite | User-profile access check; no order, trade, holdings or balance data returned. |
| YouTube, Meta, Threads, Tumblr, X | Configuration inventory only; explicitly unchecked. Meta collection evidence remains in Content & analytics. No token permission/expiry or posting health is inferred. |
| Cloudinary | Historical references explicitly distinguished from current B2 storage. |
| Pulsetic + account-level Cloudflare usage | External/unverified; their live inventories and billing telemetry are not in these repos. |

The donut summary is the fraction of represented components whose current probe
succeeded, not an uptime SLA. Every measured capacity donut retains its numeric
used/limit and source. Unknown limits do not produce a capacity percentage.
Probes are lazy, three at a time, coalesced and cached for 60 seconds per process.
There is no new scheduled polling or background collection. Reads can still consume
provider API transactions and wake a sleeping Render origin. Provider HTTP errors
are sanitized; arbitrary provider payloads, secrets and raw logs are not forwarded.

## Backblaze behavior

Manage files initially reads up to 20 pages of 500 versions (10,000) using metadata
only. The UI remains paginated at 100 displayed rows to keep rendering bounded.
Load next 500 continues larger inventories. Sorting defaults to size descending;
name, ascending size and upload time are also available. Search filters LOADED rows.
Partial results are explicitly labeled and never claimed to be the globally largest
files until pagination finishes. A changing bucket is not an atomic snapshot.

Uploaded versions count toward listed storage. Hide markers and unfinished large
uploads are shown but cannot be deleted in this UI. Prefix-restricted keys stay in
their prefix and do not claim whole-bucket totals. Scanned bytes are not B2 billing
usage; unfinished parts and concurrent uploads may be missing. A capacity donut
appears only when the listing completes and an operator budget is configured.

Select at most ten uploaded versions, click Review deletion, inspect exact names,
sizes and version IDs, then type DELETE <count> in the confirmation dialog.
Listing and preview never delete. Signed listing tickets and confirmation plans
expire after ten minutes and bind slot, current credential scope, bucket and exact
file identities. Changed/rotated settings invalidate old tickets. The backend
checks ownership/identity again immediately before each immutable-version delete.

Required B2 capabilities: listFiles and bucket resolution access (listBuckets for
account-wide keys, or a correctly bucket-restricted key); readFiles and deleteFiles
for deletion. Object lock/retention remains enforced by Backblaze. No bypass flag
is sent. No media file is downloaded or buffered.

Deleting a version is permanent. Deleting the newest version can make an older
version current again. The tool cannot prove that a file is unreferenced by a live
post, saved URL, media job or n8n workflow. Review those dependencies yourself.

Results distinguish deleted, blocked, unknown, and not_attempted. An uncertain
provider delete stops subsequent attempts; the browser disables further deletion
until a fresh listing/review. No automatic deletion retry is made. A repeated exact
version cannot delete a newly uploaded replacement. This is not a durable audit
receipt system: if the connection is lost, re-list to reconcile. Deletes are never
scheduled and are separate from social-post Clickouts deletion.

## Validation and acceptance

Offline validation covers backend authentication separation, wrong-bucket/identity
refusal, tampering/expiry, rotation, duplicate/oversized selections, required typed
confirmation, read-only preview, repeated execution, sanitized errors and unknown
delete outcomes. Worker tests cover routing, credential selection, redirects and
single-attempt mutations. UI-state tests cover sorting, escaping, selection, cancel,
confirmation and session cleanup. Existing dashboard tests are also run.

Run after applying:
    cd <backend>
    python -m unittest discover -s tests -p test_ops_infrastructure.py -v
    cd <desk>
    node --test *.test.mjs
    python build_ui.py

Real browser layout verification was blocked in the authoring environment by
Chromium socket restrictions. Live credentials, deployed endpoints, provider
permissions and production deletions have NOT been tested.

After deployment, unlock the desk and open Infrastructure. Check both inventory
scopes and each serving-instance ID, then validate the displayed slot selection
against the actual controller. Open B2, verify bucket/prefix, review a selection and
cancel first. For an actual delete test, use an expendable test version, confirm
exactly that version and verify the subsequent listing. No destructive test is
necessary merely to enable monitoring.

## References checked

- https://www.backblaze.com/apidocs/b2-authorize-account-2
- https://www.backblaze.com/apidocs/b2-list-file-versions
- https://www.backblaze.com/apidocs/b2-get-file-info
- https://www.backblaze.com/apidocs/b2-delete-file-version
- https://github.com/imagekit-developer/imagekit-nodejs/blob/main/src/resources/accounts/usage.ts
- https://imagekit.io/docs/api-keys
- https://www.kite.trade/docs/connect/v3/user/

## Patch installer v2

The backend app.py and handbook are updated additively: existing code and notes
are preserved. The installer validates a unique top-level infra router registration
before inserting two ops routers, and appends only its own handbook section.
Other patched files retain exact source checks. This supports local backend work
without resetting, pulling, stashing or replacing the full backend files.
