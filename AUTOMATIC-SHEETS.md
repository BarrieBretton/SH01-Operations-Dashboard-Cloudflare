# Automatic Google Sheets inventory

## One-time setup
1. Run apply_sheets_automation.py in the dashboard repo. It preserves the current
   D1 binding and adds the Git-managed */10 * * * * Cron Trigger.
2. Before pushing, run sheets-sync-schema.sql in the EXISTING D1 Console.
   This additive migration is safe to run again. Original inventory is retained.
3. Worker Settings > Variables and Secrets:
   - GOOGLE_CLIENT_ID: Secret
   - GOOGLE_CLIENT_SECRET: Secret
   - GOOGLE_REFRESH_TOKEN: Secret (OAuth OFFLINE refresh token, not an access token)
   - GOOGLE_SHEETS_SPREADSHEET_ID: text variable, ID of the operational workbook
4. OAuth identity must be allowed to read that workbook. Use scope
   https://www.googleapis.com/auth/spreadsheets.readonly.
   If you already obtained an offline refresh token in Kaggle, use that with its
   matching client ID/secret. Do not put credential values in Git or send them to chat.
   Otherwise authorize offline access once. Google OAuth Playground supports using
   your own OAuth client in its settings; a web client must allow the Playground
   redirect URI https://developers.google.com/oauthplayground. Select the Sheets
   readonly scope, authorize with the workbook's authorized user, exchange the code,
   and keep the refresh token in the Worker secret.
   Google testing-mode/revoked refresh tokens can expire. Automatic refresh is not
   a guarantee of perpetual access: use the appropriate production OAuth setup.
5. Commit and push the patch files. No npm installation on your PC is required.
6. In Producers, press Queue Sheets sync. It returns QUEUED, not success.
   The source status refreshes every minute while the Producers tab is visible.
   Successful automatic collection continues every ten minutes with the PC closed.
   Cron configuration can take time to propagate.
7. Check Google Sheets status=ok, last successful SOURCE FETCH, and no error_code.

## Scope and semantics
- Reads streamables, streamables-yt, workflow-schedule, columns A:Z, header row 1.
- Required stock headers: account, creator_handle, status, approved.
- Links use yt_link or public drive link; ready/consumed rules match sync.py.
- Accounts appearing only in workflow-schedule are Unknown, not consumed.
- Preserves seeded workflow references and warning thresholds by producer ID;
  new groups default to threshold 3. Does not inspect live n8n workflow logic.
- Existing archive records are never labelled live. Once a live snapshot exists,
  it supersedes archived stock/schedule groups. Workflow-only archive references
  remain explicitly labelled unverified.
- D1 publishes a complete staged snapshot with one active-version pointer.
  Failed reads, missing tabs/headers, and row-limit failures retain the previous
  good version. No in-place partial inventory replacement.
- Uses a five-minute lease to avoid overlap, bounded retries and HTTP timeouts.
  Source status records last attempt, last success and sanitized failure category.
- More than 20,000 rows per tab aborts the run. Rows are read in one request per
  tab so internal blank-row gaps cannot silently truncate subsequent data.
- Freshness means fetch time, NOT the last user edit time in Google Sheets.
  The three tab reads are not a Google-side transactional snapshot.
- Stale after thirty minutes. Failed recent sync and freshness are separate:
  a previous successful snapshot may still be recent, while status reports failed.
- No media files downloaded. Google access/refresh tokens never stored in D1.
- Sync is read-only to Google; it writes only the dashboard D1 tables.
- Worker resource limits can still stop oversized runs; expired running leases
  are retried on the next cron. Monitor source status and Worker logs.
- This replaces the old scheduled Meta call: Meta stays manual pending diagnosis.
  It does not automate n8n error ingestion, FastAPI error hooks, or Meta analytics.

## Tests
node --test sheets.test.mjs
Tests use synthetic data and in-memory SQLite, not your Google credentials.
Official references:
https://developers.cloudflare.com/workers/configuration/cron-triggers/
https://developers.google.com/identity/protocols/oauth2/web-server
