# Content upgrade deployment tracker

Updated 2026-11-04. Mark only what has evidence. Record commit IDs, Worker version, timestamps and counts; never credential values, private Sheet rows or signed URLs. Local installation is not proof of deployment.

## Current checkpoint

| Surface | Evidence | State |
| --- | --- | --- |
| 39-file content patch in local dashboard checkout | Operator supplied CHECK PASSED / PATCH APPLIED | Reported complete |
| Local `build_ui.py` | Operator supplied rebuilt message | Reported complete |
| Earlier producer sync | 7 pools, 1,291 items checked, 70 workflow definitions, live_sheet routing | Earlier observed checkpoint only |
| New local tests | Upgrade preparation: 80 tests across JS/Python with mocks/synthetic media | Local evidence; no live provider validation |
| Content schema, new deployment and runtime settings | No output supplied yet | Pending |
| FastAPI companion installation/deployment | Previous patch only included files in dashboard repo | Pending |
| n8n imports/publisher integrations | Templates and local transform only | Pending |

## Ordered rollout

- [ ] Apply documentation follow-up; check dashboard README/handbook/config register.
- [ ] Apply companion to the separate FastAPI checkout with `--fastapi-repo`; check its README/handbook/requirements/router diff.
- [ ] Export existing dashboard D1 privately before migration; record backup date/checksum outside Git if private.
- [ ] Apply `content-schema.sql` in existing D1 Console. Never replace this database.
- [ ] Commit/push dashboard changed-file manifest; record commit: __________.
- [ ] Cloudflare Git deployment succeeded; Worker version/time: __________.
- [ ] Confirm `DB` binding, UI-managed variables preserved, two cron triggers and unchanged Worker URL.
- [ ] Run `python verify_content.py`; record schema/status/count result, including empty datasets honestly.
- [ ] Manual Meta sync succeeds or partial capabilities are recorded. Enable `META_SYNC_ENABLED=1` and observe a later scheduled run.
- [ ] Verify Google OAuth write grant and workbook editor access if enabling mapping/clickouts writes. Check existing clickouts consumer ownership first.
- [ ] Set `GOOGLE_SHEETS_WRITE_ENABLED=1`, create/verify mapping tab through UI and observe mirror status. No live deletion needed for this check.
- [ ] Commit/push FastAPI changes to main; record commit: __________.
- [ ] Redeploy chosen Render worker backend(s); record service IDs/commits. Leave master social endpoint key unset unless intentionally needed there.
- [ ] Configure companion accounts and credentials; keep deletion disabled. Check OpenAPI route presence and a small authorized scan.
- [ ] Verify one image and one video scan under real resource limits; inspect partial/error flags and preview playback.
- [ ] Import publisher child in relevant n8n instance(s), bind credential, map one known final publish result and confirm registry/mirror record. Do not republish to retry registration.
- [ ] Track every remaining publisher in the coverage table below; do not mark all 70 integrated from an imported template.
- [ ] Import deletion template only if wanted; bind credentials and test preview. Keep it inactive and choose one consumer for clickouts.
- [ ] Before enabling any execution, explicitly select keep-best/keep-worst, review actual targets and verify provider authorization. Do not use a production deletion as a generic smoke test.

## Publisher coverage register

| n8n instance / workflow ID | Final publisher node ID | Platform / owned account ID | Final ID/permalink verified | Registration hook / credential bound | Last successful recording | Remaining gap |
| --- | --- | --- | --- | --- | --- | --- |
| Not inventoried for this rollout yet | — | — | No | No | — | Requires real unredacted graph/output inspection by owner |

## Render deployment register

| Service ID / role | Deployed commit | Companion configured | Delete flag | Last small-scan result |
| --- | --- | --- | --- | --- |
| Fill for each eligible SH01 worker | Unknown | Unverified | Keep disabled | Unverified |

## Known boundaries

Meta collection is bounded/partial and the code does not implement every requested Meta Business Suite metric, advertising insights, account demographics or historical backfill guarantees. Fingerprints suggest candidates; crop-match precision on real media is unverified. Native previews depend on API/CDN availability. The current patch has no automatically scheduled scanner/deleter. An older clickouts consumer can still act on appended links. No live changes were made by the patch generator.

## Rollback

Set `META_SYNC_ENABLED=0` and `GOOGLE_SHEETS_WRITE_ENABLED=0` to stop new optional collector/writer work; turn off any separate downstream clickouts consumer if queue processing must stop. Set `SOCIAL_DELETE_ENABLED=0` on every configured executor. Roll source back through Git/known Worker versions; local patch backups are outside Git. Leave additive D1 tables intact unless a separately reviewed migration is required. A rollback does not undo a post already deleted at Meta/Tumblr or a Sheet append already consumed. Preserve `uncertain` outbox records until reconciled with Sheet/provider evidence.
