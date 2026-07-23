from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class MaterialRecord:
    path: Path
    kind: str
    complete: bool
    purpose: str
    warnings: tuple[str, ...] = ()


def inventory_materials(paths: list[str | Path]) -> list[MaterialRecord]:
    records: list[MaterialRecord] = []
    for value in paths:
        path = Path(value)
        if not path.exists():
            records.append(MaterialRecord(path, "missing", False, "unavailable"))
            continue
        if path.is_dir():
            records.append(
                MaterialRecord(path, "source_repository", True, "source and configuration facts")
            )
            continue
        suffix = path.suffix.lower()
        if suffix in {".json", ".yaml", ".yml", ".apifox", ".postman", ".har"}:
            kind = "runtime_sample" if suffix == ".har" else "interface_export"
            purpose = "runtime evidence" if kind == "runtime_sample" else "declared interface facts"
        elif suffix in {".py", ".java", ".ts", ".tsx", ".js", ".kt", ".swift", ".cs", ".go"}:
            kind, purpose = "source_code", "implementation facts"
        else:
            kind, purpose = "document", "requirements and declared rules"
        records.append(MaterialRecord(path, kind, True, purpose))
    return records
