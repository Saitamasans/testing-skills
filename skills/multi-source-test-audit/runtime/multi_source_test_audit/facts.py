from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .traceability import Provenance


class FactLayer(StrEnum):
    CONFIRMED_FACT = "confirmed_fact"
    AUDIT_INFERENCE = "audit_inference"
    UNKNOWN_RULE = "unknown_rule"


@dataclass(frozen=True)
class Fact:
    value: Any
    layer: FactLayer
    source: str
    provenance: Provenance

    def __post_init__(self) -> None:
        if not self.source.strip():
            raise ValueError("source is required for every fact")
        if self.provenance.source != self.source:
            raise ValueError("fact source must match provenance source")
