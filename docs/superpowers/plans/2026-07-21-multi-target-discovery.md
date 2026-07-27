# Runner 1.1.3 Multi-target Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Runner 1.1.3 discover every required target state in isolated BrowserContexts and assemble a final manifest only after a complete set of valid task receipts.

**Architecture:** Add a pure deterministic discovery-task planner, execute its tasks sequentially with one fresh BrowserContext per task, and verify receipts against the same reconstructed task set. Add a provenance-aware artifact secret scanner for strict secrets and low-entropy usernames.

**Tech Stack:** TypeScript, Node.js 22+, Playwright 1.61.1, node:test, AJV JSON schemas, PowerShell 5.1 wrappers.

## Global Constraints

- Keep Runner at `1.1.3`, Compiler and Execution Contract at `1.0.0`, and Runtime target at `1.0.3`.
- Do not modify the live Fixture to accommodate the Runner and do not delete contract effects or cases.
- Do not modify Runner 1.1.2, Runtime 1.0.2, historical tags, or Releases.
- Do not hand-author or bypass manifests, receipts, discovery, approvals, or package validation.
- Every discovery task uses a fresh BrowserContext and all required receipts must validate before final manifest assembly.
- Password, wrong-password, token, cookie, and storage-state matches remain strict failures; username values are never emitted.

---

### Task 1: Deterministic discovery task planning

**Files:**
- Create: `packages/testing-runner/src/discovery/discovery-task.ts`
- Test: `packages/testing-runner/tests/discover-plan.test.ts`

**Interfaces:**
- Consumes: loaded contract cases, execution profile, and package SHA.
- Produces: `planDiscoveryTasks({ contractCases, profile, packageSha256 }): DiscoveryTask[]`.

- [x] Add tests asserting the live-smoke contract yields ordered `workspace` and `login_error` tasks, identical state/action bindings deduplicate, and different states never deduplicate.
- [x] Run the focused tests and confirm failure because the task planner/API does not exist.
- [x] Implement the pure task planner and deterministic task ID/hash rules.
- [x] Run focused tests and confirm they pass.

### Task 2: Multi-task Context execution and precise failure

**Files:**
- Modify: `packages/testing-runner/src/commands/discover-plan.ts`
- Modify: `packages/testing-runner/src/cli.ts`
- Test: `packages/testing-runner/tests/discover-plan.test.ts`
- Test: `packages/testing-runner/tests/cli.test.ts`

**Interfaces:**
- Consumes: `DiscoveryTask[]`, one ordered approval path per task, and an injectable/browser launch function.
- Produces: `PlanCommandResult & { discovery_tasks: DiscoveryTask[] }`, `discovery-tasks.json`, and one receipt path per successful task.

- [x] Add tests for two tasks using two distinct Context objects, repeated approvals, persisted task output, exact failed task/case diagnostics, and the existing single-target invocation.
- [x] Run focused tests and confirm the old exactly-one-target guard fails them.
- [x] Replace the guard with ordered task execution, explicit `browser.newContext()`, `finally` closure, and task-scoped error wrapping.
- [x] Run focused tests and confirm they pass without weakening old R2/R3 or live-page-fingerprint checks.

### Task 3: Multi-receipt binding and quorum

**Files:**
- Modify: `packages/testing-runner/src/security/discovery-receipt.ts`
- Modify: `packages/testing-runner/src/commands/plan.ts`
- Modify: `packages/testing-runner/src/types.ts`
- Modify: `schemas/discovery-receipt.schema.json`
- Modify: `schemas/run-manifest.schema.json`
- Test: `packages/testing-runner/tests/execution-package.test.ts`
- Test: `packages/testing-runner/tests/discover-plan.test.ts`

**Interfaces:**
- Consumes: deterministic task set, ordered receipts, ordered approvals, active RuntimeSession.
- Produces: receipt references bound to task ID/case/state and a final manifest only after full task quorum.

- [x] Add tests rejecting a missing second receipt plus forged, cross-package, cross-origin, cross-run-nonce, and action-mismatched task receipts.
- [x] Run focused tests and confirm failures show the missing task-aware binding/quorum.
- [x] Add receipt task fields, validate each receipt against its task and approval, and gate planning on exact task quorum.
- [x] Run focused and full Runner tests and confirm single-target compatibility remains green.

### Task 4: Provenance-aware secret scan

**Files:**
- Create: `packages/testing-runner/src/security/artifact-secret-scan.ts`
- Create: `packages/testing-runner/tests/artifact-secret-scan.test.ts`

**Interfaces:**
- Consumes: named secret policies and extracted artifact fields with file/field/provenance metadata.
- Produces: redacted findings containing secret name, file, field, provenance, and classification, never the value.

- [x] Add tests for strict password/token/cookie/storage-state matches, username credential-field leakage, username public metadata/domain/project collisions, unknown provenance, and output non-disclosure.
- [x] Run the focused test and confirm failure because the scanner does not exist.
- [x] Implement exact matching plus strict-secret and username-provenance classification.
- [x] Run focused tests and confirm all findings are value-free.

### Task 5: Generated docs, distributions, and verification

**Files:**
- Modify: `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md`
- Modify: `skills/web-api-test-execution-evidence/SKILL.md` (generated)
- Modify: `skills/web-api-test-execution-evidence/references/runner-commands.md`
- Modify: `packages/testing-runner/dist/**` (generated)
- Modify: relevant schema copies and release locks only for Runner 1.1.3.

**Interfaces:**
- Consumes: implemented CLI/task/receipt behavior.
- Produces: synchronized generated artifacts and reproducible Runner 1.1.3 package metadata.

- [x] Update source documentation for repeated approvals, task arrays, isolated discovery Contexts, and receipt quorum; regenerate Skill output.
- [x] Build Runner and verify generated-file checks show no drift.
- [x] Run Compiler tests/typecheck/build; Runner tests/typecheck/build; root Node and Python tests; nine Skill validations; ZIP safety; offline install; PowerShell 5.1; actionlint; `git diff --check`; and secret scanning.
- [ ] Review the final diff for P0/P1 findings, commit and push the existing PR branch, wait for all GitHub CI checks, and keep PR #20 Draft without merging or publishing.
