from __future__ import annotations

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from .atomic_io import atomic_create_json, atomic_write_json
from .capability import determine_capability
from .errors import ErrorCode, RuntimePolicyError
from .excel import write_stage_a_workbook_v2
from .inventory import MaterialRecord, inventory_materials
from .paths import (
    WritePolicy,
    initialize_runtime_layout,
    project_state_dir,
    standard_paths,
)
from .stage_a_plan import load_and_validate_plan_package
from .stage_a_report import build_stage_a_report_rows
from .state_store import load_project_state, save_project_state, save_stage_snapshot

STAGE_A_SCHEMA_VERSION = "stage-a-analysis-v2"
LEGACY_STAGE_A_SCHEMA_VERSION = "stage-a-analysis-v1"
PROFILE_DIMENSIONS = {
    "actor",
    "resource",
    "action",
    "input",
    "state",
    "permission",
    "trust_boundary",
    "side_effect",
    "evidence_source",
}
BASIS_STATUSES = {
    "confirmed_fact",
    "audit_inference",
    "unknown_rule",
    "user_confirmed_rule",
}
CLUE_CATEGORIES = {
    "audit_clue",
    "behavior_difference",
    "pending_validation_risk",
    "rule_pending_confirmation",
}
_SELECTION = re.compile(r"^[1-3]$")
_FORBIDDEN_CONCLUSIONS = ("confirmed bug", "confirmed_issue", "已确认 bug")
_ANALYSIS_FIELDS = {
    "schema_version",
    "project",
    "materials",
    "capability",
    "profile",
    "associations",
    "behavior_differences",
    "candidates",
    "later_stage_recommendations",
}
_PROJECT_FIELDS = {"id", "name"}
_MATERIAL_FIELDS = {"material_id", "path", "role"}
_CAPABILITY_FIELDS = {"level", "explanation"}
_PROFILE_FIELDS = {"dimension", "statement", "basis_status", "source_locations"}
_ASSOCIATION_FIELDS = {
    "action",
    "requirement",
    "caller",
    "interface",
    "backend",
    "side_effect",
    "source_locations",
    "basis_status",
    "behavior_difference",
}
_DIFFERENCE_FIELDS = {"summary", "source_locations"}
_CANDIDATE_FIELDS = {
    "name",
    "recommendation_reason",
    "conditions",
    "gaps",
    "risks",
    "materials",
    "clues",
    "business_entry",
    "component_references",
    "interface_references",
    "priority_reason",
    "estimated_interface_count",
    "source_coverage",
}
_BUSINESS_ENTRY_FIELDS = {"name", "component", "source", "relevance"}
_COMPONENT_GROUPS = {"android", "api_backend", "admin", "interface_document"}
_COMPONENT_REFERENCE_FIELDS = {
    "component",
    "material_id",
    "file_path",
    "symbol",
    "class_name",
    "method_name",
    "line_range",
    "relevance",
    "provenance",
    "source",
}
_INTERFACE_REFERENCE_FIELDS = {
    "method",
    "path",
    "interface_name",
    "group",
    "source",
    "relevance",
    "provenance",
}
_PRIORITY_REASON_FIELDS = {
    "why_priority",
    "risk_value",
    "material_completeness",
    "later_verifiability",
    "later_execution_safety",
}
_SOURCE_COVERAGE_FIELDS = _COMPONENT_GROUPS | {"other_materials"}
_COVERAGE_STATUSES = {"linked", "missing", "not_applicable", "not_located"}
_CLUE_FIELDS = {
    "category",
    "summary",
    "root_cause",
    "score",
    "source_locations",
    "black_box_steps",
    "proposed_role",
    "mutation_parameters",
    "side_effect_check",
    "risk",
    "stage_b_approval",
}
_GENERIC_COMPONENT_ROLES = {
    "client",
    "backend",
    "admin_console",
    "web",
    "mobile",
    "desktop",
    "service",
    "data_store",
    "cache",
    "queue",
    "scheduled_job",
    "external_service",
    "interface_document",
    "requirement_document",
    "other",
}


def inventory_stage_a(
    project_name: str,
    material_paths: list[Path],
    business_repositories: list[Path],
) -> dict[str, Any]:
    if not project_name.strip() or not material_paths or not business_repositories:
        raise _contract_error("Project name, materials and business repositories are required.")
    resolved_repositories = tuple(_require_directory(path) for path in business_repositories)
    resolved_materials = [_require_material(path, resolved_repositories) for path in material_paths]
    layout = initialize_runtime_layout(business_repositories=resolved_repositories)
    runtime_root = layout["runtime_root"]
    if any(_is_within(repository, runtime_root) for repository in resolved_repositories):
        raise _contract_error("Business repositories cannot be inside the audit runtime root.")
    inventory_inputs: list[str | Path] = list(resolved_materials)
    records = inventory_materials(inventory_inputs)
    project_id = _project_id(project_name, resolved_materials)
    policy = WritePolicy(runtime_root, resolved_repositories)
    project_root = project_state_dir(project_id, runtime_root).parent
    capability = determine_capability(_material_kinds(records)).value
    fingerprints = _fingerprint_repositories(resolved_repositories)
    material_index = [_material_dict(record, resolved_repositories) for record in records]
    request_path = project_root / "analysis-request.json"
    analysis_package_path = project_root / "analysis-package.json"
    analysis_request = {
        "schema_version": STAGE_A_SCHEMA_VERSION,
        "project_id": project_id,
        "project_name": project_name.strip(),
        "stage": "analysing_materials",
        "materials": material_index,
        "capability": {
            "level": capability,
            "explanation_required": True,
        },
        "analysis_package_path": str(analysis_package_path),
        "required_profile_dimensions": sorted(PROFILE_DIMENSIONS),
        "allowed_basis_statuses": sorted(BASIS_STATUSES),
        "required_candidate_count": 3,
        "allowed_clue_categories": sorted(CLUE_CATEGORIES),
        "analysis_schema": _analysis_schema(),
    }
    state = _base_state(
        project_id=project_id,
        project_name=project_name.strip(),
        stage="analysing_materials",
        materials=material_index,
        repositories=resolved_repositories,
        fingerprints=fingerprints,
        capability=capability,
    )
    atomic_write_json(request_path, analysis_request, policy=policy)
    state_path = save_project_state(project_id, state, policy)
    return {
        "status": "ok",
        "stage": "analysing_materials",
        "project_id": project_id,
        "capability": analysis_request["capability"],
        "materials": material_index,
        "analysis_request": str(request_path),
        "analysis_package": str(analysis_package_path),
        "state": str(state_path),
    }


