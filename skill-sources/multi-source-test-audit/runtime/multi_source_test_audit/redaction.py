from __future__ import annotations

from typing import Any

REDACTED = "***REDACTED***"
_SENSITIVE_KEYS = {
    "password",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "api_key",
    "authorization",
    "cookie",
}


def redact_cell(column: str, value: Any) -> Any:
    normalized = column.strip().lower()
    if normalized in _SENSITIVE_KEYS:
        return REDACTED
    return value
