from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .errors import ErrorCode, RuntimePolicyError
from .excel import AUDIT_SHEETS


@dataclass(frozen=True)
class ScopePlan:
    chain_name: str
    selected_interfaces: tuple[str, ...]
    out_of_scope: tuple[str, ...]


@dataclass(frozen=True)
class LaterBatchRecommendation:
    interface: str
    chat_summary: str
    excel_row: dict[str, Any]


@dataclass
class AnalysisWorkflow:
    inventory_records: tuple[str, ...] = ()
    scope: ScopePlan | None = None

    def record_inventory(self, records: list[str]) -> None:
        unique = tuple(dict.fromkeys(record.strip() for record in records if record.strip()))
        if not unique:
            raise RuntimePolicyError(
                ErrorCode.SCOPE_VALIDATION_FAILED,
                "Analysis requires a material inventory before scope selection.",
            )
        self.inventory_records = unique

    def select_scope(self, scope: ScopePlan) -> None:
        if not self.inventory_records or not scope.selected_interfaces:
            raise RuntimePolicyError(
                ErrorCode.SCOPE_VALIDATION_FAILED,
                "Deep-dive scope requires inventory and at least one selected interface.",
            )
        self.scope = scope

    def start_deep_dive(self) -> tuple[str, ...]:
        if not self.inventory_records or self.scope is None:
            raise RuntimePolicyError(
                ErrorCode.SCOPE_VALIDATION_FAILED,
                "Complete inventory and scope selection before deep analysis.",
            )
        return self.scope.selected_interfaces


def plan_scope(
    chain_name: str,
    selected_interfaces: list[str],
    discovered_out_of_scope: list[str],
) -> ScopePlan:
    return ScopePlan(
        chain_name=chain_name,
        selected_interfaces=tuple(selected_interfaces),
        out_of_scope=tuple(discovered_out_of_scope),
    )


def validate_user_chain(
    chain_name: str,
    selected_interfaces: list[str],
    *,
    available_interfaces: set[str],
    blocked_interfaces: set[str],
) -> ScopePlan:
    unique = list(dict.fromkeys(selected_interfaces))
    unavailable = set(unique) - available_interfaces
    blocked = set(unique) & blocked_interfaces
    if not unique or len(unique) > 15 or unavailable or blocked:
        raise RuntimePolicyError(
            ErrorCode.SCOPE_VALIDATION_FAILED,
            "User-selected chain failed material or safety validation.",
            details={
                "count": len(unique),
                "maximum": 15,
                "unavailable": sorted(unavailable),
                "blocked": sorted(blocked),
            },
        )
    return plan_scope(chain_name, unique, [])


def later_batch_recommendations(
    plan: ScopePlan,
) -> tuple[LaterBatchRecommendation, ...]:
    return tuple(
        LaterBatchRecommendation(
            interface=interface,
            chat_summary=f"Keep {interface} for a later audit batch.",
            excel_row={
                "interface": interface,
                "disposition": "later_batch",
                "selected_chain": plan.chain_name,
            },
        )
        for interface in plan.out_of_scope
    )


def append_later_batch_to_workbook(
    rows_by_sheet: dict[str, list[dict[str, Any]]],
    plan: ScopePlan,
) -> None:
    if tuple(rows_by_sheet) != AUDIT_SHEETS:
        raise RuntimePolicyError(
            ErrorCode.EXCEL_SHEET_CONTRACT,
            "Audit workbook must contain exactly the four required sheets in order.",
            details={"expected": list(AUDIT_SHEETS), "actual": list(rows_by_sheet)},
        )
    rows_by_sheet["审计计划"].extend(
        recommendation.excel_row for recommendation in later_batch_recommendations(plan)
    )