def accept_stage_a_candidates(project_id: str, analysis_path: Path) -> dict[str, Any]:
    runtime_root = standard_paths()["runtime_root"]
    state = load_project_state(project_id, runtime_root)
    _require_stage(state, "analysing_materials")
    policy = _policy_from_state(state, runtime_root)
    _assert_inputs_unchanged(state)
    analysis = _load_json_object(analysis_path)
    candidates = _validate_analysis_package(analysis, state)
    candidates = cast(list[dict[str, Any]], analysis["candidates"])
    numbered = [
        _number_candidate(candidate, index)
        for index, candidate in enumerate(candidates, 1)
    ]
    updated = dict(state)
    updated.update(
        {
            "stage": "awaiting_candidate_selection",
            "profile": {"items": analysis["profile"]},
            "chains": numbered,
            "clues": [clue for candidate in candidates for clue in candidate["clues"]],
            "analysis": analysis,
        }
    )
    project_root = project_state_dir(project_id, runtime_root).parent
    candidates_path = project_root / "candidates.json"
    atomic_write_json(
        candidates_path,
        {
            "stage": "awaiting_candidate_selection",
            "project_id": project_id,
            "candidates": numbered,
            "selection_instruction": "Reply with one plain Arabic digit: 1, 2 or 3.",
        },
        policy=policy,
    )
    save_project_state(project_id, updated, policy)
    return {
        "status": "ok",
        "stage": "awaiting_candidate_selection",
        "project_id": project_id,
        "candidates": numbered,
        "associations": analysis["associations"],
        "schema_version": analysis["schema_version"],
        "candidates_file": str(candidates_path),
        "selection_instruction": "Reply with one plain Arabic digit: 1, 2 or 3.",
    }


def select_stage_a_candidate(project_id: str, selection: str) -> dict[str, Any]:
    if not _SELECTION.fullmatch(selection):
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_INVALID,
            "Stage A selection must be one plain Arabic digit from 1 to 3.",
            details={"selection": selection},
        )
    runtime_root = standard_paths()["runtime_root"]
    state = load_project_state(project_id, runtime_root)
    _require_stage(state, "awaiting_candidate_selection")
    policy = _policy_from_state(state, runtime_root)
    _assert_inputs_unchanged(state)
    analysis = _require_dict(state.get("analysis"), "state.analysis")
    candidates = _require_dict_list(analysis.get("candidates"), "analysis.candidates")
    selected_number = int(selection)
    selected = candidates[selected_number - 1]
    project_root = project_state_dir(project_id, runtime_root).parent
    candidate_set_hash = _canonical_hash(candidates)
    selected_candidate_hash = _canonical_hash(selected)
    material_inventory_hash = _canonical_hash(state["material_index"])
    evidence = {
        "project_id": project_id,
        "selection_number": selected_number,
        "selected_chain_id": selected["chain_id"],
        "selected_chain_name": selected["name"],
        "candidate_set_hash": candidate_set_hash,
        "selected_candidate_hash": selected_candidate_hash,
        "material_inventory_hash": material_inventory_hash,
        "selected_at": datetime.now(UTC).isoformat(),
        "state_before": "awaiting_candidate_selection",
        "state_after": "awaiting_selected_chain_plan",
        "user_input": selection,
        "evidence_version": "user-selection-v1",
    }
    evidence_path = project_root / "user-selection.json"
    atomic_create_json(evidence_path, evidence, policy=policy)
    updated = dict(state)
    updated.update({"stage": "awaiting_selected_chain_plan", "selection": evidence})
    save_project_state(project_id, updated, policy)
    return {
        "status": "ok",
        "stage": "awaiting_selected_chain_plan",
        "project_id": project_id,
        "selected_chain_id": selected["chain_id"],
        "selected_chain_name": selected["name"],
        "candidate_set_hash": candidate_set_hash,
        "material_inventory_hash": material_inventory_hash,
        "selection_evidence": str(evidence_path),
    }


def complete_stage_a(project_id: str, plan_package_path: Path | None) -> dict[str, Any]:
    if plan_package_path is None:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_PLAN_PACKAGE_INVALID,
            "A selected-chain plan package is required; Runner will not generate plans.",
        )
    runtime_root = standard_paths()["runtime_root"]
    state = load_project_state(project_id, runtime_root)
    if state.get("stage") == "stage_a_complete":
        return _confirm_idempotent_stage_a_completion(state, project_id, plan_package_path)
    _require_stage(state, "awaiting_selected_chain_plan")
    policy = _policy_from_state(state, runtime_root)
    _assert_inputs_unchanged(state)
    analysis = _require_dict(state.get("analysis"), "state.analysis")
    candidates = _require_dict_list(analysis.get("candidates"), "analysis.candidates")
    selection = _require_dict(state.get("selection"), "state.selection")
    evidence_path = project_state_dir(project_id, runtime_root).parent / "user-selection.json"
    persisted_selection = _load_json_object(evidence_path)
    if persisted_selection != selection:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_STALE,
            "Project selection no longer matches immutable selection evidence.",
        )
    current_candidate_hash = _canonical_hash(candidates)
    current_material_hash = _canonical_hash(state["material_index"])
    if (
        current_candidate_hash != selection.get("candidate_set_hash")
        or current_material_hash != selection.get("material_inventory_hash")
    ):
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_STALE,
            "Candidate or material inventory changed after user selection.",
        )
    selected = next(
        (item for item in candidates if item.get("chain_id") == selection.get("selected_chain_id")),
        None,
    )
    if selected is None:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_STALE,
            "Selected chain no longer exists in the candidate set.",
        )
    material_ids = _material_ids_from_state(state)
    plan_package = load_and_validate_plan_package(
        plan_package_path,
        project_id=project_id,
        selection=selection,
        analysis=analysis,
        material_ids=material_ids,
    )
    project_root = project_state_dir(project_id, runtime_root).parent
    stored_plan_path = project_root / "selected-chain-plan.json"
    plan_package_hash = _store_plan_package_evidence(stored_plan_path, plan_package, policy)
    outputs_root = project_root / "outputs"
    chat_path = outputs_root / "chat-summary.json"
    excel_path = outputs_root / "stage-a-audit-v2.xlsx"
    selected_number = cast(int, selection["selection_number"])
    rows = build_stage_a_report_rows(
        state, analysis, candidates, selected, selected_number, plan_package
    )
    chat_summary = _plan_chat_summary(
        state, analysis, candidates, selection, plan_package, excel_path
    )
    atomic_write_json(chat_path, chat_summary, policy=policy)
    write_stage_a_workbook_v2(
        excel_path,
        rows,
        policy=policy,
        project_name=cast(str, cast(dict[str, Any], state["project"])["name"]),
        selected_chain=f"{selected_number}. {selected['name']}",
    )
    updated = dict(state)
    updated.update(
        {
            "stage": "stage_a_complete",
            "selection": selection,
            "clues": selected["clues"],
            "selected_chain_plan": plan_package,
            "plan_package_hash": plan_package_hash,
            "execution": {
                "status": "not_executed",
                "reason": "Current workflow completed Stage A only.",
            },
            "outputs": {
                "chat_summary": str(chat_path),
                "excel": str(excel_path),
            },
        }
    )
    state_path = save_project_state(project_id, updated, policy)
    save_stage_snapshot(project_id, "stage_a_complete", updated, policy)
    _assert_inputs_unchanged(updated)
    return {
        "status": "ok",
        "stage": "stage_a_complete",
        "project_id": project_id,
        "selection": {"number": selected_number, "name": selected["name"]},
        "chat_summary": str(chat_path),
        "excel": str(excel_path),
        "state": str(state_path),
    }


