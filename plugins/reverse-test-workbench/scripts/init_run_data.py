#!/usr/bin/env python3
"""Create a canonical minimal reverse-test-workbench run-data file."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path


def _parse_timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds")


def _phase(status: str = "not_started") -> dict[str, object]:
    return {"started_at": "", "ended_at": "", "duration_ms": 0, "status": status}


def _reserve_minutes(budget_minutes: float) -> float:
    if budget_minutes <= 3:
        return budget_minutes * 0.5
    if budget_minutes <= 15:
        return min(budget_minutes * 0.8, max(3.0, budget_minutes * 0.3))
    return max(3.0, budget_minutes * 0.2)


def build_data(args: argparse.Namespace) -> dict[str, object]:
    started = _parse_timestamp(args.started_at)
    now = datetime.now(started.tzinfo)
    if now < started:
        now = started
    deadline = started + timedelta(minutes=args.budget_minutes)
    closeout = deadline - timedelta(minutes=_reserve_minutes(args.budget_minutes))
    gate_duration = max(0, round((now - started).total_seconds() * 1000))

    timing = {
        name: _phase()
        for name in (
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
        )
    }
    timing["executor_gate"] = {
        "started_at": _iso(started),
        "ended_at": _iso(now),
        "duration_ms": gate_duration,
        "status": "completed",
    }
    timing["total"] = {
        "started_at": _iso(started),
        "ended_at": "",
        "duration_ms": 0,
        "status": "running",
    }

    return {
        "schema_version": "1.0",
        "run": {
            "run_id": args.run_id,
            "system_name": args.system_name,
            "target_url": args.target_url,
            "status": "running",
            "plugin_version": args.plugin_version,
            "run_positioning": ["执行器/Plugin验证", "初始侦察"],
            "scope_boundary": "当前授权目标与账号可见范围；默认仅执行L0只读操作",
            "coverage_commitment": "代表性价值探索",
            "exploration_focus": ["入口判定", "B01快速地图", "安全的高价值未知"],
            "run_budget": f"{args.budget_minutes:g}分钟端到端预算",
            "budget_control": {
                "mode": "time",
                "started_at": _iso(started),
                "closeout_at": _iso(closeout),
                "deadline_at": _iso(deadline),
                "last_checked_at": _iso(now),
                "status": "active",
                "overrun_ms": 0,
            },
            "account_context": "待登录后更新；不记录登录凭据",
            "executor": {
                "protocol": "official-playwright-mcp",
                "package": "@playwright/mcp",
                "version": args.executor_version,
                "transport": "stdio",
                "browser_channel": args.browser_channel,
                "session_mode": args.session_mode,
                "model_vision_capability": args.model_vision_capability,
                "capability_state": args.capability_state,
            },
            "artifact_preflight": {
                "checked_at": "",
                "docx_generation": "unknown",
                "xlsx_generation": "unknown",
                "libreoffice": "unknown",
                "table_validation": "unknown",
                "image_validation": "unknown",
                "visual_render_unavailable": False,
                "fallback": "pending",
                "notes": "页面类型判定后只执行一次产物能力预检。",
            },
            "timing": timing,
            "resume": {
                "pause_state": "running",
                "current_batch": "",
                "navigation_cursor": "",
                "return_cursor": "",
                "initial_plan": [],
                "dynamic_batches": [],
                "active_inserted_path": None,
                "backlog": [],
                "last_known_good_page": {},
                "blockers": [],
                "next_action": "依据页面类型进入B00或B01并增量更新事实源",
            },
        },
        "summary": {
            "one_line_conclusion": "运行中：已建立规范事实源，等待页面事实更新。",
            "answered_questions": [],
            "unanswered_questions": ["页面类型、账号上下文、导航骨架和首个高价值未知"],
            "key_findings": [],
            "recommendations": [],
            "conclusion_boundary": "当前仅为运行骨架，不代表系统质量或覆盖结论。",
        },
        "coverage": {
            "quick_map_status": "not_started",
            "navigation_ledger_status": "not_started",
            "identified_entries": 0,
            "reached_surfaces": 0,
            "initially_explored": 0,
            "effectively_explored": 0,
            "closed_paths": 0,
            "initial_batches": 0,
            "dynamic_batches": 0,
            "completed_batches": 0,
            "disposed_batches": 0,
            "backlog_count": 0,
            "information_gain_state": "pending",
            "uncovered_scope": [],
        },
        "batches": [],
        "navigation": [],
        "page_inventory": [],
        "paths": [],
        "test_cases": [],
        "issues": [],
        "risks": [],
        "test_data": [],
        "evidence": [],
        "knowledge": [],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--system-name", required=True)
    parser.add_argument("--target-url", required=True)
    parser.add_argument("--plugin-version", required=True)
    parser.add_argument("--executor-version", required=True)
    parser.add_argument("--started-at", required=True)
    parser.add_argument("--budget-minutes", required=True, type=float)
    parser.add_argument("--browser-channel", default="chrome")
    parser.add_argument("--session-mode", default="managed-isolated-headed")
    parser.add_argument("--model-vision-capability", default="available")
    parser.add_argument("--capability-state", default="READY_DOM_VISUAL")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if args.budget_minutes <= 0:
        parser.error("--budget-minutes must be positive")
    if args.output.exists() and not args.force:
        parser.error(f"output already exists: {args.output}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(build_data(args), ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"status": "initialized", "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
