#!/usr/bin/env python3
"""Record external DOCX visual validation in the artifact build manifest."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from hashlib import sha256
from pathlib import Path
import tempfile


MANIFEST_RELATIVE = Path("evidence/_artifact-build.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", required=True, type=Path)
    parser.add_argument("--status", required=True, choices=("passed", "failed", "skipped"))
    parser.add_argument("--reason", default="")
    parser.add_argument("--pages", type=int, default=0)
    parser.add_argument(
        "--evidence",
        action="append",
        default=[],
        help="Rendered visual evidence path relative to the run root",
    )
    args = parser.parse_args()
    if args.status != "passed" and not args.reason.strip():
        parser.error("--reason is required for failed or skipped validation")
    if args.status == "passed" and args.pages <= 0:
        parser.error("--pages must be greater than zero for passed validation")

    manifest_path = args.run_root / MANIFEST_RELATIVE
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"artifact validation record failed: {exc}")
        return 1

    artifact = manifest.get("artifacts", {}).get("docx", {})
    docx_relative = str(artifact.get("path", "过程小结.docx"))
    docx_path = args.run_root / docx_relative
    if args.status == "passed":
        if artifact.get("status") != "generated" or not docx_path.is_file():
            parser.error("passed validation requires a generated DOCX artifact")
        if not args.evidence:
            parser.error("passed validation requires at least one --evidence path")
        for evidence in args.evidence:
            evidence_path = Path(evidence)
            if evidence_path.is_absolute() or ".." in evidence_path.parts:
                parser.error("--evidence paths must be relative to the run root")
            resolved_evidence = args.run_root / evidence_path
            if not resolved_evidence.is_file() or resolved_evidence.stat().st_size == 0:
                parser.error(f"visual evidence does not exist: {evidence}")

    docx_sha256 = None
    if docx_path.is_file():
        docx_sha256 = sha256(docx_path.read_bytes()).hexdigest()
    if args.status == "passed" and docx_sha256 != artifact.get("integrity", {}).get("sha256"):
        parser.error("generated DOCX changed after artifact publication")

    manifest["visual_validation"] = {
        **manifest.get("visual_validation", {}),
        "status": args.status,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "reason": args.reason,
        "pages": max(args.pages, 0),
        "claimed_passed": args.status == "passed",
        "evidence": args.evidence,
        "artifact": {"path": docx_relative, "sha256": docx_sha256},
    }

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    handle, temp_name = tempfile.mkstemp(
        prefix=".artifact-validation-",
        suffix=".json",
        dir=manifest_path.parent,
    )
    os.close(handle)
    temp_path = Path(temp_name)
    try:
        temp_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        os.replace(temp_path, manifest_path)
    finally:
        if temp_path.exists():
            temp_path.unlink()

    print(
        json.dumps(
            {
                "status": "recorded",
                "manifest": str(manifest_path),
                "visual_validation": manifest["visual_validation"],
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
