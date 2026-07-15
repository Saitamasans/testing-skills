# One-Command Runner Bootstrap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Make web-api-test-execution-evidence installable with one public Skill command and able to prepare its locked Runner automatically, then execute interactive Web tests in a visible browser.

**Architecture:** Add a Node.js bootstrap launcher and pinned release manifest to the Skill. The launcher downloads one SHA-256-locked GitHub Release tarball containing the Runner and bundled production dependencies, installs it into a versioned user cache without npm login, installs Chromium only for Web actions, and forwards Runner commands. Interactive Runner execution opens a visible browser with trace capture; CI remains headless.

**Tech Stack:** Node.js 20+, npm packaging, TypeScript, Playwright, Python Skill builder/tests, GitHub Releases, skills CLI 1.5.x-compatible selectors.

## Global Constraints

- Preserve all seven original Skill names, responsibilities, source filenames, and writing habits.
- Keep the eighth canonical name web-api-test-execution-evidence.
- Public users run one Skill installation command and no manual Runner/npm installation command.
- Public users do not need an npm account or npm login.
- First bootstrap prints source, fixed version, cache path, estimated size, and browser source before downloading automatically.
- Runner stays at version 1.0.0 because no public Runner release exists yet.
- Runner and bundled dependencies come from a fixed GitHub Release asset verified by SHA-256.
- Interactive Web execution defaults to visible Chromium with slowMo 200; CI is headless.
- Interactive execution never silently falls back to headless.
- API-only execution does not install or launch Chromium.
- Existing approval, target, credential, redaction, database-readonly, cleanup, and report consistency gates remain mandatory.
- run-result.json remains the only business-verdict source.
- Follow RED-GREEN-REFACTOR and commit after every independently testable task.

---

## File Map

Create:

- skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs: manifest validation, download, hash, cache lock, local install, browser preparation, and forwarding.
- skill-sources/web-api-test-execution-evidence/scripts/testing-runner.mjs: installed launcher entry point.
- skill-sources/web-api-test-execution-evidence/assets/runner-release.json: generated fixed Runner release metadata.
- packages/testing-runner/src/runtime/browser-session.ts: visible/headless policy and trace lifecycle.
- packages/testing-runner/tests/browser-session.test.ts: browser-mode tests.
- packages/testing-runner/scripts/package-release.mjs: bundled release builder and checksum writer.
- tests/runner-bootstrap.test.mjs: bootstrap behavior tests.
- tests/runner-release-package.test.mjs: release archive tests.

Modify:

- tooling/build_skills.py and tests/test_build_skills.py.
- tests/test_execution_skill_contracts.py and tests/test_readme_and_packages.py.
- package.json and packages/testing-runner/package.json.
- packages/testing-runner/src/commands/run.ts and packages/testing-runner/src/cli.ts.
- packages/testing-runner/tests/cli.test.ts.
- skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md.
- README.md, scripts/install-all.ps1, scripts/install-all.sh.
- .github/workflows/validate-runner.yml.
- docs/release/v1.1.0-execution-skill-verification.md.

---

### Task 1: Correct Public Skill Installation Syntax

**Files:**
- Modify: tests/test_readme_and_packages.py
- Modify: README.md
- Modify: scripts/install-all.ps1
- Modify: scripts/install-all.sh

**Interfaces:**
- Consumes: skills CLI selector owner/repo@skill-name.
- Produces: npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y.

- [ ] **Step 1: Write the failing contract**

~~~python
def test_single_skill_commands_use_supported_selector(self):
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    scripts = "\n".join([
        (ROOT / "scripts/install-all.ps1").read_text(encoding="utf-8"),
        (ROOT / "scripts/install-all.sh").read_text(encoding="utf-8"),
    ])
    self.assertNotIn("--path", readme + scripts)
    self.assertIn(
        "npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y",
        readme,
    )
    self.assertIn("Saitamasans/testing-skills@$skill", scripts)
~~~

- [ ] **Step 2: Verify RED**

Run: python -m unittest tests.test_readme_and_packages -v  
Expected: FAIL because README and both installers still use --path.

- [ ] **Step 3: Replace unsupported commands**

PowerShell:

~~~powershell
& npx skills add "Saitamasans/testing-skills@$skill" -g -y
~~~

Shell:

~~~bash
npx skills add "Saitamasans/testing-skills@$skill" -g -y
~~~

Replace all eight individual README commands with owner/repo@slug selectors.

- [ ] **Step 4: Verify GREEN**

