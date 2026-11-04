<!-- SH01 DIRECT SHEETS FOLLOW-UP BEGIN -->
> **Current storage instructions:** the existing Cloudflare Worker calls the Google Sheets API directly using its existing Google OAuth credentials. No Apps Script project, gateway URL or gateway secret is required. Follow [../SHEETS-MIGRATION.md](../SHEETS-MIGRATION.md): deploy with `SHEETS_STORAGE_READY=0`, verify the live write guard and all-table copy, then set `SHEETS_STORAGE_READY=1`. Cloud deployment and cutover remain pending until verified. Existing optional business-sheet write flags and platform credentials remain in their current scopes. Older storage/deployment instructions below are historical where they differ from this guide.
<!-- SH01 DIRECT SHEETS FOLLOW-UP END -->

# SH01 publication registration and clickouts deletion

## What is delivered

| File | Purpose | Initial state |
| --- | --- | --- |
| `register-published-post.n8n.json` | Shared subworkflow that validates a published-post record and registers it in the dashboard | Inactive; ingestion credential unbound |
| `clickouts-deletion.n8n.json` | Reads `clickouts.URLS` or supplied URLs; previews deletion and accepts a separately confirmed execution | Inactive; Google and social credentials unbound |
| `instrument_publishers.py` | Adds a separate registration branch to explicitly mapped success outputs in a private n8n export | Local file transformation; no network or n8n updates |
| `publisher-mappings.example.json` | Exact mapping schema, using placeholders | Replace after inspecting real final publication outputs |
| `test_workflows.py` | Python structural and instrumentation regression checks | Run with Python; no Node installation required |

**Code-confirmed:** these templates, validation, dry-run defaults and explicit graph transformation. **Unverified:** imports and executions on the live n8n instance, credential bindings, deployed FastAPI endpoint availability and current provider permissions. No workflow has been imported, activated, or modified through an API by this package.

The source register in `../producer-sources.json` contains metadata for 70 exported workflows. It does not contain enough final publication responses, hidden CFG values or credential context to safely instrument all of them. The script never reads that register as executable workflow source and never infers missing mappings.

## 1. Register a successfully published post

1. In n8n, import `register-published-post.n8n.json` as a new workflow. Leave it inactive during setup.
2. Create an **HTTP Header Auth** credential with header name **`X-INGEST-KEY`** and the dashboard's `INGEST_TOKEN` as its value. Select it on **Register published post**. Neither a credential ID nor a value is bundled.
3. After a final publish operation has succeeded, map the nine fields below with Edit Fields. Call this child through Execute Sub-workflow, passing the normalized items. Select the imported child by its actual n8n ID; this package does not guess it. Configure the caller to wait for completion while validating the integration.
4. Check one known published item in the dashboard, then decide whether to publish/enable the parent workflow. n8n versions differ in child publication requirements; use the UI's validation and do not automatically activate unrelated workflows. An inactive flag alone is not an authorization boundary for manually invoked subworkflows.

Every required value must be a nonempty string. Keep all provider IDs as strings from their original JSON response; converting an already-rounded JavaScript number to text cannot recover it. Accepted media types are `IMAGE`, `VIDEO`, `REELS`, `STORY`, `CAROUSEL`, `CAROUSEL_ALBUM`, and `POST`.

```json
{
  "platform": "instagram",
  "account_id": "EXAMPLE_ACCOUNT_ID",
  "account_handle": "example_handle",
  "post_id": "EXAMPLE_FINAL_PUBLISHED_ID",
  "permalink": "https://www.instagram.com/p/EXAMPLE_SHORTCODE/",
  "media_type": "IMAGE",
  "published_at": "2026-11-04T12:00:00Z",
  "workflow_id": "EXAMPLE_WORKFLOW_ID",
  "workflow_url": "https://n8n-prod-1.vivojaymail.workers.dev/workflow/EXAMPLE_WORKFLOW_ID"
}
```

This is a shape example, not a real post. Missing or invalid fields fail validation. The workflow sends only this metadata as `{ "posts": [record] }` to:

`POST https://sh01-operations-dashboard-cloudflare.vivojaymail.workers.dev/api/ingest/posts`

The current dashboard upserts on `(platform, account_id, post_id)`, so the HTTP ingestion step can retry safely. A failed registration does not undo an already published post. Retry the failed ingestion step or invoke the child with the saved metadata; **do not rerun the publish operation** to repair the ledger. Existing execution retention can contain private data; keep source exports and review outputs private.

