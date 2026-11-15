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

## 2026-11-14 Meta transport correction
Workers rejects redirect:error before sending the request. The shared Graph
helper now uses manual and rejects all 3xx responses without following them
or forwarding credentials. Collection and preview refresh use this helper.
Local targeted tests passed; live recovery requires post-deployment verification.

## Image-first gallery and automatic previews (2026-11-14)
Large 4:5 cropped previews expand smoothly and reveal the complete image on hover or keyboard focus. A small information corner reveals full captions, metrics, identifiers, links and comparison controls; clicking pins details until Hide or Escape. Displayed dates use UTC AM/PM, with relative labels above post times. Touch and reduced-motion users have accessible alternatives. Previews warm within 1800px, two at a time, with nearest-card priority and bounded two-minute caching; videos do not autoplay. Leaving the tab cancels pending work; locking clears cached previews. This does not refresh analytics or fetch additional library pages. 83 local JavaScript tests passed; real-browser visual and fast-scroll acceptance remains pending.

## Preview storage throttling fix (2026-11-14)
Gallery previews reuse safe CDN URLs already returned in library rows. Missing or failed stored URLs use provider refresh, paced at least six seconds apart. A storage rate limit pauses the queue for 60 seconds and permits two retries, followed by an explicit Retry control. Lock/tab exit cancels recovery timers. Local tests cover bypass, pacing and cooldown cancellation; live quota recovery remains to be verified.

## Preview caching, jitter and duplicate acceptance (2026-11-14)
This supersedes the preview rate fix. Preview URLs from the library bypass backend calls; refresh requests are spaced 6–9 seconds apart and rate limiting pauses 60–90 seconds with two retries. Worker instances coalesce preview requests and retain at most 128 entries for up to two minutes, with a 30-second margin when CDN oe expiry is known. Credential/workbook changes isolate entries; errors are evicted; empty results last ten seconds. This is isolate-local, not durable or globally shared. Browser image-byte caching remains provider-controlled. Google read retries add jitter and honor Retry-After when within the 20-second retry budget; longer delays return failure without retrying early. Writes remain unretried until reconciled. No post-list/metric staleness cache was added.
Duplicate tests: exact SHA256, image crop hashes, ordered five-frame videos, duration/blank guards, and real transcoding versus an unrelated scene. Candidates require human review; heavily edited videos and carousels are not comprehensively covered. Live scanner deployment and provider credentials remain unverified.

## Python backend ownership — 14 November 2026
All scanner/deletion/telemetry implementation and runtime collection scripts now live in the existing sh01-fastapi-server repo. Run social scan and Drive collection commands from that repo. The dashboard retains Worker endpoints, UI, workflow templates and build/verification utilities. Historical instructions referencing server_extensions are superseded by this relocation. Deployment and configured credentials still require verification; no live scan or deletion is claimed.

## Automatic Meta scanner integration — 14 November 2026

Code-confirmed: scanner automatically discovers Facebook Pages via me/accounts and me/assigned_pages, and linked Instagram business accounts, from existing FB_PAGE_ACCESS_TOKEN (META_SYSVAR takes precedence if explicitly set; plain token or supported JSON token fields). Discovery follows cursors on the fixed Graph host, is bounded to 20 pages per edge and 45 seconds overall, deduplicates accounts and caches credentials in process memory for at most five minutes (partial results one minute). Errors and unverified completeness remain visible; API permissions can restrict results. No manually maintained SOCIAL_ACCOUNTS_JSON is required for Meta. Explicit legacy account overrides and Tumblr configuration remain supported. Status makes no provider call; authenticated GET /social/inventory/accounts performs discovery.

The scanner defaults to https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev. Explicit INGEST_TOKEN or OPS_INGEST_TOKEN takes precedence. Otherwise MEDIA_CLIP_API_KEY is reused ONLY for that fixed origin. Configure the SAME existing MEDIA_CLIP_API_KEY as a secret once on the dashboard Worker. Worker media-key access is restricted to GET /api/ingest/fingerprints, POST /api/ingest/posts and POST /api/ingest/duplicate-groups. It does not grant dashboard login, deletion-result, resolve-post, telemetry or storage-admin access. Existing ingestion auth continues to work. Deletion auth is unchanged.

FB_PAGE_ACCESS_TOKEN or META_SYSVAR must actually exist on Render for discovery; Cloudflare secrets cannot be read automatically from Render. No secret values are added by the patch. Account status exposes credential presence only, not values. dashboard_configured means local settings exist; dashboard_auth_verified remains false until live access is checked. A failed fingerprint cache check stops scanning before provider media downloads or fingerprint work.

run_meta_scans.py lists discovered accounts by default and prompts for the existing media key. --scan runs one sequential bounded batch (default three posts) per discovered account. Checkpoints live outside the repository under the user's home directory and persist for later runs. Exhausted accounts are skipped; select a new --checkpoint-dir for a new pass after exhaustion. Partial discovery errors remain visible. No automatic schedule is installed. Carousel media remains metadata-only; similarity groups are candidates, not proof of identity.

Local validation: automatic discovery/credential/pagination/cache tests plus existing social tests and dashboard JavaScript tests passed. Operator-observed deployment, live provider permissions, successful ingestion and populated duplicate groups remain unverified for this change. Deploy both repositories, add the existing media key once to Cloudflare, then check status, discovery and a bounded scan. Do not infer all-account/full-history coverage from deployment or unit tests.

## Dashboard-owned scanner catalogue — 15 November 2026

This supersedes the scanner's direct Meta discovery integration above. Existing dashboard collection remains the source of accounts and published posts. Authenticated GET /social/inventory/accounts now reads that stored catalogue; Meta credentials are no longer required on Render for Facebook/Instagram scanning. Existing Meta discovery helpers remain as legacy code; the scanner routes no longer invoke them. Tumblr's explicit legacy configuration is unchanged.

The Worker exposes restricted scanner health/accounts/posts/media/fingerprint endpoints under /api/ingest/scanner/. Existing MEDIA_CLIP_API_KEY authenticates only the exact allowed operations; dashboard login/admin/deletion endpoints remain excluded. Existing INGEST_TOKEN auth is retained. No new secrets or environment values are installed. Account results include stored-post counts and disclose that history coverage depends on dashboard collection. Catalogue pages are limited to 20, filtered by platform/account and published status, with post-ID keyset pagination.

Render requests actual media sources through Cloudflare, where Meta credentials stay. Facebook video thumbnails are not treated as video sources. Images/videos are fingerprinted using the existing bounded algorithm and compared with cached fingerprints. Unsupported/carousel media remains explicit and unavailable originals are not fabricated. Expired CDN 403/404 permits one refresh/retry; refreshed URLs use a bounded isolate-local cache. Similarity groups are candidates, not proof of identical content. Fingerprint-only writes update existing rows without replaying old metrics, modifying captions or creating metric observations/outbox jobs. Generic Facebook POST groups require stored fingerprint classification. No deletion is enabled or performed.

The HTTPS client validates all resolved addresses as public, prefers IPv4 and tries up to four pinned addresses within its connect budget; certificate verification and hostname SNI remain enabled. Authenticated GET /social/inventory/diagnostics returns safe stage/exception/errno information for a fixed dashboard health probe without exposing raw exception messages, credentials, DNS addresses or media URLs. The health probe verifies endpoint auth but not Google Sheets access or media-CDN reachability; accounts checks catalogue storage separately.

