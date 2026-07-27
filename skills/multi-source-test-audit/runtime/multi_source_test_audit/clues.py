from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .traceability import Provenance


class ClueLevel(StrEnum):
    HIGH = "L-High"
    MEDIUM = "L-Medium"
    LOW = "L-Low"
    UNKNOWN = "L-Unknown"


@dataclass(frozen=True)
class Clue:
    clue_id: str
    level: ClueLevel
    root_cause: str
    subject: str
    validation_goal: str
    evidence_source: str
    provenance: Provenance
    merged_ids: tuple[str, ...] = ()
    provenance_history: tuple[Provenance, ...] = ()

    def __post_init__(self) -> None:
        values = (
            self.clue_id,
            self.root_cause,
            self.subject,
            self.validation_goal,
            self.evidence_source,
        )
        if not all(value.strip() for value in values):
            raise ValueError(
                "clue identity, subject, validation goal and evidence source are required"
            )


def merge_clues(clues: list[Clue]) -> list[Clue]:
    groups: dict[tuple[str, str], list[Clue]] = {}
    for clue in clues:
        key = (_normalize(clue.root_cause), _normalize(clue.subject))
        groups.setdefault(key, []).append(clue)
    merged: list[Clue] = []
    rank = {ClueLevel.HIGH: 0, ClueLevel.MEDIUM: 1, ClueLevel.LOW: 2, ClueLevel.UNKNOWN: 3}
    for _, group in sorted(groups.items()):
        ordered = sorted(group, key=lambda clue: clue.clue_id)
        level = min((clue.level for clue in ordered), key=rank.__getitem__)
        goals = tuple(dict.fromkeys(clue.validation_goal for clue in ordered))
        evidence = tuple(dict.fromkeys(clue.evidence_source for clue in ordered))
        merged.append(
            Clue(
                clue_id=ordered[0].clue_id,
                level=level,
                root_cause=ordered[0].root_cause.strip(),
                subject=ordered[0].subject.strip(),
                validation_goal="; ".join(goals),
                evidence_source="; ".join(evidence),
                provenance=ordered[0].provenance,
                merged_ids=tuple(clue.clue_id for clue in ordered),
                provenance_history=tuple(clue.provenance for clue in ordered),
            )
        )
    return merged


def _normalize(value: str) -> str:
    return " ".join(value.casefold().split())
