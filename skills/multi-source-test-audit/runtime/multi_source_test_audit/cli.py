from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import TextIO

from .errors import RuntimePolicyError
from .health import health_report
from .paths import standard_paths
from .self_check import run_self_check
from .stage_a import (
    accept_stage_a_candidates,
    complete_stage_a,
    inventory_stage_a,
    regenerate_stage_a_report,
    select_stage_a_candidate,
)
from .version import __version__


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="multi-source-test-audit")
    parser.add_argument("--version", action="version", version=__version__)
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("health", help="Report deterministic runtime health.")
    subcommands.add_parser("paths", help="Report controlled runtime paths.")
    self_check = subcommands.add_parser("self-check", help="Run the offline installation checks.")
    self_check.add_argument("--fixtures", required=True, type=Path)
    stage_a = subcommands.add_parser("stage-a", help="Run the read-only Stage A workflow.")
    stage_actions = stage_a.add_subparsers(dest="stage_a_action", required=True)
    inventory = stage_actions.add_parser("inventory", help="Inventory Stage A materials.")
    inventory.add_argument("--project-name", required=True)
    inventory.add_argument("--material", action="append", required=True, type=Path)
    inventory.add_argument(
        "--business-repository", action="append", required=True, type=Path
    )
    candidates = stage_actions.add_parser(
        "candidates", help="Validate model analysis and present three candidates."
    )
    candidates.add_argument("--project-id", required=True)
    candidates.add_argument("--analysis", required=True, type=Path)
    select = stage_actions.add_parser("select", help="Record an immutable candidate selection.")
    select.add_argument("--project-id", required=True)
    select.add_argument("--selection", required=True)
    complete = stage_actions.add_parser(
        "complete", help="Validate a host-generated plan and complete Stage A."
    )
    complete.add_argument("--project-id", required=True)
    complete.add_argument("--plan-package", required=True, type=Path)
    report = stage_actions.add_parser(
        "report", help="Regenerate the final Stage A v2 workbook from saved state."
    )
    report.add_argument("--project-id", required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    if argv is not None and list(argv) == ["--version"]:
        print(__version__)
        return 0
    parser = build_parser()
    try:
        arguments = parser.parse_args(argv)
        if arguments.command == "health":
            _write_json(health_report(), sys.stdout)
            return 0
        if arguments.command == "paths":
            _write_json({name: str(path) for name, path in standard_paths().items()}, sys.stdout)
            return 0
        if arguments.command == "self-check":
            report = run_self_check(standard_paths()["runtime_root"], arguments.fixtures)
            _write_json(report, sys.stdout if report["status"] == "ready" else sys.stderr)
            return 0 if report["status"] == "ready" else 3
        if arguments.command == "stage-a":
            if arguments.stage_a_action == "inventory":
                _write_json(
                    inventory_stage_a(
                        arguments.project_name,
                        arguments.material,
                        arguments.business_repository,
                    ),
                    sys.stdout,
                )
                return 0
            if arguments.stage_a_action == "candidates":
                _write_json(
                    accept_stage_a_candidates(arguments.project_id, arguments.analysis),
                    sys.stdout,
                )
                return 0
            if arguments.stage_a_action == "complete":
                _write_json(
                    complete_stage_a(arguments.project_id, arguments.plan_package),
                    sys.stdout,
                )
                return 0
            if arguments.stage_a_action == "select":
                _write_json(
                    select_stage_a_candidate(arguments.project_id, arguments.selection),
                    sys.stdout,
                )
                return 0
            if arguments.stage_a_action == "report":
                _write_json(regenerate_stage_a_report(arguments.project_id), sys.stdout)
                return 0
        parser.error("unknown command")
    except RuntimePolicyError as exc:
        _write_json(exc.as_dict(), sys.stderr)
        return 2
    return 2


def _write_json(value: object, stream: TextIO) -> None:
    json.dump(value, stream, ensure_ascii=False, sort_keys=True)
    stream.write("\n")
