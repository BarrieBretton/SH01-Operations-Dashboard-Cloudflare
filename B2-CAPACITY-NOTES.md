# B2 capacity presentation

B2 bytes now use decimal GB/MB for the primary display, with binary GiB/MiB and exact byte counts underneath. For example, 8.8 GiB is approximately 9.45 GB, not 10 GB.

The bucket shown by the user was sh0001. Its complete file-version listing is a bucket measurement, not an account-wide daily billing total. The remaining difference from the Caps & Alerts screenshot is not reconciled by unit conversion alone. Other bucket bytes, unfinished upload parts, changes between observations and provider accounting timing are possible contributors; none has been established as the cause from the screenshots. No extra bytes are invented to make the display match 10 GB.

A 10,000,000,000-byte account cap reference is included ONLY for sh0001, based on the user's Backblaze screenshot supplied 16 November 2026. It is explicitly marked as a user-supplied reference, not automatically fetched quota. The ring compares complete, unrestricted bucket-version bytes to this account-cap reference. It does not report total account utilization or free upload capacity. Partial and prefix-scoped scans do not use this reference ring. Any configured operator budget takes precedence and retains its own label.

The reference is in infra-view.js, infraB2CapReferences. If the provider cap changes, update or remove that reference and rebuild. It is not a claim that 10 GB is Backblaze's maximum possible storage capacity. No provider cap is changed by this patch.

Component cards now have distinct inline icons for B2, databases, Redis, Sheets, image storage, compute, routing, queues, monitoring and publishing integrations. Icons are illustrative service symbols, not downloaded provider logos.

This update does not reconcile account-wide billing usage or change deletion permissions, targets or confirmation behavior. It requires no backend change.
