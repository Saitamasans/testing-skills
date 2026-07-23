from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from .environment_guard import EnvironmentKind, assert_dynamic_allowed
from .errors import ErrorCode, RuntimePolicyError


class SqlMode(StrEnum):
    READ_ONLY = "read_only"
    CONTROLLED_WRITE = "controlled_write"


_BINDING_TOKEN = object()


@dataclass(frozen=True)
class DatabaseTarget:
    target_id: str
    environment: EnvironmentKind
    sqlite_path: str


@dataclass(frozen=True)
class DatabaseTargetRegistry:
    targets: tuple[DatabaseTarget, ...]

    def resolve(self, target_id: str) -> DatabaseTarget:
        matches = [target for target in self.targets if target.target_id == target_id]
        if len(matches) != 1:
            raise RuntimePolicyError(
                ErrorCode.UNAPPROVED_TARGET,
                "Database target is not uniquely registered.",
                details={"target_id": target_id},
            )
        return matches[0]


@dataclass(frozen=True)
class BoundDatabaseConnection:
    connection: sqlite3.Connection
    target_id: str
    environment: EnvironmentKind
    _token: object


def open_database_connection(
    target_id: str,
    registry: DatabaseTargetRegistry,
) -> BoundDatabaseConnection:
    target = registry.resolve(target_id)
    assert_dynamic_allowed(target.environment)
    connection = sqlite3.connect(target.sqlite_path)
    return BoundDatabaseConnection(connection, target.target_id, target.environment, _BINDING_TOKEN)


_READ_ONLY = {"SELECT", "SHOW", "DESCRIBE", "EXPLAIN"}
_HARD_DELETE = {"DELETE", "TRUNCATE", "DROP", "ALTER"}
_STATEMENT = re.compile(r"^\s*([A-Za-z]+)")
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


@dataclass(frozen=True)
class DatabaseWriteScope:
    task_id: str
    batch_id: str
    target_id: str
    table: str
    record_ids: frozenset[str]
    fields: frozenset[str]
    purpose: str
    max_rows: int
    alternatives_exhausted: bool

    def __post_init__(self) -> None:
        text_values = (
            self.task_id,
            self.batch_id,
            self.target_id,
            self.table,
            self.purpose,
        )
        if not all(value.strip() for value in text_values):
            raise ValueError("database write task, batch, target, table and purpose are required")
        if not self.record_ids or any(not value.strip() for value in self.record_ids):
            raise ValueError("database write record range is required")
        if not self.fields or any(not value.strip() for value in self.fields):
            raise ValueError("database write field range is required")
        if self.max_rows <= 0:
            raise ValueError("database write row limit must be positive")


@dataclass(frozen=True)
class ControlledWriteEvidence:
    preview_sql: str
    verification_sql: str
    before_snapshot: dict[str, Any]
    after_snapshot: dict[str, Any]
    affected_rows: int


def validate_sql(sql: str, mode: SqlMode = SqlMode.READ_ONLY, *, approved: bool = False) -> str:
    statement = sql.strip()
    match = _STATEMENT.match(statement)
    keyword = match.group(1).upper() if match else ""
    if keyword in _HARD_DELETE:
        raise RuntimePolicyError(
            ErrorCode.PHYSICAL_DELETE_FORBIDDEN,
            "Physical deletion and schema changes are permanently forbidden.",
        )
    if keyword in _READ_ONLY:
        if mode is not SqlMode.READ_ONLY and not approved:
            raise RuntimePolicyError(
                ErrorCode.SQL_READ_ONLY_VIOLATION,
                "Read query scope is invalid.",
            )
        return statement
    if keyword in {"INSERT", "UPDATE"}:
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Writes must use the structured controlled INSERT or UPDATE API.",
        )
    raise RuntimePolicyError(
        ErrorCode.SQL_READ_ONLY_VIOLATION,
        "SQL statement is not allowed by the current database policy.",
    )


def execute_sql(
    bound: BoundDatabaseConnection,
    sql: str,
    mode: SqlMode = SqlMode.READ_ONLY,
    *,
    approved: bool = False,
) -> list[tuple[Any, ...]]:
    if bound._token is not _BINDING_TOKEN:
        raise RuntimePolicyError(
            ErrorCode.UNAPPROVED_TARGET,
            "Database connection was not created by the trusted target binder.",
        )
    assert_dynamic_allowed(bound.environment)
    statement = validate_sql(sql, mode, approved=approved)
    cursor = bound.connection.execute(statement)
    if statement.lstrip().upper().startswith("SELECT"):
        return cursor.fetchall()
    bound.connection.commit()
    return []