Catalogue cursors use a new signed namespace and checkpoint directory, separate from old provider cursors. run_meta_scans.py lists accounts by default; --scan runs one bounded sequential batch per account with collected posts. It resumes checkpoints; a fresh directory starts a new catalogue pass after exhaustion. Catalogue exhaustion is not provider-history exhaustion. Scheduling and automatic browser-triggered scanning are not installed.

Validation: 59 Python backend tests, 97 JavaScript dashboard tests and four dashboard completion tests passed locally. Tests cover catalogue identity/pagination, fingerprint reuse, signed-cursor isolation, actual video-source handling, fingerprint-only persistence, scoped auth and validated-address fallback. Operator observed prior Render Meta calls failing with upstream_transport_error; the actual production transport cause remains unverified until the new diagnostic response. No live scan, provider deletion, deployment or credential change was performed during development.

## Scanner quota recovery

Code: scanner reads and deterministic writes share process-local request pacing and a 75-second minimum storage-rate-limit cooldown, honoring longer Retry-After values. Reads retry transient errors up to three attempts within their budget; permanent errors stop. Every unsuccessful catalogue batch retains its original cursor. The PowerShell runner scripts/run_catalogue_scans.ps1 keeps the existing progress file, waits 75 seconds between batches, retries explicit throttles up to three times with jitter, and stops on ambiguous timeouts or permanent failures. One round is the default; no unattended schedule is installed.

Worker read snapshots coalesce metadata reads for ten seconds, are credential/workbook scoped, and invalidate after fingerprint writes. Writes always revalidate through storage transactions. Other writers may be reflected up to ten seconds later. These are process/isolate-local controls, not a distributed quota coordinator; collector and UI traffic still share Google quota. Operator observed Erika recover after a 75-second pause; global quota headroom and full-catalogue duplicate accuracy remain unverified.

Local regression evidence: 74 backend tests and 99 dashboard tests passed. PowerShell execution is pending the operator Windows run; installer checks support LF and CRLF. No live scan or deployment was performed here.

## Duplicate galleries and refresh provenance

Code: duplicate members now share the Library gallery, lazy lookahead, bounded request queue, preview cache, hover-to-uncrop images, keyboard/touch details and click-to-pin controls. Media stops when navigating away or replacing a group. Original-post links and explicit cleanup confirmation remain available. Known videos do not use still thumbnails as playback; Facebook attachments resolve playable video sources when accessible, with explicitly labelled poster-only fallback. Video availability remains provider/CDN-dependent.

Content request errors stay within their originating tab and clear after successful retry. Requests for hidden content tabs are cancelled only for reads. Producer requests coalesce; stock renders independently of slow/failed source evidence. Producers now distinguish dashboard check time, source collection time, unchanged snapshots and the existing 60-second display polling. Refresh stored data does not queue a source collection; Queue Sheets sync is the separate existing operation.

Verification: 105 JavaScript tests passed, including group cards, video controls, scoped late errors, and partial/coalesced producer refresh. HTML identifiers and panel placement checked. Existing real-video test passed for transcodes versus unrelated scenes; an additional two-second re-encoded sample matched five ordered frame hashes in about 1.3 seconds including local fingerprinting, not a Render performance promise. Chromium visual testing was blocked by the execution environment socket restriction. Live provider playback and user visual acceptance remain pending. No deployment, scan, deletion or credentials changed by this installer.

## Duplicate-group storage pressure and recovery (2026-11-15)

Operator-observed: the duplicate gallery displayed HTTP 503 / store_rate_limited after an earlier successful response with eight groups. This is a failed storage read, not evidence that candidate groups were deleted.

Code-confirmed repair: GET /api/content/groups now takes one consistent snapshot of groups and posts for up to 20 groups, replacing a separate groups read plus one full two-table snapshot per group. Missing-member evidence, platform/account isolation and response limits are preserved. No shared server cache or changed write semantics is introduced.

UI: overlapping refreshes coalesce. A failed refresh retains session-local groups, selection, media and queue entries with an explicit stale notice. Removal planning is blocked until both groups and queue refresh successfully. Rate-limited reads use a 75-second minimum cooldown plus up to 15 seconds jitter (honouring longer Retry-After), with at most two automatic retries. Manual clicks respect the cooldown. Preview backend requests also wait until that cooldown expires. Timers cancel on navigation/lock and do not run while the main view or browser document is hidden. Only reads are retried; confirmation writes remain explicit. A first-load failure is distinguished from a successful empty result.

Local verification: 110 JavaScript tests pass, including a 20-group single-snapshot regression, stale display/plan blocking, recovery, Retry-After, coalescing, bounded retries and cancellation. Existing gallery, video playback, producer freshness and confirmation tests remain passing. Live quota headroom and recovery require checking after Worker deployment; Google quota remains shared with collectors and other requests. No scans, Render changes, credentials or provider deletions were performed.

## Task-local feedback and action hierarchy (2026-11-15)

Operational errors now stay with the affected controls, rather than the page-wide banner: failure filters/pagination, producer stock/source evidence/items/source sync, library filters/pagination, comparison charts, duplicate group loading, keep-plan validation, confirmation, queue reads and Sheet operations. Plan and confirmation feedback are separate from group-refresh messages. Confirmation failures remain visible outside the collapsible confirmation panel. Invalid keep fields are marked with aria-invalid, controls reference their messages with aria-describedby, and feedback uses polite live regions. Successful retries clear only the associated action feedback; editing keep inputs invalidates old plan errors, including late failures. Lock clears private feedback. Session-wide notices retain the top banner.

Exports and less frequent operations use labelled native disclosures. Meta collection is in Collection & sync; producer source sync/export is beside stock refresh, with collection versus stored-refresh explanations. Workflow source evidence is expandable. Comparison exports are expandable and Library comparison actions appear only after selection. Duplicates use Review / Choose what stays / Track queued links sections with the keep controls, explanation and local errors in one panel. Existing gallery previews, keyboard/touch details, source collection timestamps, ranking rules and typed confirmation remain intact. No server/API contracts, write flags or retry budgets changed.

Verification: 116 JavaScript tests pass, including local validation and server failures, confirmation failure visibility, pagination, independent action errors, disclosure recovery, lock cleanup and obsolete-plan errors. Generated HTML has 155 unique IDs, balanced tags, valid described-by references and checked feedback containment. Chromium launch is blocked by this execution environment; browser layout, mobile appearance and operator visual acceptance remain pending. No live deployment or scan was performed during development.

## Unified visual duplicate planning (2026-11-15)

This update supersedes the unapplied apply_desk_ux.py package and includes its task-local feedback and quieter controls. Candidate cards are now the only post-level plan preview. Keep/rank/display-order controls sit above the gallery; proposed keep/removal decisions are text-labelled and green/red bordered on those same cards. Confirmed removal states use amber labels; previously kept members explicitly say Kept in confirmed plan. The footer contains the summary, warning and typed confirmation only, without a second list of posts. Cancelling/changing a preview clears proposed marks; expired previews cannot confirm and are labelled expired. Sorting moves existing card elements rather than refetching media. Native moveBefore is used when available, with a DOM insertion fallback. Browser playback continuity remains a live visual check.

All Library and candidate cards display platform and views/likes/comments/shares above the media. Candidate cards also highlight the ranking metric (showing an extra metric if necessary), display order and recorded decision state. Unknown counts remain Unknown. Captions, identity metadata and other details remain in the hover/pinnable information corner. Platform filtering and platform/account optgroups make the existing same-platform-and-account grouping boundary explicit; a post appearing once on Facebook and once on Instagram is not a duplicate pair.

