from pathlib import Path
import json


ROOT = Path(__file__).resolve().parents[2]
README = ROOT / "README.md"
GITIGNORE = ROOT / ".gitignore"
MARKETPLACE = ROOT / ".agents/plugins/marketplace.json"
PLUGIN = ROOT / "plugins/reverse-test-workbench"
MANIFEST = PLUGIN / ".codex-plugin/plugin.json"
MCP = PLUGIN / ".mcp.json"
WORKFLOW = ROOT / ".github/workflows/update-playwright-mcp.yml"


for path in (README, GITIGNORE, MARKETPLACE, MANIFEST, MCP, WORKFLOW):
    if not path.is_file():
        raise AssertionError(f"release resource missing: {path}")

readme = README.read_text(encoding="utf-8")
for fragment in (
    "codex plugin marketplace add",
    "codex plugin add reverse-test-workbench@reverse-test-workbench",
    "新建任务",
):
    if fragment not in readme:
        raise AssertionError(f"root README missing installation guidance: {fragment}")

gitignore = GITIGNORE.read_text(encoding="utf-8")
for pattern in (
    ".playwright-mcp/",
    ".release-validation/",
    "outputs/",
    "artifact_build/",
    "*_无需求UI逆向测试/",
    "__pycache__/",
):
    if pattern not in gitignore:
        raise AssertionError(f".gitignore missing development artifact pattern: {pattern}")

marketplace = json.loads(MARKETPLACE.read_text(encoding="utf-8"))
entries = marketplace.get("plugins", [])
if len(entries) != 1 or entries[0].get("name") != "reverse-test-workbench":
    raise AssertionError("marketplace must expose exactly the release plugin")
source_path = entries[0].get("source", {}).get("path")
if source_path != "./plugins/reverse-test-workbench":
    raise AssertionError("marketplace source path is not repository-relative")
if not (MARKETPLACE.parent.parent.parent / source_path).resolve().is_dir():
    raise AssertionError("marketplace source path does not resolve to the plugin")

manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
if manifest.get("name") != "reverse-test-workbench":
    raise AssertionError("plugin manifest name mismatch")

mcp = json.loads(MCP.read_text(encoding="utf-8"))
args = mcp.get("mcpServers", {}).get("playwright", {}).get("args", [])
locked = [value for value in args if str(value).startswith("@playwright/mcp@")]
if len(locked) != 1 or locked[0].endswith("@latest"):
    raise AssertionError("Playwright MCP must use one pinned package version")

workflow = WORKFLOW.read_text(encoding="utf-8")
if "plugin.version.split('+', 1)[0]" not in workflow:
    raise AssertionError("dependency workflow is not cachebuster-aware")
if "parts = plugin.version.split('.').map(Number)" in workflow:
    raise AssertionError("dependency workflow still parses build metadata as a number")

print("release readiness validation passed")
