# Standard Skill Packaging and Dual Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. The user requires time-controlled inline batch execution; do not dispatch per-file implementers or per-task reviewers.

**Goal:** Convert the seven Chinese source documents into seven self-contained installable Codex/Claude Skill packages, add deterministic Excel/HTML test-case output to five packages, validate routing and CC Switch discovery, and prepare the existing GitHub repository for a public MIT release.

**Architecture:** The seven root Markdown files remain the only manually edited Skill content. A standard-library Python builder reads a manifest, validates each source, and generates committed `skills/<slug>/SKILL.md` packages plus metadata and package-local renderer assets. One generic report schema feeds both the openpyxl Excel renderer and a self-contained HTML renderer.

**Tech Stack:** Markdown, JSON, Python 3 standard library, openpyxl, `unittest`, JavaScript, Playwright, GitHub Actions, `npx skills`.

## Global Constraints

- The seven Chinese source filenames and root locations must not change.
- Do not merge, delete, or split any of the seven Skills.
- Preserve the original Chinese tone, numbering, tables, P0/P1/P2, 待确认, 合理假设, and existing trigger phrases.
- Meaning, behavior, gates, and usefulness take priority over line-count targets.
- Root Chinese files are the only manually maintained Skill body source.
- A task has one primary Skill and at most one secondary Skill.
- Before loading a secondary Skill, tell the user the two Skills and their responsibilities, then wait for confirmation.
- If the user rejects the secondary Skill, continue with the primary Skill and state the coverage limitation.
- Only five case-generating Skills receive the Excel/HTML execution component.
- A file request produces both `.xlsx` and `.html`; chat-only requests do not create files.
- Execution status values are exactly `未执行`, `通过`, `不通过`, `待定`.
- `待定` means execution occurred but the acceptance rule is disputed or ambiguous; notes remain optional.
- Excel 2016+, current WPS Office, Codex, Claude Code, and CC Switch are blocking compatibility targets.
- README content is Chinese-first with concise English names and descriptions.
- License is MIT.
- Do not push GitHub or create a Release until the user separately confirms the verified local result.
- Time control: one batch implementation pass, one unified regression pass, one final review. Target execution window is 90–120 minutes; report scope blockers instead of starting repeated review loops.

---

### Task 1: Build and validation foundation

**Files:**
- Create: `tooling/skills-manifest.json`
- Create: `tooling/build_skills.py`
- Create: `tooling/validate_skills.py`
- Create: `tooling/ability-contracts.json`
- Create: `tests/test_build_skills.py`
- Create: `tests/test_source_contracts.py`
- Create: `.gitignore`

**Interfaces:**
- Consumes: the seven root Markdown source files.
- Produces: `load_manifest(root: Path) -> dict`, `parse_frontmatter(text: str) -> tuple[dict, str]`, `build_all(root: Path, check: bool = False) -> list[Path]`, and `validate_sources(root: Path) -> list[str]`.
- Manifest entries contain `source`, `slug`, `display_name`, `short_description`, `default_prompt`, and `case_output`.

- [ ] **Step 1: Write failing build tests**

Create `tests/test_build_skills.py` with `unittest` coverage for all seven manifest entries, exact source-to-slug mapping, generated `SKILL.md`, generated-file banner, frontmatter equality, check-mode drift detection, and self-contained package paths.