GET /api/content/groups reads groups, posts, persisted cleanup plans and deletion queue together in one snapshot, with no per-group storage reads. It annotates members using exact platform/account/post identity and committed plans only. Confirmed timestamps are recorded inside the existing plan payload, so no schema migration is needed. Legacy committed plans derive their confirmation timestamp from matching queued records when possible; otherwise it stays unknown. Expired confirmation windows do not erase committed decisions. Read annotations are excluded from the existing planning digest so final transaction validation remains unchanged. Previously queued members block another plan and duplicate queue writes remain rejected by the backend.

Removal scheduling is not present in the stored queue schema or this update. Queue creation and plan expiry are not removal dates. Cards show Removal date not reported for queued items, and Deletion reported only for recorded deleted status. The display can format a genuine removal timestamp if later supplied, but this release returns null and never invents a countdown or schedules deletions. Keeping is a recorded decision, not a future job.

Local evidence: 121 dashboard JavaScript tests pass, including persisted decisions across fresh reads/expired confirmation windows, legacy history, platform/account isolation, one-snapshot reads, visible metrics, authoritative plan highlighting, display sorting without API calls, cancellation, expiry and unknown scheduling. HTML has 157 unique IDs, balanced tags and checked feedback containment. Browser visual verification remains blocked by the execution environment. No provider calls, scans, deletions, deployment or credential changes were performed.

## Weighted duplicate ranking (2026-11-15)

Baseline verified against the remote master files after operator-reported commit e8f7cbc. The duplicate review Rank by selector now defaults to Weighted score: Views × 1 + Likes × 10. Score settings accepts whole-number view/like weights from 0 to 1,000, with at least one positive. Zero explicitly excludes that metric. Page loads start at the defaults; edits remain in the current page. Views, likes, comments and shares remain visible and individual metric ranking remains available. The score is a user-selected preference, not a provider insight or a normalized engagement rate; lifetime totals can favour older posts. It works on eligible image, video and Reel groups with the required observed metrics, retaining same-platform/account boundaries.

Card scores, local ascending/descending ordering and best/worst top-K keep planning use the same weighted sum. Unknown required metrics are Unavailable, sorted last, and block planning for the whole group. Missing values never become zero or get silently excluded. Invalid/nonfinite/negative inputs and unsafe score magnitudes are rejected. Equal values use deterministic post-ID order. Weight edits immediately invalidate a pending/unconfirmed preview and typed confirmation, without calling an API or replacing media elements. Weight controls are disabled during confirmation.

The backend stores the weights, formula version, input metrics and each member's score inside the existing cleanup-plan payload. During preview, gallery ranking values use that backend snapshot, including when metrics changed after the group first loaded. After confirmation, group history exposes each member's original recorded score and formula independently of newer metrics/current settings. Legacy plans retain their original decisions without fabricated historical scores. Existing source-digest validation, typed confirmation, write flags, platform/account isolation and one-snapshot group reads remain enforced. No extra storage reads or provider calls are needed for score calculations; no score observations are added to provider metric series. No schema, Render or credential change is required.

Local verification: 132 JavaScript tests pass, including UI/backend score parity, highest/lowest/custom weights, zero versus missing values, invalid settings, plan snapshot display, late response invalidation, saved score history, stale-metric protection and previous regression coverage. HTML checks pass with 161 unique IDs, balanced tags and valid feedback references. The guarded installer is checked against both LF and CRLF baselines, including atomic conflict rejection and repeated application. Browser layout and live Worker behaviour remain unverified in this environment. This package has not been deployed by the assistant.

Operator check after deployment: open Duplicates & queue, choose a group with known views and likes, verify Weighted score and its formula, change a weight and inspect the local order, then preview an explicit keep count. The same cards must show the planned keep/removal marks and plan snapshot scores. A weight edit must retract the unconfirmed plan. Do not confirm a removal just to test scoring; confirmation queues real clickouts links.

## Consistent loading indicators (2026-11-15)

Baseline: all inspected remote master UI/source files matched the local weighted-ranking version before this change. The UI now shows CSS spinners and action-specific loading labels for unlock/session restoration, failure queries and pagination, producer stock/source evidence/schedules/items, source-sync submission, Library/filter/page reads, comparison series, duplicate groups and queue reads, keep-plan generation, confirmation plus its queue refresh, availability/account/coverage reads, Meta collection requests/progress and optional Sheet operations. Buttons and relevant navigation tabs animate during their requests. Already displayed data stays available during refresh. Indicators do not change source collection timestamps or imply new source data was collected.

Request indicators track overlapping work independently. An older aborted, superseded or completed request cannot remove a newer request's spinner. Finally blocks release indicators on HTTP/transport/timeout failures; locking clears private activity and aborts requests. The direct source-sync POST now has a 25-second abort deadline with local outcome-unknown feedback. Automatic duplicate-read rate-limit cooldowns visibly say they are waiting for a scheduled retry and cancel on navigation/lock. Reported queued/running collector states have separate labelled indicators; these are the last reported backend state, not proof of ongoing browser requests or successful collection.

Each nearby media card displays queued, paced/waiting, availability-checking and actual image/video loading states. Cached/stored media still shows loading until the browser reports ready. Video waiting/stalled events show Buffering video; playing/canplay/pause/end/error clear it. Closed, replaced or cancelled media cannot restart a spinner via late events. The bounded initial media wait returns a visible retry state on timeout instead of leaving a blank card. Failed previews retain retry/original-post options. Existing lookahead, concurrency, cache and request pacing remain; animations add no provider/API calls. Local sorting/filtering that completes synchronously does not introduce artificial loading delays.

Loading labels use status/live-region semantics, busy controls expose aria-busy, and media exposes its current loading state. CSS honours prefers-reduced-motion with a stationary indicator plus readable text. No icon library, package install or external loading image is required.

Local evidence: 141 JavaScript tests pass. Added coverage includes all request-to-indicator mappings, overlapping and superseded requests, timeout/lock/replacement-session cleanup, slow producer evidence, rate-limit waiting, CDN image loading/error/timeout, video buffering and closed-media events, and preview cancellation. HTML has 181 unique IDs, balanced tags and valid feedback references. Guarded installer checks cover LF/CRLF, atomic conflict rejection and repeat application. Browser visual verification and live deployment remain unverified here; no scans, provider deletions, credential changes or deployment were performed.

Operator visual check after deployment: reload the dashboard; unlock and refresh each main tab, paginate where available, open producer items, load a comparison chart, refresh groups/queue and preview a keep plan. Each pending action should show a nearby animated indicator; existing rows should remain visible while refreshing. Scroll to fresh media cards and play a video to inspect preview/buffering states. Normal completion, an error, navigation or locking should not leave an active request spinner behind. Queue confirmation is not required to test visual loading.

## Staged approval backlog and inline eligible items (2026-11-15)

Baseline: the inspected remote master files matched the weighted-ranking and loading-indicator updates. Previously, staged rows whose approved value was not yes were included in Other; item inspection used a separate panel. The stock collector now stores an approval breakdown in each existing group JSON payload, with no table/schema or credential changes. Awaiting approval means a nonconflicting staged status and an approved value other than yes, using the existing trimmed, case-insensitive normalization. Explicit no, blank and other non-yes values have separate counts. Uploaded/consumed rows, nonstaged rows and status/state conflicts are excluded. Eligibility remains staged AND approved=yes; policy version 2 is unchanged. These are source Sheet observations, not verification that the corresponding B2 object exists.

