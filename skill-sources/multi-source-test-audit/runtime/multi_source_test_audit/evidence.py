from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .traceability import Provenance


class ConclusionCategory(StrEnum):
    CONFIRMED_ISSUE = "confirmed_issue"
    HIGH_RISK_PENDING = "high_risk_pending"
    REQUIREMENT_PENDING = "requirement_pending"
    COMPLIANT = "compliant"


class EvidenceKind(StrEnum):
    DATABASE = "database"
    LOG = "log"
    CACHE = "cache"
    MESSAGE = "message"
    FILE = "file"
    DEVICE = "device"
    ADMIN_STATE = "admin_state"
    ASYNC_TASK = "async_task"
    THIRD_PARTY_SANDBOX = "third_party_sandbox"


@dataclass(frozen=True)
class EvidenceSource:
    kind: EvidenceKind
    locator: str

    def __post_init__(self) -> None:
        if not self.locator.strip():
            raise ValueError("evidence source locator is required")


@dataclass(frozen=True)
class EvidencePlan:
    selected: tuple[EvidenceSource, ...]
    missing: tuple[EvidenceKind, ...]


class InterfaceOutcome(StrEnum):
    SUCCESS = "success"
    FAILURE = "failure"


class SideEffectState(StrEnum):
    PRESENT = "present"
    ABSENT = "absent"
    PARTIAL = "partial"
    UNKNOWN = "unknown"


class OutcomeClassification(StrEnum):
    TRUE_SUCCESS = "true_success"
    FALSE_SUCCESS = "false_success"
    TRUE_FAILURE = "true_failure"
    FALSE_FAILURE = "false_failure"
    PARTIAL_FAILURE = "partial_failure"
    INCONCLUSIVE = "inconclusive"


class AnomalyKind(StrEnum):
    SERVER_ERROR = "server_error"
    SENSITIVE_DATA_LEAK = "sensitive_data_leak"
    OBJECTIVE_CONTRADICTION = "objective_contradiction"
    AMBIGUOUS_BUSINESS_SEMANTICS = "ambiguous_business_semantics"


@dataclass(frozen=True)
class ExecutionConclusion:
    category: ConclusionCategory
    interface_reproduced: bool
    side_effect_present: bool
    rule_known: bool
    code_location: str | None
    code_basis: str
    provenance: Provenance


def conclude_execution(
    *,
    interface_reproduced: bool,
    side_effect_present: bool,
    rule_known: bool,
    code_location: str | None,
    code_basis: str,
    provenance: Provenance,
) -> ExecutionConclusion:
    if code_location is None and not code_basis.strip():
        raise ValueError("missing code location requires an explicit code basis explanation")
    if code_location is not None and not code_location.strip():
        raise ValueError("code location cannot be empty")
    if not rule_known and interface_reproduced and side_effect_present:
        category = ConclusionCategory.REQUIREMENT_PENDING
    elif interface_reproduced and side_effect_present:
        category = ConclusionCategory.CONFIRMED_ISSUE
    else:
        category = ConclusionCategory.HIGH_RISK_PENDING
    return ExecutionConclusion(
        category,
        interface_reproduced,
        side_effect_present,
        rule_known,
        code_location,
        code_basis,
        provenance,
    )


def plan_evidence_sources(
    required: list[EvidenceKind],
    available: list[EvidenceSource],
) -> EvidencePlan:
    required_kinds = tuple(dict.fromkeys(required))
    selected = tuple(source for source in available if source.kind in required_kinds)
    selected_kinds = {source.kind for source in selected}
    missing = tuple(kind for kind in required_kinds if kind not in selected_kinds)
    return EvidencePlan(selected, missing)


def classify_outcome(
    interface: InterfaceOutcome,
    side_effect: SideEffectState,
) -> OutcomeClassification:
    if side_effect is SideEffectState.UNKNOWN:
        return OutcomeClassification.INCONCLUSIVE
    if side_effect is SideEffectState.PARTIAL:
        return OutcomeClassification.PARTIAL_FAILURE
    if interface is InterfaceOutcome.SUCCESS:
        return (
            OutcomeClassification.TRUE_SUCCESS
            if side_effect is SideEffectState.PRESENT
            else OutcomeClassification.FALSE_SUCCESS
        )
    return (
        OutcomeClassification.FALSE_FAILURE
        if side_effect is SideEffectState.PRESENT
        else OutcomeClassification.TRUE_FAILURE
    )


def classify_anomaly(
    kind: AnomalyKind,
    *,
    interface_reproduced: bool,
    side_effect_present: bool,
    provenance: Provenance,
) -> ExecutionConclusion:
    return conclude_execution(
        interface_reproduced=interface_reproduced,
        side_effect_present=side_effect_present,
        rule_known=kind is not AnomalyKind.AMBIGUOUS_BUSINESS_SEMANTICS,
        code_location=None,
        code_basis="classification based on objective runtime evidence",
        provenance=provenance,
    )