def regenerate_stage_a_report(project_id: str) -> dict[str, Any]:
    """Regenerate only the deterministic Stage A v2 workbook from saved state."""
    runtime_root = standard_paths()["runtime_root"]
    state = load_project_state(project_id, runtime_root)
    _require_stage(state, "stage_a_complete")
    policy = _policy_from_state(state, runtime_root)
    analysis = _require_dict(state.get("analysis"), "state.analysis")
    candidates = _require_dict_list(analysis.get("candidates"), "analysis.candidates")
    selection = _require_dict(state.get("selection"), "state.selection")
    project_root = project_state_dir(project_id, runtime_root).parent
    evidence = _load_json_object(project_root / "user-selection.json")
    if (
        evidence != selection
        or _canonical_hash(candidates) != selection.get("candidate_set_hash")
        or _canonical_hash(state["material_index"]) != selection.get("material_inventory_hash")
    ):
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_STALE,
            "Saved report inputs no longer match immutable selection evidence.",
        )
    selected_number = selection.get("selection_number")
    if (
        not isinstance(selected_number, int)
        or isinstance(selected_number, bool)
        or not 1 <= selected_number <= len(candidates)
    ):
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_INVALID,
            "Saved Stage A selection must identify one available candidate.",
            details={"selection": selected_number},
        )
    selected = candidates[selected_number - 1]
    if selected.get("chain_id") != selection.get("selected_chain_id"):
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_SELECTION_STALE,
            "Selected chain no longer matches immutable selection evidence.",
        )
    material_ids = _material_ids_from_state(state)
    plan_package = load_and_validate_plan_package(
        project_root / "selected-chain-plan.json",
        project_id=project_id,
        selection=selection,
        analysis=analysis,
        material_ids=material_ids,
    )
    expected_plan_hash = _require_text(state.get("plan_package_hash"), "plan_package_hash")
    if _canonical_hash(plan_package) != expected_plan_hash:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_PLAN_EVIDENCE_CONFLICT,
            "Stored selected-chain plan package no longer matches its recorded hash.",
        )
    project = _require_dict(state.get("project"), "state.project")
    project_name = project.get("name")
    if not isinstance(project_name, str) or not project_name.strip():
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_CONTRACT_INVALID,
            "Saved project name must be a non-empty string.",
        )
    selected_name = selected.get("name")
    if not isinstance(selected_name, str) or not selected_name.strip():
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_CONTRACT_INVALID,
            "Selected candidate name must be a non-empty string.",
        )
    rows = build_stage_a_report_rows(
        state,
        analysis,
        candidates,
        selected,
        selected_number,
        plan_package,
    )
    excel_path = project_root / "outputs" / "stage-a-audit-v2.xlsx"
    write_stage_a_workbook_v2(
        excel_path,
        rows,
        policy=policy,
        project_name=project_name,
        selected_chain=f"{selected_number}. {selected_name}",
    )
    counts = {sheet: len(sheet_rows) for sheet, sheet_rows in rows.items()}
    return {
        "status": "ok",
        "stage": "stage_a_complete",
        "project_id": project_id,
        "selection": {"number": selected_number, "name": selected_name},
        "excel": str(excel_path),
        "sheet_data_rows": counts,
        "plan_count": counts["审计计划"],
        "execution_count": counts["执行结果"],
    }


def _confirm_idempotent_stage_a_completion(
    state: dict[str, Any], project_id: str, supplied_path: Path
) -> dict[str, Any]:
    runtime_root = standard_paths()["runtime_root"]
    project_root = project_state_dir(project_id, runtime_root).parent
    stored = _load_json_object(project_root / "selected-chain-plan.json")
    supplied = _load_json_object(supplied_path)
    expected_hash = _require_text(state.get("plan_package_hash"), "plan_package_hash")
    if _canonical_hash(stored) != expected_hash or _canonical_hash(supplied) != expected_hash:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_PLAN_EVIDENCE_CONFLICT,
            "A completed Stage A project only accepts the exact recorded plan package.",
        )
    outputs = _require_dict(state.get("outputs"), "outputs")
    selection = _require_dict(state.get("selection"), "selection")
    return {
        "status": "ok",
        "stage": "stage_a_complete",
        "project_id": project_id,
        "selection": {
            "number": selection["selection_number"],
            "name": selection["selected_chain_name"],
        },
        "chat_summary": outputs["chat_summary"],
        "excel": outputs["excel"],
        "idempotent": True,
    }


