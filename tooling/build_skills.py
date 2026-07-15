from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BANNER = "<!-- 此文件由根目录中文源文件自动生成，请勿直接编辑。 -->"
EXECUTION_BANNER = "<!-- 此文件由源文件自动生成，请勿直接编辑。 -->"


def load_manifest(root: Path = ROOT) -> dict:
    return json.loads((root / "tooling/skills-manifest.json").read_text(encoding="utf-8"))


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    if not text.startswith("---\n"):
        raise ValueError("缺少 YAML frontmatter")
    raw, body = text[4:].split("\n---\n", 1)
    meta: dict[str, str] = {}
    for line in raw.splitlines():
        key, value = line.split(":", 1)
        meta[key.strip()] = value.strip().strip('"')
    return meta, body


def _render_skill(source_text: str, banner: str = BANNER) -> str:
    marker = "\n---\n"
    split_at = source_text.index(marker, 4) + len(marker)
    return source_text[:split_at] + "\n" + banner + "\n" + source_text[split_at:].lstrip("\n")


def _split_block(source_text: str, start_marker: str, end_marker: str, replacement: str) -> tuple[str, str]:
    start = source_text.index(start_marker)
    end = source_text.index(end_marker)
    reference = source_text[start:end].rstrip() + "\n"
    return source_text[:start] + replacement + source_text[end:], reference


def _split_full_skill(source_text: str) -> tuple[str, dict[str, str]]:
    source_text, design_reference = _split_block(
        source_text,
        "## 十、用例生成分层",
        "## 十二、优先级定义",
        """## 十至十一、用例分层与去冗余（生成正式用例时加载）

门禁允许进入正式用例生成时，必须完整读取 `references/test-design-and-dedup.md`，执行其中的正常/异常分层、拆分与数量控制规则；仅澄清或输出轻量方向时不加载。

""",
    )
    start_marker = "## 十五、表格文件完整版规范"
    end_marker = "## 二十四、最终输出要求"
    replacement = """## 十五至二十三、表格文件与正式用例细则（按需加载）

仅输出聊天速览时，不加载本节的重型细则。用户明确要求文件、Excel、xlsx、HTML、归档表、正式十列用例，或需要核对具体字段和写法时，必须完整读取 `references/file-output-and-case-writing.md`，再继续生成；不得凭摘要省略其中的 Sheet、字段、编号、错误码、预期结果、资料等级和风险声明规则。

"""
    source_text, file_reference = _split_block(source_text, start_marker, end_marker, replacement)
    return source_text, {
        "references/test-design-and-dedup.md": design_reference,
        "references/file-output-and-case-writing.md": file_reference,
    }


def _split_execution_skill(source_text: str) -> tuple[str, dict[str, str]]:
    references: dict[str, str] = {}
    open_marker = "<!-- reference:"
    close_marker = "<!-- /reference -->"
    while open_marker in source_text:
        start = source_text.index(open_marker)
        marker_end = source_text.index("-->", start) + len("-->")
        relative = source_text[start + len(open_marker): marker_end - len("-->")].strip()
        end = source_text.index(close_marker, marker_end)
        reference = source_text[marker_end:end].strip() + "\n"
        references[relative] = reference
        replacement = "\n"
        source_text = source_text[:start] + replacement + source_text[end + len(close_marker):]
    for relative in references:
        if relative not in source_text:
            raise ValueError(f"执行 Skill 正文缺少引用读取条件: {relative}")
    return source_text.strip() + "\n", references


def _openai_yaml(item: dict) -> str:
    return (
        "interface:\n"
        f"  display_name: \"{item['display_name']}\"\n"
        f"  short_description: \"{item['short_description']}\"\n"
        f"  default_prompt: \"{item['default_prompt']}\"\n"
    )


def _copy_resource_tree(source_root: Path, package: Path, desired: dict[Path, str | bytes]) -> None:
    for directory in ("scripts", "assets"):
        resource_root = source_root / directory
        if not resource_root.exists():
            continue
        for resource in sorted(resource_root.rglob("*")):
            if resource.is_symlink():
                raise ValueError(f"执行 Skill 资源不允许符号链接: {resource}")
            if resource.is_file():
                desired[package / resource.relative_to(source_root)] = resource.read_bytes()


def build_all(root: Path = ROOT, check: bool = False) -> list[Path]:
    manifest = load_manifest(root)
    entries = manifest.get("skills", [])
    if len(entries) != 8 or len({i["slug"] for i in entries}) != 8:
        raise ValueError("manifest 必须包含八个唯一 Skill")
    desired: dict[Path, str | bytes] = {}
    for item in entries:
        source = root / item["source"]
        text = source.read_text(encoding="utf-8")
        meta, _ = parse_frontmatter(text)
        if meta.get("name") != item["slug"]:
            raise ValueError(f"{source.name}: frontmatter name 与 slug 不一致")
        package = root / "skills" / item["slug"]
        if item["slug"] == "single-api-test-full":
            compact, references = _split_full_skill(text)
            desired[package / "SKILL.md"] = _render_skill(compact)
            for relative, reference in references.items():
                desired[package / relative] = reference
        elif item["slug"] == "web-api-test-execution-evidence":
            compact, references = _split_execution_skill(text)
            desired[package / "SKILL.md"] = _render_skill(compact, EXECUTION_BANNER)
            for relative, reference in references.items():
                desired[package / relative] = reference
            _copy_resource_tree(source.parent, package, desired)
        else:
            desired[package / "SKILL.md"] = _render_skill(text)
        desired[package / "agents/openai.yaml"] = _openai_yaml(item)
        if item["case_output"]:
            renderer = root / "tooling/test-case-renderer.mjs"
            if renderer.exists():
                desired[package / "scripts/render-test-assets.mjs"] = renderer.read_text(encoding="utf-8")

    if check:
        drift = []
        for path, content in desired.items():
            if not path.exists() or path.read_bytes() != (content.encode("utf-8") if isinstance(content, str) else content):
                drift.append(str(path.relative_to(root)))
        existing = {p for p in (root / "skills").rglob("*") if p.is_file()} if (root / "skills").exists() else set()
        extra = existing - set(desired)
        if drift or extra:
            raise RuntimeError("生成内容漂移: " + ", ".join(drift + [str(p.relative_to(root)) for p in sorted(extra)]))
        return sorted(desired)

    skills_dir = root / "skills"
    temp = Path(tempfile.mkdtemp(prefix="skills-build-", dir=root))
    try:
        staged = temp / "skills"
        for final, content in desired.items():
            relative = final.relative_to(skills_dir)
            target = staged / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if isinstance(content, str):
                target.write_text(content, encoding="utf-8", newline="\n")
            else:
                target.write_bytes(content)
        if skills_dir.exists():
            shutil.rmtree(skills_dir)
        staged.replace(skills_dir)
    finally:
        shutil.rmtree(temp, ignore_errors=True)
    return sorted(desired)


def main() -> int:
    parser = argparse.ArgumentParser(description="生成八个标准 Skill 安装包")
    parser.add_argument("--check", action="store_true", help="只检查生成内容是否漂移")
    args = parser.parse_args()
    try:
        outputs = build_all(ROOT, check=args.check)
        print(f"{'校验' if args.check else '生成'}完成：{len(outputs)} 个文件")
        return 0
    except Exception as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
