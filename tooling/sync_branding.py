from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from branding import ROOT, load_brand, origin_text

README_START = "<!-- brand:display:start -->"
README_END = "<!-- brand:display:end -->"
INSTALLER_START = "rem brand:display:start"
INSTALLER_END = "rem brand:display:end"
INSTALLER_PATH = Path("installers/install-js-test-mapper.cmd")


def replace_block(text: str, start: str, end: str, replacement: str) -> str:
    if start not in text or end not in text:
        raise RuntimeError(f"missing branding markers: {start} / {end}")
    before, remainder = text.split(start, 1)
    _, after = remainder.split(end, 1)
    return before + start + "\n" + replacement.rstrip() + "\n" + end + after


def expected_files(root: Path = ROOT) -> dict[Path, str]:
    brand = load_brand(root)
    manifest = json.loads((root / "tooling/skills-manifest.json").read_text(encoding="utf-8"))
    expected = {
        root / "NOTICE": (
            f"{brand['brand_display_name']} ({brand['brand_name']})\n"
            "Branding and ORIGIN.txt files are attribution-only presentation metadata.\n"
            "They do not form part of any Skill instruction, prompt, schema, or Runtime behavior.\n"
        )
    }
    for item in manifest["skills"]:
        expected[root / "skills" / item["slug"] / "ORIGIN.txt"] = origin_text(item["slug"], root)
    expected[root / "plugins/js-test-mapper/skills/js-test-mapper/ORIGIN.txt"] = origin_text("js-test-mapper", root)
    expected[root / "plugins/reverse-test-workbench/skills/reverse-test-workbench/ORIGIN.txt"] = origin_text("reverse-test-workbench", root)
    readme = (root / "README.md").read_text(encoding="utf-8")
    expected[root / "README.md"] = replace_block(readme, README_START, README_END, f"由 **{brand['brand_display_name']}** 维护的中文测试 Skill 集合。")
    installer = (root / "installers/install-js-test-mapper.cmd").read_text(encoding="utf-8")
    expected[root / INSTALLER_PATH] = replace_block(
        installer,
        INSTALLER_START,
        INSTALLER_END,
        "\n".join(
            (
                f"echo {brand['installer_brand_display_name']}",
                f"echo {brand['installer_product_display_name']}",
            )
        ),
    )
    return expected


def installer_bytes(content: str) -> bytes:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n")
    return normalized.replace("\n", "\r\n").encode("ascii")


def sync(root: Path = ROOT, check: bool = False) -> None:
    drift = []
    for path, content in expected_files(root).items():
        is_installer = path == root / INSTALLER_PATH
        if check:
            matches = (
                path.exists()
                and (
                    path.read_bytes() == installer_bytes(content)
                    if is_installer
                    else path.read_text(encoding="utf-8") == content
                )
            )
            if not matches:
                drift.append(path.relative_to(root).as_posix())
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            if is_installer:
                path.write_bytes(installer_bytes(content))
            else:
                path.write_text(content, encoding="utf-8", newline="\n")
    if drift:
        raise RuntimeError("branding drift: " + ", ".join(drift))


def main() -> int:
    parser = argparse.ArgumentParser(description="Synchronize presentation-only branding")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        sync(ROOT, args.check)
        print("branding check passed" if args.check else "branding synchronized")
        return 0
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
