<!-- SH01 DIRECT SHEETS FOLLOW-UP BEGIN -->
> **Current storage instructions:** the existing Cloudflare Worker calls the Google Sheets API directly using its existing Google OAuth credentials. No Apps Script project, gateway URL or gateway secret is required. Follow [../SHEETS-MIGRATION.md](../SHEETS-MIGRATION.md): deploy with `SHEETS_STORAGE_READY=0`, verify the live write guard and all-table copy, then set `SHEETS_STORAGE_READY=1`. Cloud deployment and cutover remain pending until verified. Existing optional business-sheet write flags and platform credentials remain in their current scopes. Older storage/deployment instructions below are historical where they differ from this guide.
<!-- SH01 DIRECT SHEETS FOLLOW-UP END -->

# Producer correctness audit and correction

## Evidence inspected

- Dashboard repository: `BarrieBretton/SH01-Operations-Dashboard-Cloudflare`, fetched `master`. Worker blob `71565ba9f47ea5c61cf3eb164afc1b1c4d8a76fd`; collector blob `228c122f2991abff963b0e8a151f0389ee079cc1`.
- Readable handoff: `SH01-Shareable-Handoff-20261029-192451.zip`.
- Inspected all 70 workflow definitions / 3,295 nodes, the workflow connections, literal subworkflow calls, and the operational workbook's headers and schedule associations. The generated register covers 740 integration nodes. These are **not 740 distinct producers**.
- Reviewed collector, Worker routes and D1 schema, browser stock/session behavior, archive importer, and build embedding.
- Did not decrypt private backups or use credential values. Did not access current Google, Drive, Telegram, Pinterest or n8n accounts. Snapshot evidence does not verify current deployments or successful execution.

## Confirmed source relationships

| Account / pipeline | Evidence | What it establishes |
|---|---|---|
| `vlvt.ave` | Schedule row names `ig-sidehustle PINTEREST 4` (`mUSb7FumbbDcI4mg`). Connected node `Pinterest Search1`, ID `7a21027a-0ee7-4e12-922c-7f83c30a33c3`, uses the Pinterest RapidAPI host. | On-demand Pinterest source. `pinterest-search-queries` supplies query inputs. Search-query counts are not remaining media counts. |
| `erika.devereux` | Schedule selects `ai-image-model-erika.devereux` (`i2tjtyiZoO8vlJAv`). Drive nodes navigate accounts → account directory → media → images; `image-ids` is `ab522ec8-180b-4776-9e06-2f3c1b5b6c14`. | Google Drive is an actual input. Account-directory expression and other CFG/branch details are redacted. A generation API branch is also present; the dashboard does not assume a single unconditional source. |
| `cyootstuff` | Schedule selects `ai-image-model-cyootstuff 2`, which has Drive and generation paths. | Separate workflow-backed input, not a guessed Streamables mapping. |
| Streamables → Meta | `5hYoUWzz57EXtEbT`, `Get streamables` and `Assess streamable inventory`. Snapshot schedule associates `aand.cut` and `dave.commercial7`. | Reads `streamables`, filters account + staged + yes. |
| Streamables → YouTube | `rcHTg7RzrCYICIjy`, `Get streamables-yt` and `Assess streamable inventory`. | Reads `streamables-yt`. The snapshot schedule does not supply an account binding for this row; it remains unresolved. |
| Telegram audio pipeline | `49rdB5CUChByDqLR` Telegram trigger → `telegram_audio_social_queue`; `MSLOMwwZZbIf2Pdb` reads that queue and submits/polls media rendering; `k81kDu7iUEYrKRBy` is the publishing workflow. | A separate event/queue-based pipeline. The sanitized export does not prove that Erika or Vlvt receives its output. No such account association is invented. |

The first `Pinterest Search` node in Pinterest 4 is disconnected in this exported graph. `Pinterest Search1` is connected. Disabled sinks and calls are retained in the register but excluded from inferred account call chains. Graph reachability follows all branches; it is not proof of selected runtime branches.

## Bugs fixed

| Old behavior | Corrected behavior |
|---|---|
| Accepted `true`, `1`, `approved`, `y` and arbitrary nonterminal status | Requires trimmed, case-insensitive `status=staged` AND `approved=yes`. |
| Uploaded treated as available | Uploaded is consumed in the collector and ingestion rule. |
| `status`/`state` confusion | Uses `state` as alias if status is blank; conflicting populated values are explicitly ineligible. |
| Client-provided `ready=true` trusted | Worker recomputes eligibility from status/approval. |
| Account/creator name found in workflow text implies a source | Removed. Uses exact unique scheduler workflow name, literal call chains, explicit integration nodes and workbook/tab references. Sheet stock links require a matching workbook-ID fingerprint. Branch/account overrides remain unverified. |
| Same account/creator combined across tabs | IDs include workbook and tab. |
| Stock threshold evaluated per creator | Counts account-level stock; creator is item metadata, matching the inspected workflows. |
| Warn at count <= threshold | Inspected workflows use count < `min_ready_streamables`. Default 3 is labelled as a dashboard fallback; CFG override is unverified. |
| Schedule-only accounts fabricated as stock | Schedule entries are source-routing evidence, never stock. |
| All non-Sheets inputs absent | Workflow source register includes Drive, Pinterest, Telegram, other Sheets, file/database/HTTP dependencies, inactive/disabled paths and unresolved dynamic integrations. |
| Zero used for unavailable telemetry | Remaining count is null/unknown for unmeasured sources. Pinterest is on demand, with no finite stock assumption. |
| Stale or failed reads look currently healthy | Independent freshness state; failed required reads retain the last complete snapshot and mark it stale. |
| Old false producer mappings remain visible | Old records are retained in D1, but hidden from the corrected live stock view until a new v2 snapshot is collected. |
| Item list silently limited to 5,000 | Paged items (200/page), pinned to a published snapshot; expired snapshots return an explicit refresh requirement. |
| Optional queue failure masks successful stock | Optional tabs have individual unavailable/error states. Failed schedule read yields no invented account associations. |

