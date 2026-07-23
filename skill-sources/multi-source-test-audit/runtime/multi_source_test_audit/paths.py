from __future__ import annotations

import ntpath
import os
import re
from collections.abc import Iterable, Iterator, Mapping
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from pathlib import Path
from typing import IO

from .errors import ErrorCode, RuntimePolicyError

RUNTIME_DIRECTORY_NAME = "MultiSourceTestAudit"
_PROJECT_ID_PATTERN = re.compile(r"^[\w.-]{1,128}$", re.UNICODE)


@dataclass(frozen=True)
class WritePolicy:
    runtime_root: Path
    business_repositories: tuple[Path, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "runtime_root", self.runtime_root.absolute())
        object.__setattr__(
            self,
            "business_repositories",
            tuple(path.absolute() for path in self.business_repositories),
        )


@dataclass(frozen=True)
class WriteTargetGuard:
    target: Path
    parent_identity: tuple[int, int]


@dataclass(frozen=True)
class DirectoryWriteAccess:
    parent: Path
    directory_fd: int | None

    def open_text_exclusive(self, name: str) -> IO[str]:
        if self.directory_fd is None:
            return (self.parent / name).open("x", encoding="utf-8", newline="\n")
        descriptor = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
            dir_fd=self.directory_fd,
        )
        return os.fdopen(descriptor, "w", encoding="utf-8", newline="\n")

    def open_binary_exclusive(self, name: str) -> IO[bytes]:
        if self.directory_fd is None:
            return (self.parent / name).open("xb")
        descriptor = os.open(
            name,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL,
            0o600,
            dir_fd=self.directory_fd,
        )
        return os.fdopen(descriptor, "wb")

    def replace(self, source_name: str, target_name: str) -> None:
        if self.directory_fd is None:
            os.replace(self.parent / source_name, self.parent / target_name)
            return
        os.replace(
            source_name,
            target_name,
            src_dir_fd=self.directory_fd,
            dst_dir_fd=self.directory_fd,
        )

    def unlink(self, name: str) -> None:
        if self.directory_fd is None:
            (self.parent / name).unlink(missing_ok=True)
            return
        with suppress(FileNotFoundError):
            os.unlink(name, dir_fd=self.directory_fd)

    def link_exclusive(self, source_name: str, target_name: str) -> None:
        """Atomically publish an existing file only if target_name is absent."""
        if self.directory_fd is None:
            os.link(self.parent / source_name, self.parent / target_name)
            return
        os.link(
            source_name,
            target_name,
            src_dir_fd=self.directory_fd,
            dst_dir_fd=self.directory_fd,
            follow_symlinks=False,
        )

    def ensure_directory(self, name: str) -> None:
        if self.directory_fd is None:
            (self.parent / name).mkdir(exist_ok=True)
            return
        with suppress(FileExistsError):
            os.mkdir(name, mode=0o700, dir_fd=self.directory_fd)


def prepare_write_target(candidate: str | Path, policy: WritePolicy) -> WriteTargetGuard:
    if policy.runtime_root.exists() and _is_reparse_point(policy.runtime_root):
        raise RuntimePolicyError(
            ErrorCode.SYMLINK_ESCAPE,
            "The runtime root cannot be a symbolic link or junction.",
        )
    target = validate_write_path(
        candidate,
        policy.runtime_root,
        policy.business_repositories,
    )
    ensure_write_directory(target.parent, policy)
    target = validate_write_path(
        candidate,
        policy.runtime_root,
        policy.business_repositories,
    )
    return WriteTargetGuard(target, _directory_identity(target.parent))


