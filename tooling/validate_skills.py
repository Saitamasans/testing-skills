from pathlib import Path

from build_skills import ROOT, load_manifest, parse_frontmatter


def validate_sources(root: Path = ROOT) -> list[str]:
    errors: list[str] = []
    manifest = load_manifest(root)
    for item in manifest["skills"]:
        path = root / item["source"]
        try:
            meta, body = parse_frontmatter(path.read_text(encoding="utf-8"))
            if set(meta) != {"name", "description"}:
                errors.append(f"{path.name}: frontmatter 只能包含 name/description")
            if meta.get("name") != item["slug"]:
                errors.append(f"{path.name}: name 与 slug 不一致")
            if not meta.get("description", "").startswith("Use when"):
                errors.append(f"{path.name}: description 必须以 Use when 开头")
            if "铁律" not in body and "硬规则" not in body:
                errors.append(f"{path.name}: 缺少顶层铁律或硬规则")
            if "自检" not in body and "检查清单" not in body:
                errors.append(f"{path.name}: 缺少最终自检")
        except Exception as exc:
            errors.append(f"{path.name}: {exc}")
    return errors


if __name__ == "__main__":
    problems = validate_sources()
    if problems:
        print("\n".join(problems))
        raise SystemExit(1)
    print("八个源 Skill 校验通过")
