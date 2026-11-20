# Snapchat development lane

The canonical implementation roadmap lives in the SH01 backend repository:

**[Snapchat roadmap](https://github.com/BarrieBretton/sh01-fastapi-server/blob/main/docs/SNAPCHAT-ROADMAP.md)**

The pilot is merged in both repositories. Resume with **Producers → Snapchat
publishing → Refresh status** to check the routed backend before connecting the
Public Profile or enabling a schedule.

The roadmap tracks completed code, offline tests, deployment/account activation,
manual and IST-scheduled publication, analytics, later video preparation/effects,
multi-profile support and monetization evidence. Keep status and decisions in that
one canonical document instead of maintaining a second, potentially stale checklist.

This repository owns the **Producers > Snapchat publishing** panel and its fixed
backend route bridge. The backend owns execution, credentials and workbook timing.
Deployment branches are backend `main` and dashboard `master`. The personal/AQI
dashboard is outside this lane.
