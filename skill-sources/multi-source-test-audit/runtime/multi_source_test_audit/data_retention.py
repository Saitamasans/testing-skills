from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime


@dataclass(frozen=True)
class DataEvidenceLocation:
    environment: str
    database: str
    table: str
    record_key: str
    server_time: datetime
    verification_sql: str
    evidence_id: str
    retention_action: str = field(default="retain", init=False)

    def __post_init__(self) -> None:
        values = (
            self.environment,
            self.database,
            self.table,
            self.record_key,
            self.verification_sql,
            self.evidence_id,
        )
        if not all(value.strip() for value in values):
            raise ValueError("complete database evidence location is required")
        if self.server_time.tzinfo is None:
            raise ValueError("database evidence server time must include a timezone")
