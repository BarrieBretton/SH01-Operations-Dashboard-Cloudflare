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

## Scope and semantics — v2 producer correction

- Required stock tabs: streamables and streamables-yt. Required columns: account, approved, and status (or state). Creator is optional metadata.
- Only trimmed/case-insensitive staged + yes is eligible. Uploaded is consumed. Conflicting status/state values are ineligible.
- Groups are per workbook/tab/account. No cross-tab merging or account-name source guessing.
- workflow-schedule is routing evidence, not inventory. Failure to read it is shown explicitly and clears routing assumptions for that snapshot.
- Explicitly allowlisted other tabs provide state summaries, with unavailable counts represented as unknown. They do not receive Streamables eligibility rules.
- Unknown Drive, Pinterest, Telegram and dynamic sources are visible in the workflow source register. Their private configuration and live authorization are not inferred from Sheets access.
- Old inferred stock rows remain stored but are hidden from live inventory. Queue Sheets sync after the correction deploys.
- D1 publishes complete required-stock snapshots atomically with a five-minute lease. Failed required reads retain last good stock and mark it stale.
- At most 20,000 rows per tab; larger reads fail explicitly. Required headers and duplicates are checked. Reads cover A:AZ and do not stop at blank rows.
- Snapshot freshness means fetch time, not the last Google edit time. Multiple tab reads are not a Google-side transaction.
- Automatic cron is every ten minutes; UI refresh reads D1 and does not itself sync.
- No media downloads or upstream mutations. Credentials stay server-side in memory. Queue summary values and full workflow parameters are not returned.
- The existing scheduled handler runs Sheets, not Meta. Meta remains manual.

See docs/PRODUCER-AUDIT.md for the evidence, known gaps and optional threshold setting.

## Tests
node --test producers.test.mjs sheets.test.mjs ui.test.mjs smoke.test.mjs
python -m unittest discover -p test_producers.py

## Official references
https://developers.cloudflare.com/workers/configuration/cron-triggers/
https://developers.google.com/identity/protocols/oauth2/web-server
https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/get
