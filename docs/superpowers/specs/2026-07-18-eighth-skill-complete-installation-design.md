# Eighth Skill Complete Installation Design

**Status:** Proposed for implementation

**Date:** 2026-07-18

## Goal

Installing `web-api-test-execution-evidence` must produce a verified environment that can immediately execute existing Web/API test cases. After installation, a user opens Codex, uploads test cases, invokes the Skill, and enters the normal readiness, discovery, approval, execution, and evidence workflow without downloading Node.js, the Runner, or Chromium.

## User Contract

The end-user distribution is a versioned Windows GitHub Release installer, not the repository source ZIP. The installer may not print `安装完成，可以执行 Web/API 自动化测试` until every required payload is installed and the complete post-install smoke test passes.

Normal execution performs a fast integrity check only. It must not download, update, repair, or substitute a runtime component. Missing or damaged components produce a deterministic `installation_incomplete` error that directs the user to repair the installation.

There is no API-only, browser-optional, minimal, deferred, or lightweight installation mode. Chromium is mandatory because Web execution is a core capability of the Skill.

## Approaches Considered

### A. Keep first-run bootstrap

Keep the current small Skill installer and improve the Runner bootstrap downloader. This preserves a small installer but violates the user contract because test execution can still spend tens of minutes preparing infrastructure. Rejected.

### B. Online installer with separate dependency downloads

Install the Skill, portable Node.js, Runner, and Chromium from separate upstream endpoints. This supports smaller updates but has multiple failure points, depends on GitHub and Playwright CDN behavior, and makes corporate proxy support harder. Retained only as a repair/development fallback, not the primary end-user distribution.

### C. Architecture-specific complete release bundle

Build one signed or checksummed Windows bundle per supported architecture containing the Skill, portable Node.js, the unpacked Runner with production dependencies, and the exact Playwright Chromium revision. A small visible installer downloads this one bundle with resume/retry support, verifies it, installs atomically, and runs the full smoke test. This is the selected design because it minimizes endpoints and makes installation reproducible.

## Release Artifacts

For each supported Windows architecture, the release contains:

- `web-api-test-execution-evidence-<bundle-version>-windows-<arch>.zip`
- `web-api-test-execution-evidence-<bundle-version>-windows-<arch>.manifest.json`
- `install-web-api-test-execution-evidence.cmd`
- `install-web-api-test-execution-evidence.ps1`

The bundle contains:

- the generated `web-api-test-execution-evidence` Skill package;
- a pinned portable Node.js 20+ runtime;
- Runner 1.1.2 and all production dependencies;
- the exact Playwright Chromium, Chromium headless shell, and Playwright FFmpeg revisions required by the bundled Playwright version, each downloaded from a locked HTTPS archive URL with an exact byte size and SHA-256 before safe ZIP extraction;
- a local smoke-test fixture and expected output contract;
- an immutable inner payload manifest.

The ZIP's inner payload manifest locks bundle version, operating system, architecture, Node.js version, Runner version, Playwright version, Chromium/headless-shell/FFmpeg revisions, and every extracted payload size and SHA-256. A separate companion release manifest locks the ZIP size/SHA-256, inner manifest SHA-256, and immutable release URL. This separation avoids a self-hash cycle. Floating semver ranges are forbidden in produced release metadata.

## Installer Flow

1. Detect Windows version and x64 or ARM64 architecture.
2. Check PowerShell, TLS, writable directories, process-launch permission, and required free space calculated from the selected manifest plus a safety margin.
3. Select the matching fixed release manifest and display all payload versions, compressed sizes, installed sizes, destination paths, and total required space.
4. Download to a persistent versioned cache using HTTP range requests. Partial bytes remain untrusted until the final whole-file SHA-256 succeeds. Display current file, transferred bytes, percentage, bytes per second, elapsed time, remaining time, resume offset, and retry count.
5. Retry transient failures with bounded exponential backoff. Preserve verified partial bytes between installer runs. A server that does not honor range requests restarts only the affected artifact and states that explicitly.
6. Verify expected byte size and SHA-256 before extraction.
7. Extract to a staging directory and verify every manifest entry.
8. Run the post-install smoke test from staging.
9. Atomically replace the previous installation only after all checks pass. Preserve the previous verified installation until the replacement is ready.
10. Write `installation-receipt.json` last, then display `安装完成，可以执行 Web/API 自动化测试`.

Cancellation, network failure, hash mismatch, extraction failure, or smoke-test failure must not create or update the receipt. Existing verified installations remain usable after a failed update.

## Installation Locations

- Skill: the selected Codex-compatible Skill root, defaulting to `%USERPROFILE%\.agents\skills\web-api-test-execution-evidence` under the repository's current convention.
- Runtime: `%USERPROFILE%\.testing-skills\runtime\web-api-test-execution-evidence\<bundle-version>`.
- Persistent downloads: `%USERPROFILE%\.testing-skills\downloads\web-api-test-execution-evidence\<bundle-version>`.
- Receipt: `%USERPROFILE%\.testing-skills\installations\web-api-test-execution-evidence.json`.

The installed Skill launcher resolves the receipt and bundled Node.js by absolute path. It does not depend on `PATH`, npm, pnpm, npx, Git, Python, a local Chrome installation, Microsoft Excel, or database client programs.

