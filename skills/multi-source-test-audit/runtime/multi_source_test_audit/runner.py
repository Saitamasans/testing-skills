from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .approval import ApprovalLease, ExecutionContext, HighRiskAction
from .errors import ErrorCode, RuntimePolicyError
from .traceability import Provenance


class ExecutionEffect(StrEnum):
    READ = "read"
    WRITE = "write"


@dataclass(frozen=True)
class ConcurrencyPlan:
    execution_number: int
    count: int
    rate_per_second: float
    account_alias: str
    impact: str
    stop_conditions: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.execution_number <= 0 or self.count <= 0 or self.rate_per_second <= 0:
            raise ValueError("concurrency number, count and rate must be positive")
        if not self.account_alias.strip() or not self.impact.strip() or not self.stop_conditions:
            raise ValueError("concurrency account, impact and stop conditions are required")
        if any(not condition.strip() for condition in self.stop_conditions):
            raise ValueError("concurrency stop conditions cannot be empty")


@dataclass(frozen=True)
class RequestSpec:
    number: int
    label: str
    effect: ExecutionEffect
    golden: bool = False
    concurrent: bool = False
    high_risk_action: HighRiskAction | None = None
    chain_id: str | None = None
    resource: str | None = None
    data_id: str | None = None
    concurrency_plan: ConcurrencyPlan | None = None

    def __post_init__(self) -> None:
        mutating_actions = {
            HighRiskAction.LOGICAL_DELETE,
            HighRiskAction.PAYMENT,
            HighRiskAction.TRANSFER,
            HighRiskAction.DEVICE_CONTROL,
            HighRiskAction.MESSAGING,
        }
        if self.high_risk_action in mutating_actions and self.effect is not ExecutionEffect.WRITE:
            raise RuntimePolicyError(
                ErrorCode.CONTROLLED_WRITE_REQUIRED,
                "Mutating high-risk actions must be explicitly classified as writes.",
            )


@dataclass(frozen=True)
class TransportResult:
    ok: bool
    response: Any


@dataclass(frozen=True)
class ExecutionRecord:
    number: int
    status: str
    provenance: Provenance
    response: Any = None

    def as_dict(self) -> dict[str, Any]:
        return {
            "number": self.number,
            "status": self.status,
            "response": _canonicalize(self.response),
            "provenance": self.provenance.as_dict(),
        }


@dataclass(frozen=True)
class ExecutionResult:
    blocked: bool
    records: tuple[ExecutionRecord, ...]

    def as_dict(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "blocked": self.blocked,
            "records": [record.as_dict() for record in self.records],
        }


Transport = Callable[[RequestSpec], TransportResult]


def execute_requests(
    requests: list[RequestSpec],
    lease: ApprovalLease,
    context: ExecutionContext,
    transport: Transport,
) -> ExecutionResult:
    lease.assert_valid(context)
    records: list[ExecutionRecord] = []
    for request in requests:
        provenance = Provenance(
            source=request.label,
            batch_id=context.batch_id,
            environment=context.environment,
            commit=context.commit,
            account_alias=context.account_alias,
            evidence_ids=(f"execution:{context.batch_id}:{request.number}",),
        )
        if request.concurrent:
            plan = request.concurrency_plan
            if plan is None:
                raise RuntimePolicyError(
                    ErrorCode.CONCURRENCY_APPROVAL_REQUIRED,
                    "Concurrency and replay require a complete separately approved plan.",
                )
            if (
                plan.execution_number != request.number
                or plan.account_alias != context.account_alias
            ):
                raise RuntimePolicyError(
                    ErrorCode.APPROVAL_SCOPE_CHANGED,
                    "Concurrency plan number or account no longer matches execution context.",
                )
        required_risk_actions = list(
            dict.fromkeys(
                action
                for action in (
                    request.high_risk_action,
                    HighRiskAction.CONCURRENCY if request.concurrent else None,
                )
                if action is not None
            )
        )
        for risk_action in required_risk_actions:
            if lease.allows_high_risk(request.number, risk_action):
                continue
            code = (
                ErrorCode.CONCURRENCY_APPROVAL_REQUIRED
                if risk_action is HighRiskAction.CONCURRENCY
                else ErrorCode.HIGH_RISK_APPROVAL_REQUIRED
            )
            raise RuntimePolicyError(
                code,
                "High-risk execution requires matching item or small-batch approval.",
            )
        if request.effect is ExecutionEffect.WRITE and not lease.allows_write(
            context,
            request.number,
            chain_id=request.chain_id or "",
            resource=request.resource or "",
            data_id=request.data_id or "",
        ):
            raise RuntimePolicyError(
                ErrorCode.CONTROLLED_WRITE_REQUIRED,
                "Write execution is outside the approved chain, resource or data range.",
            )
        if not lease.allows(context, request.number, write=False):
            records.append(ExecutionRecord(request.number, "not_approved", provenance))
            continue
        result = transport(request)
        if request.golden and not result.ok:
            records.append(
                ExecutionRecord(request.number, "golden_failed", provenance, result.response)
            )
            return ExecutionResult(True, tuple(records))
        records.append(
            ExecutionRecord(
                request.number,
                "executed" if result.ok else "failed",
                provenance,
                result.response,
            )
        )
    return ExecutionResult(False, tuple(records))


def _canonicalize(value: Any) -> Any:
    if isinstance(value, float) and not math.isfinite(value):
        raise RuntimePolicyError(
            ErrorCode.RESULT_NOT_SERIALIZABLE,
            "Runner result numbers must be finite JSON values.",
        )
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        if any(not isinstance(key, str) for key in value):
            raise RuntimePolicyError(
                ErrorCode.RESULT_NOT_SERIALIZABLE,
                "Runner result object keys must be strings.",
            )
        return {key: _canonicalize(value[key]) for key in sorted(value)}
    if isinstance(value, (list, tuple)):
        return [_canonicalize(item) for item in value]
    raise RuntimePolicyError(
        ErrorCode.RESULT_NOT_SERIALIZABLE,
        "Runner result contains a value that is not JSON serializable.",
        details={"type": type(value).__name__},
    )
