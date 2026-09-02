from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "skill-sources" / "js-test-mapper"
PUBLIC = ROOT / "skills" / "js-test-mapper"
PLUGIN = ROOT / "plugins" / "js-test-mapper" / "skills" / "js-test-mapper"
RUNTIME = ROOT / "runtimes" / "js-test-mapper-runtime"
BANNER = "<!-- 此文件由根目录中文源文件自动生成，请勿直接编辑。 -->"


def files(root: Path) -> dict[Path, bytes]:
    if not root.exists():
        return {}
    return {
        path.relative_to(root): path.read_bytes()
        for path in sorted(root.rglob("*"))
        if path.is_file()
    }


def desired_source() -> dict[Path, bytes]:
    source_files = files(SOURCE)
    for name in ("run-data.schema.json", "cognition.schema.json"):
        source_files[Path("schemas") / name] = (RUNTIME / "schemas" / name).read_bytes()
    return source_files


def desired_public() -> dict[Path, bytes]:
    source_files = desired_source()
    if Path("SKILL.md") not in source_files:
        raise RuntimeError("js-test-mapper source SKILL.md is missing")
    skill = source_files.pop(Path("SKILL.md")).decode("utf-8")
    marker = "\n---\n"
    split_at = skill.index(marker, 4) + len(marker)
    rendered = skill[:split_at] + "\n" + BANNER + "\n" + skill[split_at:].lstrip("\n")
    source_files[Path("SKILL.md")] = rendered.encode("utf-8")
    manifest = json.loads((ROOT / "tooling" / "skills-manifest.json").read_text(encoding="utf-8"))
    item = next(entry for entry in manifest["skills"] if entry["slug"] == "js-test-mapper")
    yaml = (
        "interface:\n"
        f"  display_name: \"{item['display_name']}\"\n"
        f"  short_description: \"{item['short_description']}\"\n"
        f"  default_prompt: \"{item['default_prompt']}\"\n"
    )
    source_files[Path("agents/openai.yaml")] = yaml.encode("utf-8")
    return source_files


def replace_tree(target: Path, desired: dict[Path, bytes]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="js-test-mapper-sync-", dir=target.parent))
    staged = temporary / target.name
    try:
        for relative, content in desired.items():
            output = staged / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(content)
        if target.exists():
            shutil.rmtree(target)
        staged.replace(target)
    finally:
        shutil.rmtree(temporary, ignore_errors=True)


def drift(actual: dict[Path, bytes], expected: dict[Path, bytes]) -> list[str]:
    return [
        *(f"missing:{path.as_posix()}" for path in sorted(set(expected) - set(actual))),
        *(f"extra:{path.as_posix()}" for path in sorted(set(actual) - set(expected))),
        *(f"changed:{path.as_posix()}" for path in sorted(set(actual) & set(expected)) if actual[path] != expected[path]),
    ]


def assert_runtime_schema_contract() -> None:
    for name in ("run-data.schema.json", "cognition.schema.json"):
        runtime = json.loads((RUNTIME / "schemas" / name).read_text(encoding="utf-8"))
        source = json.loads((SOURCE / "schemas" / name).read_text(encoding="utf-8"))
        if runtime != source:
            raise RuntimeError(f"js-test-mapper runtime/source schema drift: {name}")


def sync(check: bool = False) -> None:
    source_expected = desired_source()
    if check:
        source_problems = drift(files(SOURCE), source_expected)
        if source_problems:
            raise RuntimeError("js-test-mapper source schema drift: " + ", ".join(source_problems))
    expected = desired_public()
    if check:
        problems = [*(f"public:{item}" for item in drift(files(PUBLIC), expected)), *(f"plugin:{item}" for item in drift(files(PLUGIN), expected))]
        if problems:
            raise RuntimeError("js-test-mapper distribution drift: " + ", ".join(problems))
        return
    if not check:
        replace_tree(SOURCE, source_expected)
        expected = desired_public()
        replace_tree(PUBLIC, expected)
        replace_tree(PLUGIN, expected)


def main() -> int:
    parser = argparse.ArgumentParser(description="Build public js-test-mapper Skill and mirror it into the Codex Plugin")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        sync(args.check)
        print("js-test-mapper distribution check passed" if args.check else "js-test-mapper public Skill and Plugin mirror synchronized")
        return 0
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
