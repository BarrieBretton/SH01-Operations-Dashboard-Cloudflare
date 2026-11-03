"""Optional SH01 hook: records future ERROR-level Python logs without stack traces.

In app.py after logger setup:
    from sh01_error_handler import install_ops_handler
    install_ops_handler(logger)

On Render set OPS_DASHBOARD_URL and OPS_INGEST_TOKEN for each SH01 service.
"""
import hashlib
import json
import logging
import os
import re
import threading
import urllib.request
from datetime import datetime, timezone


class OpsHandler(logging.Handler):
    def emit(self, record):
        if record.levelno < logging.ERROR or not os.getenv("OPS_DASHBOARD_URL") or not os.getenv("OPS_INGEST_TOKEN"):
            return
        # Do not send exception/stack or arbitrary formatted log payload. Only
        # the exception class, module and logging template are transferred.
        template = record.msg if isinstance(record.msg, str) else type(record.msg).__name__
        template = re.sub(r"(?i)(token|password|secret|api[_-]?key)\s*[=:]\s*\S+", "[REDACTED]", template)
        template = re.sub(r"eyJ[A-Za-z0-9_-]{18,}\.eyJ[A-Za-z0-9_-]{18,}\.[A-Za-z0-9_-]{12,}", "[REDACTED]", template)
        name = record.exc_info[0].__name__ if record.exc_info and record.exc_info[0] else ""
        message = (record.module + ": " + (name or record.levelname) + " · " + template[:200])[:350]
        at = datetime.fromtimestamp(record.created, timezone.utc).isoformat()
        event_id = hashlib.sha256((at + record.name + message).encode()).hexdigest()
        payload = json.dumps({"source": "sh01", "event_id": event_id, "happened_at": at,
                              "service": os.getenv("RENDER_SERVICE_ID", "sh01"), "message": message}).encode()
        url = os.environ["OPS_DASHBOARD_URL"].rstrip("/") + "/api/ingest/event"
        key = os.environ["OPS_INGEST_TOKEN"]
        def send():
            try:
                req = urllib.request.Request(url, payload, method="POST", headers={
                    "X-INGEST-KEY": key, "Content-Type": "application/json"})
                with urllib.request.urlopen(req, timeout=5):
                    pass
            except Exception:
                pass  # Prevent telemetry failures from affecting app requests.
        threading.Thread(target=send, daemon=True).start()


def install_ops_handler(logger):
    if not any(isinstance(h, OpsHandler) for h in logger.handlers):
        logger.addHandler(OpsHandler())
