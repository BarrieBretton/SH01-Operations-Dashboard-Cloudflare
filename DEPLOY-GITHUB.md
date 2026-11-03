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
