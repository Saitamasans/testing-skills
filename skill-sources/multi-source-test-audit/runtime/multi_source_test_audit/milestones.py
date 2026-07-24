from __future__ import annotations

from dataclasses import dataclass, field
from enum import StrEnum


class ExecutionStatus(StrEnum):
    RUNNING = "running"
    BLOCKED = "blocked"
    PAUSED = "paused"
    COMPLETED = "completed"


class MilestoneKind(StrEnum):
    MATERIAL_INVENTORY = "material_inventory"
    PROFILE_COMPLETE = "profile_complete"
    ASSOCIATION_COMPLETE = "association_complete"
    PLAN_READY = "plan_ready"
    EXECUTION_PROGRESS = "execution_progress"
    EVIDENCE_COMPLETE = "evidence_complete"
    OUTPUT_COMPLETE = "output_complete"


@dataclass(frozen=True)
class MilestoneEvent:
    kind: MilestoneKind
    message: str


@dataclass
class MilestoneReporter:
    status: ExecutionStatus = ExecutionStatus.RUNNING
    events: list[MilestoneEvent] = field(default_factory=list)

    def report(self, kind: MilestoneKind, message: str) -> MilestoneEvent:
        if not message.strip():
            raise ValueError("milestone message is required")
        event = MilestoneEvent(kind, message)
        self.events.append(event)
        return event
