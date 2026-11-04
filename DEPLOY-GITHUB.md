<!-- SH01 DIRECT SHEETS FOLLOW-UP BEGIN -->
> **Current storage instructions:** the existing Cloudflare Worker calls the Google Sheets API directly using its existing Google OAuth credentials. No Apps Script project, gateway URL or gateway secret is required. Follow [SHEETS-MIGRATION.md](SHEETS-MIGRATION.md): deploy with `SHEETS_STORAGE_READY=0`, verify the live write guard and all-table copy, then set `SHEETS_STORAGE_READY=1`. Cloud deployment and cutover remain pending until verified. Existing optional business-sheet write flags and platform credentials remain in their current scopes. Older storage/deployment instructions below are historical where they differ from this guide.
<!-- SH01 DIRECT SHEETS FOLLOW-UP END -->

# Deploy from GitHub
Cloudflare Worker: sh01-operations-dashboard-cloudflare.
Keep the repository connected. Root directory is the directory containing
worker.js and wrangler.jsonc. Leave build command empty. Deploy command:
npx wrangler deploy

The config binds the existing D1 database as DB. No database is created by
this patch. Run meta-schema.sql once in that database's Cloudflare Console.
Keep DASHBOARD_TOKEN, INGEST_TOKEN and META_SYSVAR in Worker Secrets in the UI.
No token values belong in this repository. Cron is intentionally not configured.
The Meta integration is experimental and not live-validated; see README.
Do not treat it as the complete Meta analytics product requested.

Review git diff, then commit and push the changed files. This script does not
commit, push, deploy, execute SQL or change cloud resources.