def execute_controlled_update(
    bound: BoundDatabaseConnection,
    scope: DatabaseWriteScope,
    *,
    current_batch_id: str,
    key_column: str,
    record_id: str,
    updates: dict[str, Any],
) -> ControlledWriteEvidence:
    _validate_bound_connection(bound)
    _validate_controlled_update_scope(
        bound,
        scope,
        current_batch_id=current_batch_id,
        key_column=key_column,
        record_id=record_id,
        updates=updates,
    )
    table = _quote_identifier(scope.table)
    key = _quote_identifier(key_column)
    preview_sql = f"SELECT * FROM {table} WHERE {key} = ?"
    before_cursor = bound.connection.execute(preview_sql, (record_id,))
    before_rows = before_cursor.fetchmany(scope.max_rows + 1)
    if len(before_rows) != 1:
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Controlled update must resolve exactly one approved record.",
            details={"matched_rows": len(before_rows), "max_rows": scope.max_rows},
        )
    columns = tuple(description[0] for description in before_cursor.description or ())
    before_snapshot = dict(zip(columns, before_rows[0], strict=True))
    ordered_updates = sorted(updates.items())
    assignments = ", ".join(f"{_quote_identifier(field)} = ?" for field, _ in ordered_updates)
    update_sql = f"UPDATE {table} SET {assignments} WHERE {key} = ?"
    parameters = (*tuple(value for _, value in ordered_updates), record_id)
    try:
        cursor = bound.connection.execute(update_sql, parameters)
        if cursor.rowcount < 0 or cursor.rowcount > scope.max_rows:
            raise RuntimePolicyError(
                ErrorCode.CONTROLLED_WRITE_REQUIRED,
                "Controlled update exceeded the approved row limit.",
                details={"affected_rows": cursor.rowcount, "max_rows": scope.max_rows},
            )
        after_cursor = bound.connection.execute(preview_sql, (record_id,))
        after_row = after_cursor.fetchone()
        if after_row is None:
            raise RuntimePolicyError(
                ErrorCode.CONTROLLED_WRITE_REQUIRED,
                "Controlled update post-verification could not find the approved record.",
            )
        after_columns = tuple(description[0] for description in after_cursor.description or ())
        after_snapshot = dict(zip(after_columns, after_row, strict=True))
        _assert_updated_values(after_snapshot, updates)
        bound.connection.commit()
    except Exception:
        bound.connection.rollback()
        raise
    return ControlledWriteEvidence(
        preview_sql,
        preview_sql,
        before_snapshot,
        after_snapshot,
        cursor.rowcount,
    )


def execute_controlled_insert(
    bound: BoundDatabaseConnection,
    scope: DatabaseWriteScope,
    *,
    current_batch_id: str,
    key_column: str,
    values: dict[str, Any],
) -> ControlledWriteEvidence:
    _validate_bound_connection(bound)
    record_id_value = values.get(key_column)
    if not isinstance(record_id_value, str) or not record_id_value.strip():
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Controlled insert requires the approved string record identifier.",
        )
    _validate_controlled_update_scope(
        bound,
        scope,
        current_batch_id=current_batch_id,
        key_column=key_column,
        record_id=record_id_value,
        updates=values,
    )
    table = _quote_identifier(scope.table)
    key = _quote_identifier(key_column)
    verification_sql = f"SELECT * FROM {table} WHERE {key} = ?"
    if bound.connection.execute(verification_sql, (record_id_value,)).fetchone() is not None:
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Controlled insert requires the approved record identifier to be absent.",
        )
    ordered_values = sorted(values.items())
    columns = ", ".join(_quote_identifier(field) for field, _ in ordered_values)
    placeholders = ", ".join("?" for _ in ordered_values)
    insert_sql = f"INSERT INTO {table} ({columns}) VALUES ({placeholders})"
    try:
        cursor = bound.connection.execute(
            insert_sql,
            tuple(value for _, value in ordered_values),
        )
        if cursor.rowcount < 0 or cursor.rowcount > scope.max_rows:
            raise RuntimePolicyError(
                ErrorCode.CONTROLLED_WRITE_REQUIRED,
                "Controlled insert exceeded the approved row limit.",
                details={"affected_rows": cursor.rowcount, "max_rows": scope.max_rows},
            )
        after_cursor = bound.connection.execute(verification_sql, (record_id_value,))
        after_row = after_cursor.fetchone()
        if after_row is None:
            raise RuntimePolicyError(
                ErrorCode.CONTROLLED_WRITE_REQUIRED,
                "Controlled insert post-verification could not find the approved record.",
            )
        after_columns = tuple(description[0] for description in after_cursor.description or ())
        after_snapshot = dict(zip(after_columns, after_row, strict=True))
        _assert_updated_values(after_snapshot, values)
        bound.connection.commit()
    except Exception:
        bound.connection.rollback()
        raise
    return ControlledWriteEvidence(
        verification_sql,
        verification_sql,
        {},
        after_snapshot,
        cursor.rowcount,
    )


def _validate_bound_connection(bound: BoundDatabaseConnection) -> None:
    if bound._token is not _BINDING_TOKEN:
        raise RuntimePolicyError(
            ErrorCode.UNAPPROVED_TARGET,
            "Database connection was not created by the trusted target binder.",
        )
    assert_dynamic_allowed(bound.environment)


def _validate_controlled_update_scope(
    bound: BoundDatabaseConnection,
    scope: DatabaseWriteScope,
    *,
    current_batch_id: str,
    key_column: str,
    record_id: str,
    updates: dict[str, Any],
) -> None:
    if not scope.alternatives_exhausted:
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Direct database writes require interface and Admin alternatives to be exhausted.",
        )
    if scope.target_id != bound.target_id or scope.batch_id != current_batch_id:
        raise RuntimePolicyError(
            ErrorCode.APPROVAL_SCOPE_CHANGED,
            "Database write target or batch no longer matches approval scope.",
        )
    if record_id not in scope.record_ids or not updates or not set(updates).issubset(scope.fields):
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Database write record or fields are outside the approved scope.",
        )
    _quote_identifier(scope.table)
    _quote_identifier(key_column)
    for field in updates:
        _quote_identifier(field)


def _quote_identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Database identifiers must use the controlled identifier format.",
            details={"identifier": value},
        )
    return f'"{value}"'


def _assert_updated_values(snapshot: dict[str, Any], expected: dict[str, Any]) -> None:
    mismatches = sorted(field for field, value in expected.items() if snapshot.get(field) != value)
    if mismatches:
        raise RuntimePolicyError(
            ErrorCode.CONTROLLED_WRITE_REQUIRED,
            "Controlled write post-verification did not match requested values.",
            details={"mismatched_fields": mismatches},
        )
