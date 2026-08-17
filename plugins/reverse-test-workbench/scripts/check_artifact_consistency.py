#!/usr/bin/env python3
"""Verify that reverse-test-workbench derived artifacts match run-data.json."""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
from typing import Any


class ConsistencyError(ValueError):
    pass


def _load(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConsistencyError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConsistencyError(f"{path} must contain a JSON object")
    return value


def _file_fingerprint(path: Path) -> dict[str, Any]:
    content = path.read_bytes()
    return {"size_bytes": len(content), "sha256": sha256(content).hexdigest()}


def _require_fingerprint(run_root: Path, relative: str, expected: Any) -> None:
    path = run_root / relative
    if not path.is_file() or not isinstance(expected, dict):
        raise ConsistencyError(f"artifact integrity metadata is missing: {relative}")
    actual = _file_fingerprint(path)
    normalized_expected = {
        "size_bytes": expected.get("size_bytes"),
        "sha256": expected.get("sha256"),
    }
    if actual != normalized_expected:
        raise ConsistencyError(f"generated artifact is corrupted or replaced: {relative}")


def check(run_root: Path) -> dict[str, Any]:
    evidence = run_root / "evidence"
    run_data_path = evidence / "run-data.json"
    state_path = evidence / "_run-state.json"
    manifest_path = evidence / "_artifact-build.json"
    for path in (run_data_path, state_path, manifest_path):
        if not path.is_file():
            raise ConsistencyError(f"required artifact is missing: {path}")

    run_data = _load(run_data_path)
    state = _load(state_path)
    manifest = _load(manifest_path)
    canonical = json.dumps(
        run_data,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    actual_hash = sha256(canonical).hexdigest()
    expected_hash = manifest.get("input_sha256")
    if actual_hash != expected_hash:
        raise ConsistencyError(
            "derived artifacts are stale: run-data.json changed after publication"
        )

    run = run_data.get("run", {})
    executor = run.get("executor", {})
    comparisons = {
        "run_id": (state.get("run_id"), run.get("run_id")),
        "executor_protocol": (state.get("executor_protocol"), executor.get("protocol")),
        "executor_version": (state.get("executor_version"), executor.get("version")),
        "budget_control": (state.get("budget_control"), run.get("budget_control")),
    }
    for field, (actual, expected) in comparisons.items():
        if actual != expected:
            raise ConsistencyError(f"derived run-state is stale at {field}")

    file_integrity = manifest.get("file_integrity")
    if not isinstance(file_integrity, dict):
        raise ConsistencyError("artifact file integrity metadata is missing")
    for relative in ("evidence/run-data.json", "evidence/_run-state.json"):
        _require_fingerprint(run_root, relative, file_integrity.get(relative))

    for artifact_name, artifact in manifest.get("artifacts", {}).items():
        if artifact.get("status") != "generated":
            continue
        relative = artifact.get("path")
        if not relative:
            raise ConsistencyError(f"generated {artifact_name} artifact is missing")
        _require_fingerprint(run_root, relative, artifact.get("integrity"))
        _require_fingerprint(run_root, relative, file_integrity.get(relative))

    return {
        "status": "consistent",
        "run_id": run.get("run_id"),
        "input_sha256": actual_hash,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = check(args.run_root)
    except ConsistencyError as exc:
        print(f"artifact consistency check failed: {exc}")
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