### Choose the final publish-success node

| Platform | Correct identifier | If the final response contains only an ID |
| --- | --- | --- |
| Instagram | `id` returned by successful `POST /{ig-user-id}/media_publish` | Read `GET /{published-id}?fields=id,permalink,media_type,media_product_type,timestamp,owner,username` using the existing authorized Meta credential. Merge verified context into the normalized record. |
| Facebook | Final Page post ID returned by publication, or the final video ID when the record represents the video object | Read the corresponding Graph object for `permalink_url` and `created_time`; video objects can expose a separate `post_id`. Preserve which object is being registered. |
| Tumblr | Final `id_string` / string post ID from successful publication | Read `GET /v2/blog/{owned-blog}/posts/{post-id}` with the authorized Tumblr credential; use the returned `post_url` and publication time. |

Use the correct Graph host and configured version for the existing login path. These read examples describe field lookups, not credential configuration. A workflow may already obtain all metadata; reuse those verified fields. Do not construct Instagram permalinks from numeric IDs. Do not register an Instagram `/media` upload/container ID, a pending async job ID, or an unsuccessful result. The validator cannot distinguish a container ID from a published ID by its digits; placement and mapping must establish this.

## 2. Instrument selected existing publishers using Python

Use a **private full workflow export** from your own n8n instance. Do not use a credentials export, the metadata-only register, or a redacted CFG export. No full live export is included here.

1. Copy `publisher-mappings.example.json` to a private mappings file.
2. For each selected publisher, enter the exact exported `workflow_id`, final success `node_id`, and `output_index`. Inspect that node's successful output and set `final_published_id_verified=true` only after confirming it is a published object.
3. Supply a Boolean `success_expression` that is true only for successful publication. Supply n8n expressions for every normalized field. The example assumes an already normalized source; it does not claim the existing workflows have those fields. Use explicit references to the inspected nodes where needed. Expressions run with n8n privileges, so use only your own reviewed mappings.
4. Run locally or in a private Python notebook. No Node installation is needed:

```bash
python workflows/instrument_publishers.py \
  --export /private/full-n8n-workflows.json \
  --mappings /private/publisher-mappings.json \
  --output /private/instrumented-review.json \
  --report /private/instrumentation-report.json
```

The output contains **only mapped workflows**, all with `active=false`. Unmapped workflows appear as `skipped_no_mapping` in a metadata inventory. Source nodes, parameters, credential references, and existing downstream connections are preserved; three nodes and a separate branch are added: field mapping, validation, and HTTP registration. The new HTTP nodes have no credential binding. A false success predicate produces no registration; incomplete data for a true predicate fails validation.

The tool does not overwrite any file, activate workflows, call APIs, edit credentials, alter hidden CFG, or resolve missing IDs. Review outputs contain the original mapped workflow bodies and may contain secrets that were already inline in the source. The files are created with private permissions where the operating system supports them; do not commit or share them. The report contains only workflow/node metadata, not field expressions or credential values.

Rerunning with identical mappings and the unmodified generated export produces the same graph and no duplicate hooks. A modified or partially installed hook causes an explicit failure for manual review. After binding the new credential in n8n, do not overwrite it with another generated export. Import behavior varies by n8n version: review workflow IDs before import, preserve an original backup, and use an inactive review copy first. Existing edges are unchanged, but registration failure can fail the workflow execution; this is intentional visibility and is not a signal to repeat publication.

## 3. Preview clickouts from the existing workbook

Import `clickouts-deletion.n8n.json`. Bind:

- **Read URLS from clickouts:** Google Sheets OAuth access to the existing workbook.
- **Preview or execute reviewed deletion:** HTTP Header Auth named **`X-API-KEY`**, using the server's key for the social inventory/deletion endpoint. Other SH01 keys are not interchangeable.

There is no schedule, webhook, or automatically activated trigger. Call the workflow with Execute Sub-workflow and **one request envelope**:

```json
{
  "source": "sheet",
  "mode": "preview",
  "document_id": "REPLACE_WITH_EXISTING_WORKBOOK_ID",
  "sheet_name": "clickouts",
  "platform": "instagram",
  "account_id": "EXACT_OWNED_ACCOUNT_ID"
}
```