## Collection contract

Google OAuth refresh is the only non-GET upstream request. Sheets content is read-only. Required live stock tabs are `streamables` and `streamables-yt`. `workflow-schedule` provides current routing metadata, compared against the exported workflow definitions.

Additional allowlisted tabs are read for row counts and state summaries only: `pinterest-search-queries`, `telegram_audio_social_queue`, `telegram-storage`, `media-edit-clips`, `captions-archive`, `daily-prompts`, `yt-accounts-mapper-store`. Their row contents, credentials, captions and private messages are not copied into the register. Other tabs/workbooks appearing in workflow nodes remain inventoried with no unverified live collector. In particular, matching a tab name in another workbook does not prove workbook identity.

The reads happen over a collection interval, not a transaction across Google tabs. All required stock reads must succeed before a D1 version is published. A lease prevents overlapping collection; a failed write/expired lease does not replace the published version. Optional-source errors are visible in the source panel. Guards reject duplicate headers and oversized Sheets results instead of silently truncating them.

Every ten minutes is the existing Worker cron configuration, not guaranteed real time. Dashboard refresh reads D1, and the queue button requests a new collection. The patch does not modify the cron, database bindings, secrets, META logic, n8n graphs, Google rows, posting state, or media.

## Important remaining limits

1. **Drive live inventory is not connected.** The concrete account-folder selection is redacted. Supply the actual folder mapping and verify that the OAuth credential has a Drive read scope before connecting a listing adapter. A successful Sheets read does not establish Drive authorization. Do not infer eligibility from file existence alone.
2. **Pinterest is an on-demand input.** Live retrieved results, deduplication/consumption state, API quota and query semantics need a collector or execution telemetry for that workflow. A query pool is not a warehouse of media.
3. **Telegram account routes and queue eligibility differ.** The inspected queue lacks the Streamables approval contract. State summaries are shown; no cross-account bindings or available-media counts are inferred.
4. **156 code nodes have possible I/O or redacted logic**, and one subworkflow target is unresolved. This number is a conservative investigation list, not 156 confirmed broken workflows. Conditional routes, CFG overrides, external webhooks and arbitrary code cannot be fully resolved from sanitized definitions.
5. **This is not an audit of current FastAPI deployments or a rewrite of Meta analytics.** Those existing components require separate live tests. The patch fixes producer observability, and does not claim all inherited features are production-complete.
6. **Post-deploy verification is still needed.** Tests use mocked Google responses and local SQLite for the D1 interface. No browser rendering QA or authenticated production fetch was possible in this session.

## Tests

Run with Python 3 and Node 22.13+ (Node 24 tested):

```powershell
python build_ui.py
node --test producers.test.mjs ui.test.mjs smoke.test.mjs
python -m unittest discover -p test_producers.py
```

Tests cover exact eligibility, status aliases/conflicts, uploaded items, account/tab aggregation, threshold boundaries, stale/failed state, optional-source failures, explicit source mapping, legacy rejection, paginated snapshot consistency, leases, headers, URL handling, authentication, escaped display text, session clearing and archive importer behavior. Test fixtures are never served by the production Worker.

## Deploy and verify

Apply the supplied Python patch in the existing dashboard repo; it validates known file versions, tolerates CRLF and the earlier uploaded-state patch, and creates backups. No secrets or new D1 migrations are needed when the previously installed Sheets tables exist. The generated `worker.js` is included; GitHub deployment continues to use the existing Wrangler configuration.

After committing/pushing and Cloudflare reports deployment success, reload the dashboard and select **Producers → Queue Sheets sync**. The source register is available immediately; corrected stock requires that first successful sync. Existing historical failure rows are preserved.

For a read-only deployed check, set `OPS_DASHBOARD_URL` and `DASHBOARD_TOKEN` locally, then run `python verify_producers.py`. It checks every returned stock item and pagination, never prints values or credentials, and makes no writes.

Optional server variable `PRODUCER_MIN_READY_JSON` can record confirmed minimums, e.g. `{"streamables:aand.cut":3}`. This must be the workflow's **minimum ready count**, not its maximum count that triggers a warning. Empty/unset uses a labelled unverified default. Do not invent CFG settings to turn an unknown into a pass.

When workflow definitions change, regenerate:

```powershell
python audit_sources.py --archive "C:\path\to\new-shareable-handoff.zip"
python build_ui.py
```

Review/commit the metadata registry and Worker together. `audit_sources.py` never executes workflow code or copies credentials/parameters. Do not commit the handoff ZIP or private workflow JSONL.

## Official API references consulted

- n8n Execute Sub-workflow: https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow/
- Sheets values.get and accepted OAuth scopes: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
- Drive search and listing/pagination: https://developers.google.com/workspace/drive/api/guides/search-files and https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list

The account/source conclusions above come from this project's exported graph and schedule, not from generic API documentation.
