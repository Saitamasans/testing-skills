# Eighth Skill Complete Installation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a Windows installation flow for `web-api-test-execution-evidence` that installs and verifies the Skill, portable Node.js, Runner, and Playwright Chromium before claiming readiness, while prohibiting dependency downloads during test execution.

**Architecture:** A checked-in runtime lock defines exact versions and hashes. Release CI builds an architecture-specific complete ZIP and manifest. A PowerShell installer downloads that immutable ZIP with visible resume/retry progress, verifies and stages it, runs a local smoke test, atomically activates it, and writes the installation receipt last. The installed Skill launcher only verifies the receipt and starts the bundled Runner.

**Tech Stack:** PowerShell 5.1, Node.js ESM, Playwright 1.61.1, portable Node.js 22.23.1, GitHub Actions, Node test runner, Python unittest.

## Global Constraints

- There is no lightweight, API-only, browser-optional, or deferred dependency installation.
- The installer success text is exactly `安装完成，可以执行 Web/API 自动化测试` and appears only after the full smoke test succeeds.
- Test execution never downloads Node.js, Runner, Playwright, or Chromium.
- The public launcher and installer use immutable versioned Release URLs; no installed or public launcher executes a script from the mutable `main` branch.
- The release bootstrap has an anchored trust chain: the generated public CMD embeds the installer SHA-256, and the verified installer embeds each architecture-specific companion manifest SHA-256.
- The canonical receipt path is `%USERPROFILE%\.testing-skills\installations\web-api-test-execution-evidence.json`; it is the only activation commit point and is written atomically last.
- Runner is released as the new immutable 1.1.2 artifact with SHA-256 `0db2c917eaf786fa9c03bacc9f33a058ef8a9b429bc111772c7833f82c664a07` and size `22769464` bytes; the public Release bytes must match exactly.
- Playwright is pinned exactly to 1.61.1. Chromium 1228 uses the fixed Windows `chrome-win64.zip` archive (`192511857` bytes, SHA-256 `ebc0c2b75e2ea98151a7f18ff47037bfcbab44a8660e79b9ffa6520f9b7607ab`); headless shell 1228 uses `chrome-headless-shell-win64.zip` (`119099822` bytes, SHA-256 `5cfda0c763aa6a867ce2efad0c467e3220e9c5c01c4cba02fd57afe49ede5457`); FFmpeg 1011 uses `ffmpeg-win64.zip` (`1411741` bytes, SHA-256 `8d08827c019ad36e7b9d49d3648447d884534cb2acf200e71c715f6dd834cc50`). Windows ARM64 bundles intentionally use Playwright's supported win64 browser archives under x64 emulation; no unverified ARM64 Chrome URL is invented, and the native ARM64 release job must prove the browser starts.
- Portable Node.js is pinned to 22.23.1. Windows x64 SHA-256 is `7df0bc9375723f4a86b3aa1b7cc73342423d9677a8df4538aca31a049e309c29`; Windows ARM64 SHA-256 is `b470fdfe3502c05151656e06d495e3f47544f2ee8b1d9c8705090f2dd5996bd0`.
- Existing unrelated dirty-worktree changes are preserved and excluded from task commits.

---

### Task 1: Lock the complete runtime contract

**Files:**
- Create: `packages/testing-runner/release/windows-runtime-lock.json`
- Modify: `packages/testing-runner/package.json`
- Create: `tests/windows-runtime-lock.test.mjs`

**Interfaces:**
- Produces: schema version 1 runtime lock consumed by bundle builder, installer tests, CI, and installed runtime verifier.

- [ ] **Step 1: Write the failing lock-contract test**

Assert exact Node per-architecture URLs/hashes, Runner identity/hash/size, Playwright 1.61.1, Chromium/headless-shell revision 1228, FFmpeg revision 1011, release tag, and absence of semver range prefixes in both package manifests.

- [ ] **Step 2: Run the focused test and observe failure**

Run: `node --test tests/windows-runtime-lock.test.mjs`

Expected: failure because `windows-runtime-lock.json` does not exist and Playwright is still declared as `^1.52.0`.

- [ ] **Step 3: Add the lock and pin Playwright**

The lock exposes:

```json
{
  "schema_version": 1,
  "bundle_version": "1.0.0",
  "release_tag": "web-api-test-execution-evidence-v1.0.0",
  "node": { "version": "22.23.1", "windows": { "x64": {}, "arm64": {} } },
  "runner": { "version": "1.1.2", "size_bytes": 22769464, "sha256": "0db2...4a07" },
  "playwright": { "version": "1.61.1", "chromium_revision": "1228", "chromium_headless_shell_revision": "1228", "ffmpeg_revision": "1011", "archives": { "windows": {} } }
}
```

