from __future__ import annotations

from pathlib import Path

from .errors import ErrorCode, RuntimePolicyError

REQUIRED_DIRECTORIES = (
    "runtime",
    "wheels",
    "runner",
    "templates",
    "schemas",
    "self-check",
    "installer",
    "skill",
)
REQUIRED_FILES = (
    "requirements.lock",
    "runtime.lock.json",
    "checksums.json",
    "release.json",
    "install.ps1",
    "repair.ps1",
    "uninstall.ps1",
    "templates/audit-workbook.json",
    "schemas/execution-result.schema.json",
    "self-check/openapi.json",
    "self-check/postman.json",
    "installer/validate_release.ps1",
    "installer/validate_checksums.ps1",
)


def validate_release_layout(release_root: str | Path) -> dict[str, object]:
    root = Path(release_root).resolve()
    missing = [
        name
        for name in (*REQUIRED_DIRECTORIES, *REQUIRED_FILES)
        if not (root / name).exists()
    ]
    if not (root / "runtime" / "python.exe").is_file():
        missing.append("runtime/python.exe")
    if not list((root / "wheels").glob("*.whl")):
        missing.append("wheels/*.whl")
    if not list((root / "runner").glob("*.whl")):
        missing.append("runner/*.whl")
    if not list((root / "skill").rglob("SKILL.md")):
        missing.append("skill/SKILL.md")
    if missing:
        raise RuntimePolicyError(
            ErrorCode.RELEASE_LAYOUT_INCOMPLETE,
            "Offline release layout is incomplete.",
            details={"root": str(root), "missing": missing},
        )
    return {
        "status": "complete",
        "offline": True,
        "root": str(root),
        "missing": [],
        "required_directories": list(REQUIRED_DIRECTORIES),
        "required_files": list(REQUIRED_FILES),
    }
