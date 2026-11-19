# SH01 Operations Desk roadmap

Start here to continue work on infrastructure, producer entry and trend-assisted drafting. The Operations Desk lives in `BarrieBretton/SH01-Operations-Dashboard-Cloudflare` on `master`. The server, controller and future trend pipeline code belong in `BarrieBretton/sh01-fastapi-server` on `main`.

## Delivery order and evidence

| Step | Deliverable | Status at the 20 November 2026 handoff (IST) | What closes it |
| --- | --- | --- | --- |
| 0 | Infrastructure visibility and configuration | The Infrastructure page exists. A separate management patch was prepared. Its merge and deployment need verification. | Compare the authenticated page against a controller response and both public router responses. Verify the watchdog evidence and the manual workbook export. |
| 1 | Read live producer rows | The existing Producers view reads stock summaries for `streamables` and `streamables-yt`. The live write contracts still need verification. | Both tabs show the right workbook, headers and rows. A workbook-side edit appears on refresh. |
| 2 | Edit, append and batch-update | Planned above the existing Sheets integration. | Verify writes, conflicts and retries on a fixture workbook, then round-trip an authorized unapproved draft in the real workbook. |
| 3 | Trends workspace | Proposed as a separate product area. | Deliver one evidence-backed weekly ranking for one platform and niche, evaluate it on held-out history, then expand sources and time windows. |
| 4 | Human-reviewed AI drafting | Depends on the manual editor and published trend results. | Accept selected suggestions into a draft, review the saved cells, and verify that approval stays with the operator. |
| Later | Retention for consumed rows | Deferred. All producer rows are retained today. | Measured workbook capacity pressure and a separate, explicitly authorized retention proposal. |

In the PR that changes a milestone, record its PR link, deployed revision, verification date and outstanding issues here. A merged change and a verified deployment are separate milestones.

## 0. Finish the dedicated Infrastructure page

Use the existing Infrastructure tab. Read each independent ring from the controller registry at refresh time. Show registered slots, active choices and observed health for Render worker pairs, Supabase and Backblaze B2. For each Render pair show FastAPI and n8n separately, including actual responding backend, provider suspension reason and last observation. Identify both controller masters, which answered the control-plane proxy, its effective order, fallback and maintenance. Show workspace and verified owner email where available. Use an explicit unknown state when evidence is missing.

For the watchdog, show configured cadence, last confirmed invocation if available, last completed controller check, recent gaps, hard-stop status, reason, candidate and last recovery action. Let a failed source leave other sources visible. The historical recovery on 20 November IST selected `render-c`, retained `supabase-b` and `b2-a`, and both public routes answered from C. Observed check intervals were 119 and 121 seconds. Use this incident as a fixture. Live verification reads current state and leaves standby services alone.

Retain the deferred management work. Track each Cloudflare Worker's reviewed source, bindings such as `BACKENDS`, and the desired nonsecret environment for each Render master and worker in Git. Distinguish desired settings, provider settings, and settings observed by the running service. Use target-specific review, a preview of the exact change, fresh reads before apply and a post-deploy check. Keep credential values out of Git and logs. For the **other workbook**, provide a locally copyable one-column replacement, one `KEY=value` per line, preserving unmanaged keys. The operator alone pastes it into that workbook. Verify the prepared management patch before building another implementation.

## 1. Make Producers a workbook editor

Extend `producer-view.html`, `producer-view.js`, `producer-policy.js`, `producer-sources.json` and the existing `sheets-sync.js` integration. Preserve stock counts, workflow associations and existing publishing controls. The [producer audit](PRODUCER-AUDIT.md) identifies both source tabs and records an unresolved historical YouTube account binding. Confirm it against current data. Treat the workbook as authoritative for cells and validations. Use stock snapshots for summaries.

| Producer tab | Editable inputs | Read-only context |
| --- | --- | --- |
| `streamables` | Exactly `caption`, `yt_link`, `account`, `approved`, `creator_handle`. Resolve the exact live header spelling, positions and validated choices. | Status, formulas, derived fields, workflow outputs and consumed history. |
| `streamables-yt` | Discover its own tab ID, headers, validations and workflow inputs. Record the verified allowlist before enabling edits. | Keep unverified fields and any ambiguous mapping read-only. |

Use separate sheet tabs with one shared editor. Each tab owns its filters, selection and unsaved drafts. Show one compact table with a checkbox, video thumbnail, caption, account, approval and status. Open a row to edit the allowed fields and jump to its exact Sheet cell using workbook ID, sheet ID and A1 address. Offer click-to-play for validated YouTube links with a normal link fallback. Keep the Add row action and last sync time visible. Show the batch toolbar only after a selection. Use text as well as color for draft, saved, conflicted and uploaded states. Keep keyboard selection, input labels and focus visible.

