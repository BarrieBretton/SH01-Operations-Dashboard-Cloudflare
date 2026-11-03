# SH01 Operations Desk

A single-file, framework-free Cloudflare Worker serves a private HTML/CSS/JS
dashboard and stores event metadata and producer inventory in a dedicated D1
database. No npm install, Wrangler, database password, or third-party UI
library is needed to run it. The SH01 repository and live n8n instances are
read-only inputs; this package does not change their workflows.

## Deploy in the Cloudflare dashboard

1. Create a **new, dedicated D1 database** (for example `sh01-ops-desk`) in
   **Storage & databases → D1**. Open its SQL console and run `schema.sql`.
   This is not the operational media queue D1 database.
2. Create a Worker in **Workers & Pages**. Replace its editor content with
   `worker.js`, and bind the new D1 database under the exact name **`DB`**.
3. Add two distinct, random, long **secrets** (never plaintext variables):
   `DASHBOARD_TOKEN` for the UI and `INGEST_TOKEN` for collectors. Deploy.
4. Open the Worker's URL; enter `DASHBOARD_TOKEN`. The token remains in that
   browser tab's memory. Do not share the URL and token together. Restrict
   access at the edge if this dashboard is exposed beyond your own use.
5. Save `OPS_DASHBOARD_URL` (the Worker origin) and `OPS_INGEST_TOKEN` as Kaggle
   private environment variables. Run `sync.py` with the existing safe handoff:

   ```python
   import os, subprocess, sys
   os.environ['OPS_DASHBOARD_URL'] = 'https://YOUR-NEW-WORKER.workers.dev'
   # OPS_INGEST_TOKEN must already be loaded from Kaggle Secrets.
   subprocess.run([sys.executable, 'sync.py', '--archive',
       '/kaggle/working/SH01-Shareable-Handoff-YYYYMMDD-HHMMSS.zip'], check=True)
   ```

   The Worker and collector need no connection to the private database dump.
   With `GOOGLE_SHEETS_ACCESS_TOKEN` set, the collector reads fresh rows from
   `streamables`, `streamables-yt` and `workflow-schedule`. Without it, the
   collector uses the readable workbook **snapshot in that ZIP**. The Sheets
   token must be a Google OAuth token for the operational workbook; a client
   ID/secret alone is not a token. `GOOGLE_SHEETS_SPREADSHEET_ID` is an optional
   override; the workbook ID is in the ZIP.
6. Optional live n8n collection uses `N8N_A_BASE_URL`, `N8N_A_API_KEY`, and
   equivalent B variables. These should be **direct Render n8n URLs**, not
   two aliases of the same Cloudflare proxy, to avoid double counting. Until
   billing suspensions lift, requests can return 503; the snapshot still
   provides historical **failure metadata** without error details. Re-run
   the collector when you want newer records. It is idempotent on event ID.
7. To capture **future Python ERROR logs**, copy `sh01_error_handler.py` into
   the FastAPI repository, set `OPS_DASHBOARD_URL` and `OPS_INGEST_TOKEN` on
   its Render services, and after its existing `logger` setup add:

   ```python
   from sh01_error_handler import install_ops_handler
   install_ops_handler(logger)
   ```

   Deploy this as a normal repo change. The hook sends the exception class,
   logging template, time and service ID; it omits traceback and format args
   to reduce accidental leakage. It will not retrieve old Render log lines or
   logs emitted by unrelated third-party loggers. A persistent record of every
   past server error requires an existing retained log source, which the
   provided handoff did not include.

For n8n errors with useful **failure details**, attach an HTTP Request node
to a dedicated Error Trigger workflow in **each** n8n instance. POST to
`/api/ingest/event` with `X-INGEST-KEY` and the following small JSON shape:

```json
{"source":"n8n","event_id":"A:execution-123","happened_at":"2026-11-03T12:00:00Z","workflow_name":"workflow name","workflow_url":"https://DIRECT-INSTANCE/workflow/WORKFLOW-ID","service":"render-a n8n","message":"Brief sanitized error message"}
```

Keep the ingest key in an n8n credential; send only sanitized text, never
execution input/output, raw request headers, URLs with secrets, or credentials.
The Worker also strips common token-shaped strings and sensitive query
parameters. Automatic redaction **cannot guarantee** that unknown credentials
are absent, so prefer error categories and short summaries. The Error Trigger
is an optional enhancement; the live API collector provides failure metadata
even before that workflow is installed.

## Inventory semantics

`sync.py` groups media rows by `account` and `creator_handle`, links the
corresponding `yt_link` values, and records the sheet tab/row, approval and
status. A row is available only when `approved` is yes/true/approved/1/y and
its status is not `used/published/consumed/done/posted/completed/deleted`.
Review those meanings against your actual sheet workflow rules before using
the colors operationally. Yellow is `1..threshold` ready items; red means
**every listed item is explicitly marked consumed**; green exceeds the
threshold. Unapproved-only rows and a producer seen only in the scheduler
with no stock are **unknown**, not consumed. The
default threshold is 3; change it with `--threshold 5`.

Workflow references are inferred by matching account and creator names to
the sanitized workflow definitions. This is a helpful cross-reference, not a
proof that every producer used in arbitrary node code has been found. Private
CFG node bodies cannot be searched here. A new live Sheets sync makes stock
current; it does not guarantee that a scheduled workflow still uses it.

The handoff's readable `execution_entity` rows contain status/timestamps, but
not saved error traces. Suspended instances and pruned n8n execution history
remain gaps. n8n live API collection stops after 20 pages per instance per
run to bound traffic; repeat or extend `max_pages` when backfilling.

## Privacy and operations

- The dashboard **must** stay private: even item links and failure summaries
  can expose sensitive operational information.
- Worker secrets are never written to the browser HTML or D1; the dashboard
  token is entered interactively. Ingest and UI tokens must differ.
- Query string token/password/signature parameters are replaced with a
  placeholder before storage; ordinary YouTube `?v=` links remain intact.
- The collector sends sheet rows that you explicitly chose for the stock
  inventory, not all tabs. Review links/labels in your private workbook.
- When replacing or losing the Worker tokens, set new Worker secrets and
  update only the corresponding Kaggle/Render/n8n secret stores.

This is a Cloudflare deployment package; nothing is deployed automatically.
Documentation: [Cloudflare D1 dashboard and Worker binding](https://developers.cloudflare.com/d1/get-started/),
[Worker secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