Producers shows eligible and awaiting-approval item KPIs, a per-account/source approval column, approval subtotals, an awaiting-approval filter, an approval-count sort and the breakdown in CSV export. KPIs cover all loaded stock pools, independently of table filters. Older snapshots without the new breakdown show Not collected yet/Unknown, never a fabricated zero. A successful Queue Sheets sync collects the new fields. Manually changing a reviewed row from approved=no to yes moves it into eligible on the next successful source collection if it remains staged; a workflow may instead consume it before collection. A failed collection retains the last known counts and marks freshness separately. Source links also recognize the Sheet URL column, with the existing URL validation retained.

Each positive-eligible account/source row expands inline into its exact eligible items, including source tab/row, creator/handle, source link, status and approval. Zero or unknown eligibility has no expansion control. The existing items endpoint supports eligibility=ready and filters before pagination; its default all-items behavior remains compatible with verification tools. Each request stays pinned to the displayed snapshot and pool, returning at most 200 items. A 21-item pool displays all 21 on first expansion; larger pools use Load more within the same hierarchy. No per-item provider calls, thumbnail requests or approval mutations are introduced.

The browser loads items only when a row is expanded, caches pages for that pool/snapshot, and reuses them on collapse/reopen. A new snapshot invalidates old children and offers an explicit reload; automatic dashboard checks do not fetch item pages. Collapse aborts pending item reads. Local loading indicators, busy state, errors and retry controls remain beside that account's items. Pagination errors preserve already loaded pages. Snapshot/count mismatches, duplicate rows and unexpected eligibility are rejected. Locking clears the hierarchy and cache; obsolete responses cannot repaint a new session or stop a newer indicator. The read-only producer verifier checks the approval breakdown using its existing paced traversal, without adding requests.

Local verification: 152 JavaScript tests pass, covering normalization and exclusions, manual approval and consumption transitions, failed-collection preservation, legacy snapshots, eligible pagination beyond 200 items, pool/snapshot isolation, 21-item expansion, cache reuse, local failure/retry/timeout, collapse/late responses and lock cleanup. Existing weighted ranking and loading tests remain included. HTML has 173 unique IDs, balanced tags and valid feedback references. The guarded installer checks LF/CRLF, atomic conflict rejection and repeated application. Browser visual verification and live deployment remain pending; no Sheet approvals, scans, deletions or deployment were performed here.

Operator check: after deployment, queue one Sheets sync and wait for successful source collection. Refresh stored data, verify the approval counts, expand a positive eligible pool and compare its source row numbers with staged/yes rows in the Sheet. A zero-eligible pool must not expand. Reopening an unchanged pool should reuse its loaded items. After a manual approval and another successful collection, the awaiting count should decrease and eligible should increase if the workflow has not already consumed the row.

## Active sessions and inactivity expiry (2026-11-15)

Operator-reported: the desk logged out during active use. Code-confirmed cause: saveSession set an absolute deadline 30 minutes after login, and activity never extended it. Both the timer and request guards used that fixed deadline. The inspected remote dashboard/Worker matched the producer-approval update before this fix; a particular production logout reason was not captured in a browser trace.

The browser now locks after 30 minutes without trusted pointer, keyboard, wheel, touch, click or input activity in the visible, unlocked tab. User interaction updates the in-memory deadline immediately; sessionStorage writes are coalesced to once per second during continuous input, with the latest deadline flushed on visibility/page lifecycle changes. No keepalive/API requests are added. Automatic polling, API responses, scripted events, merely switching focus and hidden-tab events do not extend the session. The header says Auto-lock in N min; login text explains the inactivity policy. There is no fixed 30-minute ceiling during continued interaction.

Reload restores the remaining deadline rather than starting another 30-minute window. Timeout callbacks recheck the current deadline and authentication epoch, so an obsolete callback cannot lock an extended/replacement session. Expiry is also checked on visibility/pageshow, the status interval and API requests to cover sleeping laptops and throttled background timers. Expired sessions cannot be revived by a late input. Manual Lock and rejected credentials still clear private data, cancel requests and remove the stored session. Storage errors cannot prevent in-memory locking. Late login/restore completions cannot reopen a locked session.

A temporary failure to read stored failures during reload now displays local request feedback while retaining a still-valid session. An HTTP 401 still locks it. This avoids reporting a storage 503 as an expired or rejected credential. The existing per-tab token storage and server authentication remain unchanged; this update needs no new secret, schema, source sync or Render deployment.

Local verification: 160 JavaScript tests and four Python completion tests pass. Controlled clock/input/network fixtures run against the built dashboard, covering activity beyond the old 30-minute limit, all registered input types, actual inactivity, automatic/synthetic/hidden activity exclusion, reload/deadline persistence, coalesced storage writes, storage failures, laptop-sleep expiry, stale timers, lock and HTTP 401, temporary restore errors, and late login/restore completion. HTML structure checks pass. The guarded installer verifies LF/CRLF, repeated application and conflict rejection before any writes. Browser visual verification and live deployment are still operator checks.

Operator check after deployment: hard reload, unlock once, interact with any desk view and observe Auto-lock in N min reset to 30. Continued interaction beyond 30 minutes after login must keep it unlocked. Leaving it untouched for 30 minutes must lock it. No Sheet sync is needed for this session fix.

## Post comments and persistent previews — 15 November 2026

This supersedes the short-lived preview-cache descriptions above for the new
Library and duplicate-gallery clients. No new binding, environment variable,
Python service, schema or content write permission is required.

**Code-confirmed:** Read-only Facebook/Instagram comment threads are available
inside the existing hover/pinned information panels, with scrollable text and
expandable replies. Library compact rows, Compare selections and identity-mapped
queue entries also expose comment disclosures. Unmapped clickouts links remain
external links; account identity is not inferred from a URL. Opening information
for 500 ms (or pinning it) loads comments, 20 at a time. Replies load only on
request; Load more follows signed, post-bound cursors on fixed Graph endpoints.
No posting, replying, moderation, inbox synchronization or full Business Suite
parity is claimed. API privacy, permissions and deleted content can limit the
returned thread; unavailable is distinguished from an empty accessible page.
Author names can be unavailable. Text is escaped, with relative ages and AM/PM
UTC timestamps. Threads show collection time and the next refresh time.

Comment pages are cached for five minutes, including explicit permission failures.
There is no periodic comment polling or full-thread background crawl. Opening a
panel after expiry or pressing Refresh comments revalidates; repeated refreshes
inside that window reuse the page. Requests serialize in the browser, and failures
appear inside that post's panel. Transient throttles set a shared browser cooldown
of at least 75 seconds plus jitter, honoring longer Retry-After values. Graph
short retries now have jitter and honor Retry-After; waits beyond five seconds or
the request budget return a retryable response rather than retrying early.

The authenticated `/api/content/media` POST caches image bytes in Cloudflare's
Cache API for up to 24 hours, keyed by workbook, credential scope, post identity
and media revision. This is best-effort, data-center-local shared caching, not
permanent storage or global replication. Identical signed URLs changing only
query parameters do not invalidate an unchanged image. Images changing bytes at
the same URL path can remain stale for at most the TTL. MIME, HTTPS CDN allowlists,
redirect targets and an 8 MiB streamed size limit apply. Images exceeding the cap
show an explicit error and retain the original-post link. Signed media tickets
avoid a Sheets lookup for each preview; dashboard authentication remains mandatory
before any cache access. Tickets expire after six hours; refresh the library/group
if requested. Auth/workbook/provider credential rotation isolates cache entries.
No provider token is stored in tickets or persistent caches. Transient page access
tokens are retained only in Worker memory for at most five minutes.