**Sync contract.** Resolve an existing immutable row ID or agree a compatible stable identity with the workflow owners. After a sort or insertion, the row number alone cannot identify the draft. Load live values on entry and refresh, show staleness during backoff, and preserve unsaved edits when fresher cells arrive. Read back changed cells after each save. Coalesce reads, use bounded batches and back off on quota responses so the UI shares Sheets capacity with n8n.

## 2. Enable manual writes in small steps

1. Start with one permitted edit and one append. Validate the tab, row, headers, allowed values, protection and current status on the server. Preserve formulas, formatting and data validation. Write user text as literal text. Use a durable request ID for an append and reconcile an uncertain result before retrying.
2. Preview batch changes by sheet, field, new value and row count. At submission, resolve IDs again and compare expected old values. Skip consumed, changed or protected rows. Return a result for each row. Sheets and n8n can edit outside the dashboard. Document the limits of simultaneous external writes, verify the result and surface conflicts.
3. Keep `status=uploaded` rows as read-only history. Preserve the existing producer readiness rule of staged status plus explicit yes approval. Editing an approved row can influence a live workflow, so identify that consequence in the preview. Exclude deleting, clearing whole rows and overwriting system fields from all producer write routes. Batch actions obey the same contract as individual saves.

**Acceptance.** A sheet edit appears in the dashboard and a dashboard save reaches the intended cell. Reordering rows cannot redirect a write. A timed-out append followed by a retry produces one row. Mixed batches report each outcome. Uploaded rows survive UI and direct write attempts. Test authorization, formulas, validators, tab isolation and stale selections on a fixture workbook.

## 3. Build Trends on Kaggle

Give Trends its own workspace. Its first screen should answer “What picked up this week for this account, what evidence supports it, and how did similar ideas perform?” Offer current, weekly and monthly windows. Show rank movement, source links, platform, account or niche, observation time, confidence and result age. A topic can be rising, sustained or cooling across the windows.

| Owner | Responsibility |
| --- | --- |
| FastAPI repository | Version collectors, scoring code and run/result schemas. Handle lightweight scheduling, job identity, validation and reads. Use the server-owned `workflow-schedule` convention with `Server::<workflow-label>` and `Asia/Kolkata` for unattended runs. |
| Project Kaggle notebooks | Collect permitted public signals, deduplicate, build features, run heavier models and evaluate historical predictions. Begin with a manually dispatched run until unattended launch, compute budget and completion reporting are verified. New trend jobs run independently of n8n. |
| Shared results store | Publish immutable, versioned batches. Postgres is a candidate for ranked rows, object storage for large artifacts. Verify existing integration, availability across ring switches and cost before choosing. Promote the latest complete batch only after validation. Retain the previous good result and its timestamp on failure. |
| Ops Desk | Read published results through the authenticated API. Show evidence and coverage while leaving expensive compute on Kaggle. |

Start with one permitted feed or API and the desk's own historical post outcomes. Group comparable formats, platforms, audiences and observation ages. Rank topics using engagement velocity and acceleration, independent creator breadth, repetition and saturation. Record missing metrics and sample size. Add ML or LLM enrichment only after a baseline exists. Use time-separated backtests, compare top-ranked ideas against a simple recent-popularity ranking and measure subsequent lift. Record which cohorts had enough evidence to evaluate.

Each result needs a run ID, topic ID, source links, observation and expiry times, window, platform, score components, confidence, coverage and model/schema version. Retries for the same scheduled slot must reconcile one run. Publish completed evidence in a shared store using an ingest credential scoped to that operation. Store raw model responses outside the workbook. Only the reviewed input fields enter a producer row.

## 4. Add a small AI action inside Producers

Add one **✦ AI** action next to the existing producer editor. The wizard selects a sheet, account and time window, displays ranked ideas with sources and age, then previews field-level differences. The operator chooses which suggestions to accept, edits the draft and explicitly saves through the manual editor. Supply a YouTube link only when a verified source is suitable for reuse. Empty or uncertain inputs stay visible for manual completion.

AI writes target new or unapproved drafts. For an already-approved item, offer a new unapproved draft. Preserve human-entered values unless the operator explicitly accepts a replacement. Keep approval as a separate human action so accepting a caption cannot make a row publishable. Record the source run, accepted fields, edits and resulting workbook row identity. Cancelling makes zero workbook writes. Stale or missing results leave manual entry available.

## Deferred decision on retention

Producer rows cannot be deleted through Operations Desk. Keep uploaded rows and their historical links. If workbook cell usage approaches capacity, record measured usage and growth, identify only rows with `status=uploaded`, assess dependencies on row references, test archive and restoration, and present an exact dry-run list. Any future cleanup requires a separate decision and explicit authorization. A quota alert only opens that review.
