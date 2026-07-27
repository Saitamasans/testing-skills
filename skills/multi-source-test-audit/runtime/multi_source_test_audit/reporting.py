from __future__ import annotations

from collections import Counter
from dataclasses import dataclass


@dataclass(frozen=True)
class Clue:
    identifier: str
    score: float
    category: str
    root_cause: str


@dataclass(frozen=True)
class FocusedClues:
    shown: tuple[Clue, ...]
    hidden_count: int
    category_counts: dict[str, int]


def focus_clues(clues: list[Clue]) -> FocusedClues:
    merged: dict[str, Clue] = {}
    for clue in clues:
        current = merged.get(clue.root_cause)
        if current is None or clue.score > current.score:
            merged[clue.root_cause] = clue
    ranked = sorted(merged.values(), key=lambda clue: (-clue.score, clue.identifier))
    if len(ranked) <= 5:
        limit = len(ranked)
    elif len(ranked) <= 15:
        limit = 8
    else:
        limit = 5
    shown = tuple(ranked[:limit])
    return FocusedClues(
        shown=shown,
        hidden_count=len(ranked) - len(shown),
        category_counts=dict(Counter(clue.category for clue in clues)),
    )