```python
class BuildSkillsTest(unittest.TestCase):
    def test_manifest_has_exactly_seven_unique_skills(self):
        manifest = load_manifest(ROOT)
        self.assertEqual(7, len(manifest["skills"]))
        self.assertEqual(7, len({item["slug"] for item in manifest["skills"]}))

    def test_generated_skill_preserves_frontmatter_and_body(self):
        outputs = build_all(ROOT)
        generated = ROOT / "skills/single-api-test-full/SKILL.md"
        self.assertIn(generated, outputs)
        source_meta, source_body = parse_frontmatter(
            (ROOT / "单接口用例生成与对齐_完整版Skill_v0.3.md").read_text(encoding="utf-8")
        )
        generated_meta, generated_body = parse_frontmatter(generated.read_text(encoding="utf-8"))
        self.assertEqual(source_meta, generated_meta)
        self.assertIn(source_body.strip(), generated_body)
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```powershell
python -m unittest tests.test_build_skills -v
```

Expected: import or file-not-found failures for the new builder and manifest.

- [ ] **Step 3: Create the exact seven-entry manifest**

Map the existing frontmatter names to these package slugs:

```json
[
  "single-api-test-full",
  "single-api-test-concise",
  "multi-api-flow-test",
  "requirement-test-workbench",
  "production-verification-test",
  "test-case-quality-audit",
  "requirement-clarification-test"
]
```

Set `case_output: true` only for the first five case-generating packages.

- [ ] **Step 4: Implement deterministic build functions**

Implement frontmatter parsing without a YAML dependency because current frontmatter contains only `name` and `description`. Build into a temporary directory, compare in `--check` mode, and atomically replace generated package files only after all seven sources validate.

Command interface:

```powershell
python tooling/build_skills.py
python tooling/build_skills.py --check
python tooling/validate_skills.py
```

Expected: build returns exit 0; check exits nonzero when a generated package is stale; validation prints seven valid source entries.

- [ ] **Step 5: Add source contract tests**

`tests/test_source_contracts.py` must assert seven unchanged filenames, frontmatter with only `name` and `description`, no placeholder residue, at least one checklist, a top-level iron law or hard rule, a final self-check, and exact ten-column order in the five case-generating sources. Build the placeholder pattern from fragments in test code, for example `("TO" + "DO", "FIX" + "ME", "T" + "BD", "x" + "xx")`, so the plan itself does not contain a false-positive placeholder.

- [ ] **Step 6: Run Task 1 tests**

```powershell
python -m unittest tests.test_build_skills tests.test_source_contracts -v
python tooling/build_skills.py --check
```

Expected: all tests pass and seven package directories exist.

- [ ] **Step 7: Commit Task 1**

```powershell
git add tooling tests skills .gitignore
git commit -m "build: generate standard skill packages"
```

---

### Task 2: Route-safe content optimization

**Files:**
- Modify: `单接口用例生成与对齐_完整版Skill_v0.3.md`
- Modify: `精炼版_单接口用例与对齐skill_v0.3.md`
- Modify: `多接口链路测试用例生成skill_v0.6_精炼执行版.md`
- Modify: `根据需求-用例生成_skill.md`
- Modify: `正式服验证-用例生成 Skill.md`
- Modify: `测试用例-审计与评_Skill_V1.md`
- Modify: `测试视角-需求澄清 Skill.md`
- Modify: `tooling/ability-contracts.json`
- Create: `tests/test_routing_contracts.py`
- Create: `tests/test_ability_preservation.py`

**Interfaces:**
- Consumes: the confirmed routing matrix and each source's current unique capabilities.
- Produces: mutually bounded descriptions, primary/secondary confirmation protocol, and machine-readable ability contracts used by validation.

- [ ] **Step 1: Record current abilities before editing**

For each source, list required literal terms, required headings, original trigger phrases, business templates, gates, fixed IDs, and output contracts in `tooling/ability-contracts.json`. Include `按六个 Skill 跑一遍`, `C001/Q001/N001`, M1–M7, the four production gates, four audit levels, L0–L4, and all ten columns.

- [ ] **Step 2: Write failing routing tests**

Create table-driven tests for these exact decisions:

```python
ROUTES = [
    ("帮我测一个接口", "single-api-test-full"),
    ("用精炼版快速测一个接口", "single-api-test-concise"),
    ("分析这五个接口的调用链", "multi-api-flow-test"),
    ("根据 PRD 提测试点", "requirement-test-workbench"),
    ("先澄清需求，不要写用例", "requirement-clarification-test"),
    ("审计这批已有测试用例", "test-case-quality-audit"),
    ("正式服上线后怎么验证", "production-verification-test"),
]
```

Also assert that a combined task emits a confirmation notice before any secondary-Skill instruction and contains the phrase `用户确认前` rather than `用户未确认前`.

- [ ] **Step 3: Optimize all seven sources in one batch**

Apply the confirmed per-file reductions. Merge only repeated definitions. Preserve every ability-contract item. Use these soft line targets: 600, 264, 420, 420, 360, 360, and 336 respectively. If a target cannot be reached without losing a required ability, keep the content and record the reason in the build report.

- [ ] **Step 4: Implement primary/secondary transparency**

Add one reusable positive output contract to applicable sources:

```text
本次 Skill 调用说明
主 Skill：...
辅助 Skill：...
职责分工：...
最终只生成一套结果。
是否确认同时调用？
```

The primary Skill stops before loading the secondary Skill. Rejection continues the primary workflow with an explicit coverage limitation.

- [ ] **Step 5: Fix known content defects**

- Move the audit evidence iron law before its workflow.
- Fix requirement-clarification heading levels to `#`, `##`, `###`.
- Keep only an L0 read-only example in the default production template; place authorized write examples behind the complete four-gate condition.
- Keep the multi-interface current 334-line core unless new requirements require a small increase.
- Run a Chinese wording scan for double negatives, missing subjects, ambiguous references, and unnatural pre-confirmation wording.

