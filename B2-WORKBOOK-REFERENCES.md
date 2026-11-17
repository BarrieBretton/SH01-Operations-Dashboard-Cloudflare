# B2 workbook reference review

This release is read-only. It does not delete B2 objects, edit workbook cells,
change n8n workflows, or change FastAPI. Operations Desk B2 preview/delete proxy
routes now return HTTP 409 `b2_deletion_disabled_reference_review_only`, including
calls from old browser tabs. Existing FastAPI/n8n routes are unchanged.
Classification is evidence, never deletion authorization.

## Inspection and live acceptance

The deployed master component files matched this patch's source baseline.
The desk reuses Google OAuth and GOOGLE_SHEETS_SPREADSHEET_ID. B2 listings come
from FastAPI's control-plane API. The existing stock collector reads fixed tabs;
it cannot prove workbook-wide absence of a reference.

Historical n8n source registry titles: Foglio1, Links, Sheet1, affiliate-links,
captions-archive, clickouts, media-edit-clips, pinterest-search-queries,
streamables, streamables-yt, telegram_audio_social_queue, workflow-schedule,
yt-accounts-mapper-store. These are NOT verified current workbook tabs or
verified unlocked/unlogged sheets. `streamables-yt` is not automatically treated
as `Streamables-VT`. Live Google credentials were unavailable in this session.

After deploying master, open Infrastructure > Browse files. Complete the B2
listing, then **Scan workbook references**. The discovery panel enumerates ALL
tabs including hidden tabs, exact IDs/titles, protections, coverage and issues.
All allocated grid columns are scanned, including those beyond AZ. Download
**evidence JSON** for the full report; keep its object names/statuses private.

Google Sheets API exposes protections, but not a reliable custom Log drawing
button inventory. Verify those indicators in the actual workbook. Without this
verification, no API protection does NOT prove an unlogged/unlocked sheet.
Unreviewed sheets block eligibility. Whole-sheet enforced protection excludes
a sheet; partial/warning-only protection remains unresolved.

Set OPS_B2_WORKBOOK_POLICY_JSON on the dashboard Worker, using actual workbook
and numeric sheet IDs, exact titles and verified flags. Example ONLY:

```json
{
  "version": 1,
  "workbook_id": "YOUR_EXISTING_WORKBOOK_ID",
  "sheets": {
    "123": {
      "title": "Streamables", "mode": "include",
      "no_log_button": true, "unlocked": true, "header_row": 1,
      "default_bucket": "YOUR_VERIFIED_BUCKET_NAME"
    },
    "456": {
      "title": "Archive", "mode": "include",
      "no_log_button": true, "unlocked": true, "header_row": 1
    },
    "789": { "title": "Actual logged tab", "mode": "exclude_logged" }
  }
}
```

Do not exclude sheets merely because their name contains "log". Newly added or
renamed tabs become unreviewed. Deleted tabs disappear at the next discovery.
Only exact Streamables / Streamables-VT are designated by default. If inspection
proves another spelling is the intended designated stock tab, explicitly add
`"designated_uploaded_only": true` to THAT reviewed sheet entry. Never add it
to Archive or other reference sheets. The exact `status` column is required.
`default_bucket` is optional and only valid after verifying unqualified paths'
bucket. Per-row bucket/bucket_name/b2_bucket/b2_bucket_name also supplies context.
Refresh files and scan again after configuring the policy.

## Matching and rules

- Native B2, S3 path/virtual-host URLs, b2://bucket/key, exact version IDs, and
  exact paths with verified bucket context. Decode URL keys once; preserve case,
  Unicode, plus signs, repeated slashes and dot segments. No basename/substrings.
- Read effective values, formula hyperlinks/literal URL arguments, rich-text
  links and JSON strings. Headers label columns; A1 letters disambiguate blanks
  and duplicate headers. References in/before the header are protected.
- IDs and paths conservatively match all listed versions of the same bucket/key.
  Multiple coordinates are retained; repeated representations per cell dedupe.
- No refs + complete fresh issue-free evidence => Eligible.
- Exclusively designated refs + every exact status `uploaded` => Eligible.
  Case/whitespace variants, missing/duplicate status columns, errors fail.
- Any other qualifying sheet ref => Ineligible, overriding uploaded elsewhere.
  Every blocking reference contributes its sheet/column/row/status/rule reason.
- Unknown references, absent bucket context, malformed URLs, unresolved IDs,
  unsupported custom URLs in file-reference columns, access/formula errors,
  incomplete scans and limits => manual review. They never mean Unreferenced.
  Unrecognized opaque formats/custom download aliases need explicit integration;
  unrelated generic URLs are not assumed to be B2. No arbitrary URLs are fetched.

## Display and limits

Preserves filename/ID, size, uploaded time and action. Adds Workbook Reference
Status, Workbook References, Deletion Eligibility, Deletion Ineligibility Reason.
Reference and eligibility filters combine with folder/search/sort (largest first).
Only current eligible rows can be selected for READ-ONLY evidence review.

Evidence expires after 60 seconds; refresh invalidates it and lock clears it.
The report records the observation window. Google grid reads are not an atomic
workbook snapshot; concurrent edits can happen between chunks. Labels must not
be reused as deletion authorization. There is no persisted cell-content cache.

Bounds: 20,000 cells/request; 10,000 B2 versions; 800,000-character identity
payload; 100 chunks/scan; 50,000 refs/issues. Limit/quota/HTTP failures are explicit
and block eligibility. Google read quotas may interrupt large scans; retry after
quota recovery. Prefix-scoped inventories cannot resolve IDs outside that scope.

Authenticated read-only routes:
GET /api/infra/control/b2/workbook — discovery/protection/policy report.
POST /api/infra/control/b2/reference-scan — reads a chunk against the displayed
inventory; browser-supplied identities are NOT an authoritative deletion grant.
No eligibility claim from this endpoint can authorize a write.

## Validation

From the ops repo: `python build_ui.py`, then `node --test *.test.mjs`.
Fixtures cover identities/encoding, all rule combinations, exact statuses,
multiple references, overrides, protections, metadata changes, auth, columns
beyond AZ, filters, expiration and disabled deletion routes. No live deletion
or workbook mutation was tested. Full live discovery and Log-button verification
remain acceptance steps; they have not been represented as completed.
