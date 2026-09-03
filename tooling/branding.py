from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_brand(root: Path = ROOT) -> dict:
    brand = json.loads((root / "config/brand.json").read_text(encoding="utf-8"))
    for field in ("brand_name", "brand_display_name"):
        if not isinstance(brand.get(field), str) or not brand[field].strip():
            raise ValueError(f"{field} must be a non-empty string")
    aliases = brand.get("aliases")
    if not isinstance(aliases, list) or len(aliases) != 4 or len(set(aliases)) != 4:
        raise ValueError("aliases must contain exactly four unique values")
    if any(not isinstance(alias, str) or not alias.strip() for alias in aliases):
        raise ValueError("aliases must be non-empty strings")
    return brand


def origin_alias(skill_name: str, root: Path = ROOT) -> str:
    aliases = load_brand(root)["aliases"]
    digest = hashlib.sha256(f"{skill_name}:ORIGIN.txt".encode("utf-8")).digest()
    return aliases[int.from_bytes(digest, "big") % len(aliases)]


def origin_text(skill_name: str, root: Path = ROOT) -> str:
    brand = load_brand(root)
    return (
        f"Origin: {brand['brand_display_name']}\n"
        f"Alias: {origin_alias(skill_name, root)}\n"
        "Purpose: attribution only; not part of Skill execution instructions.\n"
    )
