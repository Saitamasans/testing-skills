#!/usr/bin/env python3
"""Report artifact-generation capabilities without creating artifacts."""

from __future__ import annotations

from datetime import datetime, timezone
import importlib
import json
import shutil


def _import_capability(module: str) -> tuple[str, str]:
    try:
        importlib.import_module(module)
        return "available", ""
    except ImportError as exc:
        return "unavailable", str(exc)


def capability_report() -> dict[str, object]:
    docx_status, docx_error = _import_capability("docx")
    xlsx_status, xlsx_error = _import_capability("openpyxl")
    image_status, image_error = _import_capability("PIL")
    docx_available = docx_status == "available"
    xlsx_available = xlsx_status == "available"
    libreoffice_path = shutil.which("soffice") or shutil.which("libreoffice")
    libreoffice_available = libreoffice_path is not None
    if docx_available and not libreoffice_available:
        fallback = "structure_check"
    elif not docx_available and not xlsx_available:
        fallback = "no_artifact_generation"
    else:
        fallback = "none"
    return {
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "docx_generation": docx_status,
        "docx_error": docx_error,
        "xlsx_generation": xlsx_status,
        "xlsx_error": xlsx_error,
        "libreoffice": "available" if libreoffice_available else "unavailable",
        "libreoffice_path": libreoffice_path or "",
        "table_validation": "available" if xlsx_available else "unavailable",
        "image_validation": image_status,
        "image_error": image_error,
        "visual_render_unavailable": not libreoffice_available,
        "fallback": fallback,
        "notes": "LibreOffice 缺失时直接采用 DOCX 结构检查。"
        if docx_available and not libreoffice_available
        else "",
    }


def main() -> int:
    print(json.dumps(capability_report(), ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
