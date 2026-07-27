from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Provenance:
    source: str
    batch_id: str
    environment: str
    commit: str
    account_alias: str
    evidence_ids: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.is_complete():
            raise ValueError(
                "provenance requires source, batch, environment, commit, account and evidence"
            )

    def is_complete(self) -> bool:
        values = (
            self.source,
            self.batch_id,
            self.environment,
            self.commit,
            self.account_alias,
            *self.evidence_ids,
        )
        return bool(self.evidence_ids) and all(value.strip() for value in values)

    def as_dict(self) -> dict[str, Any]:
        return {
            "source": self.source,
            "batch_id": self.batch_id,
            "environment": self.environment,
            "commit": self.commit,
            "account_alias": self.account_alias,
            "evidence_ids": list(self.evidence_ids),
        }