Run: python -m unittest tests.test_readme_and_packages -v  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add README.md scripts/install-all.ps1 scripts/install-all.sh tests/test_readme_and_packages.py
git commit -m "fix: use supported single-skill installer syntax"
~~~

### Task 2: Build the Bootstrap Core

**Files:**
- Create: tests/runner-bootstrap.test.mjs
- Create: skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs
- Modify: package.json

**Interfaces:**
- Produces validateReleaseManifest(value), resolveRuntimePaths(manifest, env), renderBootstrapNotice(manifest, paths), ensureRunnerRuntime(options), prepareBrowserForCommand(options), and forwardRunnerCommand(options).
- ensureRunnerRuntime returns { cliPath, cacheHit, runtimeDir }.
- External effects enter through fetchImpl, runProcess, log, and env parameters.

- [ ] **Step 1: Write failing tests**

~~~javascript
test("first bootstrap announces, downloads, verifies, and installs once", async () => {
  const result = await ensureRunnerRuntime(fixtureOptions());
  assert.equal(result.cacheHit, false);
  assert.equal(downloads, 1);
  assert.match(logs.join("\n"), /Runner 1\.0\.0/);
  assert.match(logs.join("\n"), /GitHub Release/);
  assert.match(logs.join("\n"), /缓存位置/);
});

test("hash mismatch blocks installation", async () => {
  await assert.rejects(
    ensureRunnerRuntime(fixtureOptions({ sha256: "0".repeat(64) })),
    /bootstrap_integrity_failed/,
  );
  assert.equal(installs, 0);
});

test("second bootstrap reuses verified cache", async () => {
  await ensureRunnerRuntime(fixtureOptions());
  const second = await ensureRunnerRuntime(fixtureOptions());
  assert.equal(second.cacheHit, true);
  assert.equal(downloads, 1);
});
~~~

Also cover invalid URL, Node floor, partial-cache recovery, concurrent lock, absent npm auth, and environment-value redaction.

- [ ] **Step 2: Verify RED**

Run: node --test tests/runner-bootstrap.test.mjs  
Expected: FAIL because runner-bootstrap-lib.mjs does not exist.

- [ ] **Step 3: Implement with Node built-ins only**

Validate this shape:

~~~javascript
{
  schema_version: 1,
  runner: {
    name: "@saitamasans/testing-runner",
    version: "1.0.0",
    download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.0.0/saitamasans-testing-runner-1.0.0.tgz",
    sha256: "64 lowercase hexadecimal characters",
    size_bytes: 1,
    minimum_node: 20
  },
  browser: { provider: "playwright", name: "chromium" }
}
~~~

Install the already-downloaded archive only:

~~~javascript
await runProcess(npmCommand, [
  "install", "--prefix", runtimeDir, "--offline", "--ignore-scripts",
  "--no-audit", "--no-fund", archivePath,
], { env: sanitizedEnv });
~~~

Write runtime-ready.json through a temporary file and atomic rename. A cache hit requires matching manifest hash and an existing CLI file.

- [ ] **Step 4: Verify GREEN**

Run: node --test tests/runner-bootstrap.test.mjs  
Expected: all bootstrap tests PASS.

- [ ] **Step 5: Commit**

~~~bash
git add package.json tests/runner-bootstrap.test.mjs skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs
git commit -m "feat: add verified runner bootstrap core"
~~~

### Task 3: Generate the Installed Launcher

**Files:**
- Create: skill-sources/web-api-test-execution-evidence/scripts/testing-runner.mjs
- Modify: tooling/build_skills.py
- Modify: tests/test_build_skills.py
- Modify: tests/test_execution_skill_contracts.py

**Interfaces:**
- Launcher resolves ../assets/runner-release.json, prepares runtime, prepares Chromium for Web run commands, and forwards Runner arguments.
- Builder copies source scripts and assets recursively and byte-for-byte only for the eighth Skill.

- [ ] **Step 1: Write failing resource tests**

~~~python
def test_execution_skill_bundles_launcher_resources(self):
    package = ROOT / "skills/web-api-test-execution-evidence"
    for relative in [
        "scripts/testing-runner.mjs",
        "scripts/runner-bootstrap-lib.mjs",
    ]:
        self.assertEqual(
            (ROOT / "skill-sources/web-api-test-execution-evidence" / relative).read_bytes(),
            (package / relative).read_bytes(),
        )
~~~

- [ ] **Step 2: Verify RED**

Run: python -m unittest tests.test_build_skills tests.test_execution_skill_contracts -v  
Expected: FAIL because the launcher is missing and builder ignores resource directories.

