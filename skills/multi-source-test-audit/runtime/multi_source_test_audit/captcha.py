from __future__ import annotations

from enum import StrEnum

from .environment_guard import EnvironmentKind, classify_environment
from .errors import ErrorCode, RuntimePolicyError


class CaptchaMode(StrEnum):
    TEST_ENVIRONMENT_DISABLED = "test_environment_disabled"
    MANUAL_INPUT = "manual_input"
    FIXED_TEST_CODE = "fixed_test_code"
    MOCK = "mock"


def validate_captcha_mode(mode: CaptchaMode | str, *, environment: str) -> CaptchaMode:
    try:
        validated = CaptchaMode(mode)
    except ValueError as exc:
        raise RuntimePolicyError(
            ErrorCode.CAPTCHA_BYPASS_FORBIDDEN,
            "CAPTCHA bypass is forbidden; use an explicitly supported test mode.",
        ) from exc
    environment_kind = classify_environment(environment)
    if environment_kind not in {
        EnvironmentKind.DEVELOPMENT,
        EnvironmentKind.TEST,
        EnvironmentKind.STAGING,
    }:
        raise RuntimePolicyError(
            ErrorCode.CAPTCHA_MODE_ENVIRONMENT_MISMATCH,
            "CAPTCHA test modes require an explicitly classified non-production environment.",
        )
    return validated