The browser stores AES-GCM-encrypted image bytes, video URL descriptors and comment
pages in IndexedDB, bounded to 160 entries / 64 MiB, with expired/oldest entries
evicted on writes. Encryption keys derive from the current dashboard credential
and cache scope; credentials and plaintext media/comments are not written to the
cache. Reloads and later logins in the same browser reuse unexpired records.
Browser eviction/private mode or denied storage can prevent persistence. Local
caches are not shared between browsers; another browser may benefit from the
Cloudflare cache. Hard reloads still refresh the library's current stored metadata
and metrics. Lock clears decrypted state, pending requests and object URLs while
retaining encrypted records. Late responses cannot repaint a new session.
The library's Dates/layout/cache/export disclosure has a cache-clear action.

Videos/Reels use cached source descriptors (up to 30 minutes, bounded by a known
signed-URL expiry). Full videos are not prefetched or persisted: controls use
preload=none, stream on play, and show a spinner when buffering. Stored posters
may be shown where supplied; a poster is never presented as playable video.
A failed video's explicit Retry requests a provider refresh, coalesced/cached for
60 seconds and replacing the ordinary descriptor. Provider refreshes retain
browser pacing. No automatic extra Meta account collection is added.

**Local validation:** 179 JavaScript tests and four Python completion tests passed. Tests cover credential/ticket isolation, fixed
pagination paths, unavailable permissions, escaping, reply paging, edge reuse
across simulated isolates, encrypted browser reuse across simulated reloads,
expiry/corruption, byte/count caps, redirects, video recovery, cooldowns and
lock/late-response behavior. Existing dashboard suites and Python completion
checks are also run. A real Chromium session could not start in this environment
(socket permission restriction); desktop/mobile visual checks remain pending.

**Unverified live:** deployed build, actual comment grants and completeness,
Cloudflare cache-hit rate, browser quota behavior and real CDN playback. The
previous screenshots prove neither this deployment nor these new permission
checks. After deployment: open one Library info panel, pin it, load replies; open
another post and verify isolation. Reload twice and inspect Network: already
cached images should not POST /api/content/media again until expiry (unless the
browser cleared storage). First-load images still download; cache population
cannot eliminate that. Lock/unlock and verify private content clears while locked.
Check both Library and duplicate groups. Verify a Reel loads on Play and its
buffering indicator stops. This patch does not change scanner schedules,
duplicate ranking, approval eligibility, cleanup confirmations or deletion flags.

## Preview waiting status and queue correction — 15 November 2026

Code inspection found a global queue gate at previewNextRequest. Both normal
6–9 second provider-refresh spacing and longer storage/service cooldowns stopped
all queued cards before their local cache could be checked. The generic waiting
message did not distinguish either cause. This can explain long preview waits;
it does not identify which live request caused an individual operator's delay.

The browser now schedules each delayed job separately, leaving its two available
preview slots free for other cards. Local encrypted-cache hits, in-memory hits
and directly usable stored media can display during a network cooldown. Jobs
that need a deferred API request retain their retry deadline, nearest-card
priority, cancellation and at most two automatic retries of actual failures.
Checking cached entries does not issue a provider request. First-time downloads
and expired/missing links can still require network work and deliberate pacing.

Waiting cards show a per-second countdown and distinguish normal request spacing,
storage rate limiting, provider rate limiting and a busy preview service. Longer
Retry-After deadlines remain enforced. Tab exit and lock cancel countdown timers;
late responses remain guarded. Comment-triggered service cooldowns also carry
an explicit reason, and affected preview jobs wait instead of displaying a
permanent error during that temporary cooldown. No scheduler interval, backend
quota, credential or persistent-cache lifetime is changed.

Local tests exercise cached cards passing a waiting network card, countdown
updates without early requests, bounded retries, persistent-cache reuse during
a cooldown and cancellation. Deployment and live timing measurements remain
operator checks. This change supplements the preceding comments/cache patch.

## Readable account and duplicate-group labels — 15 November 2026

Duplicate selectors now group by platform and a readable account name, with labels
such as "Instagram · @username · Group 1 · 7 photos · Previously confirmed".
Group numbers remain stable when the loaded result is reordered or filtered;
they are presentation labels for the current loaded set, not permanent IDs.
Accounts with identical display names remain separate. Internal platform,
account ID and group ID continue to identify every selection and cleanup plan.
Raw IDs remain available in the collapsed similarity evidence details.

The groups and Library endpoints attach display-only account names from the
exact platform/account match in meta_assets, with a stored post name as fallback.
The asset table is read in the same batched snapshot, without per-card storage
requests or provider calls on dropdown render. Name changes do not mutate post
identity or invalidate the metric/source digest of an existing cleanup plan.
The same label helper is used in gallery details, account filters, Compare,
duplicate member tables and queue rows where an account can be resolved.

Instagram discovery previously copied the linked Facebook Page's name. The
existing discovery request now asks for the linked Instagram user's username
and name and stores the returned handle/display name. It does not add one
profile request per account. If optional fields receive Graph error 100/200,
discovery falls back to the preceding field list and suppresses that optional
expansion for 24 hours. Other failures retain their existing handling. A stored
legacy name is retained until a real profile name is returned; the selected
group explains this fallback. Missing names are shown as "Account name
unavailable", never silently substituted with a numeric account ID.

The combined installer includes the preceding unapplied preview-wait correction
and these account/group label changes. It retains the existing comments and
persistent-preview cache implementation. No new environment variables, bindings,
Python services or scanner changes are required.

Validation covers name escaping, platform/account isolation, duplicate display
names, filtering/reorder selection stability, matched asset enrichment, plan
identity through a rename, actual Instagram profile fields and graceful optional
field fallback. All 190 JavaScript tests and four Python completion tests passed;
the built HTML has 175 unique IDs and passes the existing structure checks.
Live deployment and actual Meta field permissions remain operator checks. After
deployment, refresh groups; a successful subsequent Meta discovery will supply
the actual Instagram username when the provider permits it.

## Automatic similarity scanning — 15 November 2026

This supersedes the earlier manual-only scan scheduling instructions. The existing
Cloudflare minute cron now includes a bounded `similarity_scan` job alongside
Sheets and Meta collection. The scheduler still chooses one due job per invocation
and orders jobs by their last attempt. Automatic matching is enabled by the
existing `META_SYNC_ENABLED=1` and `MEDIA_CLIP_API_KEY` settings; no additional
secret, binding, schema, service or desktop scheduler is introduced. The live
Cloudflare cron must be configured and both repository updates must be deployed.

The job selects up to two published, unfingerprinted IMAGE/VIDEO/REELS/Facebook
POST records in one platform/account, rotating between accounts. It calls the
existing SH01 router's authenticated FastAPI scanner, using explicit post IDs.
Already-fingerprinted posts are not re-downloaded just to walk a checkpoint;
matching still uses cached fingerprints from that account. Carousels, stories,
non-Meta platforms and unpublished rows are excluded from automatic selection.
Existing manual scan tools remain available for recovery, but are not required
for ongoing scans. Future collected posts automatically become eligible.

A batch and ten-minute exclusive lease are saved in existing Sheets job/state
rows before dispatch. Persisted batches also cover fingerprints saved before a
group-save failure. They are replayed until the backend acknowledges the exact
requested count, targeted mode and non-truncated matching. Confirmed completion
removes that pending batch. The active lease prevents simultaneous automatic
batches across Worker invocations; FastAPI retains its process-local scan lock.
An unconfirmed network response retains the batch and waits at least ten minutes.
Storage throttles honor Retry-After with jitter and at least 75 seconds; other
failed batches back off up to six hours without starving other pending posts.
Auth/version mismatch backs off for at least one hour. At most 50 failed batches
are retained before admitting additional work. Idle scans check again after five
minutes, and other due jobs can delay dispatch further. Existing Google quotas
remain shared; this is not a promise of instantaneous or full provider coverage.