Set both root and Runner `package.json` Playwright declarations to `1.61.1` and refresh only the corresponding lockfile metadata.

- [ ] **Step 4: Run lock tests**

Expected: exact-version and architecture assertions pass.

- [ ] **Step 5: Commit only Task 1 files**

Commit: `build: lock complete eighth skill runtime`

### Task 2: Build deterministic complete Windows bundles

**Files:**
- Create: `packages/testing-runner/scripts/windows-bundle-lib.mjs`
- Create: `packages/testing-runner/scripts/build-windows-bundle.mjs`
- Create: `packages/testing-runner/scripts/installation-smoke-test.mjs`
- Create: `packages/testing-runner/assets/installation-smoke-fixture.html`
- Create: `tests/windows-bundle-package.test.mjs`
- Modify: `packages/testing-runner/src/reporting/report-projector.ts`
- Modify: `packages/testing-runner/src/commands/run.ts`
- Modify: `packages/testing-runner/tests/report-projection.test.ts`
- Modify: `packages/testing-runner/tests/report-consistency.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: runtime lock from Task 1 and generated Skill package.
- Produces: `web-api-test-execution-evidence-1.0.0-windows-<arch>.zip`, companion manifest, SHA-256 list, and bundled smoke-test program.

- [ ] **Step 1: Write failing bundle layout and manifest tests**

Use a small temporary fake Node/Runner/browser tree. Assert normalized bundle paths, path traversal/reparse-point/duplicate-case path rejection, per-file size/SHA-256 inventory, exact component metadata, companion-manifest-to-payload-manifest binding, bundle SHA-256, and required smoke fixture.

- [ ] **Step 2: Run focused tests and observe missing module failure**

Run: `node --test tests/windows-bundle-package.test.mjs`

- [ ] **Step 3: Implement pure bundle inventory and validation functions**

Export `validateRuntimeLock(value)`, `inventoryTree(root)`, `validateBundleLayout(root, lock, arch)`, and `writeBundleManifest(input)` from `windows-bundle-lib.mjs`.

- [ ] **Step 4: Implement the release builder**

The builder verifies the portable Node ZIP against the checked-in SHA, downloads/verifies the already-published immutable Runner 1.1.2 tarball, rejects a Runner whose internal Playwright identity is not exactly 1.61.1 with browser revisions 1228/1228/1011, verifies each locked browser archive before extraction, copies the generated Skill, adds smoke assets, emits the internal per-file payload manifest, creates the ZIP, and emits a separate companion manifest with ZIP and payload-manifest hashes. Network and process operations are injectable for unit tests.

- [ ] **Step 5: Implement local deterministic smoke test**

The smoke program starts a loopback-only HTTP fixture server, verifies Node/Runner/dependencies, launches bundled Chromium visibly, writes PNG and Trace, and executes a locked one-case R0 manifest whose explicit assertion is visible text `Bundle Smoke Ready`. It validates matching case ID, status, per-assertion outcome, PNG evidence path/hash, and Trace existence across Runner outputs, writes `smoke-result.json`, and exits nonzero on any mismatch or external request.

- [ ] **Step 6: Project assertion and evidence outcomes consistently**

Extend the Runner report model so Excel, HTML, projected JSON, and `run-result.json` expose the same assertion outcome and PNG evidence reference. Finalize Trace before final artifact projection so its reference can be represented consistently without treating Trace existence as a business assertion.

- [ ] **Step 7: Run bundle and existing Runner package tests**

Run: `node --test tests/windows-bundle-package.test.mjs tests/runner-release-package.test.mjs`

- [ ] **Step 8: Commit only Task 2 files**

Commit: `build: package complete Windows execution runtime`

### Task 3: Implement resumable visible atomic installation

**Files:**
- Create: `scripts/install-web-api-test-execution-evidence.ps1`
- Modify: `scripts/install.ps1`
- Modify: `installers/install-web-api-test-execution-evidence.cmd`
- Modify: `installers/install-all.cmd`
- Create: `tests/test_complete_execution_installer.py`
- Modify: `tests/test_install_no_node.py`
- Modify: `tests/test_windows_cmd_launchers.py`

**Interfaces:**
- Consumes: release manifest and complete bundle from Task 2.
- Produces: installed Skill, versioned runtime, diagnostics, and `installation-receipt.json`.

- [ ] **Step 1: Write failing installer contract tests**

Cover architecture selection, free-space rejection, HTTP range resume, 200/206/416 behavior, strict `Content-Range`, ETag/Last-Modified partial metadata, retry accounting, redirects, proxy/TLS behavior, concurrent-install lock, size/hash rejection, persistent `.part` preservation, ZIP traversal/reparse rejection, path-length checks, staging cleanup, injected activation failures, previous-install preservation, receipt-last semantics, `-Repair`, `-Force`, exact success wording, and no dependence on PATH Node/npm/Git.

- [ ] **Step 2: Run focused Python tests and observe failures**

Run: `python -m unittest tests.test_complete_execution_installer tests.test_windows_cmd_launchers -v`

- [ ] **Step 3: Implement the dedicated complete installer**

Use PowerShell 5.1-compatible `HttpWebRequest.AddRange()` streaming. Emit progress fields for current artifact, total bytes, downloaded bytes, percent, bytes/sec, ETA, retry count, and resume offset. Cache untrusted partial bytes plus ETag/Last-Modified metadata by bundle version and architecture; trust them only after the final full size/SHA-256 check. Require exact 206 `Content-Range`; restart explicitly on 200; accept 416 only when the completed file passes final verification. Validate every redirect as HTTPS, cap writes at expected size, verify the companion and payload manifests, reject unsafe ZIP entries before extraction, and validate disk permissions/path lengths.

- [ ] **Step 4: Implement atomic activation and repair**

Extract under same-volume staging directories, run bundled smoke test, retain diagnostics, rename immutable versioned runtime into place, stage the stable Skill shim, then atomically replace the canonical receipt in its own directory as the single commit point. On failure, preserve download partials but remove staging and leave the previous receipt, Skill, and runtime launchable. Locked old versions are retained for delayed cleanup.

- [ ] **Step 5: Integrate single and all-Skill entry points**

The generated public `.cmd` verifies the immutable versioned installer script before execution. Generic `install.ps1 -Skill web-api-test-execution-evidence` and `-All` route through the same complete Release path; other seven Skills keep their current small-file installer behavior. `-SourceDirectory` is explicitly developer-only for the eighth Skill and must not print execution-ready success unless a locally supplied verified complete bundle is also provided.

- [ ] **Step 6: Run installer tests**

Expected: mocked complete installs pass with empty PATH and interrupted downloads resume.

- [ ] **Step 7: Commit only Task 3 files**

Commit: `feat: install complete eighth skill runtime`

### Task 4: Remove all execution-time dependency installation

**Files:**
- Create: `skill-sources/web-api-test-execution-evidence/scripts/installed-runtime-lib.mjs`
- Modify: `skill-sources/web-api-test-execution-evidence/scripts/testing-runner.mjs`
- Create: `skill-sources/web-api-test-execution-evidence/scripts/testing-runner.cmd`
- Remove: download behavior from `skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs` while retaining a compatibility error wrapper if needed.
- Modify generated counterparts under `skills/web-api-test-execution-evidence/scripts/` without overwriting unrelated dirty files.
- Create: `tests/installed-runtime.test.mjs`
- Modify: `tests/runner-bootstrap.test.mjs`

**Interfaces:**
- Consumes: installation receipt and versioned runtime from Task 3.
- Produces: verified absolute Runner CLI, Node, and browser paths or deterministic installation error.

- [ ] **Step 1: Write failing no-download launcher tests**

Assert valid receipt launch, missing receipt `installation_incomplete`, tampered file `installation_corrupt`, wrong architecture rejection, fixed `PLAYWRIGHT_BROWSERS_PATH`, bundled Node execution, and zero network/`playwright install` calls for every Runner command.

- [ ] **Step 2: Run tests and observe current bootstrap download behavior failure**

Run: `node --test tests/installed-runtime.test.mjs tests/runner-bootstrap.test.mjs`

- [ ] **Step 3: Implement receipt verifier and launcher**

The Skill `.cmd` resolves the canonical receipt without PATH Node and invokes the bundled `node.exe`. The verifier validates receipt schema, bundle version, architecture, allowed absolute roots, Runner/Playwright/Chromium identity, required file sizes/hashes, and smoke-test marker. It launches the absolute bundled Runner path using a sanitized environment and fixed browser cache.

- [ ] **Step 4: Replace first-run preparation messages with repair instructions**

Errors direct users to rerun the GitHub Release installer with `-Repair`; the launcher never downloads or mutates installation state.

- [ ] **Step 5: Run launcher, generated-Skill, and contract tests**

Run: `node --test tests/installed-runtime.test.mjs tests/runner-bootstrap.test.mjs`

- [ ] **Step 6: Commit only Task 4 files**

Commit: `fix: prohibit runtime downloads during test execution`

### Task 5: Update Skill and user documentation contracts

**Files:**
- Modify: `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md`
- Modify: `README.md`
- Modify: `tests/test_execution_skill_contracts.py`
- Modify: `tests/test_readme_and_packages.py`
- Modify generated `skills/web-api-test-execution-evidence/SKILL.md` only for source-equivalent changes.

**Interfaces:**
- Produces: user-facing installation and execution instructions aligned with implemented behavior.

- [ ] **Step 1: Write failing text-contract tests**

Require the complete installer success contract, repair behavior, execution-time no-download rule, complete Chromium installation, and GitHub Release end-user/source-ZIP developer distinction. Reject “首次运行下载” and browser-optional wording.

- [ ] **Step 2: Run focused contract tests and observe failures**

Run: `python -m unittest tests.test_execution_skill_contracts tests.test_readme_and_packages -v`

- [ ] **Step 3: Update source Skill and README**

Keep test-specific discovery and approval gates unchanged. Change only infrastructure installation, readiness, repair, and launcher guidance.

- [ ] **Step 4: Synchronize generated Skill files carefully**

Generate in a temporary clean copy or patch only affected generated files so unrelated working-tree modifications are preserved.

- [ ] **Step 5: Run documentation contracts and build drift check in a clean index/worktree**

- [ ] **Step 6: Commit only Task 5 files**

Commit: `docs: require install-time execution readiness`

### Task 6: Build, verify, and publish complete GitHub Release assets

**Files:**
- Create: `.github/workflows/publish-eighth-skill-runtime.yml`
- Create: `installers/templates/install-web-api-test-execution-evidence.cmd.in`
- Create: `installers/templates/install-web-api-test-execution-evidence.ps1.in`
- Create: `packages/testing-runner/scripts/render-windows-installers.mjs`
- Modify: `.github/workflows/publish-installers.yml`
- Modify: `.github/workflows/validate-runner.yml`
- Modify: `tests/test_github_install_launchers.py`
- Create: `tests/test_eighth_skill_release_workflow.py`

**Interfaces:**
- Consumes: bundle builder and installer from Tasks 1-5.
- Produces: immutable GitHub Release assets for each supported Windows architecture.

- [ ] **Step 1: Write failing workflow contract tests**

Require clean native-architecture Windows builds, exact lock validation, bundle build, complete installer smoke test under Windows PowerShell 5.1, generated bootstrap hashes, artifact SHA list, release publication only after verification, and upload of generated installer/manifest/bundle assets together.

- [ ] **Step 2: Run focused workflow tests and observe failures**

Run: `python -m unittest tests.test_eighth_skill_release_workflow tests.test_github_install_launchers -v`

- [ ] **Step 3: Add Windows bundle publication workflow**

Use the mandatory native matrix `windows-2025` for x64 and `windows-11-arm` for ARM64. Verify `process.arch`, OS image, and free space in each job. Build from a clean checkout, install exact dependencies from `package-lock.json`, package the exact browser set, execute the installed-bundle smoke test, render the public installer with fixed script/manifest hashes, then publish only when both architectures pass. Create a new draft `web-api-test-execution-evidence-v1.0.0` release, verify its tag commit and complete asset set, then publish it under a protected release environment. Never use `--clobber` for runtime release assets.

- [ ] **Step 4: Make launcher publication depend on complete assets**

Do not publish or update the public eighth-Skill launcher if the complete bundle workflow has not produced matching manifests and hashes.

- [ ] **Step 5: Run full repository verification**

Run bundled Node and Python paths explicitly:

```powershell
node --test tests/*.test.mjs
python -m unittest discover -s tests -v
npm run typecheck --workspace @saitamasans/testing-runner
npm test --workspace @saitamasans/testing-runner
git diff --check
```

- [ ] **Step 6: Perform a local clean-room installer smoke test**

Install from a locally built bundle into temporary empty Skill/runtime roots with PATH excluding Node/npm/Git. Verify the receipt, PNG, Trace, Excel, HTML, JSON, and zero network access during a subsequent Runner invocation.

- [ ] **Step 7: Commit and publish intentionally**

Commit: `ci: publish verified complete eighth skill runtime`

Push the implementation commits only after all local tests pass. Confirm GitHub Actions produces and verifies release assets before calling the public installer ready.
