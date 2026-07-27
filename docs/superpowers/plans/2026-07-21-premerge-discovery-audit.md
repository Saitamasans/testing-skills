# PR #20 Pre-merge Discovery Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the deterministic task-binding, receipt-quorum, and discovery/execution BrowserContext evidence gaps before rerunning the three-case Live Smoke.

**Architecture:** Extend the pure discovery binding with canonical start-state and full auth-profile hashes, index receipts by required task ID instead of array position, and carry phase-tagged discovery Context records into the formal execution evidence. Keep the Compiler contract, Fixture, Runner 1.1.3, and package-first flow unchanged.

**Tech Stack:** TypeScript, Node.js 22, Playwright 1.61.1, node:test, AJV schemas.

## Global Constraints

- Keep PR #20 Draft until every audit test and Live Smoke acceptance check succeeds.
- Do not modify the three-case Fixture, Runner 1.1.2, Runtime 1.0.2, tags, or Releases.
- Do not weaken receipt MAC, approval, package, origin, run-nonce, action, or page-fingerprint checks.
- Do not print credential values; strict secrets remain zero-match and username findings remain provenance classified.

---

### Task 1: Deterministic discovery binding

**Files:**
- Modify: `packages/testing-runner/src/discovery/discovery-task.ts`
- Modify: `packages/testing-runner/tests/discover-plan.test.ts`

**Interfaces:**
- Consumes: contract target state, transition actions, normalized origin, full auth profile, start state, and isolation scope.
- Produces: a canonical binding key and task ID containing `target_state`, `transition_actions_sha256`, `origin`, `auth_profile_sha256`, `start_state_sha256`, and `isolation_scope`.

- [x] Add a table-driven test that changes exactly one binding dimension and requires a different task ID.
- [x] Run the focused test and verify the start-state/full-auth cases fail on the old binding.
- [x] Add canonical start-state and auth-profile hashes to the task model, dedup key, and task ID.
- [x] Rerun the focused test plus the existing deterministic dedup and success/error non-merge tests.

### Task 2: Receipt quorum by task identity

**Files:**
- Modify: `packages/testing-runner/src/security/discovery-receipt.ts`
- Modify: `packages/testing-runner/tests/discover-plan.test.ts`

**Interfaces:**
- Consumes: required deterministic tasks and untrusted receipt paths.
- Produces: exactly one validated receipt reference per required task, ordered by required task order.

- [x] Add tests for duplicate task receipts, unknown task IDs, extra receipts, and complete manifest task-ID/SHA conservation.
- [x] Run the tests and verify at least duplicate/unknown task diagnostics fail under the positional verifier.
- [x] Pre-index validated receipt documents by `discovery_task_id`; reject duplicates, unknown IDs, missing IDs, and extras before manifest assembly.
- [x] Rerun the new tests and existing forged/cross-package/cross-origin/cross-run tests.

### Task 3: Phase-separated BrowserContext evidence

**Files:**
- Modify: `packages/testing-runner/src/runtime/browser-session.ts`
- Modify: `packages/testing-runner/src/commands/discover-plan.ts`
- Modify: `packages/testing-runner/src/commands/run.ts`
- Modify: `packages/testing-runner/tests/browser-session.test.ts`
- Modify: `packages/testing-runner/tests/discover-plan.test.ts`
- Modify: `packages/testing-runner/tests/cli.test.ts`

**Interfaces:**
- Produces: `BrowserContextRecord.phase` as `discovery` or `execution`; discovery records bind task ID and are closed before command completion; final execution `browser-contexts.json` contains both phases and rejects cross-phase context reuse.

- [x] Add tests for discovery phase records and closed status, execution phase records, combined output, and cross-phase ID reuse rejection.
- [x] Run focused tests and verify missing phase/combined evidence failures.
- [x] Record discovery Context lifecycle, tag execution records, combine prior discovery evidence during `run`, and fail closed on reused context IDs.
- [x] Rerun Context lifecycle, cleanup-failure, CLI persistence, and live-smoke isolation tests.

### Task 4: Non-Live gate and Live Smoke

**Files:**
- Modify only generated Runner/Skill files required by the implementation.
- Update PR body only after a successful Live Smoke.

**Interfaces:**
- Consumes: audited Runner 1.1.3 branch and the three environment-variable presence flags.
- Produces: all-green non-Live evidence, then either a complete real Smoke evidence directory or a Draft blocker.

- [x] Run Runner tests/typecheck/build, Compiler tests/typecheck/build, root Node tests, related Python/security checks, generated checks, and `git diff --check`.
- [ ] Commit/push the audit fix and confirm PR CI is green while Draft.
- [ ] Check only whether all three `SAITAMA_TEST_*` variables exist.
- [ ] If present, rerun the complete Excel-to-reports Smoke and audit counts, Context separation/closure, secrets, report consistency, original Excel SHA, and zero dependency downloads.
- [ ] Only after successful Smoke, update the PR body, reconfirm CI/head SHA, perform final P0/P1 review, mark Ready, and merge without publishing.
