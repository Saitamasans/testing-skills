from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "skills/reverse-test-workbench/SKILL.md"
REFERENCES = SKILL.parent / "references"
SCRIPTS = SKILL.parent / "scripts"


skill = SKILL.read_text(encoding="utf-8")
skill_lines = len(skill.splitlines())
if skill_lines > 380:
    raise AssertionError(f"SKILL.md is still too close to the 500-line limit: {skill_lines}")

frontmatter = skill.split("---", 2)[1]
if set(
    line.split(":", 1)[0].strip()
    for line in frontmatter.splitlines()
    if ":" in line
) != {"name", "description"}:
    raise AssertionError("SKILL.md frontmatter must contain only name and description")

for reference in REFERENCES.glob("*.md"):
    text = reference.read_text(encoding="utf-8")
    if len(text.splitlines()) > 100 and "## 目录" not in text:
        raise AssertionError(f"long reference lacks a table of contents: {reference}")

for obsolete in (
    "在 `evidence/_run-state.json` 保存轻量断点",
    "临时等待期间允许先存在 `evidence/` 和 `_run-state.json`",
):
    if obsolete in skill:
        raise AssertionError(f"derived state is still described as a direct fact source: {obsolete}")

for reference_name in (
    "execution-environment.md",
    "browser-execution.md",
    "exploration-design.md",
    "output-assets.md",
    "run-data-contract.md",
    "host-integration-contract.md",
):
    if reference_name not in skill:
        raise AssertionError(f"SKILL.md does not reference {reference_name}")

invocation_text = "\n".join(
    path.read_text(encoding="utf-8") for path in REFERENCES.glob("*.md")
)
for script in SCRIPTS.glob("*.py"):
    content = script.read_text(encoding="utf-8")
    if not content.startswith("#!/usr/bin/env python3"):
        raise AssertionError(f"script lacks a portable shebang: {script}")
    if script.name not in invocation_text:
        raise AssertionError(f"script has no invocation/reference documentation: {script.name}")

for source in (SKILL, *REFERENCES.glob("*.md")):
    text = source.read_text(encoding="utf-8")
    if re.search(r"\b(TODO|FIXME|TBD)\b", text, flags=re.IGNORECASE):
        raise AssertionError(f"placeholder residue in {source}")

print("skill audit validation passed")
