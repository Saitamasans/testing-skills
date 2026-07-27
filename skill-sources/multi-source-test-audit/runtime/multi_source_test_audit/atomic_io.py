from __future__ import annotations

import json
import os
import uuid
from contextlib import suppress
from pathlib import Path
from typing import Any

from .errors import ErrorCode, RuntimePolicyError
from .paths import WritePolicy, locked_write_directory, prepare_write_target


def atomic_write_json(target: Path, value: Any, *, policy: WritePolicy) -> None:
    guard = prepare_write_target(target, policy)
    safe_target = guard.target
    temporary_name = f".{safe_target.name}.{uuid.uuid4().hex}.tmp"
    with locked_write_directory(guard, policy) as directory:
        try:
            with directory.open_text_exclusive(temporary_name) as stream:
                json.dump(
                    value,
                    stream,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            directory.replace(temporary_name, safe_target.name)
            _sync_directory(safe_target.parent)
        except RuntimePolicyError:
            with suppress(OSError):
                directory.unlink(temporary_name)
            raise
        except Exception as exc:
            with suppress(OSError):
                directory.unlink(temporary_name)
            raise RuntimePolicyError(
                ErrorCode.ATOMIC_WRITE_FAILED,
                "Atomic JSON write failed.",
                details={"path": str(safe_target), "reason": str(exc)},
            ) from exc


def atomic_create_json(target: Path, value: Any, *, policy: WritePolicy) -> None:
    """Atomically create immutable JSON and reject an existing target."""
    guard = prepare_write_target(target, policy)
    safe_target = guard.target
    temporary_name = f".{safe_target.name}.{uuid.uuid4().hex}.tmp"
    with locked_write_directory(guard, policy) as directory:
        try:
            with directory.open_text_exclusive(temporary_name) as stream:
                json.dump(
                    value,
                    stream,
                    ensure_ascii=False,
                    sort_keys=True,
                    separators=(",", ":"),
                )
                stream.write("\n")
                stream.flush()
                os.fsync(stream.fileno())
            try:
                directory.link_exclusive(temporary_name, safe_target.name)
            except FileExistsError as exc:
                raise RuntimePolicyError(
                    ErrorCode.STAGE_A_SELECTION_EXISTS,
                    "Immutable JSON evidence already exists.",
                    details={"path": str(safe_target)},
                ) from exc
            directory.unlink(temporary_name)
            _sync_directory(safe_target.parent)
        except RuntimePolicyError:
            with suppress(OSError):
                directory.unlink(temporary_name)
            raise
        except Exception as exc:
            with suppress(OSError):
                directory.unlink(temporary_name)
            raise RuntimePolicyError(
                ErrorCode.ATOMIC_WRITE_FAILED,
                "Atomic immutable JSON creation failed.",
                details={"path": str(safe_target), "reason": str(exc)},
            ) from exc


def _sync_directory(directory: Path) -> None:
    if os.name == "nt":
        return
    descriptor = os.open(directory, os.O_RDONLY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
