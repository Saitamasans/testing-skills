from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum

from .clues import Clue, ClueLevel
from .traceability import Provenance


@dataclass(frozen=True)
class SourceObservation:
    subject: str
    field: str
    value: str
    source_type: str
    source_location: str


@dataclass(frozen=True)
class AssociationRecord:
    subject: str
    field: str
    observations: tuple[SourceObservation, ...]
    status: str


@dataclass(frozen=True)
class ChainLink:
    source_kind: str
    source_id: str
    target_kind: str
    target_id: str


@dataclass(frozen=True)
class CallerRecord:
    caller_type: str
    interface: str
    behavior_signature: str
    source_location: str

    def __post_init__(self) -> None:
        if not all(
            value.strip()
            for value in (
                self.caller_type,
                self.interface,
                self.behavior_signature,
                self.source_location,
            )
        ):
            raise ValueError("caller fields and provenance are required")


@dataclass(frozen=True)
class CallerComparison:
    interface: str
    callers: tuple[CallerRecord, ...]
    behavior_difference: bool


class ParameterOriginKind(StrEnum):
    CLIENT_PROVIDED = "client_provided"
    SERVER_COMPUTED = "server_computed"
    MIDDLEWARE_ADDED = "middleware_added"


@dataclass(frozen=True)
class ParameterOrigin:
    interface: str
    name: str
    origin: ParameterOriginKind
    final_use: str
    source_location: str

    def __post_init__(self) -> None:
        if not all(
            value.strip()
            for value in (self.interface, self.name, self.final_use, self.source_location)
        ):
            raise ValueError("parameter origin fields and provenance are required")


@dataclass(frozen=True)
class InterfaceDifference:
    interface: str
    difference_type: str
    source_locations: tuple[str, ...]

    def __post_init__(self) -> None:
        if (
            not self.interface.strip()
            or not self.difference_type.strip()
            or not self.source_locations
        ):
            raise ValueError("interface differences require type and source locations")
        if any(not source.strip() for source in self.source_locations):
            raise ValueError("interface difference source locations cannot be empty")


def associate_observations(observations: list[SourceObservation]) -> list[AssociationRecord]:
    grouped: dict[tuple[str, str], list[SourceObservation]] = defaultdict(list)
    for observation in observations:
        grouped[(observation.subject, observation.field)].append(observation)
    records: list[AssociationRecord] = []
    for (subject, field), values in sorted(grouped.items()):
        distinct_values = {observation.value for observation in values}
        status = "behavior_difference" if len(distinct_values) > 1 else "confirmed_alignment"
        records.append(AssociationRecord(subject, field, tuple(values), status))
    return records


def validate_chain_trace(links: list[ChainLink]) -> bool:
    adjacency: dict[tuple[str, str], set[tuple[str, str]]] = defaultdict(set)
    for link in links:
        adjacency[(link.source_kind, link.source_id)].add(
            (link.target_kind, link.target_id)
        )
    starts = {node for node in adjacency if node[0] == "requirement"}
    return _has_typed_path(
        starts,
        adjacency,
        ("caller", "interface", "route", "backend", "data", "evidence"),
    ) or _has_typed_path(
        starts,
        adjacency,
        ("caller", "interface", "route", "backend", "external", "evidence"),
    )


def _has_typed_path(
    starts: set[tuple[str, str]],
    adjacency: dict[tuple[str, str], set[tuple[str, str]]],
    target_kinds: tuple[str, ...],
) -> bool:
    current = starts
    for target_kind in target_kinds:
        current = {
            target
            for source in current
            for target in adjacency.get(source, ())
            if target[0] == target_kind
        }
        if not current:
            return False
    return True


def compare_existing_callers(callers: list[CallerRecord]) -> list[CallerComparison]:
    grouped: dict[str, list[CallerRecord]] = defaultdict(list)
    for caller in callers:
        grouped[caller.interface].append(caller)
    return [
        CallerComparison(
            interface,
            tuple(sorted(records, key=lambda item: (item.caller_type, item.source_location))),
            len({record.behavior_signature for record in records}) > 1,
        )
        for interface, records in sorted(grouped.items())
    ]


def find_interface_differences(
    *,
    declared: Mapping[str, str],
    observed: Mapping[str, str],
    routed: Mapping[str, str],
    legacy: set[str],
) -> list[InterfaceDifference]:
    differences: list[InterfaceDifference] = []
    for interface in observed.keys() - declared.keys():
        kind = "legacy_call" if interface in legacy else "undocumented_call"
        differences.append(InterfaceDifference(interface, kind, (observed[interface],)))
    differences.extend(
        InterfaceDifference(interface, "hidden_route", (routed[interface],))
        for interface in routed.keys() - declared.keys() - observed.keys()
    )
    differences.extend(
        InterfaceDifference(interface, "declared_unrouted", (declared[interface],))
        for interface in declared.keys() - routed.keys()
    )
    return sorted(differences, key=lambda item: (item.interface, item.difference_type))


def differences_to_clues(
    differences: list[InterfaceDifference],
    provenance: Provenance,
) -> list[Clue]:
    return [
        Clue(
            clue_id=f"D-{index:03d}",
            level=ClueLevel.UNKNOWN,
            root_cause=difference.difference_type,
            subject=difference.interface,
            validation_goal=f"Validate {difference.difference_type} for {difference.interface}",
            evidence_source="; ".join(difference.source_locations),
            provenance=provenance,
        )
        for index, difference in enumerate(differences, start=1)
    ]
