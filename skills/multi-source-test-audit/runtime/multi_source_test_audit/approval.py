from __future__ import annotations

import re
from dataclasses import dataclass
from enum import StrEnum

from .errors import ErrorCode, RuntimePolicyError

_EXECUTION_NUMBER = re.compile(r"^[0-9]+$")


@dataclass(frozen=True)
class ExecutionContext:
    project_id: str
    batch_id: str
    environment: str
    account_alias: str
    commit: str


class HighRiskAction(StrEnum):
    LOGICAL_DELETE = "logical_delete"
    PAYMENT = "payment"
    TRANSFER = "transfer"
    DEVICE_CONTROL = "device_control"
    CONCURRENCY = "concurrency"
    MESSAGING = "messaging"


@dataclass(frozen=True)
class WriteScope:
    chain_id: str
    resource: str
    data_ids: frozenset[str]

    def __post_init__(self) -> None:
        if not self.chain_id.strip() or not self.resource.strip() or not self.data_ids:
            raise ValueError("write scope requires chain, resource and data range")
        if any(not data_id.strip() for data_id in self.data_ids):
            raise ValueError("write scope data identifiers cannot be empty")


@dataclass
class ApprovalLease:
    context: ExecutionContext
    approved_numbers: frozenset[int]
    read_only: bool = False
    write_scope: WriteScope | None = None
    high_risk_approvals: frozenset[tuple[int, HighRiskAction]] = frozenset()
    expired: bool = False

    def allows(self, context: ExecutionContext, number: int, *, write: bool) -> bool:
        return (
            not self.expired
            and self.context == context
            and number in self.approved_numbers
            and not (write and self.read_only)
        )

    def allows_write(
        self,
        context: ExecutionContext,
        number: int,
        *,
        chain_id: str,
        resource: str,
        data_id: str,
    ) -> bool:
        scope = self.write_scope
        return bool(
            self.allows(context, number, write=True)
            and scope
            and scope.chain_id == chain_id
            and scope.resource == resource
            and data_id in scope.data_ids
        )

    def allows_high_risk(self, number: int, action: HighRiskAction) -> bool:
        return not self.expired and (number, action) in self.high_risk_approvals

    def expire(self) -> None:
        self.expired = True

    def assert_valid(self, context: ExecutionContext) -> None:
        if self.expired:
            raise RuntimePolicyError(
                ErrorCode.APPROVAL_LEASE_EXPIRED,
                "Approval lease expired at batch end.",
            )
        if context != self.context:
            raise RuntimePolicyError(
                ErrorCode.APPROVAL_SCOPE_CHANGED,
                "Approval lease context no longer matches the execution context.",
            )


def validate_execution_number(value: str) -> int:
    if not _EXECUTION_NUMBER.fullmatch(value):
        raise RuntimePolicyError(
            ErrorCode.INVALID_EXECUTION_NUMBER,
            "Execution numbers must contain only Arabic digits.",
            details={"value": value},
        )
    return int(value)


def create_lease(
    context: ExecutionContext,
    approved_numbers: list[int],
    *,
    read_only: bool = False,
    write_scope: WriteScope | None = None,
    high_risk_approvals: dict[
        int, HighRiskAction | frozenset[HighRiskAction]
    ] | None = None,
) -> ApprovalLease:
    if any(number <= 0 for number in approved_numbers):
        raise RuntimePolicyError(
            ErrorCode.INVALID_EXECUTION_NUMBER,
            "Execution numbers must be positive.",
        )
    supplied_risk_approvals = high_risk_approvals or {}
    if any(number not in approved_numbers for number in supplied_risk_approvals):
        raise RuntimePolicyError(
            ErrorCode.APPROVAL_REQUIRED,
            "High-risk approval must reference an approved execution number.",
        )
    risk_approvals: set[tuple[int, HighRiskAction]] = set()
    for number, supplied_actions in supplied_risk_approvals.items():
        actions = (
            frozenset({supplied_actions})
            if isinstance(supplied_actions, HighRiskAction)
            else supplied_actions
        )
        if not actions:
            raise RuntimePolicyError(
                ErrorCode.HIGH_RISK_APPROVAL_REQUIRED,
                "High-risk approval action set cannot be empty.",
            )
        risk_approvals.update((number, action) for action in actions)
    return ApprovalLease(
        context=context,
        approved_numbers=frozenset(approved_numbers),
        read_only=read_only,
        write_scope=write_scope,
        high_risk_approvals=frozenset(risk_approvals),
    )