- [ ] **Step 3: Implement launcher and resource copy**

Launcher:

~~~javascript
const skillRoot = fileURLToPath(new URL("..", import.meta.url));
const manifestPath = process.env.TESTING_RUNNER_RELEASE_MANIFEST
  ?? path.join(skillRoot, "assets", "runner-release.json");
const runtime = await ensureRunnerRuntime({ manifestPath, env: process.env, log: console.error });
await prepareBrowserForCommand({ cliPath: runtime.cliPath, args: process.argv.slice(2), env: process.env });
process.exitCode = await forwardRunnerCommand({
  cliPath: runtime.cliPath,
  args: process.argv.slice(2),
  env: process.env,
});
~~~

Builder copies every regular file below source scripts and assets, rejects symlinks, and includes them in --check drift detection.

- [ ] **Step 4: Verify GREEN**

~~~bash
python tooling/build_skills.py
python tooling/build_skills.py --check
python -m unittest tests.test_build_skills tests.test_execution_skill_contracts -v
~~~

Expected: generated launcher files match source and tests PASS.

- [ ] **Step 5: Commit**

~~~bash
git add tooling/build_skills.py tests/test_build_skills.py tests/test_execution_skill_contracts.py skill-sources/web-api-test-execution-evidence/scripts skills/web-api-test-execution-evidence/scripts
git commit -m "feat: bundle runner launcher with execution skill"
~~~

### Task 4: Package Runner with Bundled Dependencies

**Files:**
- Create: packages/testing-runner/scripts/package-release.mjs
- Create: tests/runner-release-package.test.mjs
- Modify: packages/testing-runner/package.json
- Modify: package.json
- Modify: .gitignore

**Interfaces:**
- Produces build/releases/saitamasans-testing-runner-1.0.0.tgz and adjacent .sha256.
- Archive contains dist, vendor, examples, and production trees for ajv, commander, exceljs, node-sql-parser, and playwright.

- [ ] **Step 1: Write failing package test**

~~~javascript
test("release includes runner and bundled dependencies", async () => {
  const release = await buildReleaseTarball(tempDirectory);
  const entries = await listTarEntries(release.archivePath);
  assert(entries.includes("package/dist/cli.js"));
  assert(entries.includes("package/node_modules/playwright/package.json"));
  assert(entries.includes("package/node_modules/ajv/package.json"));
  assert.equal(await sha256File(release.archivePath), release.sha256);
});
~~~

- [ ] **Step 2: Verify RED**

Run: node --test tests/runner-release-package.test.mjs  
Expected: FAIL because the packer and bundled dependencies are absent.

- [ ] **Step 3: Implement deterministic packaging**

Add bundledDependencies for all five production dependencies. package-release.mjs removes an older same-version archive, builds Runner, executes npm pack --json --pack-destination, renames the single output deterministically, computes SHA-256, and writes a newline-terminated checksum file.

- [ ] **Step 4: Verify GREEN**

~~~bash
npm run build:runner
node --test tests/runner-release-package.test.mjs
npm run pack:runner-release
~~~

Expected: PASS and both release files exist below ignored build/releases.

- [ ] **Step 5: Commit**

~~~bash
git add package.json packages/testing-runner/package.json packages/testing-runner/scripts/package-release.mjs tests/runner-release-package.test.mjs .gitignore
git commit -m "build: package runner with locked dependencies"
~~~

### Task 5: Make Interactive Web Execution Visible

**Files:**
- Create: packages/testing-runner/src/runtime/browser-session.ts
- Create: packages/testing-runner/tests/browser-session.test.ts
- Modify: packages/testing-runner/src/commands/run.ts
- Modify: packages/testing-runner/src/cli.ts
- Modify: packages/testing-runner/tests/cli.test.ts

**Interfaces:**
- Produces resolveBrowserSettings({ mode, visibility, slowMo }) and openBrowserSession({ manifest, mode, visibility, slowMo, outputDir }).
- visibility is auto, visible, or headless.
- auto means visible for interactive and headless for CI.
- openBrowserSession returns undefined for API-only, otherwise { page, close }.

- [ ] **Step 1: Write failing visibility tests**

~~~typescript
test("interactive auto is visible with 200ms slow motion", () => {
  assert.deepEqual(resolveBrowserSettings({ mode: "interactive", visibility: "auto" }), {
    headless: false,
    slowMo: 200,
  });
});