def _normalize_analysis(analysis: dict[str, Any]) -> dict[str, Any]:
    """Convert the accepted legacy analysis contract to the generic internal model."""
    normalized = json.loads(json.dumps(analysis, ensure_ascii=False))
    normalized["schema_version"] = STAGE_A_SCHEMA_VERSION
    candidates = cast(list[dict[str, Any]], normalized["candidates"])
    for candidate_index, candidate in enumerate(candidates, start=1):
        chain_id = _stable_id("chain", {"index": candidate_index, "name": candidate["name"]})
        candidate["chain_id"] = chain_id
        legacy_components = cast(dict[str, list[dict[str, Any]]], candidate["component_references"])
        components: list[dict[str, Any]] = []
        for role, references in legacy_components.items():
            role_name = {
                "android": "mobile",
                "api_backend": "backend",
                "admin": "admin_console",
                "interface_document": "interface_document",
            }[role]
            for reference in references:
                components.append(
                    {
                        "component_id": _stable_id("component", reference),
                        "component_role": role_name,
                        "component_name": reference["component"],
                        "technology": "unknown",
                        "material_id": reference["material_id"],
                        "file_path": reference["file_path"],
                        "symbol": reference["symbol"],
                        "line_range": reference["line_range"],
                        "relevance": reference["relevance"],
                        "provenance": reference["provenance"],
                    }
                )
        candidate["component_references"] = components
        legacy_coverage = cast(dict[str, str], candidate["source_coverage"])
        candidate["source_coverage"] = [
            {
                "component_role": {
                    "android": "mobile",
                    "api_backend": "backend",
                    "admin": "admin_console",
                    "interface_document": "interface_document",
                    "other_materials": "other",
                }[role],
                "status": status,
            }
            for role, status in legacy_coverage.items()
        ]
        for clue_index, clue in enumerate(cast(list[dict[str, Any]], candidate["clues"]), 1):
            clue["clue_id"] = _stable_id(
                "clue", {"chain_id": chain_id, "index": clue_index, "summary": clue["summary"]}
            )
            clue["chain_id"] = chain_id
            clue["scope"] = "selected_chain"
        for interface_index, interface in enumerate(
            cast(list[dict[str, Any]], candidate["interface_references"]), 1
        ):
            interface["interface_id"] = _stable_id(
                "interface",
                {"chain_id": chain_id, "index": interface_index, "path": interface["path"]},
            )
            interface["chain_id"] = chain_id
    for fact_index, fact in enumerate(cast(list[dict[str, Any]], normalized["profile"]), 1):
        fact["fact_id"] = _stable_id(
            "fact", {"index": fact_index, "statement": fact["statement"]}
        )
        fact["scope"] = "global"
        fact["chain_id"] = None
    for association_index, association in enumerate(
        cast(list[dict[str, Any]], normalized["associations"]), 1
    ):
        matching = [
            candidate["chain_id"]
            for candidate in candidates
            if any(
                association["interface"].endswith(reference["path"])
                for reference in cast(list[dict[str, Any]], candidate["interface_references"])
            )
        ]
        association["association_id"] = _stable_id(
            "association", {"index": association_index, "action": association["action"]}
        )
        association["scope"] = "selected_chain" if len(matching) == 1 else "global"
        association["chain_id"] = matching[0] if len(matching) == 1 else None
    return cast(dict[str, Any], normalized)


def _validate_generic_analysis_package(
    analysis: dict[str, Any], state: dict[str, Any]
) -> list[dict[str, Any]]:
    project = _require_dict(analysis.get("project"), "project")
    _require_exact_fields(project, _PROJECT_FIELDS, "project")
    state_project = _require_dict(state.get("project"), "state.project")
    if project.get("id") != state_project.get("id"):
        raise _contract_error("Analysis project identity does not match inventory state.")
    _require_text(project.get("name"), "project.name")
    materials = _require_dict_list(analysis.get("materials"), "materials")
    material_ids: set[str] = set()
    for item in materials:
        _require_exact_fields(item, _MATERIAL_FIELDS, "material")
        material_ids.add(_require_text(item.get("material_id"), "material.material_id"))
        _require_text(item.get("path"), "material.path")
        _require_text(item.get("role"), "material.role")
    inventory = _require_dict_list(state.get("material_index"), "state.material_index")
    inventory_ids = {
        _require_text(item.get("material_id"), "state.material.material_id")
        for item in inventory
    }
    if material_ids != inventory_ids:
        raise _contract_error("Analysis materials must exactly match inventoried materials.")
    source_names = {
        _require_text(item.get("relative_path"), "state.material.relative_path")
        for item in inventory
    }
    capability = _require_dict(analysis.get("capability"), "capability")
    _require_exact_fields(capability, _CAPABILITY_FIELDS, "capability")
    if capability.get("level") != _require_dict(state.get("capability"), "state.capability").get(
        "level"
    ):
        raise _contract_error("Analysis capability does not match deterministic inventory.")
    _require_text(capability.get("explanation"), "capability.explanation")
    profile = _require_dict_list(analysis.get("profile"), "profile")
    dimensions: set[str] = set()
    for fact in profile:
        _require_exact_fields(
            fact, _PROFILE_FIELDS | {"fact_id", "scope", "chain_id"}, "profile fact"
        )
        _require_text(fact.get("fact_id"), "fact_id")
        dimensions.add(_require_text(fact.get("dimension"), "dimension"))
        if fact.get("basis_status") not in BASIS_STATUSES:
            raise _contract_error("Profile basis status is invalid.")
        _validate_scope(fact)
        _validate_sources(fact.get("source_locations"), source_names)
    if dimensions != PROFILE_DIMENSIONS:
        raise _contract_error("Stage A profile must cover every required dimension.")
    associations = _require_dict_list(analysis.get("associations"), "associations")
    for item in associations:
        _require_exact_fields(
            item,
            _ASSOCIATION_FIELDS | {"association_id", "scope", "chain_id"},
            "association",
        )
        _require_text(item.get("association_id"), "association_id")
        for field in ("action", "requirement", "caller", "interface", "backend", "side_effect"):
            _require_text(item.get(field), f"association.{field}")
        if item.get("basis_status") not in BASIS_STATUSES:
            raise _contract_error("Association basis status is invalid.")
        _validate_scope(item)
        _validate_sources(item.get("source_locations"), source_names)
    for difference in _require_dict_list(
        analysis.get("behavior_differences"), "behavior_differences"
    ):
        _require_exact_fields(difference, _DIFFERENCE_FIELDS, "behavior difference")
        _validate_sources(difference.get("source_locations"), source_names)
    candidates = _require_dict_list(analysis.get("candidates"), "candidates")
    if len(candidates) != 3:
        raise _contract_error("Stage A requires exactly three candidates.")
    _require_unique_ids("chain_id", candidates, "candidates")
    chain_ids = {_require_text(item.get("chain_id"), "chain_id") for item in candidates}
    for candidate in candidates:
        _require_exact_fields(candidate, _CANDIDATE_FIELDS | {"chain_id"}, "candidate")
        chain_id = cast(str, candidate["chain_id"])
        _require_text(candidate.get("name"), "candidate.name")
        _require_text(candidate.get("recommendation_reason"), "candidate.recommendation_reason")
        for field in ("conditions", "gaps", "risks", "materials"):
            _require_text_list(candidate.get(field), f"candidate.{field}")
        if not set(candidate["materials"]).issubset(material_ids):
            raise _contract_error("Candidate references material outside the inventory.")
        entry = _require_dict(candidate.get("business_entry"), "business_entry")
        _require_exact_fields(entry, _BUSINESS_ENTRY_FIELDS, "business_entry")
        for field in _BUSINESS_ENTRY_FIELDS:
            _require_text(entry.get(field), f"business_entry.{field}")
        components = _require_dict_list(candidate.get("component_references"), "components")
        for component in components:
            _require_exact_fields(
                component,
                {
                    "component_id",
                    "component_role",
                    "component_name",
                    "technology",
                    "material_id",
                    "file_path",
                    "symbol",
                    "line_range",
                    "relevance",
                    "provenance",
                },
                "component reference",
            )
            if component.get("component_role") not in _GENERIC_COMPONENT_ROLES:
                raise _contract_error("Component role is invalid.")
            if component.get("provenance") not in BASIS_STATUSES:
                raise _contract_error("Component provenance is invalid.")
            component_material = _require_text(component.get("material_id"), "material_id")
            if component_material not in material_ids:
                raise _contract_error("Component material is not inventoried.")
        interfaces = _require_dict_list(candidate.get("interface_references"), "interfaces")
        for interface in interfaces:
            _require_exact_fields(
                interface,
                _INTERFACE_REFERENCE_FIELDS | {"interface_id", "chain_id"},
                "interface reference",
            )
            if interface.get("chain_id") != chain_id:
                raise _contract_error("Interface reference belongs to another chain.")
            if interface.get("provenance") not in BASIS_STATUSES:
                raise _contract_error("Interface provenance is invalid.")
        clues = _require_dict_list(candidate.get("clues"), "clues")
        if not clues:
            raise _contract_error("Each candidate requires at least one clue.")
        for clue in clues:
            _require_exact_fields(
                clue, _CLUE_FIELDS | {"clue_id", "chain_id", "scope"}, "clue"
            )
            if clue.get("chain_id") != chain_id:
                raise _contract_error("Clue belongs to another chain.")
            _validate_scope(clue)
            _validate_clue({key: clue[key] for key in _CLUE_FIELDS}, source_names)
        _validate_interface_count(candidate.get("estimated_interface_count"))
        coverage = _require_dict_list(candidate.get("source_coverage"), "source_coverage")
        for item in coverage:
            _require_exact_fields(item, {"component_role", "status"}, "source coverage")
            if item.get("component_role") not in _GENERIC_COMPONENT_ROLES:
                raise _contract_error("Source coverage component role is invalid.")
            if item.get("status") not in _COVERAGE_STATUSES:
                raise _contract_error("Source coverage status is invalid.")
        _validate_missing_component_gaps(candidate, components, coverage)
        priority = _require_dict(candidate.get("priority_reason"), "priority_reason")
        _require_exact_fields(priority, _PRIORITY_REASON_FIELDS, "priority_reason")
    for item in profile + associations:
        scoped_chain_id = item.get("chain_id")
        if scoped_chain_id is not None and scoped_chain_id not in chain_ids:
            raise _contract_error("Scoped analysis item references an unknown chain.")
    _require_unique_ids("fact_id", profile, "profile")
    _require_unique_ids("association_id", associations, "associations")
    _require_unique_ids(
        "clue_id",
        [clue for candidate in candidates for clue in candidate["clues"]],
        "candidate clues",
    )
    _require_unique_ids(
        "interface_id",
        [
            interface
            for candidate in candidates
            for interface in candidate["interface_references"]
        ],
        "candidate interfaces",
    )
    _require_unique_ids(
        "component_id",
        [
            component
            for candidate in candidates
            for component in candidate["component_references"]
        ],
        "candidate components",
    )
    _require_text_list(analysis.get("later_stage_recommendations"), "recommendations")
    return candidates