def ensure_write_directory(directory: str | Path, policy: WritePolicy) -> Path:
    target = validate_write_path(
        directory,
        policy.runtime_root,
        policy.business_repositories,
    )
    root = policy.runtime_root
    if not root.is_dir() or _is_reparse_point(root):
        raise RuntimePolicyError(
            ErrorCode.WRITE_DIRECTORY_MISSING,
            "Controlled runtime root must be initialized before project writes.",
            details={"runtime_root": str(root)},
        )
    relative_parts = target.relative_to(root).parts
    current = root
    for part in relative_parts:
        guard = WriteTargetGuard(
            current / ".directory-creation-guard",
            _directory_identity(current),
        )
        with locked_write_directory(guard, policy) as access:
            access.ensure_directory(part)
        current = current / part
        validate_write_path(current, policy.runtime_root, policy.business_repositories)
        if not current.is_dir() or _is_reparse_point(current):
            raise RuntimePolicyError(
                ErrorCode.SYMLINK_ESCAPE,
                "Controlled write directory cannot be a symbolic link or junction.",
                details={"path": str(current)},
            )
    return current


def revalidate_write_target(guard: WriteTargetGuard, policy: WritePolicy) -> Path:
    target = validate_write_path(
        guard.target,
        policy.runtime_root,
        policy.business_repositories,
    )
    if target != guard.target or _directory_identity(target.parent) != guard.parent_identity:
        raise RuntimePolicyError(
            ErrorCode.PATH_IDENTITY_CHANGED,
            "Write target parent changed after validation.",
            details={"path": str(target.parent)},
        )
    return target


@contextmanager
def locked_write_directory(
    guard: WriteTargetGuard,
    policy: WritePolicy,
) -> Iterator[DirectoryWriteAccess]:
    if os.name == "nt":
        handle = _lock_windows_directory(guard.target.parent)
        try:
            revalidate_write_target(guard, policy)
            yield DirectoryWriteAccess(guard.target.parent, None)
        finally:
            _close_windows_handle(handle)
        return
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
    descriptor = os.open(guard.target.parent, flags)
    try:
        stat = os.fstat(descriptor)
        if (stat.st_dev, stat.st_ino) != guard.parent_identity:
            raise RuntimePolicyError(
                ErrorCode.PATH_IDENTITY_CHANGED,
                "Write target parent changed before directory lock acquisition.",
            )
        yield DirectoryWriteAccess(guard.target.parent, descriptor)
    finally:
        os.close(descriptor)


def get_runtime_root(env: Mapping[str, str] | None = None) -> Path:
    source = os.environ if env is None else env
    local_app_data = source.get("LOCALAPPDATA", "").strip()
    if not local_app_data:
        raise RuntimePolicyError(
            ErrorCode.LOCALAPPDATA_MISSING,
            "LOCALAPPDATA is required to locate the controlled audit runtime.",
        )
    return Path(local_app_data) / RUNTIME_DIRECTORY_NAME


def standard_paths(runtime_root: Path | None = None) -> dict[str, Path]:
    root = get_runtime_root() if runtime_root is None else Path(runtime_root)
    return {
        "runtime_root": root,
        "runtime": root / "runtime",
        "projects": root / "projects",
        "logs": root / "logs",
        "versions": root / "versions",
    }


def project_state_dir(project_id: str, runtime_root: Path | None = None) -> Path:
    if not _PROJECT_ID_PATTERN.fullmatch(project_id):
        raise RuntimePolicyError(
            ErrorCode.INVALID_PROJECT_ID,
            "Project ID must contain only letters, numbers, underscore, dot or hyphen.",
            details={"project_id": project_id},
        )
    root = get_runtime_root() if runtime_root is None else Path(runtime_root)
    return root / "projects" / project_id / "state"


def initialize_runtime_layout(
    runtime_root: str | Path | None = None,
    business_repositories: Iterable[str | Path] = (),
) -> dict[str, Path]:
    root = get_runtime_root() if runtime_root is None else Path(runtime_root)
    if root.exists() and _is_reparse_point(root):
        raise RuntimePolicyError(
            ErrorCode.SYMLINK_ESCAPE,
            "The runtime root cannot itself be a symbolic link or junction.",
            details={"runtime_root": str(root)},
        )
    layout = standard_paths(root)
    for path in layout.values():
        validate_write_path(path, root, business_repositories)
    for path in layout.values():
        path.mkdir(parents=True, exist_ok=True)
    return layout


