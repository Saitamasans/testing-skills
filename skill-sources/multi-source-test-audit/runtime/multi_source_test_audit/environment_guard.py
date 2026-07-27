from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from urllib.parse import urlparse

from .errors import ErrorCode, RuntimePolicyError


class EnvironmentKind(StrEnum):
    DEVELOPMENT = "development"
    TEST = "test"
    STAGING = "staging"
    PRODUCTION = "production"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class ExecutionTargetPolicy:
    environment: EnvironmentKind
    allowed_origins: frozenset[str]
    production_origins: frozenset[str]


def classify_environment(name: str) -> EnvironmentKind:
    normalized = name.strip().lower()
    if normalized in {"prod", "production", "正式", "线上"}:
        return EnvironmentKind.PRODUCTION
    if normalized in {"dev", "development", "开发"}:
        return EnvironmentKind.DEVELOPMENT
    if normalized in {"test", "testing", "qa", "测试"}:
        return EnvironmentKind.TEST
    if normalized in {"staging", "stage", "preprod", "预发布"}:
        return EnvironmentKind.STAGING
    return EnvironmentKind.UNKNOWN


def assert_dynamic_allowed(environment: EnvironmentKind) -> None:
    if environment is EnvironmentKind.PRODUCTION:
        raise RuntimePolicyError(
            ErrorCode.PRODUCTION_EXECUTION_REJECTED,
            "Dynamic execution in production is forbidden in version 1.",
        )
    if environment is EnvironmentKind.UNKNOWN:
        raise RuntimePolicyError(
            ErrorCode.UNKNOWN_ENVIRONMENT,
            "Dynamic execution requires an explicitly classified non-production environment.",
        )


def assert_url_allowed(
    url: str,
    policy: ExecutionTargetPolicy,
) -> None:
    assert_dynamic_allowed(policy.environment)
    origin = _normalize_origin(url)
    configured = {_normalize_origin(value) for value in policy.production_origins}
    if origin in configured:
        raise RuntimePolicyError(
            ErrorCode.PRODUCTION_EXECUTION_REJECTED,
            "Configured production origins are forbidden for dynamic execution.",
            details={"origin": origin},
        )
    allowed = {_normalize_origin(value) for value in policy.allowed_origins}
    if origin not in allowed:
        raise RuntimePolicyError(
            ErrorCode.UNAPPROVED_TARGET,
            "Dynamic execution target is not in the approved origin allowlist.",
            details={"origin": origin},
        )


def _normalize_origin(url: str) -> str:
    parsed = urlparse(url.strip())
    scheme = parsed.scheme.lower()
    if scheme not in {"http", "https"} or not parsed.hostname:
        raise RuntimePolicyError(
            ErrorCode.UNAPPROVED_TARGET,
            "Only explicit HTTP or HTTPS origins can be approved.",
        )
    try:
        host = parsed.hostname.encode("idna").decode("ascii").lower()
        port = parsed.port or (443 if scheme == "https" else 80)
    except (UnicodeError, ValueError) as exc:
        raise RuntimePolicyError(
            ErrorCode.UNAPPROVED_TARGET,
            "Execution origin is invalid.",
        ) from exc
    return f"{scheme}://{host}:{port}"
