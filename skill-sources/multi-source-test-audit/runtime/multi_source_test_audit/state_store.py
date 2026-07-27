from __future__ import annotations

import json
import re
from copy import deepcopy
from pathlib import Path
from typing import Any

from .atomic_io import atomic_write_json
from .errors import ErrorCode, RuntimePolicyError
from .paths import WritePolicy, project_state_dir

_SECRET_KEYS = {"password", "token", "access_token", "refresh_token", "secret", "api_key"}
_REQUIRED_STATE_TYPES: dict[str, type[Any]] = {
    "material_index": list,
    "profile": dict,
    "context": dict,
    "chains": list,
    "clues": list,
    "approvals": list,
    "execution": dict,
    "evidence_index": list,
}
_SNAPSHOT_LABEL = re.compile(r"^[A-Za-z0-9_.:-]+$")


def save_project_state(project_id: str, state: dict[str, Any], policy: WritePolicy) -> Path:
    _validate_project_state(state)
    secret_path = _find_secret_key(state)
    if secret_path is not None:
        raise RuntimePolicyError(
            ErrorCode.SECRET_VALUE_FORBIDDEN,
            "Credential values cannot be stored in project state.",
            details={"field": secret_path},
        )
    target = project_state_dir(project_id, policy.runtime_root) / "project.json"
    atomic_write_json(target, state, policy=policy)
    return target


def load_project_state(project_id: str, runtime_root: Path) -> dict[str, Any]:
    target = project_state_dir(project_id, runtime_root) / "project.json"
    if not target.is_file():
        raise RuntimePolicyError(
            ErrorCode.STATE_NOT_FOUND,
            "Project state does not exist.",
            details={"project_id": project_id},
        )
    value = json.loads(target.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimePolicyError(ErrorCode.STATE_NOT_FOUND, "Project state root must be an object.")
    return value


def resume_state(state: dict[str, Any], current_context: dict[str, str]) -> dict[str, Any]:
    saved_context = state.get("context", {})
    _validate_context(saved_context)
    _validate_context(current_context)
    result = deepcopy(state)
    changed = saved_context != current_context
    result["requires_revalidation"] = changed
    if changed:
        for approval in result.get("approvals", []):
            if isinstance(approval, dict):
                approval["status"] = "invalidated"
        for conclusion in result.get("conclusions", []):
            if isinstance(conclusion, dict):
                conclusion["status"] = "revalidation_required"
    return result


def save_stage_snapshot(
    project_id: str,
    stage: str,
    state: dict[str, Any],
    policy: WritePolicy,
) -> Path:
    _validate_project_state(state)
    label = _validate_snapshot_label(stage)
    target = project_state_dir(project_id, policy.runtime_root) / "snapshots" / f"{label}.json"
    atomic_write_json(target, state, policy=policy)
    return target


def export_project_state(project_id: str, policy: WritePolicy) -> Path:
    state = load_project_state(project_id, policy.runtime_root)
    _validate_project_state(state)
    target = policy.runtime_root / "exports" / f"{project_id}.export.json"
    atomic_write_json(
        target,
        {"format": "multi-source-test-audit-state-v1", "state": state},
        policy=policy,
    )
    return target


def import_project_state(project_id: str, source: Path, policy: WritePolicy) -> Path:
    value = json.loads(source.read_text(encoding="utf-8"))
    if not isinstance(value, dict) or value.get("format") != "multi-source-test-audit-state-v1":
        raise RuntimePolicyError(
            ErrorCode.INVALID_PROJECT_STATE,
            "Imported project state uses an unsupported format.",
        )
    state = value.get("state")
    if not isinstance(state, dict):
        raise RuntimePolicyError(
            ErrorCode.INVALID_PROJECT_STATE,
            "Imported project state payload must be an object.",
        )
    return save_project_state(project_id, state, policy)


def archive_project_state(
    project_id: str,
    archive_label: str,
    policy: WritePolicy,
) -> Path:
    state = load_project_state(project_id, policy.runtime_root)
    _validate_project_state(state)
    label = _validate_snapshot_label(archive_label)
    target = project_state_dir(project_id, policy.runtime_root) / "archive" / f"{label}.json"
    atomic_write_json(target, state, policy=policy)
    return target


def _find_secret_key(value: Any, prefix: str = "") -> str | None:
    if isinstance(value, dict):
        for key, nested in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            if str(key).lower() in _SECRET_KEYS:
                return path
            found = _find_secret_key(nested, path)
            if found is not None:
                return found
    elif isinstance(value, list):
        for index, nested in enumerate(value):
            found = _find_secret_key(nested, f"{prefix}[{index}]")
            if found is not None:
                return found
    return None


def _validate_project_state(state: dict[str, Any]) -> None:
    invalid = sorted(
        key for key, expected_type in _REQUIRED_STATE_TYPES.items()
        if not isinstance(state.get(key), expected_type)
    )
    if invalid:
        raise RuntimePolicyError(
            ErrorCode.INVALID_PROJECT_STATE,
            "Project state is missing required audit sections or has invalid section types.",
            details={"invalid_sections": invalid},
        )
    _validate_context(state["context"])


def _validate_snapshot_label(value: str) -> str:
    if not _SNAPSHOT_LABEL.fullmatch(value):
        raise RuntimePolicyError(
            ErrorCode.INVALID_PROJECT_STATE,
            "Snapshot and archive labels must use the controlled identifier format.",
            details={"label": value},
        )
    return value


def _validate_context(value: Any) -> None:
    required = ("commit", "environment", "account_alias")
    if not isinstance(value, dict) or any(
        not isinstance(value.get(key), str) or not value[key].strip() for key in required
    ):
        raise RuntimePolicyError(
            ErrorCode.INVALID_PROJECT_STATE,
            "Project state context requires commit, environment and account alias.",
        )
