from __future__ import annotations

from collections.abc import Iterable
from enum import StrEnum


class CapabilityLevel(StrEnum):
    M1 = "M1"
    M2 = "M2"
    M3 = "M3"
    M4 = "M4"


def determine_capability(material_kinds: Iterable[str]) -> CapabilityLevel:
    kinds = set(material_kinds)
    has_code = bool(
        kinds
        & {
            "source_repository",
            "source_code",
            "frontend_code",
            "backend_code",
            "admin_code",
        }
    )
    has_runtime = "environment" in kinds and "account" in kinds
    has_evidence = bool(kinds & {"database", "logs", "cache", "message", "device", "evidence"})
    if has_code and has_runtime and has_evidence:
        return CapabilityLevel.M4
    if has_code and has_runtime:
        return CapabilityLevel.M3
    if has_code:
        return CapabilityLevel.M2
    return CapabilityLevel.M1