Targeted scanner requests cannot include a cursor. They require an exact list
of published post IDs belonging to the requested platform/account and an equal
max_posts value. Missing or unexpected returned IDs fail explicitly. The response
labels targeted completion separately from catalogue/history exhaustion. Deploy
FastAPI first: an older backend rejects the additional field and is reported as
an update-required retry rather than silently scanning different posts.

Collection & sync now loads the durable background job state when opened.
Duplicate-group details show supported stored posts, fingerprinted posts and the
remaining count, using the existing groups snapshot. No per-card coverage request
is made. The group selector suppresses strict subsets when a larger stored group
has the same platform, account, media type, fingerprint algorithm and complete-link
algorithm version. Stored historical groups, confirmed plans and queue records
remain intact; previous post-level decisions still appear in the larger group.
No cleanup plan, clickouts entry, publication or deletion is generated by this job.

Code and local tests cover selection, account rotation, durable retry after partial
save, response loss, completion-persistence failure, lease races, transaction retry,
old backend rejection, quota floors, later arrivals, targeted catalogue identity,
coverage labels and historical group preservation. Live deployed execution,
Render cold-start behavior, current Google quota headroom and all-19-post matching
remain unverified. Operator's latest observed Aand Cut counts were 50 published
catalogue posts and eight fingerprints. After deployment, confirm the pending count
falls over time with the browser closed, and inspect failures under Collection &
sync. The fingerprint queue covers stored supported posts, not inaccessible or
uncollected Instagram history.

Final local validation: 204 dashboard JavaScript tests, 73 backend scanner/auth/retry/video tests and four dashboard Python completion tests passed. Built HTML validation passed with 176 unique IDs. A real browser/rendering session and live scheduled execution were not available in this development environment.

## Account catch-up and scan throughput — 15 November 2026

Operator-observed: automatic scanning is enabled and a batch for Erika Devereux
succeeded, while Aand Cut still reported eight fingerprints out of 50 eligible
stored posts, 42 pending, and incomplete provider history. This does not identify
a live account-specific failure. Code inspection confirmed the two-post global
batch limit and account rotation could make initial catch-up take hours.

Automatic batches now contain up to eight posts in one platform/account. The
existing 120-second default media budget, byte limits, ten-minute lease, failure
replay, 75-second minimum cooldown with jitter and one scheduler job per invocation
remain. Larger batches are a throughput improvement, not a completion-time promise.
Partial saves remain replayable and cached fingerprints avoid repeat downloads.

POST /api/content/scan, authenticated with the existing dashboard unlock token,
requests durable catch-up priority for an account with eligible stored posts.
It does not scan during the request, collect missing provider history, queue
clickouts or delete posts. Repeated requests for the same account are idempotent.
Priority survives browser closure and deployment restart, yields one ready batch
to another account after three priority batches, and clears when no missing
fingerprints or saved retry batches remain for that account. Existing cooldowns
and leases cannot be bypassed. Requesting a different account replaces the focus.
A failed account batch does not block eligible work on other accounts.

The group gallery offers Prioritise this account next to its coverage, with local
loading/error feedback. Group reads now include the selected account's last batch
result and retry count from the same storage snapshot. The global last-success
message must not be interpreted as that selected account's progress. No recurring
browser polling was added. No new secret, environment variable or storage schema
is required. The existing media credential cannot call this dashboard action.

Targeted scanner catalogue responses can carry safe stored image/video originals
from the existing snapshot. Video thumbnails and unclassified Facebook POST
previews are excluded. The companion scanner reuses these descriptors instead
of making a separate storage-backed media-resolution request for every post.
Expired originals still receive at most one provider refresh after CDN 403/404.
Provider credentials are never exposed; direct CDN downloads retain host, DNS,
public-address, byte-budget and TLS validation.

Local regression checks cover eight-item batching, durable priority, fair rotation,
cooldown preservation, original URL reuse, expired URL refresh, auth scope,
request payloads, loading states and locked-session races. Nineteen synthetic
identical video fingerprints form one group across 8/8/3 batches. Actual all-19
provider collection, live quota headroom and real-media matching remain unverified.

Catch-up validation: 211 dashboard JavaScript tests, 61 backend scanner/auth/retry/video tests and four dashboard Python completion tests passed locally. Live all-19 matching is still an operator check.

## Storage quota reduction — 15 November 2026

Operator-observed: Aand Cut advanced to 12 of 50 stored supported posts with
fingerprints and a six-video candidate group, while group refresh reported
store_rate_limited and one account batch awaiting retry. This is evidence of
storage throttling, not proof of a Render memory restart or slow video matching.

Measured locally against the previous adapter: a normal changed transaction
used seven Google Sheets reads and one atomic write. It now uses four reads
and one write, a 43% reduction in reads for that path. The raw snapshot is retained
privately for that transaction's commit preparation, instead of reading the same
tables twice. Before/after revision checks, a fresh metadata guard check, atomic
named-range guard rotation, request digests, response-loss reconciliation and
conflict retries remain. Imported commits still read their own fresh snapshot.
There is no storage schema change or new environment variable.

Identical simultaneous reads within the same environment share an in-flight
snapshot and receive independent copies. No completed snapshot cache or TTL is
introduced. Different table sets/environments do not share data, failed reads
are evicted, and writes invalidate in-flight sharing for subsequent requests.

An explicit Google 429 (or documented 403 per-user rate-limit reason) now ends
the request immediately with a safe store_rate_limited error. A 75-second minimum
cooldown with jitter and any longer Retry-After is shared inside the Worker
isolate across the same OAuth credential/project, including different workbooks.
Only a credential digest keys this bounded map. Further requests in that scope
fail locally until the cooldown expires. An explicitly quota-rejected write does
not launch immediate reconciliation reads or retries; ambiguous network outcomes
still reconcile. Other transient read failures retain bounded jittered retries.
The main API error handler propagates Retry-After so the existing gallery and
scanner can respect the actual delay. Authentication still precedes storage.

This coordination is best-effort within one Worker isolate, not a global quota
manager across Cloudflare regions, independent deployments or other applications.
Cold isolates, other jobs using the Google credentials, larger workloads and
provider limits can still throttle. Existing scanner backoffs and leases remain;
the patch does not bypass them or change the video comparison algorithm.

Local validation: 220 JavaScript tests and four Python completion tests passed.
Focused tests measure request counts, in-flight sharing/eviction/isolation,
concurrent commit recovery, quota-rejected writes, credential-scoped cooldowns,
numeric/date Retry-After and authenticated runtime propagation. Existing tests
cover stale atomic batches, lost responses, exclusive leases and duplicate queue
identities. Live quota reduction and all-19-post matching require deployment and
operator observation; no live scans or deletions were performed during validation.

## Queue gallery and video thumbnail repair — 15 November 2026

Operator-observed: Aand Cut now shows a 20-video candidate group and coverage of
44/50 supported stored posts, with six pending. This confirms further scanner
progress; it does not establish complete provider history. The deletion queue
shows nine entries and mirror failure google_http_400. That generic error may
originate in OAuth or a Sheets read; the screenshot does not identify which.
Dashboard queue persistence is not confirmation of clickouts delivery or deletion.

Code-confirmed causes: the deletion queue rendered only a table, and video cards
had preload=none with no poster when their stored preview URL was the video.
The collector already stores thumbnails in meta_content, but these were not
joined into the library/group display. Meta preview refresh also dropped the
thumbnail when returning the playable video source.

