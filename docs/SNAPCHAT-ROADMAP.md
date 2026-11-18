# Snapchat development lane

The canonical implementation roadmap lives in the SH01 backend repository:

**[Snapchat roadmap](https://github.com/BarrieBretton/sh01-fastapi-server/blob/main/docs/SNAPCHAT-ROADMAP.md)**

That link becomes available once the updated patch is merged into backend `main`.
For local review, open `docs/SNAPCHAT-ROADMAP.md` in your backend checkout.

The roadmap tracks completed code, offline tests, deployment/account activation,
manual and IST-scheduled publication, analytics, later video preparation/effects,
multi-profile support and monetization evidence. Keep status and decisions in that
one canonical document instead of maintaining a second, potentially stale checklist.

This repository owns the **Producers > Snapchat publishing** panel and its fixed
backend route bridge. The backend owns execution, credentials and workbook timing.
Deployment branches are backend `main` and dashboard `master`. The personal/AQI
dashboard is outside this lane.