def _validate_scope(value: dict[str, Any]) -> None:
    scope = value.get("scope")
    chain_id = value.get("chain_id")
    if scope == "global" and chain_id is None:
        return
    if scope == "selected_chain" and isinstance(chain_id, str) and chain_id:
        return
    raise _contract_error("Scope must be global or bound to one selected chain.")


def _require_unique_ids(identifier_type: str, values: list[dict[str, Any]], label: str) -> None:
    seen: dict[str, int] = {}
    for index, value in enumerate(values):
        identifier = _require_text(value.get(identifier_type), identifier_type)
        if identifier in seen:
            raise RuntimePolicyError(
                ErrorCode.STAGE_A_CONTRACT_INVALID,
                "Stable IDs must be unique within their namespace.",
                details={
                    "id_type": identifier_type,
                    "duplicate_id": identifier,
                    "first_position": f"{label}[{seen[identifier]}]",
                    "conflict_position": f"{label}[{index}]",
                },
            )
        seen[identifier] = index


def _validate_missing_component_gaps(
    candidate: dict[str, Any], components: list[dict[str, Any]], coverage: list[dict[str, Any]]
) -> None:
    present = {item["component_role"] for item in components}
    gaps = " ".join(candidate["gaps"]).casefold()
    labels = {"admin_console": "admin", "interface_document": "interface"}
    for item in coverage:
        role = item["component_role"]
        if item["status"] != "not_located" or role in present:
            continue
        if labels.get(role, role).casefold() not in gaps:
            raise _contract_error(
                "A missing component reference requires a matching candidate gap."
            )


def _plan_chat_summary(
    state: dict[str, Any],
    analysis: dict[str, Any],
    candidates: list[dict[str, Any]],
    selection: dict[str, Any],
    plan_package: dict[str, Any],
    excel_path: Path,
) -> dict[str, Any]:
    return {
        "project": state["project"],
        "materials": state["material_index"],
        "capability": analysis["capability"],
        "candidates": [
            {"number": index, "chain_id": item["chain_id"], "name": item["name"]}
            for index, item in enumerate(candidates, 1)
        ],
        "selected_candidate": {
            "number": selection["selection_number"],
            "chain_id": selection["selected_chain_id"],
            "name": selection["selected_chain_name"],
        },
        "selected_chain_summary": plan_package["selected_chain_summary"],
        "selected_chain_unknown_rules": plan_package["selected_chain_unknown_rules"],
        "audit_plan_items": plan_package["audit_plan_items"],
        "cannot_confirm": [
            "Stage A performed no dynamic execution.",
            "No interface behavior, side effect or bug is confirmed.",
        ],
        "paths": {"excel": str(excel_path)},
    }


def _stable_id(prefix: str, value: Any) -> str:
    return f"{prefix}-{_canonical_hash(value)[:16]}"


def _canonical_hash(value: Any) -> str:
    serialized = json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(serialized).hexdigest()