- [ ] **Step 6: Rebuild and run behavior contracts**

```powershell
python tooling/build_skills.py
python -m unittest tests.test_source_contracts tests.test_routing_contracts tests.test_ability_preservation -v
```

Expected: all ability items remain, all seven routing examples select one primary Skill, and secondary loading is gated by confirmation.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- '*.md' tooling/ability-contracts.json tests/test_routing_contracts.py tests/test_ability_preservation.py skills
git commit -m "refactor: clarify routes and compress seven skills"
```

---

### Task 3: Deterministic Excel and HTML renderer

**Files:**
- Create: `tooling/report-schema.json`
- Create: `tooling/test_case_renderer.py`
- Create: `tooling/templates/test-case-report.html`
- Create: `tests/fixtures/sample-report.json`
- Create: `tests/test_case_renderer.py`
- Create: `requirements.txt`

**Interfaces:**
- Consumes: one UTF-8 JSON report containing `title`, `report_id`, `skill_invocation`, and ordered `sheets`.
- Produces: `validate_report(data: dict) -> None`, `build_report_id(data: dict) -> str`, `render_xlsx(data: dict, path: Path) -> Path`, `render_html(data: dict, path: Path) -> Path`, and CLI `python scripts/render_test_assets.py --input REPORT.json --output-dir DIR --basename NAME`.
- A sheet has `name`, `kind`, `columns`, and `rows`; only `kind: test_cases` receives execution controls.

- [ ] **Step 1: Write the report fixture and failing renderer tests**

The fixture must contain an overview sheet, a ten-column test-case sheet with a module separator and four normal cases, and one supplementary risk sheet. Tests must check schema rejection, deterministic report ID, both output files, exact sheet/row counts, and no dropdown on the module separator.

```python
STATUSES = ["未执行", "通过", "不通过", "待定"]

class RendererTest(unittest.TestCase):
    def test_render_both_formats_from_same_report(self):
        data = json.loads(FIXTURE.read_text(encoding="utf-8"))
        xlsx = render_xlsx(data, self.out / "sample.xlsx")
        html = render_html(data, self.out / "sample.html")
        self.assertTrue(xlsx.exists())
        self.assertTrue(html.exists())
