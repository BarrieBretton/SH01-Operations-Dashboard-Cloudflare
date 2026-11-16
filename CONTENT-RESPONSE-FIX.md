# Duplicate-group response handling fix

Scope: Content & analytics duplicate groups and removal queue response handling. No infrastructure adapters, B2 eligibility, storage caps or file deletion behavior are changed.

The browser previously called response.json() before handling HTTP failures. HTML error pages caused a raw Unexpected token '<' error that hid the HTTP status. Responses are now checked for HTML and invalid JSON shapes; errors preserve the status and a safe Cloudflare/Worker request reference. Raw HTML and exception messages are never rendered. There are no automatic mutation retries.

The initial duplicate picker requests index_only=1. It still receives the complete candidate index and coverage, but no longer builds and signs preview-rich details for twenty groups. Existing selection logic fetches the chosen group's details on demand. The old endpoint shape remains supported for other callers. This reduces unnecessary work; it does not establish that resource exhaustion caused the reported production incident.

If queue submission succeeds and its following GET refresh fails, the UI now distinguishes those outcomes and tells the user to refresh rather than resubmit. If submission itself has no verifiable response, it retains the unknown-outcome warning and discards the stale plan.

Unexpected Worker exceptions return sanitized HTTP 500 JSON with X-Ops-Request-ID and a matching log entry. Known storage failures retain 503/Retry-After and known validation failures retain 400. Invalid request-body JSON remains a 400 error. Logs include path (not query), method, exception class and error code; they do not contain request payloads, response HTML, tokens or raw exception messages.

Cloudflare-generated errors outside the Worker can still be HTML. This patch makes those errors intelligible; their underlying provider/network/runtime cause cannot be determined from the original screenshot alone. A continued failure after deployment needs its status/reference and matching Worker execution log. The patch does not silently treat a failed read as an empty group list or an empty queue.

Validation: 305 JavaScript tests passed, including HTML read errors, ambiguous writes without retry, accepted writes followed by failed refreshes, index-only detail loading, sanitized 500s and preserved quota handling. Installer application, idempotence and conflict refusal were checked offline. Production recovery is not verified until the deployed endpoints succeed.
