from __future__ import annotations

from dataclasses import dataclass
from enum import StrEnum

from .capability import CapabilityLevel, determine_capability
from .facts import Fact, FactLayer
from .inventory import MaterialRecord


class ProfileDimension(StrEnum):
    ACTOR = "actor"
    RESOURCE = "resource"
    ACTION = "action"
    INPUT = "input"
    STATE = "state"
    PERMISSION = "permission"
    TRUST_BOUNDARY = "trust_boundary"
    SIDE_EFFECT = "side_effect"
    EVIDENCE_SOURCE = "evidence_source"


@dataclass(frozen=True)
class ProfileItem:
    dimension: ProfileDimension
    fact: Fact


@dataclass(frozen=True)
class ComponentRecord:
    component_id: str
    component_type: str
    source_location: str

    def __post_init__(self) -> None:
        values = (self.component_id, self.component_type, self.source_location)
        if not all(value.strip() for value in values):
            raise ValueError("component id, type and source location are required")


@dataclass(frozen=True)
class FlowRecord:
    source_component: str
    target_component: str
    flow_type: str
    source_location: str

    def __post_init__(self) -> None:
        if not all(
            value.strip()
            for value in (
                self.source_component,
                self.target_component,
                self.flow_type,
                self.source_location,
            )
        ):
            raise ValueError("flow endpoints, type and source location are required")


@dataclass(frozen=True)
class ProjectProfile:
    project_id: str
    materials: tuple[MaterialRecord, ...]
    facts: tuple[Fact, ...]
    capability: CapabilityLevel
    industry_context: str | None = None
    components: tuple[ComponentRecord, ...] = ()
    flows: tuple[FlowRecord, ...] = ()
    unknown_rules: tuple[Fact, ...] = ()
    items: tuple[ProfileItem, ...] = ()


def build_profile(
    project_id: str,
    materials: list[MaterialRecord],
    facts: list[Fact],
    *,
    industry_context: str | None = None,
    components: list[ComponentRecord] | None = None,
    flows: list[FlowRecord] | None = None,
    unknown_rules: list[Fact] | None = None,
    items: list[ProfileItem] | None = None,
) -> ProjectProfile:
    material_list = tuple(materials)
    fact_list = tuple(facts)
    component_list = tuple(components or ())
    flow_list = tuple(flows or ())
    unknown_list = tuple(unknown_rules or ())
    item_list = tuple(items or ())
    for component in component_list:
        _require_material_backing(component, material_list)
    for flow in flow_list:
        _require_material_backing(flow, material_list)
    for item in item_list:
        _require_source_backing(item.fact.source, material_list)
    for fact in fact_list:
        _require_source_backing(fact.source, material_list)
    component_ids = {component.component_id for component in component_list}
    if any(
        flow.source_component not in component_ids
        or flow.target_component not in component_ids
        for flow in flow_list
    ):
        raise ValueError(
            "flow endpoint is not present in the material-backed component set"
        )
    if any(rule.layer is not FactLayer.UNKNOWN_RULE for rule in unknown_list):
        raise ValueError("unknown rules must use the UNKNOWN_RULE fact layer")
    return ProjectProfile(
        project_id=project_id,
        materials=material_list,
        facts=fact_list,
        capability=determine_capability(_material_kinds(materials)),
        industry_context=industry_context,
        components=component_list,
        flows=flow_list,
        unknown_rules=unknown_list,
        items=item_list,
    )


def _material_kinds(materials: list[MaterialRecord]) -> list[str]:
    kinds: list[str] = []
    for material in materials:
        kinds.append(material.kind)
        if material.kind == "source_repository":
            kinds.append("source_code")
        if material.kind == "interface_export":
            kinds.append("interface")
    return kinds


def _source_is_material_backed(source: str, materials: tuple[MaterialRecord, ...]) -> bool:
    normalized = source.replace("\\", "/").casefold()
    for material in materials:
        material_path = str(material.path).replace("\\", "/").rstrip("/").casefold()
        if normalized == material_path:
            return True
        if material.kind == "source_repository" and normalized.startswith(f"{material_path}/"):
            return True
        if material.kind != "source_repository" and (
            normalized.startswith(f"{material_path}#")
            or normalized.startswith(f"{material_path}:")
        ):
            return True
    return False


def _require_material_backing(
    record: ComponentRecord | FlowRecord,
    materials: tuple[MaterialRecord, ...],
) -> None:
    _require_source_backing(record.source_location, materials, record=record)


def _require_source_backing(
    source: str,
    materials: tuple[MaterialRecord, ...],
    *,
    record: object | None = None,
) -> None:
    if not _source_is_material_backed(source, materials):
        raise ValueError(
            f"profile record source is not present in material inventory: {record or source}"
        )


def missing_profile_dimensions(profile: ProjectProfile) -> tuple[ProfileDimension, ...]:
    present = {item.dimension for item in profile.items}
    return tuple(dimension for dimension in ProfileDimension if dimension not in present)
