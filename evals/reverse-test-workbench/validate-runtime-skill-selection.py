from pathlib import Path
import tomllib


ROOT = Path(__file__).resolve().parents[2]
PLUGIN = ROOT / "plugins/reverse-test-workbench"
README = PLUGIN / "README.md"
MANIFEST = PLUGIN / ".codex-plugin/plugin.json"
LEGACY = Path.home() / ".codex/skills/reverse-test-workbench"
PLUGIN_CACHE = Path.home() / ".codex/plugins/cache/reverse-test-workbench"
CONFIG = Path.home() / ".codex/config.toml"


def require(text: str, fragment: str, source: Path) -> None:
    if fragment not in text:
        raise AssertionError(f"missing {fragment!r} in {source}")


readme = README.read_text(encoding="utf-8")
manifest = MANIFEST.read_text(encoding="utf-8")
config = tomllib.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}

for fragment in (
    "## 唯一运行来源与旧版迁移",
    "reverse-test-workbench:reverse-test-workbench",
    "~/.codex/skills/reverse-test-workbench",
    "移出 Skill 扫描目录",
    "不得直接修改 Plugin 缓存",
    "新建任务",
):
    require(readme, fragment, README)

for fragment in (
    '"name": "reverse-test-workbench"',
    '"skills": "./skills/"',
    '"mcpServers": "./.mcp.json"',
):
    require(manifest, fragment, MANIFEST)

if LEGACY.exists():
    raise AssertionError(
        f"legacy standalone skill still shadows plugin discovery: {LEGACY}"
    )

if not PLUGIN_CACHE.exists():
    raise AssertionError(f"installed plugin cache is missing: {PLUGIN_CACHE}")

plugin_config = config.get("plugins", {}).get(
    "reverse-test-workbench@reverse-test-workbench"
)
if not plugin_config or plugin_config.get("enabled") is not True:
    raise AssertionError("reverse-test-workbench plugin is not enabled in config.toml")

marketplace = config.get("marketplaces", {}).get("reverse-test-workbench")
if not marketplace or marketplace.get("source_type") != "local":
    raise AssertionError("reverse-test-workbench local marketplace is not configured")

print("runtime skill selection validation passed")
