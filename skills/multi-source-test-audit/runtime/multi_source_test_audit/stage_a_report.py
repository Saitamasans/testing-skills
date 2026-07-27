# ruff: noqa: RUF001
from __future__ import annotations

from pathlib import Path
from typing import Any

from .excel import AUDIT_SHEETS

NOT_EXECUTED_REASON = "当前仅完成阶段 A，尚未获得阶段 B 审批。"
_STATUS_LABELS = {
    "confirmed_fact": "已确认事实",
    "audit_inference": "审计推断",
    "unknown_rule": "规则未知",
    "material_fact": "材料事实",
    "cross_source_inference": "多源材料推断",
    "generic_test_heuristic": "通用测试启发式",
    "user_confirmed_rule": "用户明确规则",
}


def build_stage_a_report_rows(
    state: dict[str, Any],
    analysis: dict[str, Any],
    candidates: list[dict[str, Any]],
    selected: dict[str, Any],
    selected_number: int,
    plan_package: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    """Map validated host-model data to the fixed workbook without inventing semantics."""
    plan = [_plan_row(item, analysis, selected) for item in plan_package["audit_plan_items"]]
    rows = (
        _overview_rows(state, analysis, candidates, selected, selected_number, plan_package),
        _association_rows(analysis, selected, plan_package),
        plan,
        [_execution_row(item, selected["name"]) for item in plan_package["audit_plan_items"]],
    )
    return dict(zip(AUDIT_SHEETS, rows, strict=True))


def _overview_rows(
    state: dict[str, Any],
    analysis: dict[str, Any],
    candidates: list[dict[str, Any]],
    selected: dict[str, Any],
    selected_number: int,
    plan_package: dict[str, Any],
) -> list[dict[str, Any]]:
    project = state["project"]
    rows = [
        _overview("项目基本信息", "项目名称", project["name"], f"项目编号：{project['id']}"),
        _overview("项目基本信息", "阶段状态", "阶段 A 已完成", "未执行任何动态验证"),
    ]
    for index, material in enumerate(state["material_index"], start=1):
        rows.append(
            _overview(
                "材料盘点",
                f"材料 {index}",
                Path(material["path"]).name,
                "读取成功" if material["complete"] else "材料缺失或不完整",
            )
        )
    rows.append(
        _overview(
            "能力等级与限制",
            "当前能力等级",
            analysis["capability"]["level"],
            analysis["capability"]["explanation"],
        )
    )
    for index, candidate in enumerate(candidates, start=1):
        rows.append(
            _overview(
                "候选业务链",
                f"候选 {index}",
                candidate["name"],
                candidate["recommendation_reason"],
            )
        )
    rows.extend(
        [
            _overview(
                "用户最终选择",
                "已选业务链",
                f"{selected_number}. {selected['name']}",
                selected["recommendation_reason"],
            ),
            _overview(
                "当前阶段状态",
                "执行状态",
                "未执行",
                NOT_EXECUTED_REASON,
            ),
        ]
    )
    unknown_ids = set(plan_package["selected_chain_unknown_rules"])
    unknown_rules = [
        item for item in analysis["profile"] if item.get("fact_id") in unknown_ids
    ]
    for index, rule in enumerate(unknown_rules, start=1):
        rows.append(
            _overview(
                "规则未知",
                f"未知规则 {index}",
                str(rule["statement"]),
                "规则待确认",
            )
        )
    return rows


def _overview(section: str, item: str, content: str, note: str) -> dict[str, Any]:
    return {"分区": section, "项目": item, "内容": content, "来源或说明": note}


def _association_rows(
    analysis: dict[str, Any],
    selected: dict[str, Any],
    plan_package: dict[str, Any],
) -> list[dict[str, Any]]:
    requested = set(plan_package["selected_chain_associations"])
    rows: list[dict[str, Any]] = []
    for item in analysis["associations"]:
        if item["association_id"] not in requested:
            continue
        rows.append(
            {
                "关联编号": item["association_id"],
                "业务链": selected["name"],
                "业务动作": item["action"],
                "规则或材料依据": item["requirement"],
                "调用入口": item["caller"],
                "接口": item["interface"],
                "处理位置": item["backend"],
                "数据或副作用": item["side_effect"],
                "来源定位": "\n".join(item["source_locations"]),
                "依据状态": _STATUS_LABELS[item["basis_status"]],
                "行为差异": item["behavior_difference"],
            }
        )
    return rows


def _plan_row(
    item: dict[str, Any], analysis: dict[str, Any], selected: dict[str, Any]
) -> dict[str, Any]:
    return {
        "计划编号": item["plan_id"],
        "审计场景": item["title"],
        "对应接口 / 业务动作": _plan_actions(item, analysis, selected),
        "规则或材料依据": _plan_basis(item, analysis, selected),
        "前置条件与账号角色": _conditions_and_roles(item),
        "变异参数": _numbered(item["mutation_parameters"], empty="无特定变异参数"),
        "黑盒验证步骤": _numbered(item["steps"]),
        "预期结果": item["expected_result"],
        "核验点 / 副作用证据": _numbered(item["side_effect_evidence"]),
        "风险、授权范围与审批状态": "\n".join(
            [
                "【风险】",
                item["risk"],
                "【授权范围 / 审批要求】",
                item["stage_b_approval"],
                "【审批状态】",
                "待审批",
            ]
        ),
    }


def _plan_actions(item: dict[str, Any], analysis: dict[str, Any], selected: dict[str, Any]) -> str:
    references = _reference_context(analysis, selected)
    values: list[str] = []
    for reference_type in ("interface_id", "association_id", "clue_id"):
        for reference in item["basis_references"]:
            if reference["reference_type"] != reference_type:
                continue
            value = references[reference_type].get(reference["reference_id"])
            if value is not None:
                values.append(value)
    if not values:
        values.append("未定位具体接口，仅关联业务动作")
    return "\n".join(dict.fromkeys(values))


def _plan_basis(item: dict[str, Any], analysis: dict[str, Any], selected: dict[str, Any]) -> str:
    references = _reference_context(analysis, selected)
    sources = [
        references[reference["reference_type"]].get(
            reference["reference_id"],
            f"{reference['reference_type']}:{reference['reference_id']}",
        )
        for reference in item["basis_references"]
    ]
    values = [
        "【依据类型】",
        _STATUS_LABELS[item["semantic_source"]],
        "【来源】",
        *sources,
        "【预期依据】",
        item["expected_basis"],
    ]
    if item["notes"]:
        values.extend(["【补充说明】", item["notes"]])
    return "\n".join(values)


def _reference_context(
    analysis: dict[str, Any], selected: dict[str, Any]
) -> dict[str, dict[str, str]]:
    def source(item: dict[str, Any]) -> str:
        return "；".join(item.get("source_locations", [item.get("source", "")]))

    interfaces = {
        item["interface_id"]: (
            f"interface_id:{item['interface_id']}："
            f"{item['method']} {item['path']} {item['interface_name']}"
        )
        for item in selected["interface_references"]
    }
    associations = {
        item["association_id"]: "\n".join(
            [
                f"association_id:{item['association_id']}：{item['action']}",
                f"接口：{item['interface']}",
                f"来源定位：{source(item)}",
            ]
        )
        for item in analysis["associations"]
    }
    clues = {
        item["clue_id"]: f"clue_id:{item['clue_id']}：{item['summary']}；来源定位：{source(item)}"
        for item in selected["clues"]
    }
    facts = {
        item["fact_id"]: f"fact_id:{item['fact_id']}：{item['statement']}；来源定位：{source(item)}"
        for item in analysis["profile"]
    }
    materials = {
        item["material_id"]: f"material_id:{item['material_id']}：{item['path']}"
        for item in analysis["materials"]
    }
    return {
        "interface_id": interfaces,
        "association_id": associations,
        "clue_id": clues,
        "fact_id": facts,
        "material_id": materials,
    }


def _conditions_and_roles(item: dict[str, Any]) -> str:
    return "\n".join(
        [
            "【前置条件】",
            _numbered(item["preconditions"]),
            "【账号角色】",
            _numbered(item["roles"]),
        ]
    )


def _numbered(values: list[str], *, empty: str = "") -> str:
    if not values:
        return empty
    return "\n".join(f"{index}. {value}" for index, value in enumerate(values, start=1))


def _execution_row(item: dict[str, Any], selected_name: str) -> dict[str, Any]:
    return {
        "执行编号": item["plan_id"],
        "对应计划编号": item["plan_id"],
        "业务链": selected_name,
        "测试场景": item["title"],
        "语义来源": _STATUS_LABELS[item["semantic_source"]],
        "执行状态": "未执行",
        "未执行原因": NOT_EXECUTED_REASON,
        "所需账号": "\n".join(item["roles"]),
        "所需副作用证据": "\n".join(item["side_effect_evidence"]),
        "证据路径": "",
        "当前结论": "尚未执行，不能确认动态结果或缺陷。",
    }