test("ci auto is headless", () => {
  assert.deepEqual(resolveBrowserSettings({ mode: "ci", visibility: "auto" }), {
    headless: true,
    slowMo: 0,
  });
});

test("api-only does not launch a browser", async () => {
  assert.equal(await openBrowserSession({
    manifest: apiManifest,
    mode: "interactive",
    visibility: "auto",
    outputDir,
  }), undefined);
});
~~~

Add CLI propagation tests for --browser visible --slow-mo 350 and invalid values.

- [ ] **Step 2: Verify RED**

Run: npm test --workspace @saitamasans/testing-runner -- browser-session.test.ts cli.test.ts  
Expected: FAIL because module and flags do not exist.

- [ ] **Step 3: Implement session and trace**

~~~typescript
const browser = await chromium.launch({
  headless: settings.headless,
  slowMo: settings.slowMo,
});
const context = await browser.newContext();
await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
const page = await context.newPage();
~~~

close() stops tracing to outputDir/evidence/playwright-trace.zip and closes context/browser in finally. A visible launch error becomes browser_visible_launch_failed and is never retried headless.

- [ ] **Step 4: Verify GREEN**

Run: npm test --workspace @saitamasans/testing-runner -- browser-session.test.ts cli.test.ts web-api-actions.test.ts  
Expected: PASS.

- [ ] **Step 5: Commit**

~~~bash
git add packages/testing-runner/src/runtime/browser-session.ts packages/testing-runner/src/commands/run.ts packages/testing-runner/src/cli.ts packages/testing-runner/tests/browser-session.test.ts packages/testing-runner/tests/cli.test.ts
git commit -m "feat: show interactive browser execution"
~~~

### Task 6: Replace Manual Runner Instructions

