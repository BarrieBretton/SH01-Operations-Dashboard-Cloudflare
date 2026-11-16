# Infrastructure storage and layout update

Storage appears first, followed by compute/routing and connected services. Summary tiles count components, passed checks, attention and unchecked/unconfigured components. These are not uptime percentages. Empty inventories show an explicit unavailable state.

B2 health checks now measure uploaded file-version bytes in the configured bucket or restricted prefix. Each check reads at most 10 pages of 1,000 versions with a 10-second listing deadline and the existing 60-second probe cache. Listing metadata consumes B2 API transactions. Incomplete scans retain a lower-bound byte total and are labeled partial; no capacity percentage is derived from them. Unfinished upload parts are excluded, and the listing is not an atomic snapshot.

The control-plane and media cards measure their own configured buckets. A media card links to a control-plane file manager only after bucket ID and prefix match. Otherwise register the media bucket on the control plane using the existing registry/credential mechanism. Keys are not copied between services by this update.

Browse files opens the existing exact-version file manager. A folder filter groups the loaded file paths; choices expand as more pages load. Filtering does not clear selections outside that folder: the selected count and confirmation dialog still cover the full selection. Size-descending sorting remains the default. Deletion still requires a reviewed, signed selection and typed confirmation. The patch performs no deletion.

## What the usage numbers mean

- Measured bucket/prefix bytes are derived from file versions, not a billing usage report.
- OPS_INFRA_LIMITS_JSON remains an optional operator-specified budget per component. A budget is not a fetched Backblaze cap. Do not assign an account-wide cap to each bucket and present that as independent provider allowances.
- Backblaze's Caps & Alerts page contains account-level spend caps and daily counters. The ordinary file-list API does not return those fields. This patch does not fabricate free-tier limits or reuse an old screenshot as current telemetry.
- Backblaze documents daily Usage Reports for reporting-enabled accounts, groups and organizations. Account-wide daily download/transaction totals need that separate source; reporting must be enabled and its report bucket accessible before an adapter can read them. https://www.backblaze.com/docs/cloud-storage-use-partner-api-reports

No dependency installation or new secrets are required for the measurements in this update. The generated dashboard and Worker are included.

Validation: 293 JavaScript tests and 25 backend tests passed offline. Live provider results require deployment. Chromium rendering could not run in the authoring environment because socket creation was blocked; responsive CSS and DOM behavior were checked in code/tests, not a live browser screenshot.
