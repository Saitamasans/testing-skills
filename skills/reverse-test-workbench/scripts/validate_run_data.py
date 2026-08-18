#!/usr/bin/env python3
"""Validate reverse-test-workbench canonical run data without extra packages."""

from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path, PurePosixPath
import re
from typing import Any
from urllib.parse import parse_qsl, urlsplit


SCHEMA_VERSION = "1.0"
TOP_LEVEL_ARRAYS = (
    "batches",
    "navigation",
    "page_inventory",
    "paths",
    "test_cases",
    "issues",
    "risks",
    "test_data",
    "evidence",
    "knowledge",
)
REQUIRED_TOP_LEVEL = {
    "schema_version",
    "run",
    "summary",
    "coverage",
    *TOP_LEVEL_ARRAYS,
}
REQUIRED_RUN = {
    "run_id",
    "system_name",
    "target_url",
    "status",
    "skill_version",
    "run_positioning",
    "scope_boundary",
    "coverage_commitment",
    "exploration_focus",
    "run_budget",
    "budget_control",
    "account_context",
    "executor",
    "artifact_preflight",
    "timing",
    "resume",
}
REQUIRED_SUMMARY = {
    "one_line_conclusion",
    "answered_questions",
    "unanswered_questions",
    "key_findings",
    "recommendations",
    "conclusion_boundary",
}
REQUIRED_FINDING = {"title", "fact", "judgment", "basis", "impact", "action", "confidence"}
REQUIRED_EXECUTOR = {
    "protocol",
    "version",
    "browser_channel",
    "session_mode",
    "model_vision_capability",
    "capability_state",
}
REQUIRED_TIMING_PHASES = {
    "executor_gate",
    "entry",
    "b00",
    "b01_quick_map",
    "first_business_interaction",
    "b01_navigation_ledger",
    "business_batches",
    "waiting_user",
    "artifact_generation",
    "artifact_validation",
    "total",
}
REQUIRED_TIMING_FIELDS = {"started_at", "ended_at", "duration_ms", "status"}
REQUIRED_BUDGET_CONTROL = {
    "mode",
    "started_at",
    "closeout_at",
    "deadline_at",
    "last_checked_at",
    "status",
    "overrun_ms",
}
ID_FIELDS = {
    "batches": "batch_id",
    "navigation": "entry_id",
    "page_inventory": "surface_id",
    "paths": "path_id",
    "test_cases": "case_id",
    "issues": "issue_id",
    "risks": "risk_id",
    "test_data": "data_id",
    "evidence": "evidence_id",
    "knowledge": "knowledge_id",
}
SENSITIVE_KEYS = {
    "password",
    "passwd",
    "pwd",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "client_secret",
    "authorization",
    "cookie",
    "cookies",
    "otp",
    "captcha",
    "verification_code",
}

SENSITIVE_VALUE_PATTERNS = (
    re.compile(r"(?i)\b(?:authorization|proxy-authorization)\s*:\s*(?:bearer|basic)\s+\S+"),
    re.compile(r"(?i)\b(?:cookie|set-cookie)\s*:\s*[^\s;=]+=[^\s;]*"),
    re.compile(
        r"(?i)\b(?:password|passwd|pwd|token|access[_ -]?token|refresh[_ -]?token|secret|otp)"
        r"\s*(?:=|:)\s*(?!<[^>]+>|\b(?:redacted|masked|omitted|removed|none|unknown|required|"
        r"unavailable|missing|absent|blank|empty|not[_ -]?(?:provided|configured))\b)\S{8,}"
    ),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"),
)


class ValidationError(ValueError):
    pass


def _require_keys(value: dict[str, Any], required: set[str], path: str) -> None:
    missing = sorted(required - set(value))
    if missing:
        raise ValidationError(f"{path} missing required keys: {', '.join(missing)}")