The library, groups and queue now join thumbnails by exact platform, account and
post identity. Those joins use their existing batched storage snapshots. The queue
uses one snapshot for posts, account names, thumbnails, queue rows, mirror status
and collected clickouts evidence, replacing separate reads. Queue status and
queued timestamps remain authoritative. Unmapped Sheet links and missing/deleted
posts show explicit unavailable states; no identity or thumbnail is guessed.

Queued posts use the shared gallery with platform, metrics, status, queued time,
information hover/pin, comments and original-post links. The detailed queue table
is under a disclosure. Gallery IDs are distinct from group/library IDs. Nearby
previews retain two-job concurrency and existing cooldowns, and lock clears the
new gallery and prevents late media responses from repainting it.

POST /api/content/poster uses the existing dashboard authentication and signed
post ticket. It returns bounded, MIME-validated image bytes through the existing
credential/workbook-scoped Worker cache. Stored valid thumbnails require no
Sheets or Meta lookup. Expired/missing thumbnails may refresh once; an already
refreshed playback descriptor is reused first. Unavailable thumbnails are cached
for five minutes. A video response is cancelled rather than read as an image.
Arbitrary client-supplied thumbnail URLs and cross-account tickets are refused.

Thumbnail bytes reuse the encrypted browser cache, independently of video
descriptors, for up to 24 hours within the existing size/count limits. They can
survive reload and re-unlock with the same credential. Browsers without persistent
storage retain a working fallback. The video element gets its source URL only
when Play is clicked. A visible Play action and unavailable message replace blank
idle players when a thumbnail cannot be obtained. Spinner and buffering state
remain local to the card; a late thumbnail cannot cover an already playing video.

No new bindings, secrets, storage schema, Render changes or scanner algorithm
changes are required. This patch does not queue new clickouts, resend uncertain
appends, execute deletion or repair the separate mirror failure.

Validation: 231 JavaScript tests and four Python completion checks passed; built
HTML has 179 unique IDs. Tests cover exact thumbnail identity, one-snapshot queue
reads, expired/absent thumbnails, auth and cache isolation, reuse after reload,
play-only video source assignment, lock races and buffering. Browser launch was
blocked by the local environment's socket restriction, so real browser visual
and playback verification remain an operator check after deployment.

## Visible scan coverage and clear review states — 15 November 2026

This is included in the combined queue/thumbnail patch before operator application.
The duplicate workspace now has prominent overall and selected-account coverage
cards with numeric percentages, coloured progress bars, fingerprinted/total counts
and remaining counts. A disclosure lists coverage for all known Facebook and
Instagram accounts, including those with no duplicate groups or no supported posts.
Zero supported posts and unavailable coverage are shown explicitly, not as 100%.

GET /api/content/groups adds scan_progress from its existing complete snapshot.
Totals sum eligible and valid-fingerprinted stored posts across all supported
accounts; the 20-group response limit, platform picker and repeated groups do not
change these totals. Exact platform/account identities remain separate. No extra
Sheets reads, background polls, storage schema or environment variables are added.
Coverage measures saved fingerprints, not full provider history or guaranteed
completion of comparison/group delivery. A failed refresh retains the previous
coverage with an update-delayed label, and lock clears it.

The candidate picker now displays account coverage bars alongside each group,
with account names, media counts and prior confirmation history. The selection
keeps the original group identity. It supports keyboard arrows, Home/End, typing,
Enter/Space selection, Escape, Tab and outside dismissal; busy confirmation locks
selection. Selection does not request scanning or queue removal links.

Unreviewed cards have no redundant removal-state badge. Actual preview decisions
show Marked for removal · preview (confirmation still required); queued decisions
show Marked for removal · queued, and confirmed keeps remain visible. The action
Scan this account sooner explains that it moves this account's remaining posts
forward in the existing background queue. Earlier scan requested is an ordering
acknowledgment, not a claim that scanning is running or that cooldown is bypassed.
No scanner algorithm, scheduling, deletion or clickouts-write behavior changes.

Validation: 237 JavaScript tests and four Python completion checks passed. Tests
cover complete-catalogue totals despite the group limit, platform isolation, empty
and unknown denominators, dropdown selection/keyboard handling, stale recovery,
lock cleanup and proposed-versus-confirmed decisions, alongside the queue/poster
checks. Parsed generated HTML has 188 unique IDs. Real-browser visual/accessibility
and playback checks remain to be performed after deployment; Chromium launch in
this environment was blocked during the earlier preview validation.

## Complete duplicate group picker — 16 November 2026

Operator-observed: after new groups appeared for other accounts, Aand Cut no
longer appeared in the candidate picker. Source-confirmed: GET /api/content/groups
returned only the 20 newest groups globally, so one account's newer groups could
push another account entirely out of the response. This was a listing limit;
the screenshot does not prove that stored groups or provider posts were deleted.
GitHub master aeefb709 contains the progress-bar picker in both editable and built
sources, while the supplied screenshot appears to show the older native select.
The active Cloudflare version still requires operator verification.

The groups response now includes a complete lightweight index of current groups,
plus the existing bounded set of 20 preview-rich rows. The index contains exact
platform/account/group identity, readable name, member counts, saved review
history and scan coverage. Its calculation uses the same storage snapshot and
adds no Sheets read. The index is not truncated by update recency. Existing
strict-subset suppression within the same account/platform/algorithm remains.

The browser uses the full index for the picker. Selecting a group outside the
initial preview set loads only that group's details with GET /api/content/groups
and group_id. This is an authenticated read using one snapshot. It performs no
scan, queue write or deletion. Successfully loaded details are reused during that
view; refresh obtains current evidence. Selection is preserved by group identity,
not its list position. No increase to full preview payload limits is required.

A local loading indicator is shown while group members arrive, and planning is
blocked until details are validated. Concurrent identical loads coalesce. Old
selection, navigation, refresh and lock responses cannot repaint another account.
Failures retain the account in the picker with local retry feedback; rate limits
honor the existing cooldown instead of immediately reissuing the same request.
Missing/superseded groups explicitly request a refresh. Legacy responses without
a complete index are labelled incomplete rather than presented as all groups.

Local validation: 243 JavaScript tests and four Python completion checks passed;
the generated HTML has 191 unique IDs. Regression fixtures add 24 newer groups
while an older Aand Cut group remains selectable and can load exact member data.
Checks also cover one-snapshot listing, scoped confirmed history, loading/plan
gates, read coalescing, response races, wrong-account responses and cooldowns.
No production records or deployment were changed during validation. Live
Cloudflare delivery, browser appearance and actual stored Aand Cut membership
remain operator checks. The public HTML marker is complete-index-v1.


## Metric collection evidence and group refresh — 16 November 2026

Operator-observed: Facebook duplicate cards display images while every count is
Unknown. This screenshot does not establish the specific provider failure.
Source-confirmed: preview delivery is independent of metric collection; cards
previously received only numeric values, although the collector saved capability
failures. A combined Facebook likes/comments/shares field rejection discarded all
three counts. An absent value must not be converted to zero or to a loading state.

Library, duplicate and verified queue post responses now carry safe per-metric
availability from the same snapshot as their posts. Joins require exact platform,
account, post and media kind; an ephemeral index avoids repeated full capability
scans. No additional per-card Sheets request is made. Cards distinguish Not
collected, Not provided, Not supported, Access needed, Reconnect Meta, Check delayed
and Check failed. Numeric zero remains zero, older numeric values survive refresh
failures, and explanatory details include the last check where recorded. No raw
provider messages or tokens are returned. Weighted scores explain which required
counts are absent; existing missing-metric and stale-plan protections remain.