def _base_state(
    *,
    project_id: str,
    project_name: str,
    stage: str,
    materials: list[dict[str, Any]],
    repositories: tuple[Path, ...],
    fingerprints: dict[str, str],
    capability: str,
) -> dict[str, Any]:
    return {
        "project": {"id": project_id, "name": project_name},
        "stage": stage,
        "material_index": materials,
        "profile": {},
        "context": {
            "commit": "stage-a-read-only-materials",
            "environment": "not_provided",
            "account_alias": "not_provided",
        },
        "chains": [],
        "clues": [],
        "approvals": [],
        "execution": {},
        "evidence_index": [],
        "capability": {"level": capability},
        "business_repositories": [str(path) for path in repositories],
        "input_fingerprints": fingerprints,
    }


def _validate_analysis_package(
    analysis: dict[str, Any],
    state: dict[str, Any],
) -> list[dict[str, Any]]:
    if set(analysis) != _ANALYSIS_FIELDS:
        raise _contract_error(
            "Stage A analysis package must contain exactly the fixed top-level fields."
        )
    if analysis.get("schema_version") == STAGE_A_SCHEMA_VERSION:
        return _validate_generic_analysis_package(analysis, state)
    if analysis.get("schema_version") == LEGACY_STAGE_A_SCHEMA_VERSION:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_ANALYSIS_V2_REQUIRED,
            "Stage A analysis v1 is not accepted; regenerate a v2 package from source materials.",
        )
    raise _contract_error("Stage A analysis package uses an unsupported schema version.")
    project = _require_dict(analysis.get("project"), "project")
    _require_exact_fields(project, _PROJECT_FIELDS, "project")
    state_project = _require_dict(state.get("project"), "state.project")
    if project.get("id") != state_project.get("id") or not _require_text(
        project.get("name"), "project.name"
    ):
        raise _contract_error("Analysis project identity does not match the inventory state.")
    analysis_materials = _require_dict_list(analysis.get("materials"), "materials")
    for item in analysis_materials:
        _require_exact_fields(item, _MATERIAL_FIELDS, "material")
        _require_text(item.get("role"), "material.role")
    material_names = {
        Path(_require_text(item.get("path"), "material.path")).name for item in analysis_materials
    }
    inventory_names = {
        Path(_require_text(item.get("path"), "state.material.path")).name
        for item in _require_dict_list(state.get("material_index"), "state.material_index")
    }
    if material_names != inventory_names:
        raise _contract_error("Analysis materials must exactly match the inventoried materials.")
    capability = _require_dict(analysis.get("capability"), "capability")
    _require_exact_fields(capability, _CAPABILITY_FIELDS, "capability")
    state_capability = _require_dict(state.get("capability"), "state.capability")
    if capability.get("level") != state_capability.get("level"):
        raise _contract_error("Analysis capability level does not match deterministic inventory.")
    _require_text(capability.get("explanation"), "capability.explanation")
    profile = _require_dict_list(analysis.get("profile"), "profile")
    dimensions: set[str] = set()
    for item in profile:
        _require_exact_fields(item, _PROFILE_FIELDS, "profile item")
        dimension = _require_text(item.get("dimension"), "profile.dimension")
        status = _require_text(item.get("basis_status"), "profile.basis_status")
        _require_text(item.get("statement"), "profile.statement")
        if dimension not in PROFILE_DIMENSIONS or status not in BASIS_STATUSES:
            raise _contract_error("Profile dimension or basis status is invalid.")
        dimensions.add(dimension)
        _validate_sources(item.get("source_locations"), material_names)
    if dimensions != PROFILE_DIMENSIONS:
        raise _contract_error("Stage A profile must cover every required dimension.")
    for association in _require_dict_list(analysis.get("associations"), "associations"):
        _require_exact_fields(association, _ASSOCIATION_FIELDS, "association")
        for field in ("action", "requirement", "caller", "interface", "backend", "side_effect"):
            _require_text(association.get(field), f"association.{field}")
        if association.get("basis_status") not in BASIS_STATUSES:
            raise _contract_error("Association basis status is invalid.")
        if not isinstance(association.get("behavior_difference"), str):
            raise _contract_error("Association behavior difference must be explicit text.")
        _validate_sources(association.get("source_locations"), material_names)
    for difference in _require_dict_list(
        analysis.get("behavior_differences"), "behavior_differences"
    ):
        _require_exact_fields(difference, _DIFFERENCE_FIELDS, "behavior difference")
        _require_text(difference.get("summary"), "behavior_difference.summary")
        _validate_sources(difference.get("source_locations"), material_names)
    candidates = _require_dict_list(analysis.get("candidates"), "candidates")
    candidate_names = {_require_text(item.get("name"), "candidate.name") for item in candidates}
    if len(candidates) != 3 or len(candidate_names) != 3:
        raise _contract_error("Stage A requires exactly three uniquely named candidates.")
    for candidate in candidates:
        _require_exact_fields(candidate, _CANDIDATE_FIELDS, "candidate")
        for field in ("recommendation_reason",):
            _require_text(candidate.get(field), f"candidate.{field}")
        for field in ("conditions", "gaps", "risks", "materials"):
            values = _require_text_list(candidate.get(field), f"candidate.{field}")
            if not values:
                raise _contract_error(f"Candidate {field} cannot be empty.")
        if not set(cast(list[str], candidate["materials"])).issubset(material_names):
            raise _contract_error("Candidate references material outside the inventory.")
        _validate_candidate_extensions(candidate, material_names)
        clues = _require_dict_list(candidate.get("clues"), "candidate.clues")
        if not clues:
            raise _contract_error("Each candidate requires at least one static clue.")
        for clue in clues:
            _validate_clue(clue, material_names)
    recommendations = _require_text_list(
        analysis.get("later_stage_recommendations"), "later_stage_recommendations"
    )
    if not recommendations:
        raise _contract_error("Later-stage recommendations are required.")
    serialized = json.dumps(analysis, ensure_ascii=False).casefold()
    if any(term in serialized for term in _FORBIDDEN_CONCLUSIONS):
        raise _contract_error("Stage A analysis cannot contain a confirmed bug conclusion.")
    return candidates


