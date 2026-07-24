from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .errors import ErrorCode, RuntimePolicyError


class IssueKind(StrEnum):
    STABLE_QUERY = "stable_query"
    HIGH_IMPACT_IRREVERSIBLE = "high_impact_irreversible"
    INTERMITTENT = "intermittent"
    CONCURRENCY_REPLAY = "concurrency_replay"


@dataclass(frozen=True)
class ReproductionPolicy:
    attempts: int
    requires_separate_approval: bool


@dataclass(frozen=True)
class ReproductionStats:
    reproductions: int
    total_attempts: int
    reproduction_rate: float
    environment_conditions: str


def build_reproduction_policy(
    kind: IssueKind,
    *,
    approved_attempts: int | None = None,
) -> ReproductionPolicy:
    if kind is IssueKind.CONCURRENCY_REPLAY:
        if approved_attempts is None or approved_attempts <= 0:
            raise RuntimePolicyError(
                ErrorCode.CONCURRENCY_APPROVAL_REQUIRED,
                "Concurrency and replay attempts require separate explicit approval.",
            )
        return ReproductionPolicy(approved_attempts, True)
    if approved_attempts is not None:
        raise ValueError("approved attempts are only accepted for concurrency or replay")
    attempts = 1 if kind is IssueKind.HIGH_IMPACT_IRREVERSIBLE else 2
    return ReproductionPolicy(attempts, False)


def record_reproduction_stats(
    *,
    reproductions: int,
    total_attempts: int,
    environment_conditions: str,
) -> ReproductionStats:
    if total_attempts <= 0 or reproductions < 0 or reproductions > total_attempts:
        raise ValueError("reproduction counts are invalid")
    if not environment_conditions.strip():
        raise ValueError("environment conditions are required")
    return ReproductionStats(
        reproductions,
        total_attempts,
        reproductions / total_attempts,
        environment_conditions,
    )