Refresh group metrics queues an explicit authenticated request for the selected
current group's published Meta-linked posts. It reuses content_collect_state and
the existing meta_collect lease, schema, credential and cron. No new environment
variable is needed. Identical queued requests coalesce; completed requests have a
15-minute request cooldown. Two posts are checked per targeted batch, alternating
with ordinary account collection. Remaining requests participate in the normal
scheduler instead of repeatedly taking manual priority away from other jobs.
Queued counts are labelled awaiting a check, not actively loading. Refresh groups
reads completion and per-card evidence; no new browser polling loop was added.
An actual enqueue HTTP request has its own local spinner and feedback, with
selection/session guards. This action creates no cleanup plan or deletion request.

Facebook combined fields fall back individually only for a field/parameter
rejection. Permission, credential and rate failures do not trigger that fan-out.
Fallback stays within the existing twelve-call/eighty-second budget. Missing
shares and reaction breakdowns are not invented as zero or as likes. Collection
prioritizes displayed views/shares insight candidates within existing probe
cooldowns. A provider rate limit stops subsequent calls in that batch and saves
its cooldown; the scheduler also honors it for explicitly queued work. Permission
or unsupported-metric evidence cannot be repaired merely by reloading images.

Validation: 257 JavaScript tests and four Python completion checks passed locally.
New coverage includes exact metric identity, safe reasons, missing versus zero,
retained numeric history, bounded field fallback, durable/coalesced refresh work,
normal scheduler participation, persisted cooldown, local loading, and late
selection/session responses. Existing group index, media, cleanup and storage
checks still pass. No authenticated live Meta counts were fetched during this
work; the exact reason for the operator's missing counts remains unverified until
the new response is deployed and read. Public HTML marker: metric-evidence-v1.


## Compact duplicate review and explicit metric sorting — 16 November 2026

The operator requested a denser candidate picker and automatic Rank by ordering.
The supplied screenshot already shows weighted scores descending (38,304, 24,381,
17,812). Source inspection found that the old default, Plan order / highest first,
switched to keep/remove sequence when a preview plan existed. Rank and weight
controls listened only for input events. No live ordering failure was reproduced.

The picker now shows platform/account once per bucket, with one inline coverage
ratio, percentage and short bar. Group rows contain only group number, media count
and an optional Reviewed badge. Full account identity and coverage remain in
accessible labels; keyboard navigation, platform/account isolation, stable group
identity, the complete index and lazy detail loading are retained. Desktop rows
have a 32px minimum height and coarse-pointer rows a 44px minimum.

Highest first is the default gallery order. Keep / remove plan is an explicit
alternative. Rank and weight changes handle both input and change events and
return a selected plan order to metric order while invalidating its unconfirmed
plan. An explicitly chosen ascending order persists. Initial card HTML is already
ranked, subsequent changes move existing media nodes, unavailable values remain
last, and numeric zero remains numeric. Active plans retain authoritative score
snapshots. Sorting makes no request and never creates a plan or queues removals.

Coverage cards and review controls use tighter spacing and concise status labels.
Repeated guidance is under Review help. Formula/settings, account/metric refresh
and legend/header share rows. Missing-count explanations move inside the existing
post info panel so they do not independently displace a card's thumbnail. Local
errors, loading indicators, retry messages and the explicit queue confirmation
warning remain visible at their relevant controls.

Validation: 261 JavaScript tests and four Python completion checks passed locally.
Regression checks cover compact account buckets, accessible full labels, sorted
first render, explicit plan ordering, change/input handling, missing metrics last,
ascending preference and retaining video nodes during reordering. Chromium could
not launch in this environment; real-browser appearance remains a deployment
check. No deployment or production-data operation was performed. Public HTML
marker: compact-rank-v1.


## Counts, plan diagnostics and clickouts delivery — 16 November 2026

Supersedes the unapplied compact-rank-v1 installer; this combined update targets
the operator's applied a4862f5 dashboard and retains the compact UI changes.
Operator-observed: two Instagram cards lack views, one lacks shares; Reach
planning returns missing_metrics_or_already_queued_member; nine confirmed
requests await a Sheet mirror reporting google_http_400. The exact live Meta
response and the failing Google read/token stage cannot be inferred from these
screenshots. No live credentials, provider calls or production Sheet changes
were used in this investigation.

Source-confirmed metric defects: only two insight candidates were probed per
post per visit; a requested refresh could become checked after metadata loaded
without all required counts. Missing counts in duplicate groups had no dedicated
catch-up priority. Instagram now fetches up to four due scalar insight metrics
in one request, prioritizing the selected ranking, views, shares and reach. A
metric/parameter rejection falls back to individual requests within the existing
twelve-call/eighty-second budget. Permission, credential and rate failures do
not fan out. Numeric zero is preserved; absent data is never converted to zero.
The ordinary scheduler alternates bounded duplicate-count catch-up with normal
collection, two posts per batch, while honoring metric/provider cooldowns. The
account's browser need not remain open. Existing scan algorithms are unchanged.
Explicit refresh stores required metrics, and records missing/failed metrics;
budget/rate deferrals remain pending. Old numeric values survive failed reads
without turning a failed refresh into success. Instagram organic views are not
replaced with reach, crossposted or promoted/boosted totals.

Provider reference checked: Meta Instagram Media Insights documents views,
shares and reach, comma-separated metric requests, unavailable empty responses
and possible data delays up to 48 hours:
https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
Existing configured Graph version and credentials remain in force. Permissions,
actual provider availability and a live recovery time remain unverified.

Planning now validates every selected metric, not only weighted score. It shows
per-metric availability counts, distinguishes already-queued posts from missing
counts, validates the keep count locally and clears Building on failure without
letting stale responses clear a newer operation. Required-count and explicit
confirmation protections remain intact; no partial group is silently selected
for removal. Reach is distinct from views.

Source-confirmed mirror defects: every batch read meta-posts-to-id even for
clickouts; one operation per batch let mapping work delay confirmed removals;
clickouts rows contained URLS only. The mirror now prioritizes pending confirmed
removals, processes at most ten outbox records, prepares only the relevant tab
and uses its actual grid width for reads. It creates a missing destination tab
and adds required headers under the existing write flag. Existing workflow
columns and values are retained. clickouts exports URLS, platform, account_id,
post_id, request_id and queued_at as RAW values; large identifiers remain strings.
An existing matching URL receives identity in blank owned columns. Conflicting
identities fail closed; keep decisions are not exported as removals. Confirmation
queues the existing mirror job for the scheduler. No executor or deletion
schedule is introduced, and a synced row is not proof of deletion.

A definitive 4xx append rejection returns records to pending. Network and 5xx
ambiguity remains uncertain. A later matching Sheet row can reconcile delivery;
an absent uncertain row is never blindly appended again, because a consumer may
already have removed it. Pending work takes precedence over uncertain items so
they cannot starve new confirmed work. Diagnostics record authorization, tab
preparation, update, append or delivery-record stage without raw provider bodies.
Queue cards expose failed/uncertain delivery, and Retry Sheet sync queues only
the existing outbox with local loading/errors and session guards.
Google append reference: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/append

Validation: 273 JavaScript tests and four Python completion checks passed locally,
including combined Instagram counts, automatic catch-up, missing versus zero,
failed refresh retaining historical values, unsupported-field isolation, local
Reach blocking, cleared plan progress, missing mapping-tab independence, batch
clickouts, identity enrichment, large text IDs and ambiguous delivery recovery.
The installer retains complete preflight, backups and idempotent LF/CRLF support.
Live API counts, workbook contents and browser appearance remain deployment
checks. Public marker: compact-rank-v2. No new environment variables are required.