def _validate_clue(clue: dict[str, Any], material_names: set[str]) -> None:
    _require_exact_fields(clue, _CLUE_FIELDS, "static clue")
    if clue.get("category") not in CLUE_CATEGORIES:
        raise _contract_error("Static clue category is invalid for Stage A.")
    for field in (
        "summary",
        "root_cause",
        "proposed_role",
        "side_effect_check",
        "risk",
        "stage_b_approval",
    ):
        _require_text(clue.get(field), f"clue.{field}")
    score = clue.get("score")
    if not isinstance(score, (int, float)) or isinstance(score, bool) or not 0 <= score <= 100:
        raise _contract_error("Static clue score must be between 0 and 100.")
    if not _require_text_list(clue.get("black_box_steps"), "clue.black_box_steps"):
        raise _contract_error("Static clue requires black-box validation steps.")
    _require_text_list(clue.get("mutation_parameters"), "clue.mutation_parameters")
    _validate_sources(clue.get("source_locations"), material_names)


def _number_candidate(candidate: dict[str, Any], number: int) -> dict[str, Any]:
    return {"number": number, **candidate}


def _validate_candidate_extensions(candidate: dict[str, Any], material_names: set[str]) -> None:
    entry = _require_dict(candidate.get("business_entry"), "candidate.business_entry")
    _require_exact_fields(entry, _BUSINESS_ENTRY_FIELDS, "candidate.business_entry")
    for field in ("name", "component", "source", "relevance"):
        _require_text(entry.get(field), f"candidate.business_entry.{field}")
    _validate_sources([entry["source"]], material_names)

    references = _require_dict(
        candidate.get("component_references"), "candidate.component_references"
    )
    _require_exact_fields(references, _COMPONENT_GROUPS, "candidate.component_references")
    coverage = _require_dict(candidate.get("source_coverage"), "candidate.source_coverage")
    _require_exact_fields(coverage, _SOURCE_COVERAGE_FIELDS, "candidate.source_coverage")
    for name, status in coverage.items():
        if status not in _COVERAGE_STATUSES:
            raise _contract_error(f"Candidate source coverage for {name} is invalid.")

    gaps = cast(list[str], candidate["gaps"])
    for group in sorted(_COMPONENT_GROUPS):
        items = _require_dict_list(references.get(group), f"candidate.{group}_references")
        if not items:
            if coverage[group] == "linked":
                raise _contract_error(f"Empty {group} references cannot have linked coverage.")
            gap_tokens = {group, group.replace("_", " ")}
            absence_tokens = {
                "missing",
                "not located",
                "not been located",
                "absent",
                "unavailable",
                "not supplied",
                "缺失",
                "未定位",
                "未提供",
                "不存在",
            }
            if not any(
                any(token.casefold() in gap.casefold() for token in gap_tokens)
                and any(token.casefold() in gap.casefold() for token in absence_tokens)
                for gap in gaps
            ):
                raise _contract_error(f"Empty {group} references require a matching gap.")
        elif coverage[group] != "linked":
            raise _contract_error(f"Non-empty {group} references require linked coverage.")
        for item in items:
            _validate_component_reference(item, group, material_names)

    interface_references = _require_dict_list(
        candidate.get("interface_references"), "candidate.interface_references"
    )
    for item in interface_references:
        _require_exact_fields(item, _INTERFACE_REFERENCE_FIELDS, "interface reference")
        for field in ("method", "path", "interface_name", "group", "source", "relevance"):
            _require_text(item.get(field), f"interface_reference.{field}")
        _validate_provenance(item.get("provenance"), "interface reference")
        _validate_sources([item["source"]], material_names)

    priority = _require_dict(candidate.get("priority_reason"), "candidate.priority_reason")
    _require_exact_fields(priority, _PRIORITY_REASON_FIELDS, "candidate.priority_reason")
    for field in _PRIORITY_REASON_FIELDS:
        _require_text(priority.get(field), f"candidate.priority_reason.{field}")
    _validate_interface_count(candidate.get("estimated_interface_count"))


def _validate_component_reference(
    item: dict[str, Any], group: str, material_names: set[str]
) -> None:
    _require_exact_fields(item, _COMPONENT_REFERENCE_FIELDS, "component reference")
    if item.get("component") != group:
        raise _contract_error("Component reference must match its component group.")
    material_id = _require_text(item.get("material_id"), "component_reference.material_id")
    if Path(material_id).name not in material_names:
        raise _contract_error("Component reference source material is not inventoried.")
    for field in ("file_path", "relevance", "source"):
        _require_text(item.get(field), f"component_reference.{field}")
    for field in ("symbol", "class_name", "method_name", "line_range"):
        value = item.get(field)
        if value is not None and (not isinstance(value, str) or not value.strip()):
            raise _contract_error(f"component_reference.{field} must be text or null.")
    _validate_provenance(item.get("provenance"), "component reference")
    _validate_sources([item["source"]], material_names)


def _validate_provenance(value: Any, field: str) -> None:
    if value not in BASIS_STATUSES:
        raise _contract_error(f"{field} provenance is invalid.")


def _validate_interface_count(value: Any) -> None:
    if isinstance(value, int) and not isinstance(value, bool) and value >= 0:
        return
    estimate = _require_dict(value, "candidate.estimated_interface_count")
    if set(estimate) == {"minimum", "maximum"}:
        minimum, maximum = estimate["minimum"], estimate["maximum"]
        if (
            all(isinstance(item, int) and not isinstance(item, bool) for item in (minimum, maximum))
            and 0 <= minimum <= maximum
        ):
            return
    elif set(estimate) == {"status", "reason"}:
        if estimate.get("status") == "unknown":
            _require_text(estimate.get("reason"), "estimated_interface_count.reason")
            return
    raise _contract_error("Candidate estimated interface count is invalid.")


def focus_stage_a_clues(clues: list[dict[str, Any]]) -> dict[str, Any]:
    category_counts: dict[str, int] = {}
    for clue in clues:
        category = cast(str, clue["category"])
        category_counts[category] = category_counts.get(category, 0) + 1
    merged: dict[str, dict[str, Any]] = {}
    for clue in clues:
        root = cast(str, clue["root_cause"]).strip().casefold()
        current = merged.get(root)
        if current is None or cast(float, clue["score"]) > cast(float, current["score"]):
            merged[root] = clue
    ranked = sorted(
        merged.values(),
        key=lambda item: (-cast(float, item["score"]), item["summary"]),
    )
    if len(ranked) <= 5:
        shown = ranked
    elif len(ranked) <= 15:
        shown = ranked[:8]
    else:
        shown = ranked[:5]
    return {
        "shown": shown,
        "hidden_count": len(ranked) - len(shown),
        "category_counts": category_counts,
    }


def _policy_from_state(state: dict[str, Any], runtime_root: Path) -> WritePolicy:
    repositories = tuple(
        Path(path)
        for path in _require_text_list(
            state.get("business_repositories"), "state.business_repositories"
        )
    )
    return WritePolicy(runtime_root, repositories)


