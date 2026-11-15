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
