from __future__ import annotations

from dataclasses import dataclass, field, replace


@dataclass(frozen=True)
class ChainCandidate:
    name: str
    risk_value: float
    material_completeness: float
    executability: float
    evidence: float
    safety: float
    recommendation_reason: str = ""
    gaps: tuple[str, ...] = ()
    risks: tuple[str, ...] = ()
    score: float = field(default=0.0)


def recommend_candidates(candidates: list[ChainCandidate]) -> list[ChainCandidate]:
    ranked = [replace(candidate, score=_score(candidate)) for candidate in candidates]
    return sorted(ranked, key=lambda candidate: (-candidate.score, candidate.name))[:3]


def _score(candidate: ChainCandidate) -> float:
    return round(
        candidate.risk_value * 0.30
        + candidate.material_completeness * 0.20
        + candidate.executability * 0.20
        + candidate.evidence * 0.20
        + candidate.safety * 0.10,
        4,
    )