**Files:**
- Create: skill-sources/web-api-test-execution-evidence/assets/runner-release.json through the release builder.
- Modify: skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md
- Modify: tests/test_execution_skill_contracts.py
- Modify: README.md
- Modify: .github/workflows/validate-runner.yml
- Regenerate: skills/web-api-test-execution-evidence/**

**Interfaces:**
- Skill resolves its own installed root and runs node ABSOLUTE_SKILL_ROOT/scripts/testing-runner.mjs.
- Public text contains no npm install @saitamasans/testing-runner and no npx @saitamasans/testing-runner.

- [ ] **Step 1: Write failing Skill contracts**

~~~python
def test_execution_skill_uses_automatic_bootstrap_only(self):
    combined = self.text + self.generated_text + (ROOT / "README.md").read_text(encoding="utf-8")
    self.assertIn("scripts/testing-runner.mjs", combined)
    self.assertIn("首次运行", combined)
    self.assertIn("自动下载", combined)
    self.assertIn("无需 npm 账号", combined)
    self.assertNotIn("npm install --save-dev @saitamasans/testing-runner", combined)
    self.assertNotIn("npx @saitamasans/testing-runner", combined)
~~~

- [ ] **Step 2: Verify RED**

Run: python -m unittest tests.test_execution_skill_contracts tests.test_readme_and_packages -v  
Expected: FAIL because public text still requires manual Runner installation.

- [ ] **Step 3: Build release archive and exact manifest**

Run npm run pack:runner-release. package-release.mjs writes runner-release.json with the exact public URL, SHA-256, byte size, Node floor, and Chromium metadata. It rejects missing archives and invalid hashes.

- [ ] **Step 4: Update source Skill and README**

Add the exact first-run notice and launcher resolution rules. Preserve preparation, mapping confirmation, approval, four statuses, cleanup, and report verification language. Remove public manual Runner commands.

- [ ] **Step 5: Regenerate and verify GREEN**

~~~bash
python tooling/build_skills.py
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest tests.test_execution_skill_contracts tests.test_readme_and_packages tests.test_build_skills -v
~~~

Expected: PASS; generated Skill contains launcher, library, and exact release manifest.

- [ ] **Step 6: Commit**

~~~bash
git add README.md .github/workflows/validate-runner.yml skill-sources/web-api-test-execution-evidence skills/web-api-test-execution-evidence tests/test_execution_skill_contracts.py
git commit -m "feat: bootstrap runner from installed skill"
~~~

### Task 7: Verify and Publish GitHub Release

**Files:**
- Modify: docs/release/v1.1.0-execution-skill-verification.md
- Output only: build/releases/saitamasans-testing-runner-1.0.0.tgz
- Output only: build/releases/saitamasans-testing-runner-1.0.0.tgz.sha256

**Interfaces:**
- Produces public tag/release testing-runner-v1.0.0 with two assets.

- [ ] **Step 1: Run complete pre-release verification**

~~~bash
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest discover -s tests -v
npm run build:runner
npm run test:runner
node --test tests/test-case-renderer.test.mjs tests/html_behavior.test.mjs tests/runner-bootstrap.test.mjs tests/runner-release-package.test.mjs
npm run pack:runner-release
git diff --check
~~~

Expected: zero failures and generated manifest hash matches the archive.

- [ ] **Step 2: Record evidence and commit**

Record exact test counts, archive size, SHA-256, and date.

~~~bash
git add docs/release/v1.1.0-execution-skill-verification.md
git commit -m "docs: record one-command runner verification"
~~~

- [ ] **Step 3: Push branch and tag**

~~~bash
git push -u origin codex/one-command-runner-bootstrap
git tag testing-runner-v1.0.0
git push origin testing-runner-v1.0.0
~~~

- [ ] **Step 4: Create public Release**

~~~bash
gh release create testing-runner-v1.0.0 build/releases/saitamasans-testing-runner-1.0.0.tgz build/releases/saitamasans-testing-runner-1.0.0.tgz.sha256 --repo Saitamasans/testing-skills --title "Testing Runner v1.0.0" --notes "Pinned runtime for web-api-test-execution-evidence. Installs automatically from the Skill launcher."
~~~

- [ ] **Step 5: Verify remote bytes**

Download the release asset into a fresh directory. Its SHA-256 must match the checksum asset and runner-release.json.

### Task 8: Perform Visible Clean-Room Self-Test

**Files:**
- Reuse: build/e2e-self-test fixture generator and Todo app.
- Output only: build/e2e-one-command clean home, cache, reports, screenshots, and trace.

**Interfaces:**
- Consumes public tagged Skill and GitHub Release only.
- Produces proof that no local Runner repository path or npm login is used.

- [ ] **Step 1: Isolate the environment**

Set HOME, USERPROFILE, CODEX_HOME, XDG_STATE_HOME, and TESTING_SKILLS_HOME below build/e2e-one-command/clean-home. Remove npm auth environment variables from the test process.

- [ ] **Step 2: Install exactly one tagged Skill**

~~~powershell
npx skills add "Saitamasans/testing-skills#testing-runner-v1.0.0@web-api-test-execution-evidence" -g -y
~~~

Expected: only the eighth Skill is installed with scripts and assets.

- [ ] **Step 3: Start Todo Web/API fixture and generate inputs**

Generate three standard ten-column cases and execution-profile.json without local Runner paths.

- [ ] **Step 4: Run plan and verify first-run notice**

Invoke the installed launcher absolute path. Output must name Runner 1.0.0, GitHub Release, cache path, estimated size, and automatic download. Cache contains the hashed release and no npm credentials.

- [ ] **Step 5: Approve and run visibly**

Tell the user a Chromium window will open. Run with --mode interactive --browser visible --slow-mo 200. The user must see the Todo page open, create an item, query it, and toggle status.

- [ ] **Step 6: Verify evidence**

All three cases are 通过, run_status is completed, verify-report exits 0, and these files exist:

~~~text
result.xlsx
result.html
run-result.json
run-events.jsonl
evidence/playwright-trace.zip
~~~

- [ ] **Step 7: Prove cache reuse**

Run again. It must report cache hit, perform zero Runner downloads, and not reinstall Chromium.

### Task 9: Merge Main and Re-test Exact Public Command

**Files:**
- No new implementation files.

**Interfaces:**
- Produces GitHub main with one-command Skill and final external proof.

- [ ] **Step 1: Re-run the complete Task 7 suite**

Expected: zero failures and clean git status.

- [ ] **Step 2: Merge with branch-completion workflow**

Update main, merge codex/one-command-runner-bootstrap while preserving remote README changes, run the complete suite on the merge result, and push main.

- [ ] **Step 3: Test exact main command in a second clean home**

~~~powershell
npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y
~~~

Expected: one Skill installed, automatic Runner preparation succeeds, and no npm login/manual Runner command appears.

- [ ] **Step 4: Verify remote contents**

GitHub main must contain SKILL.md, scripts/testing-runner.mjs, scripts/runner-bootstrap-lib.mjs, assets/runner-release.json, agents, and references. Release assets remain downloadable and match SHA-256.

- [ ] **Step 5: Final handoff**

Report the public command, first-run behavior, visible execution behavior, test totals, Release URL, and clean-room evidence directory. Do not claim completion before these checks pass.