def validate_write_path(
    candidate: str | Path,
    runtime_root: str | Path,
    business_repositories: Iterable[str | Path] = (),
) -> Path:
    candidate_path = Path(candidate)
    root_path = Path(runtime_root)

    if ".." in candidate_path.parts:
        raise RuntimePolicyError(
            ErrorCode.PATH_TRAVERSAL,
            "Parent path traversal is not allowed.",
            details={"path": str(candidate_path)},
        )

    lexical_candidate = candidate_path.absolute()
    lexical_root = root_path.absolute()

    for repository in business_repositories:
        repository_path = Path(repository).absolute()
        if _is_within(lexical_candidate, repository_path):
            raise RuntimePolicyError(
                ErrorCode.BUSINESS_REPOSITORY_WRITE,
                "Writing inside a business repository is forbidden.",
                details={"path": str(lexical_candidate), "repository": str(repository_path)},
            )

    if not _is_within(lexical_candidate, lexical_root):
        code = (
            ErrorCode.ABSOLUTE_PATH_ESCAPE
            if candidate_path.is_absolute() or ntpath.isabs(str(candidate_path))
            else ErrorCode.PATH_OUTSIDE_RUNTIME_ROOT
        )
        raise RuntimePolicyError(
            code,
            "Write target must remain inside the controlled audit runtime.",
            details={"path": str(candidate_path), "runtime_root": str(root_path)},
        )

    resolved_root = lexical_root.resolve(strict=False)
    resolved_candidate = lexical_candidate.resolve(strict=False)
    if not _is_within(resolved_candidate, resolved_root):
        raise RuntimePolicyError(
            ErrorCode.SYMLINK_ESCAPE,
            "Symbolic-link or junction escape is not allowed.",
            details={"path": str(candidate_path), "resolved_path": str(resolved_candidate)},
        )

    return lexical_candidate


def _is_within(candidate: Path, root: Path) -> bool:
    try:
        candidate.relative_to(root)
    except ValueError:
        return False
    return True


def _is_reparse_point(path: Path) -> bool:
    if path.is_symlink():
        return True
    is_junction = getattr(path, "is_junction", None)
    return bool(is_junction and is_junction())


def _directory_identity(path: Path) -> tuple[int, int]:
    if _is_reparse_point(path):
        raise RuntimePolicyError(
            ErrorCode.SYMLINK_ESCAPE,
            "Write target parent cannot be a symbolic link or junction.",
            details={"path": str(path)},
        )
    stat = os.stat(path, follow_symlinks=False)
    return stat.st_dev, stat.st_ino


def _lock_windows_directory(path: Path) -> int:
    import ctypes
    from ctypes import wintypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = (
        wintypes.LPCWSTR,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.LPVOID,
        wintypes.DWORD,
        wintypes.DWORD,
        wintypes.HANDLE,
    )
    create_file.restype = wintypes.HANDLE
    handle = create_file(
        str(path),
        0x00000001,
        0x00000001 | 0x00000002,
        None,
        3,
        0x02000000 | 0x00200000,
        None,
    )
    if handle == wintypes.HANDLE(-1).value:
        raise OSError(ctypes.get_last_error(), "Unable to lock write target directory.")
    return int(handle)


def _close_windows_handle(handle: int) -> None:
    import ctypes
    from ctypes import wintypes

    close_handle = ctypes.WinDLL("kernel32", use_last_error=True).CloseHandle
    close_handle.argtypes = (wintypes.HANDLE,)
    close_handle.restype = wintypes.BOOL
    if not close_handle(wintypes.HANDLE(handle)):
        raise OSError(ctypes.get_last_error(), "Unable to close write target directory handle.")
