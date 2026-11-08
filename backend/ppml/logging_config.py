"""Structured, privacy-conscious logging.

Logs are emitted as single-line JSON. A redaction filter scrubs e-mail addresses and
phone-number-like strings from every message so that dataset contents never leak into logs.
"""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import datetime, timezone

_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_PHONE = re.compile(r"\+?\d[\d\s().-]{7,}\d")


def scrub(text: str) -> str:
    """Remove e-mail addresses and phone-like sequences from ``text``."""
    return _PHONE.sub("[REDACTED_PHONE]", _EMAIL.sub("[REDACTED_EMAIL]", text))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": scrub(record.getMessage()),
        }
        extra = getattr(record, "ctx", None)
        if isinstance(extra, dict):
            payload["ctx"] = {k: scrub(str(v)) for k, v in extra.items()}
        if record.exc_info:
            payload["exc"] = scrub(self.formatException(record.exc_info))
        return json.dumps(payload)


def configure_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    root.addHandler(handler)
    root.setLevel(level.upper())
    # Opacus emits noisy warnings about secure RNG; keep them but at WARNING level.
    logging.getLogger("uvicorn.access").setLevel("WARNING")
