from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path


class HostKind(StrEnum):
    CODEX = "codex"
    CLAUDE_CODE = "claude-code"
    OPENCODE = "opencode"


@dataclass(frozen=True)
class HostContract:
    host: HostKind
    runner_command: tuple[str, ...]
    state_root: Path
    skill_name: str = "multi-source-test-audit"


def resolve_host_contract(
    host: HostKind,
    *,
    python_executable: Path,
    runtime_root: Path,
) -> HostContract:
    return HostContract(
        host=host,
        runner_command=(str(python_executable), "-m", "multi_source_test_audit"),
        state_root=runtime_root / "projects",
    )
