from __future__ import annotations

import json
from pathlib import Path
from typing import Any, cast

from .errors import ErrorCode, RuntimePolicyError

PLAN_SCHEMA_VERSION = "selected-chain-plan-v1"
SEMANTIC_SOURCES = {
    "material_fact",
    "cross_source_inference",
    "generic_test_heuristic",
    "user_confirmed_rule",
    "unknown_rule",
}
REFERENCE_TYPES = {
    "material_id",
    "fact_id",
    "association_id",
    "clue_id",
    "interface_id",
}
_PACKAGE_FIELDS = {
    "schema_version",
    "project_id",
    "selected_chain_id",
    "selected_chain_name",
    "candidate_set_hash",
    "material_inventory_hash",
    "selected_chain_summary",
    "selected_chain_unknown_rules",
    "selected_chain_associations",
    "selected_chain_clues",
    "audit_plan_items",
    "generated_context",
    "provenance",
}
_PLAN_FIELDS = {
    "plan_id",
    "title",
    "category",
    "semantic_source",
    "basis_references",
    "expected_basis",
    "preconditions",
    "steps",
    "expected_result",
    "roles",
    "mutation_parameters",
    "side_effect_evidence",
    "risk",
    "current_status",
    "stage_b_approval",
    "notes",
}


def load_and_validate_plan_package(
    path: Path,
    *,
    project_id: str,
    selection: dict[str, Any],
    analysis: dict[str, Any],
    material_ids: set[str],
) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text("utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _invalid("Selected-chain plan package is not readable JSON.") from exc
    package = _object(value, "plan package")
    _exact(package, _PACKAGE_FIELDS, "plan package")
    if package.get("schema_version") != PLAN_SCHEMA_VERSION:
        raise _invalid("Selected-chain plan package uses an unsupported schema version.")
    expected_identity = {
        "project_id": project_id,
        "selected_chain_id": selection["selected_chain_id"],
        "selected_chain_name": selection["selected_chain_name"],
        "candidate_set_hash": selection["candidate_set_hash"],
        "material_inventory_hash": selection["material_inventory_hash"],
    }
    if any(package.get(key) != expected for key, expected in expected_identity.items()):
        raise _invalid("Plan package identity does not match the immutable selection evidence.")
    for field in ("selected_chain_summary",):
        _text(package.get(field), field)
    association_ids = {
        _text(item.get("association_id"), "association_id")
        for item in _objects(analysis.get("associations"), "associations")
        if item.get("scope") == "global"
        or item.get("chain_id") == selection["selected_chain_id"]
    }
    selected = next(
        item
        for item in _objects(analysis.get("candidates"), "candidates")
        if item.get("chain_id") == selection["selected_chain_id"]
    )
    if package.get("selected_chain_summary") != selected.get("recommendation_reason"):
        raise _invalid("Selected-chain summary must exactly match the selected candidate.")
    clue_ids = {
        _text(item.get("clue_id"), "clue_id")
        for item in _objects(selected.get("clues"), "clues")
    }
    interface_ids = {
        _text(item.get("interface_id"), "interface_id")
        for item in _objects(selected.get("interface_references"), "interface_references")
    }
    facts = [
        item
        for item in _objects(analysis.get("profile"), "profile")
        if item.get("scope") == "global"
        or item.get("chain_id") == selection["selected_chain_id"]
    ]
    allowed = {
        "material_id": material_ids,
        "fact_id": {
            _text(item.get("fact_id"), "fact_id")
            for item in facts
        },
        "association_id": association_ids,
        "clue_id": clue_ids,
        "interface_id": interface_ids,
    }
    material_source_ids = {
        _text(item.get("path"), "material.path"): _text(item.get("material_id"), "material_id")
        for item in _objects(analysis.get("materials"), "materials")
    }
    association_sources = {
        _text(item.get("association_id"), "association_id"): _source_material_ids(
            _text_list(item.get("source_locations"), "association.source_locations"),
            material_source_ids,
        )
        for item in _objects(analysis.get("associations"), "associations")
    }
    fact_statuses = {
        _text(item.get("fact_id"), "fact_id"): _text(item.get("basis_status"), "basis_status")
        for item in facts
    }
    if not set(_text_list(package.get("selected_chain_associations"), "associations")).issubset(
        association_ids
    ):
        raise _invalid("Plan package references an association outside the selected chain.")
    if not set(_text_list(package.get("selected_chain_clues"), "clues")).issubset(clue_ids):
        raise _invalid("Plan package references a clue outside the selected chain.")
    unknown_fact_ids = {
        _text(item.get("fact_id"), "fact_id")
        for item in facts
        if item.get("basis_status") == "unknown_rule"
    }
    package_unknown_rules = set(
        _text_list(package.get("selected_chain_unknown_rules"), "selected_chain_unknown_rules")
    )
    if not package_unknown_rules.issubset(unknown_fact_ids):
        raise _invalid("Selected-chain unknown rules must use in-scope unknown fact IDs.")
    _object(package.get("generated_context"), "generated_context")
    _object(package.get("provenance"), "provenance")
    plans = _objects(package.get("audit_plan_items"), "audit_plan_items")
    if not plans:
        raise _invalid("Plan package must contain at least one host-generated plan item.")
    seen: dict[str, int] = {}
    for plan_index, plan in enumerate(plans):
        _exact(plan, _PLAN_FIELDS, "audit plan item")
        plan_id = _text(plan.get("plan_id"), "plan_id")
        if plan_id in seen:
            raise RuntimePolicyError(
                ErrorCode.STAGE_A_PLAN_PACKAGE_INVALID,
                "Plan IDs must be unique.",
                details={
                    "id_type": "plan_id",
                    "duplicate_id": plan_id,
                    "first_position": f"audit_plan_items[{seen[plan_id]}]",
                    "conflict_position": f"audit_plan_items[{plan_index}]",
                },
            )
        seen[plan_id] = plan_index
        for field in (
            "title",
            "category",
            "expected_basis",
            "expected_result",
            "risk",
            "current_status",
            "stage_b_approval",
            "notes",
        ):
            _text(plan.get(field), field)
        source = _text(plan.get("semantic_source"), "semantic_source")
        if source not in SEMANTIC_SOURCES:
            raise _invalid("Plan semantic_source is not controlled.")
        if plan["current_status"] != "not_executed":
            raise _invalid("Stage A plans must use the exact current_status 'not_executed'.")
        for field in (
            "preconditions",
            "steps",
            "roles",
            "mutation_parameters",
            "side_effect_evidence",
        ):
            _text_list(plan.get(field), field, allow_empty=field == "mutation_parameters")
        references = _objects(plan.get("basis_references"), "basis_references")
        if not references:
            raise _invalid("Every plan must have at least one stable basis reference.")
        for reference in references:
            _exact(reference, {"reference_type", "reference_id"}, "basis reference")
            reference_type = _text(reference.get("reference_type"), "reference_type")
            reference_id = _text(reference.get("reference_id"), "reference_id")
            if reference_type not in REFERENCE_TYPES or reference_id not in allowed[reference_type]:
                raise _invalid("Plan basis reference is missing or outside the selected chain.")
        if source == "unknown_rule" and plan["expected_result"] != "规则待确认":
            raise _invalid("Unknown-rule plans must use the exact expected result '规则待确认'.")
        _validate_semantic_source(
            source,
            references,
            fact_statuses=fact_statuses,
            association_sources=association_sources,
        )
    return package


def _object(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise _invalid(f"{field} must be an object.")
    return cast(dict[str, Any], value)


def _objects(value: Any, field: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise _invalid(f"{field} must be an array.")
    return [_object(item, field) for item in value]


def _text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _invalid(f"{field} must be non-empty text.")
    return value


def _text_list(value: Any, field: str, *, allow_empty: bool = True) -> list[str]:
    if not isinstance(value, list) or (not allow_empty and not value) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        raise _invalid(f"{field} must be an array of non-empty text values.")
    return cast(list[str], value)


def _exact(value: dict[str, Any], fields: set[str], label: str) -> None:
    if set(value) != fields:
        raise _invalid(f"{label} must contain exactly the contract fields.")


def _invalid(message: str) -> RuntimePolicyError:
    return RuntimePolicyError(ErrorCode.STAGE_A_PLAN_PACKAGE_INVALID, message)


def _source_material_ids(
    sources: list[str], material_source_ids: dict[str, str]
) -> set[str]:
    result: set[str] = set()
    for source in sources:
        path = source.replace("\\", "/").split("#", 1)[0]
        material_id = material_source_ids.get(path)
        if material_id is not None:
            result.add(material_id)
    return result


def _validate_semantic_source(
    source: str,
    references: list[dict[str, Any]],
    *,
    fact_statuses: dict[str, str],
    association_sources: dict[str, set[str]],
) -> None:
    pairs = {(item["reference_type"], item["reference_id"]) for item in references}
    if source == "material_fact":
        if any(kind == "material_id" for kind, _ in pairs):
            return
        if any(
            kind == "fact_id" and fact_statuses.get(identifier) == "confirmed_fact"
            for kind, identifier in pairs
        ):
            return
        raise _invalid("material_fact requires a material ID or confirmed fact ID.")
    if source == "cross_source_inference":
        material_ids = {identifier for kind, identifier in pairs if kind == "material_id"}
        for kind, identifier in pairs:
            if kind == "association_id":
                material_ids.update(association_sources.get(identifier, set()))
        if len(material_ids) < 2:
            raise _invalid("cross_source_inference requires at least two distinct materials.")
        return
    if source == "generic_test_heuristic":
        return
    if source == "unknown_rule":
        if (
            any(
                kind == "fact_id" and fact_statuses.get(identifier) == "unknown_rule"
                for kind, identifier in pairs
            )
            and references
        ):
            # The caller separately requires the exact uncertain expected result.
            return
        raise _invalid("unknown_rule requires an in-scope unknown-rule fact ID.")
    if source == "user_confirmed_rule":
        if any(
            kind == "fact_id" and fact_statuses.get(identifier) == "user_confirmed_rule"
            for kind, identifier in pairs
        ):
            return
        raise _invalid("user_confirmed_rule requires an in-scope user-confirmed fact ID.")
