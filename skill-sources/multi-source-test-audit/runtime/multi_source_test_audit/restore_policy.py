from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .errors import ErrorCode, RuntimePolicyError


class RestoreMethod(StrEnum):
    NORMAL_INTERFACE = "normal_interface"
    ADMIN = "admin"
    LOGICAL_FIELD = "logical_field"


@dataclass(frozen=True)
class RestorePlan:
    method: RestoreMethod
    original_record_preserved: bool
    operation_trace_preserved: bool


def validate_restore_plan(
    method: RestoreMethod,
    *,
    delete_semantics_known: bool,
    original_record_preserved: bool,
    operation_trace_preserved: bool,
) -> RestorePlan:
    if not delete_semantics_known:
        raise RuntimePolicyError(
            ErrorCode.PHYSICAL_DELETE_FORBIDDEN,
            "Unknown delete semantics block restore execution.",
        )
    if not original_record_preserved or not operation_trace_preserved:
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Restore requires the original record and operation trace to remain preserved.",
        )
    return RestorePlan(method, original_record_preserved, operation_trace_preserved)