## Post-Install Smoke Test

The smoke test is local and deterministic. It does not access Baidu or another external test target.

It must verify:

1. bundled Node.js starts and reports the pinned version and architecture;
2. Runner CLI starts and reports Runner 1.1.2;
3. all bundled Runner production dependencies load;
4. the exact Chromium executable exists and matches the installed browser metadata;
5. Chromium starts visibly, opens a local fixture, renders expected text, captures a PNG, records a Playwright Trace, and closes cleanly;
6. a minimal locked manifest executes at least one observable business assertion;
7. Runner generates Excel, HTML, `run-result.json`, logs, PNG evidence, and Trace;
8. Excel, HTML, and JSON contain the same case ID, execution status, assertion outcome, and evidence references;
9. every installed file required by the receipt exists and matches its recorded size and SHA-256.

Smoke-test artifacts are retained under an installation diagnostics directory so the user can inspect or attach them when reporting installation failures.

## Execution-Time Behavior

`scripts/testing-runner.mjs` becomes a verifier and launcher:

- read and validate the installation receipt;
- verify fixed versions, the receipt-bound payload manifest, Node/Runner/Playwright identities, browser executables, Skill launchers, smoke PNG/Trace, and the required Excel/HTML/JSON/JSONL report evidence as selected integrity markers; normal execution does not re-hash unrelated payload files;
- launch the bundled Runner with the bundled Node.js and fixed Chromium cache;
- fail fast with `installation_incomplete` or `installation_corrupt` if verification fails.

It must not call GitHub, Playwright CDN, `playwright install`, npm, or another dependency installer. Repair is an explicit installer operation outside a test run.

## Download and Trust Boundaries

The public CMD embeds the immutable installer asset URL and SHA-256. The verified installer embeds each architecture-specific companion manifest URL and SHA-256. The installer accepts only HTTPS assets from that fixed project GitHub Release. Redirect targets must remain HTTPS. Proxy variables and the Windows certificate store are supported; credentials are never logged. Size and SHA-256 are mandatory even when TLS succeeds.

Windows x64 is the P0 release path. Release CI first packages Runner 1.1.2 twice from the committed production dependency lock, proves byte-for-byte reproducibility, and executes CLI version, plan, a minimal API run, and report verification using only the tar's `node_modules`. It then builds and smoke-tests the x64 bundle on native Windows, assembles the fixed x64 asset allowlist, verifies the Draft bytes against trusted artifacts, and repeats the download and byte comparison after publication. ARM64 build and smoke coverage remains as a non-blocking follow-up validation. Repository immutable-release administration and attestations remain advisory P2 checks; their failure is reported but does not block the x64 release. Runtime release assets are never overwritten or uploaded with `--clobber`.

## Progress UI

The initial implementation uses a visible PowerShell console with stable, continuously refreshed progress lines. It must show package name, total size, downloaded size, percentage, speed, ETA, retry count, and current phase. This is a real progress interface, not periodic text saying only that a download is still running.

A future native GUI may replace the console without changing the manifest, cache, integrity, atomic-install, or smoke-test contracts.

## Repair, Update, and Uninstall

- `-Repair` revalidates the receipt, reuses valid cached bytes, redownloads only damaged artifacts, reruns the full smoke test, and writes a new receipt last.
- `-Force` installs the selected fixed bundle version atomically even if a verified version exists.
- Updates install into a new version directory and switch the receipt only after verification.
- Uninstall removes the Skill, selected runtime, receipt, and diagnostics; download caches are removed only when explicitly requested.

## Documentation Changes

README and Skill instructions must state that the GitHub Release installer is the supported end-user path. Source ZIP installation is documented as a developer workflow and cannot claim execution readiness. References to first-run Runner or Chromium downloads are removed. The execution guide states that infrastructure preparation belongs to installation, while test-specific readiness and approval gates remain part of each run.

## Acceptance Criteria

- A clean supported Windows machine with no Node.js, npm, Git, Chrome, Python, or Excel can install the complete bundle through the published installer.
- Installation visibly reports sizes, progress, speed, ETA, retries, resume state, verification, extraction, and smoke-test phases.
- Interrupting and restarting a download resumes from persisted partial bytes when the server supports ranges.
- Corrupted or truncated artifacts never produce a successful receipt.
- The success message appears only after the complete smoke test passes.
- After installation, invoking a Web test from Codex causes zero runtime dependency downloads.
- Deleting or modifying Runner or Chromium produces an immediate repair instruction rather than an automatic download.
- CI verifies the installer and bundle on a clean Windows environment before release publication.
- Existing unrelated Skills remain installable without receiving the eighth Skill's large runtime unless the user chooses the all-Skills installer; the all-Skills installer includes the complete eighth Skill runtime.

## Non-Dependencies

The complete installation does not require Python, npm, pnpm, npx, Git, GitHub CLI, Microsoft Excel, local Chrome, MySQL/PostgreSQL client programs, or a separately installed system FFmpeg. The Playwright-managed FFmpeg revision is bundled as part of the locked browser runtime. Target URLs, credentials, storage state, database addresses, and test data remain run-specific inputs rather than installation dependencies.
