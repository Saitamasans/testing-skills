from __future__ import annotations

import hashlib
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .errors import ErrorCode, RuntimePolicyError


@dataclass(frozen=True)
class RepositorySnapshot:
    repository: Path
    branch: str
    commit: str
    status_porcelain: str
    workspace_fingerprint: str


def capture_repository_snapshot(repository: str | Path) -> RepositorySnapshot:
    root = Path(repository).resolve()
    try:
        branch = _git(root, "branch", "--show-current")
        commit = _git(root, "rev-parse", "HEAD")
        status = _git(root, "status", "--porcelain=v1", "--untracked-files=all")
    except (OSError, subprocess.CalledProcessError) as exc:
        raise RuntimePolicyError(
            ErrorCode.REPOSITORY_NOT_GIT,
            "The business repository must be a readable Git repository with a commit.",
            details={"repository": str(root)},
        ) from exc
    return RepositorySnapshot(
        repository=root,
        branch=branch,
        commit=commit,
        status_porcelain=status,
        workspace_fingerprint=_workspace_fingerprint(root),
    )


def assert_repository_unchanged(snapshot: RepositorySnapshot) -> None:
    current = capture_repository_snapshot(snapshot.repository)
    if current != snapshot:
        raise RuntimePolicyError(
            ErrorCode.REPOSITORY_STATE_CHANGED,
            "Business repository state changed during the audit operation.",
            details={
                "repository": str(snapshot.repository),
                "before": _snapshot_dict(snapshot),
                "after": _snapshot_dict(current),
            },
        )


def _git(repository: Path, *arguments: str) -> str:
    result = subprocess.run(
        ["git", "-C", str(repository), *arguments],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return result.stdout.strip()


def _workspace_fingerprint(repository: Path) -> str:
    digest = hashlib.sha256()
    files = (
        path
        for path in repository.rglob("*")
        if path.is_file()
        and ".git" not in path.relative_to(repository).parts
        and not path.is_symlink()
    )
    for path in sorted(files, key=lambda item: item.relative_to(repository).as_posix()):
        relative = path.relative_to(repository).as_posix().encode("utf-8")
        digest.update(relative)
        digest.update(b"\0")
        with path.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        digest.update(b"\0")
    return digest.hexdigest()


def _snapshot_dict(snapshot: RepositorySnapshot) -> dict[str, str]:
    return {
        "branch": snapshot.branch,
        "commit": snapshot.commit,
        "status_porcelain": snapshot.status_porcelain,
        "workspace_fingerprint": snapshot.workspace_fingerprint,
    }
