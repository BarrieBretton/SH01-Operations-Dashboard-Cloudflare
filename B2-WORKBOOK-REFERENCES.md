# B2 workbook reference review — padlock correction

The operator clarified that "Log" meant the padlock beside a Google Sheets tab,
not a separate button. No per-tab Log verification or new environment variable
is required. Existing Google OAuth credentials and workbook ID are reused.

## Sheet selection

Discover every sheet, including hidden sheets. Exclude sheets whose Google API
protection covers the whole sheet, including warning-only whole-sheet protection
and protections expressed using explicit grid bounds. Partial cell-range
protection does not exclude an entire sheet. No sheet is excluded by its name.
Every excluded sheet and its reason appears in the evidence report.

The exact designated titles are `streamables` and `streamables-yt`, confirmed
by the operator's screenshot and live metadata audit. Other spellings are not
silently treated as designated. Any other included-sheet reference protects the
object, regardless of status elsewhere. Newly added unprotected tabs are scanned.

The old OPS_B2_WORKBOOK_POLICY_JSON setting is no longer needed for inclusion,
exclusion or designation. If present, it must still be valid and bound to the
workbook. Optional header_row/default_bucket values apply only when its exact
sheet ID and title match. There is no need to set this variable for ordinary
B2 URLs; they already carry the bucket name.

## Matching and classification

Compare exact bucket + complete object key, or resolve a version ID present in
the listed inventory. Native B2, S3 and b2:// representations are supported.
Ignore signed URL query credentials. Decode URL keys once; preserve case,
Unicode, repeated slashes, plus signs and dot segments. No basename/substrings.
Unqualified paths need verified bucket context to establish eligibility.
Path and ID matches conservatively protect every listed version of the same key.

Read effective values, hyperlinks, rich-text links and JSON strings. Retain all
matching sheets, columns and rows. Deduplicate repeated representations within
the same cell/version. JSON blobs are never used as column headings. Ordinary
column heading labels are not treated as unresolved object references.

- Complete fresh scan, no references, no unresolved issues: Eligible.
- References exclusively in the two designated sheets, every status exactly
  `uploaded`: Eligible. Case/whitespace variants and missing statuses do not pass.
- Known non-designated reference or known non-uploaded designated reference:
  Ineligible, with every blocking reference's exact reason.
- Incomplete/failed/expired scan or uncertain identity without a proven blocker:
  Unable to determine. It is never treated as eligible or unreferenced.
- Hide markers are separate from uploaded file versions and remain ineligible.

Workbook References contains a separate clickable cell link for each reference.
Audit JSON includes workbook ID, sheet ID/title, header name, column letter, row,
cell address, quoted A1 location and cell_url. Coordinates are observations, not
permanent row identities. Re-scan after moving/inserting/deleting rows.

## Scan operation and quotas

The supplied audit contained 47 sheets, 417 B2 versions, zero collected matches,
47 unnecessary Log/lock verification blockers, one false JSON-header reference,
and a Google HTTP 429. This was an incomplete scan, not proof of ineligibility.

This correction scans designated sheets first, combines header/chunk reads into
one grid request, increases bounded chunks to 50,000 cells, spaces successive
chunks by four seconds, and retries read-only quota failures after 65 and 130
seconds. The browser displays the pause; keep the tab open. Retry exhaustion or
other read errors are recorded by sheet, while other sheets can still be scanned.
Matches/links are retained and rendered as chunks arrive. Any failed sheet keeps
absence-based eligibility unknown. Nothing is automatically deleted or queued.

Metadata/policy is checked during scanning and again at completion. Grid growth
in excluded sheets does not invalidate the matching scan. Metadata/policy changes
in included sheets require a restart. These are sequential observations, not an
atomic workbook snapshot; concurrent cell edits can occur between reads.

Read-only evidence expires after ten minutes, clears on lock and invalidates on
file refresh. No report is authorization for a future deletion operation.
Bounds: 10,000 B2 versions, 800,000-character identity payload, 100 chunks,
50,000 total refs/issues. Bounds and failures stay explicit and block eligibility.
Google quotas shared with other dashboard processes may still delay large scans.

## Deployment and validation

Apply the guarded single-file installer and publish dashboard master. After
Cloudflare deployment, hard-refresh the browser, browse B2 files and press
Scan workbook references once. Allow quota pauses to finish. Use the discovery
panel or Download evidence JSON to inspect coverage and remaining real issues.

The patch changes only the Operations Desk. Its B2 preview/delete proxy remains
HTTP 409 (read-only release); FastAPI and n8n routes are unchanged. No workbook
cells or B2 objects were modified/deleted during implementation or tests.
Run `python build_ui.py` and `node --test *.test.mjs` from the ops repo.
Validation uses fixtures including the audit failure patterns, exact statuses,
all reference combinations, canonical cell links, padlock rules, retry behavior,
partial-result retention, filters, authentication and blocked deletion requests.
Live successful scan acceptance remains to be verified after deployment.

## Completed-audit correction: field semantics and row explanations

The completed operator audit reports all 28 included tabs scanned, 19 protected
tabs excluded, 417 object versions, and 348 object/reference matches. It records
the illustrated video at streamables-yt!G2 with exact status uploaded and a cell
link. The other illustrated 1.05 GB video has no recorded match. These are scan
observations, not a claim of present-day absence or permission to delete.

Its 94 global flags comprise 36 Taskboard Priority formula errors, 42 provider
column heuristics in tokens, 10 Telegram file-ID heuristics and 6 unresolved
render_b2_file_name values. The revised scanner:
- treats a provider name alone (BackBlaze B2) as a heading, not a file-ID schema;
- recognizes the code-confirmed Telegram file_id/audio_file_id field semantics;
- retains Taskboard Priority formula errors as informational warnings unless
  their formula/link evidence explicitly contains a B2 reference;
- still matches explicit B2 URLs or exact listed IDs/keys in EVERY column,
  including the above fields; no entire sheet or column is skipped;
- scopes an unresolved literal file-name/key to that exact key, without case or
  substring matching, rather than blocking every unrelated filename;
- continues to block globally for unknown B2 IDs, malformed B2 references,
  unresolved file-reference formula errors, and incomplete scans.

Do not infer that all opaque encodings/custom aliases are supported. Failed
formula results cannot be reconstructed; the narrow Priority treatment assumes
the task-attribute meaning of that field, while explicit B2 evidence overrides it.

Each row now has an eligibility_explanation (including positive eligibility
reasons) and review_issues with the actual blocking coordinates and cell links.
Deletion Ineligibility Reason remains blank for eligible rows in the audit JSON;
the table's combined explanation column displays the positive reason instead.
Informational warnings and unresolved issues remain separately visible in the
report. A fresh scan is required; the old audit is not retroactively relabeled.

## Visible loading feedback

An activity panel above the scan controls shows a spinner, current sheet,
processed-sheet progress and match count. File loading, sheet discovery,
scanning, final verification and quota waits have distinct labels. Quota pauses
show an automatic-retry countdown. Completion stops the spinner; lock clears the
panel. Reduced motion is supported. Pending rows explain that scanning is in
progress rather than asking users to refresh. Eligibility rules are unchanged.