`document_id` is the existing Google spreadsheet ID, not a new workbook. Its placeholder is `DOCUMENT_ID`; the workflow rejects that placeholder. The sheet must have a **`URLS`** column with one permalink per nonblank row. Optional `platform` and `account_id` columns override the envelope values; a platform must be explicitly supplied. No platform, account, or IDs are inferred from workflow names. An omitted account lets the server resolve ownership; ambiguous ownership must fail server-side. The node reads rows only and never marks them completed or removes them.

At most 25 nonblank rows are accepted per invocation. A larger sheet fails before sending deletion requests; use supplied input to preview a selected batch. Sheet-origin requests always send `dry_run:true`, even if a sheet contains columns named `confirmation` or `mode`. To execute, separately submit one reviewed target using the input mode below.

## 4. Preview supplied URLs and explicitly execute one

Default input preview:

```json
{
  "source": "input",
  "items": [{
    "platform": "tumblr",
    "permalink": "https://www.tumblr.com/EXAMPLE_BLOG/123456789012345678",
    "account_id": "EXAMPLE_BLOG"
  }]
}
```

The HTTP node calls `POST https://sh01.vivojaymail.workers.dev/social/posts/delete` with:

```json
{
  "platform": "tumblr",
  "permalink": "https://www.tumblr.com/EXAMPLE_BLOG/123456789012345678",
  "account_id": "EXAMPLE_BLOG",
  "dry_run": true,
  "confirmation": null
}
```

Expected preview contract: `{ "status":"preview", "post_id":"...", "account_id":"...", "platform":"...", "permalink":"...", "confirmation":"DELETE platform:account_id:post_id" }`. Confirm ownership and the exact post in the provider, then use **the actual returned confirmation unchanged** in a separate invocation:

```json
{
  "source": "input",
  "mode": "execute",
  "items": [{
    "platform": "tumblr",
    "permalink": "https://www.tumblr.com/EXAMPLE_BLOG/123456789012345678",
    "account_id": "EXAMPLE_BLOG",
    "confirmation": "DELETE tumblr:EXAMPLE_BLOG:123456789012345678"
  }]
}
```

The example values are not a real confirmation. Execute accepts exactly one item, requires explicit `mode:"execute"`, sends `dry_run:false`, and still depends on the server's enable flag, current ownership verification and exact confirmation match. The workflow does not automatically turn preview results into executions. HTTP automatic retries are disabled: after a timeout, check whether the provider already deleted the post before retrying. Neither D1 Time Travel nor a sheet row can restore a deleted social post.

For duplicates, explicitly choose the keeper or the posts to delete before invoking this workflow. There is no implicit keep-best/keep-worst rule. Repeated local rows for the same provider post are not separate remote copies; deleting that remote object removes the single actual post. Never send a repeated permalink as proof of duplicate media.

## Validation and maintenance

```bash
python -m unittest discover -s workflows -p 'test_workflows.py' -v
```

The tests check JSON structure, credential-free templates, inactive state, preview defaults, immutable original nodes/edges, metadata-only unmapped reporting, and repeat idempotency. They do not claim a live n8n import, provider permission check, or real deletion. To rebuild JSON after editing the bundled Code-node sources, run `python workflows/build_workflows.py` and rerun tests. Existing workflows are not touched by the builder.

## Official references

- [n8n subworkflow trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflowtrigger/)
- [n8n HTTP Request credentials](https://docs.n8n.io/integrations/builtin/credentials/httprequest/)
- [n8n Google Sheets row operations](https://docs.n8n.io/integrations/builtin/app-nodes/n8n-nodes-base.googlesheets/sheet-operations/)
- [Meta's current IGMedia SDK](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/igmedia.py): published media fields and `DELETE /{ig-media-id}` exist; the older blanket claim that Instagram has no deletion API is obsolete. Current permission/login-path eligibility must still be verified against your app.
- [Meta's Post SDK](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/post.py) and [video SDK](https://github.com/meta/facebook-python-business-sdk/blob/main/facebook_business/adobjects/advideo.py): separate object IDs and deletion methods.
- [Meta's official Instagram examples](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api): creation/container and final `media_publish` result IDs are distinct.
- [Tumblr API](https://github.com/tumblr/docs/blob/master/api.md): 64-bit string identifiers, post read, and OAuth `POST /v2/blog/{blog-identifier}/post/delete`.
- [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/): database recovery, not social-platform undelete.