```

- [ ] **Step 2: Verify RED**

```powershell
python -m unittest tests.test_case_renderer -v
```

Expected: missing renderer module and schema failures.

- [ ] **Step 3: Implement schema validation and report identity**

Require the exact test-case columns, exact status values, unique case IDs, valid P0/P1/P2 priorities, and optional notes for every status including `待定`. Build the local-storage key from Skill, project/module, UTC generation time, and a SHA-256 content digest.

- [ ] **Step 4: Implement Excel rendering**

Use openpyxl. Create the overview and all declared sheets, apply the shared professional theme, freeze headers, add filters, wrap text, and add data validation to non-divider test rows in the execution-result column.

Conditional formatting order over the full test row:

```text
不通过 -> pale red, stop if true
待定   -> pale gray, stop if true
通过   -> no status fill
未执行 -> no status fill
```

Preserve module and priority fills for `通过` and `未执行`. Do not use macros or Microsoft 365-only functions.

- [ ] **Step 5: Implement self-contained HTML rendering**

Inline CSS, JavaScript, and data. Provide search, module filter, priority filter, status filter, sticky headers, live four-status counts, dropdowns, status row colors, and localStorage persistence. Make zero external network requests.

Feature-detect localStorage. When unavailable, display `浏览器未允许本地保存，本次状态仅在当前页面有效` and keep the page functional.

- [ ] **Step 6: Run renderer tests and inspect workbook metadata**

```powershell
python -m unittest tests.test_case_renderer -v
python tooling/test_case_renderer.py --input tests/fixtures/sample-report.json --output-dir build/test-output --basename sample
```

Expected: `sample.xlsx` and `sample.html` exist; openpyxl reloads the workbook; validation and conditional-formatting collections are non-empty.

- [ ] **Step 7: Commit Task 3**

```powershell
git add tooling tests/fixtures tests/test_case_renderer.py requirements.txt
git commit -m "feat: generate interactive Excel and HTML test reports"
```

---

### Task 4: Browser behavior and package-local output integration

**Files:**
- Modify: `tooling/build_skills.py`
- Modify: the five case-generating Chinese sources
- Create: `tests/html_behavior.test.mjs`
- Create: `package.json`
- Modify: generated `skills/*`

**Interfaces:**
- Consumes: Task 3 renderer and the manifest `case_output` flag.
- Produces: package-local `scripts/render_test_assets.py`, HTML template assets if the renderer does not embed them, and verified Skill instructions for creating one JSON report and both files.

- [ ] **Step 1: Write failing package integration tests**

Assert the five case-generating packages contain the renderer, the audit and clarification packages do not, and each generating `SKILL.md` states that an explicit file request creates both formats.

- [ ] **Step 2: Add renderer copy rules to the atomic builder**

Copy the canonical renderer into each of the five packages during build. Generated packages must remain self-contained after installing only their `skills/<slug>` path.

- [ ] **Step 3: Add the report JSON contract to five sources**

Specify the exact CLI and schema location. The Skill creates one report JSON, runs one renderer command, verifies both outputs, and returns two links. It must not claim success when only one file exists.

- [ ] **Step 4: Write Playwright behavior tests**

Use bundled or installed Playwright to open the generated HTML and assert:

```javascript
await statusSelect.selectOption('不通过');
await expectRowClass('status-failed');
await statusSelect.selectOption('待定');
await expectRowClass('status-pending');
await page.reload();
await expectSelectedStatus('待定');
```

Also verify search, module/priority/status filters, sticky header CSS, live counts, unique storage keys for two reports, and zero network requests.

- [ ] **Step 5: Run package and browser tests**

```powershell
python tooling/build_skills.py
python -m unittest tests.test_build_skills tests.test_case_renderer -v
node tests/html_behavior.test.mjs
```

Expected: five renderer-bearing packages, two non-renderer packages, and all browser assertions pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add tooling tests package.json skills -- '*.md'
git commit -m "feat: integrate dual-format output into five skills"
```

---

### Task 5: Public repository, CI, installation, and CC Switch

**Files:**
- Modify: `README.md`
- Create: `LICENSE`
- Create: `.github/workflows/validate-skills.yml`
- Create: `tests/test_readme_and_packages.py`
- Create: `scripts/install-all.ps1` only if verified `npx skills` cannot install all packages natively
- Create: `scripts/install-all.sh` only if verified `npx skills` cannot install all packages natively

**Interfaces:**
- Consumes: seven generated packages and all tests.
- Produces: verified individual install commands, a verified all-install path, CI checks, MIT licensing, and CC Switch acceptance evidence.

- [ ] **Step 1: Write README/package consistency tests**

Assert README mentions all seven slugs exactly once in the install table, every `--path` exists, license is MIT, and compatibility claims include Codex, Claude Code, and CC Switch.

- [ ] **Step 2: Write the Chinese-first README**

Include project overview, badges, seven-Skill table, concise English names/descriptions, individual installs, all-install, primary/secondary rules, Excel/HTML screenshots or verified samples, update/uninstall instructions, development commands, compatibility matrix, and license.

- [ ] **Step 3: Verify official install commands in clean temporary homes**

Run the installed `npx skills` CLI against the local repository or a temporary Git remote using each exact package path. Verify discovered files under isolated Codex and Claude Skill homes. Record the real command output; adjust README syntax to the verified CLI behavior.

- [ ] **Step 4: Determine all-install implementation**

If repository-level `npx skills add Saitamasans/testing-skills` discovers all seven packages, document it. Otherwise create the two repository scripts that execute the seven verified official path installs and stop on the first failure.

- [ ] **Step 5: Validate CC Switch**

Install the seven packages into the local Codex and Claude Skill locations, open CC Switch Skills management, and verify exactly seven names/descriptions are visible with the correct platform states. Save acceptance screenshots under `docs/assets/` only after the UI result is confirmed.

- [ ] **Step 6: Add GitHub Actions**

The workflow must set up Python and Node, install `requirements.txt`, install Playwright Chromium, run builder check, all unittests, browser tests, README/path tests, placeholder scan, `git diff --check`, and fail when generated content differs.

- [ ] **Step 7: Run Task 5 verification**

```powershell
python tooling/build_skills.py --check
python -m unittest discover -s tests -v
node tests/html_behavior.test.mjs
git diff --check
```

Expected: all tests pass; README commands and package paths are verified; CC Switch evidence shows seven Skills.

- [ ] **Step 8: Commit Task 5**

```powershell
git add README.md LICENSE .github scripts docs/assets tests skills
git commit -m "docs: prepare public skill repository"
```

---

### Task 6: One unified regression and release-ready handoff

**Files:**
- Verify: all seven Chinese sources
- Verify: all seven `skills/*` packages
- Verify: generated Excel/HTML fixtures
- Verify: README, LICENSE, workflow, install scripts, and acceptance screenshots
- Create: `docs/release/v1.0.0-verification.md`

**Interfaces:**
- Consumes: Tasks 1–5.
- Produces: one evidence-backed release readiness report; no push or GitHub Release.

- [ ] **Step 1: Run the full local gate once**

```powershell
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest discover -s tests -v
node tests/html_behavior.test.mjs
git diff 9f765cc --check
git status --short
```

Expected: zero failures, zero generated drift, zero diff-check errors, and a clean worktree after committing the report.

- [ ] **Step 2: Inspect five Excel and five HTML samples**

Verify exact counts, dropdown values, conditional colors, original color preservation, filters, status statistics, local persistence, storage isolation, and offline behavior. Record sample filenames and SHA-256 values.

- [ ] **Step 3: Run the route and ability regression once**

Run the fixed route table and ability-contract tests. Do not launch repeated per-file review loops. Any Critical or Important failure is fixed in one consolidated pass and the full gate is rerun once.

- [ ] **Step 4: Write release verification report**

Record seven package names, source/package hashes, line counts and justified exceptions, test counts, install commands, Codex/Claude locations, CC Switch result, sample artifact paths, and the statement that no push or Release occurred.

- [ ] **Step 5: Commit the verification report**

```powershell
git add docs/release/v1.0.0-verification.md
git commit -m "test: verify v1.0.0 skill release"
```

- [ ] **Step 6: Stop for user review**

Present the local branch, commits, test evidence, screenshots, Excel/HTML samples, and README. Wait for the user's separate instruction before pushing `Saitamasans/testing-skills`, tagging `v1.0.0`, or creating a GitHub Release.