def _scan_sensitive(value: Any, path: str = "$") -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            normalized = key.lower().replace("-", "_")
            if normalized in SENSITIVE_KEYS:
                raise ValidationError(f"sensitive key is forbidden at {path}.{key}")
            _scan_sensitive(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            _scan_sensitive(child, f"{path}[{index}]")
    elif isinstance(value, str):
        for pattern in SENSITIVE_VALUE_PATTERNS:
            if pattern.search(value):
                raise ValidationError(f"sensitive value is forbidden at {path}")


def _validate_ids(data: dict[str, Any]) -> None:
    for collection, id_field in ID_FIELDS.items():
        seen: set[str] = set()
        for index, row in enumerate(data[collection]):
            if not isinstance(row, dict):
                raise ValidationError(f"$.{collection}[{index}] must be an object")
            identifier = row.get(id_field)
            if not isinstance(identifier, str) or not identifier.strip():
                raise ValidationError(
                    f"$.{collection}[{index}].{id_field} must be a non-empty string"
                )
            if identifier in seen:
                raise ValidationError(
                    f"duplicate {id_field} {identifier!r} in $.{collection}"
                )
            seen.add(identifier)


def _validate_evidence_paths(data: dict[str, Any]) -> None:
    for index, row in enumerate(data["evidence"]):
        value = row.get("file_path", "")
        if not value:
            continue
        path = PurePosixPath(str(value).replace("\\", "/"))
        if path.is_absolute() or re.match(r"^[A-Za-z]:/", str(path)) or ".." in path.parts:
            raise ValidationError(
                f"$.evidence[{index}].file_path must be relative to the run directory"
            )


def _validate_target_url(data: dict[str, Any]) -> None:
    value = str(data["run"].get("target_url", ""))
    parsed = urlsplit(value)
    if parsed.username or parsed.password:
        raise ValidationError("$.run.target_url must not contain embedded credentials")
    for key, _ in parse_qsl(parsed.query, keep_blank_values=True):
        if key.lower().replace("-", "_") in SENSITIVE_KEYS:
            raise ValidationError(
                f"$.run.target_url contains forbidden sensitive query key {key!r}"
            )


def _parse_timestamp(value: Any, path: str) -> datetime | None:
    if value in (None, ""):
        return None
    if not isinstance(value, str):
        raise ValidationError(f"{path} must be an ISO-8601 string or empty")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValidationError(f"{path} must be a valid ISO-8601 timestamp") from exc


def _validate_executor_and_timing(data: dict[str, Any]) -> None:
    run = data["run"]
    executor = run["executor"]
    if not isinstance(executor, dict):
        raise ValidationError("$.run.executor must be an object")
    _require_keys(executor, REQUIRED_EXECUTOR, "$.run.executor")

    timing = run["timing"]
    if not isinstance(timing, dict):
        raise ValidationError("$.run.timing must be an object")
    _require_keys(timing, REQUIRED_TIMING_PHASES, "$.run.timing")

    parsed: dict[str, tuple[datetime | None, datetime | None]] = {}
    for phase_name in REQUIRED_TIMING_PHASES:
        phase = timing[phase_name]
        path = f"$.run.timing.{phase_name}"
        if not isinstance(phase, dict):
            raise ValidationError(f"{path} must be an object")
        _require_keys(phase, REQUIRED_TIMING_FIELDS, path)
        status = phase["status"]
        duration = phase["duration_ms"]
        if not isinstance(status, str) or not status.strip():
            raise ValidationError(f"{path}.status must be a non-empty string")
        if not isinstance(duration, (int, float)) or isinstance(duration, bool) or duration < 0:
            raise ValidationError(f"{path}.duration_ms must be a non-negative number")
        started = _parse_timestamp(phase["started_at"], f"{path}.started_at")
        ended = _parse_timestamp(phase["ended_at"], f"{path}.ended_at")
        if status == "not_started":
            if started is not None or ended is not None or duration != 0:
                raise ValidationError(
                    f"{path} with status=not_started must have empty timestamps and zero duration"
                )
        elif started is None:
            raise ValidationError(f"{path}.started_at is required when the phase has started")
        if started is not None and ended is not None and ended < started:
            raise ValidationError(f"{path}.ended_at must not precede started_at")
        parsed[phase_name] = (started, ended)

    total_start, total_end = parsed["total"]
    gate_start, _ = parsed["executor_gate"]
    _, validation_end = parsed["artifact_validation"]
    if total_start is not None and gate_start is not None and total_start > gate_start:
        raise ValidationError(
            "$.run.timing.total.started_at must include work before or at executor_gate"
        )
    if total_end is not None and validation_end is not None and total_end < validation_end:
        raise ValidationError(
            "$.run.timing.total.ended_at must include artifact_validation"
        )


def _validate_summary_findings(data: dict[str, Any]) -> None:
    for index, finding in enumerate(data["summary"]["key_findings"]):
        path = f"$.summary.key_findings[{index}]"
        if not isinstance(finding, dict):
            raise ValidationError(f"{path} must be an object")
        _require_keys(finding, REQUIRED_FINDING, path)


def _validate_budget_control(data: dict[str, Any]) -> None:
    budget = data["run"]["budget_control"]
    if not isinstance(budget, dict):
        raise ValidationError("$.run.budget_control must be an object")
    _require_keys(budget, REQUIRED_BUDGET_CONTROL, "$.run.budget_control")
    if budget["mode"] not in {"time", "batch", "scope", "adaptive"}:
        raise ValidationError("$.run.budget_control.mode is unsupported")
    if budget["status"] not in {"active", "closing", "met", "overrun", "not_applicable"}:
        raise ValidationError("$.run.budget_control.status is unsupported")
    overrun = budget["overrun_ms"]
    if not isinstance(overrun, (int, float)) or isinstance(overrun, bool) or overrun < 0:
        raise ValidationError("$.run.budget_control.overrun_ms must be non-negative")

    started = _parse_timestamp(budget["started_at"], "$.run.budget_control.started_at")
    closeout = _parse_timestamp(budget["closeout_at"], "$.run.budget_control.closeout_at")
    deadline = _parse_timestamp(budget["deadline_at"], "$.run.budget_control.deadline_at")
    _parse_timestamp(budget["last_checked_at"], "$.run.budget_control.last_checked_at")
    if budget["mode"] == "time":
        if started is None or closeout is None or deadline is None:
            raise ValidationError(
                "$.run.budget_control time mode requires started_at, closeout_at and deadline_at"
            )
        if started > closeout:
            raise ValidationError("$.run.budget_control.closeout_at must not precede started_at")
        if closeout > deadline:
            raise ValidationError("$.run.budget_control.closeout_at must not follow deadline_at")


def validate_data(data: Any) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise ValidationError("$ must be an object")
    _require_keys(data, REQUIRED_TOP_LEVEL, "$")
    unknown = sorted(set(data) - REQUIRED_TOP_LEVEL)
    if unknown:
        raise ValidationError(f"$ contains unsupported keys: {', '.join(unknown)}")
    if data["schema_version"] != SCHEMA_VERSION:
        raise ValidationError(
            f"unsupported schema_version {data['schema_version']!r}; expected {SCHEMA_VERSION!r}"
        )
    if not isinstance(data["run"], dict):
        raise ValidationError("$.run must be an object")
    if not isinstance(data["summary"], dict):
        raise ValidationError("$.summary must be an object")
    if not isinstance(data["coverage"], dict):
        raise ValidationError("$.coverage must be an object")
    _require_keys(data["run"], REQUIRED_RUN, "$.run")
    _require_keys(data["summary"], REQUIRED_SUMMARY, "$.summary")
    for key in TOP_LEVEL_ARRAYS:
        if not isinstance(data[key], list):
            raise ValidationError(f"$.{key} must be an array")
    for key in ("run_positioning", "exploration_focus"):
        if not isinstance(data["run"][key], list):
            raise ValidationError(f"$.run.{key} must be an array")
    for key in (
        "answered_questions",
        "unanswered_questions",
        "key_findings",
        "recommendations",
    ):
        if not isinstance(data["summary"][key], list):
            raise ValidationError(f"$.summary.{key} must be an array")
    if not str(data["summary"]["conclusion_boundary"]).strip():
        raise ValidationError("$.summary.conclusion_boundary must not be empty")
    _scan_sensitive(data)
    _validate_summary_findings(data)
    _validate_budget_control(data)
    _validate_executor_and_timing(data)
    _validate_ids(data)
    _validate_evidence_paths(data)
    _validate_target_url(data)
    return data


def load_and_validate(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ValidationError(f"cannot read JSON {path}: {exc}") from exc
    return validate_data(data)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="Path to evidence/run-data.json")
    args = parser.parse_args()
    try:
        data = load_and_validate(args.input)
    except ValidationError as exc:
        print(f"run-data validation failed: {exc}")
        return 1
    print(
        json.dumps(
            {
                "status": "valid",
                "schema_version": data["schema_version"],
                "run_id": data["run"]["run_id"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
