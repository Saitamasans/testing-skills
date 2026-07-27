from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from .errors import ErrorCode, RuntimePolicyError

RequestData = dict[str, Any]
CredentialProvider = Callable[[], dict[str, str]]
RequestHook = Callable[[RequestData], RequestData]
ResponseHook = Callable[[Any], Any]
TokenRefresher = Callable[[Any], Any]
_SECURITY_OWNED_FIELDS = frozenset(
    {
        "project_id",
        "batch_id",
        "environment",
        "account_alias",
        "commit",
        "approved_numbers",
        "effect",
        "chain_id",
        "resource",
        "data_id",
        "url",
        "target_id",
        "database",
        "sql",
        "method",
    }
)


@dataclass(frozen=True)
class AdapterHooks:
    credential_provider: CredentialProvider | None = None
    login_provider: Callable[[], Any] | None = None
    request_preprocessor: RequestHook | None = None
    signature_provider: RequestHook | None = None
    response_postprocessor: ResponseHook | None = None
    token_refresher: TokenRefresher | None = None


@dataclass(frozen=True)
class ProcessedResponse:
    raw: Any
    processed: Any


def apply_request_hooks(hooks: AdapterHooks, request: RequestData) -> RequestData:
    security_snapshot = {
        key: deepcopy(request[key]) for key in _SECURITY_OWNED_FIELDS if key in request
    }
    current = deepcopy(request)
    if hooks.request_preprocessor is not None:
        current = hooks.request_preprocessor(current)
        _assert_security_fields_unchanged(current, security_snapshot)
    if hooks.signature_provider is not None:
        current = hooks.signature_provider(current)
        _assert_security_fields_unchanged(current, security_snapshot)
    return current


def _assert_security_fields_unchanged(
    request: RequestData,
    snapshot: RequestData,
) -> None:
    changed = sorted(
        field
        for field in _SECURITY_OWNED_FIELDS
        if (field in request) != (field in snapshot)
        or (field in snapshot and request[field] != snapshot[field])
    )
    if changed:
        raise RuntimePolicyError(
            ErrorCode.ADAPTER_POLICY_VIOLATION,
            "Project adapters cannot modify security-owned request fields.",
            details={"fields": changed},
        )


def resolve_adapter_credentials(hooks: AdapterHooks) -> dict[str, str]:
    provider = hooks.credential_provider
    if provider is None:
        raise _missing_hook("credential_provider")
    credentials = provider()
    if not credentials or any(not key.strip() or not value for key, value in credentials.items()):
        raise RuntimePolicyError(
            ErrorCode.ADAPTER_POLICY_VIOLATION,
            "Credential provider returned an incomplete runtime credential mapping.",
        )
    return credentials


def run_adapter_login(hooks: AdapterHooks) -> Any:
    if hooks.login_provider is None:
        raise _missing_hook("login_provider")
    return hooks.login_provider()


def apply_response_hook(hooks: AdapterHooks, response: Any) -> ProcessedResponse:
    raw = deepcopy(response)
    if hooks.response_postprocessor is None:
        return ProcessedResponse(raw, deepcopy(response))
    return ProcessedResponse(raw, hooks.response_postprocessor(deepcopy(response)))


def refresh_adapter_token(hooks: AdapterHooks, token: Any) -> Any:
    if hooks.token_refresher is None:
        raise _missing_hook("token_refresher")
    return hooks.token_refresher(token)


def _missing_hook(name: str) -> RuntimePolicyError:
    return RuntimePolicyError(
        ErrorCode.ADAPTER_POLICY_VIOLATION,
        "Required project adapter hook is unavailable.",
        details={"hook": name},
    )
