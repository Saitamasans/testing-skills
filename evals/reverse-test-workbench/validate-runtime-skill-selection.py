from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PUBLIC = ROOT / "skills/reverse-test-workbench"
PLUGIN = ROOT / "plugins/reverse-test-workbench"
MIRROR = PLUGIN / "skills/reverse-test-workbench"
MANIFEST = PLUGIN / ".codex-plugin/plugin.json"
MCP = PLUGIN / ".mcp.json"


def files(root: Path) -> dict[Path, bytes]:
    return {
        path.relative_to(root): path.read_bytes()
        for path in root.rglob("*")
        if path.is_file()
    }


for path in (PUBLIC / "SKILL.md", MIRROR / "SKILL.md", MANIFEST, MCP):
    if not path.is_file():
        raise AssertionError(f"required distribution resource missing: {path}")

public_files = files(PUBLIC)
mirror_files = files(MIRROR)
if public_files != mirror_files:
    missing = sorted(set(public_files) - set(mirror_files))
    extra = sorted(set(mirror_files) - set(public_files))
    changed = sorted(
        path
        for path in set(public_files) & set(mirror_files)
        if public_files[path] != mirror_files[path]
    )
    raise AssertionError(
        f"optional Codex adapter mirror drifted: missing={missing}, extra={extra}, changed={changed}"
    )

core_text = "\n".join(
    path.read_text(encoding="utf-8")
    for path in PUBLIC.rglob("*")
    if path.is_file() and path.suffix in {".md", ".py", ".json", ".txt"}
)
for forbidden in (
    "本 Plugin",
    "Codex 工作区",
    "bundled Python",
    "workspace-python",
    "plugin_version",
    "--plugin-version",
    "执行器/Plugin",
):
    if forbidden in core_text:
        raise AssertionError(f"host-specific core dependency remains: {forbidden}")

adapter_readme = (PLUGIN / "README.md").read_text(encoding="utf-8")
for required in ("可选 Codex 适配器", "通用", "不依赖 Codex"):
    if required not in adapter_readme:
        raise AssertionError(f"adapter README missing boundary statement: {required}")

print("runtime distribution validation passed")
