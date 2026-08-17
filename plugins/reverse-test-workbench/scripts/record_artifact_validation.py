#!/usr/bin/env python3
"""Record external DOCX visual validation in the artifact build manifest."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import tempfile


MANIFEST_RELATIVE = Path("evidence/_artifact-build.json")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--run-root", required=True, type=Path)
    parser.add_argument("--status", required=True, choices=("passed", "failed", "skipped"))
    parser.add_argument("--reason", default="")
    parser.add_argument("--pages", type=int, default=0)
    args = parser.parse_args()
    if args.status != "passed" and not args.reason.strip():
        parser.error("--reason is required for failed or skipped validation")

    manifest_path = args.run_root / MANIFEST_RELATIVE
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"artifact validation record failed: {exc}")
        return 1

    manifest["visual_validation"] = {
        **manifest.get("visual_validation", {}),
        "status": args.status,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "reason": args.reason,
        "pages": max(args.pages, 0),
        "claimed_passed": args.status == "passed",
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
