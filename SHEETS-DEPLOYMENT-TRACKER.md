# Sheets storage rollout evidence

| Gate | Current evidence |
|---|---|
| Local follow-up baseline | Successful 41-file Sheets migration reported by operator; direct API follow-up not yet applied |
| Application and direct storage tests | Local automated tests; see SHEETS-TEST-REPORT.md |
| Live Google revision-guard probe | Pending `migrate_d1_to_sheets.py --setup-only` |
| Existing D1 source frozen for migration | Pending operator action |
| All 18 source/destination table hashes match | Pending `sheets-migration-report.json` PASS |
| Worker `SHEETS_STORAGE_READY=1` | Pending verified copy |
| Deployed read-only API verification | Pending `verify_sheets_storage.py` |
| First post-cutover producer sync | Pending; preserve strict staged + approved=yes rule |
| First Meta sync / real API permissions | Pending; migration does not validate credentials or metric availability |
| Optional mapping/clickouts writes | Preserve prior deliberate flag; independently verified |
| External error/publisher collectors resumed | Pending |
| First private Sheets backup | Pending |

Do not put secret values or worksheet contents into this tracker. Record only commit/deployment IDs, timestamps and counts. The former D1 database is a pre-cutover snapshot, not an automatically updated backup. Rolling back to it after new Sheets writes would discard those new changes unless reconciled first.