def _assert_inputs_unchanged(state: dict[str, Any]) -> None:
    repositories = [
        Path(path)
        for path in _require_text_list(
            state.get("business_repositories"), "state.business_repositories"
        )
    ]
    expected = state.get("input_fingerprints")
    if not isinstance(expected, dict) or _fingerprint_repositories(tuple(repositories)) != expected:
        raise RuntimePolicyError(
            ErrorCode.REPOSITORY_STATE_CHANGED,
            "Input materials changed after Stage A inventory.",
        )


def _fingerprint_repositories(repositories: tuple[Path, ...]) -> dict[str, str]:
    fingerprints: dict[str, str] = {}
    for repository in repositories:
        for path in sorted(repository.rglob("*")):
            if (
                not path.is_file()
                or path.is_symlink()
                or ".git" in path.relative_to(repository).parts
            ):
                continue
            key = f"{repository}::{path.relative_to(repository).as_posix()}"
            fingerprints[key] = hashlib.sha256(path.read_bytes()).hexdigest()
    return fingerprints


def _material_kinds(records: list[MaterialRecord]) -> list[str]:
    kinds: list[str] = []
    for record in records:
        kinds.append(record.kind)
        if record.kind == "interface_export":
            kinds.append("interface")
    return kinds


def _material_dict(
    record: MaterialRecord, repositories: tuple[Path, ...]
) -> dict[str, Any]:
    relative_path, container_id = _material_relative_path(record.path, repositories)
    content_hash = _material_content_hash(record.path)
    return {
        "path": str(record.path),
        "material_id": _stable_id(
            "material",
            {
                "type": record.kind,
                "container": container_id,
                "relative_path": relative_path,
                "content_sha256": content_hash,
            },
        ),
        "relative_path": relative_path,
        "content_sha256": content_hash,
        "type": record.kind,
        "complete": record.complete,
        "purpose": record.purpose,
        "warnings": list(record.warnings),
        "parse_state": "ready_for_model_analysis" if record.complete else "missing",
    }


def _material_relative_path(path: Path, repositories: tuple[Path, ...]) -> tuple[str, str]:
    for index, repository in enumerate(repositories, 1):
        if _is_within(path, repository):
            return path.relative_to(repository).as_posix(), f"repository-{index}"
    raise _contract_error("Material is not located in a registered repository.")


def _material_content_hash(path: Path) -> str:
    if not path.is_file():
        return "missing" if not path.exists() else "directory"
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _material_ids_from_state(state: dict[str, Any]) -> set[str]:
    return {
        _require_text(item.get("material_id"), "material.material_id")
        for item in _require_dict_list(state.get("material_index"), "material_index")
    }


def _store_plan_package_evidence(
    path: Path, package: dict[str, Any], policy: WritePolicy
) -> str:
    package_hash = _canonical_hash(package)
    if path.exists():
        existing = _load_json_object(path)
        if _canonical_hash(existing) == package_hash:
            return package_hash
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_PLAN_EVIDENCE_CONFLICT,
            "Selected-chain plan evidence already exists with different content.",
            details={"path": str(path)},
        )
    try:
        atomic_create_json(path, package, policy=policy)
    except RuntimePolicyError as exc:
        if exc.code is not ErrorCode.STAGE_A_SELECTION_EXISTS:
            raise
        existing = _load_json_object(path)
        if _canonical_hash(existing) == package_hash:
            return package_hash
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_PLAN_EVIDENCE_CONFLICT,
            "Selected-chain plan evidence was concurrently created with different content.",
            details={"path": str(path)},
        ) from exc
    return package_hash


def _project_id(project_name: str, materials: list[Path]) -> str:
    digest = hashlib.sha256(project_name.strip().encode("utf-8"))
    for path in sorted(materials, key=str):
        digest.update(str(path).encode("utf-8"))
    return f"stage-a-{digest.hexdigest()[:16]}"


def _require_directory(path: Path) -> Path:
    resolved = path.resolve()
    if not resolved.is_dir() or resolved.is_symlink():
        raise _contract_error("Business repository must be an existing non-link directory.")
    return resolved


def _require_material(path: Path, repositories: tuple[Path, ...]) -> Path:
    if path.is_symlink():
        raise _contract_error("Stage A materials cannot be symbolic links or junctions.")
    resolved = path.resolve(strict=False)
    if not any(_is_within(resolved, repository) for repository in repositories):
        raise _contract_error("Every material must belong to a registered business repository.")
    return resolved


def _is_within(path: Path, root: Path) -> bool:
    try:
        path.relative_to(root)
    except ValueError:
        return False
    return True


def _load_json_object(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise _contract_error("Stage A analysis package is not readable JSON.") from exc
    return _require_dict(value, "analysis package")


def _analysis_schema() -> dict[str, Any]:
    schema_path = Path(__file__).parents[2] / "schemas" / "stage-a-analysis.schema.json"
    return _load_json_object(schema_path)


def _require_stage(state: dict[str, Any], expected: str) -> None:
    if state.get("stage") != expected:
        raise RuntimePolicyError(
            ErrorCode.STAGE_A_STATE_INVALID,
            "Stage A action is not valid for the current project state.",
            details={"expected": expected, "actual": state.get("stage")},
        )


def _require_dict(value: Any, field: str) -> dict[str, Any]:
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise _contract_error(f"{field} must be an object.")
    return cast(dict[str, Any], value)


def _require_dict_list(value: Any, field: str) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        raise _contract_error(f"{field} must be an array.")
    return [_require_dict(item, field) for item in value]


def _require_exact_fields(
    value: dict[str, Any],
    expected: set[str],
    field: str,
) -> None:
    if set(value) != expected:
        raise _contract_error(f"{field} must contain exactly the fixed contract fields.")


def _require_text(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise _contract_error(f"{field} must be non-empty text.")
    return value


def _require_text_list(value: Any, field: str) -> list[str]:
    if not isinstance(value, list) or any(
        not isinstance(item, str) or not item.strip() for item in value
    ):
        raise _contract_error(f"{field} must be an array of non-empty text values.")
    return cast(list[str], value)


def _validate_sources(value: Any, material_names: set[str]) -> None:
    sources = _require_text_list(value, "source_locations")
    for source in sources:
        normalized = source.replace("\\", "/")
        material = normalized.split("#", 1)[0]
        if material not in material_names:
            raise _contract_error("Every source location must reference an inventoried material.")


def _contract_error(message: str) -> RuntimePolicyError:
    return RuntimePolicyError(ErrorCode.STAGE_A_CONTRACT_INVALID, message)
