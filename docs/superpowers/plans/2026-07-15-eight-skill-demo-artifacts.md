# Eight Skill Demo Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the eighth Skill executable without a global npm command, then produce reproducible SkillMart demo materials and evidence that can support a public 8-Skill walkthrough.

**Architecture:** Keep the existing monorepo and generated Skill package structure. Fix the Runner bootstrap in the eighth Skill first, extend the Runner evidence model for success screenshots/API evidence/`待定` verdicts, then add a local SkillMart demo fixture and a deterministic material builder that archives requirements, prompts, generated testing artifacts, execution reports and screenshot evidence.

**Tech Stack:** Node.js 20+, TypeScript, Playwright, Node test runner, Python unittest, existing `tooling/build_skills.py`, existing testing-runner package.

## Global Constraints

- Do not rename, merge, split or delete the original seven Skills.
- Keep the user's Chinese expression style in Skill-facing text.
- Display testing assets as `测试用例（Test Case）` for one case and `测试用例（Test Cases）` for collections in public/demo-facing material.
- Keep the fixed ten-column formal case schema unchanged.
- Business states remain `未执行 / 通过 / 不通过 / 待定`.
- `待定` means executed, evidence collected, but product/API/development/testing interpretation conflicts; it is not a developer Bug and not unexecuted.
- Public users must not need an npm account, npm login or a manual Runner install command.
- Interactive Web execution must export visible, directly openable PNG screenshots and trace evidence.
- API evidence must preserve redacted request, response, assertion and cleanup details.
- Multiple failed Test Cases may aggregate to one root defect while retaining every case's evidence.

---

## File Map

- Modify: `skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs`
- Regenerate: `skills/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs`
- Modify: `tests/runner-bootstrap.test.mjs`
- Modify: `packages/testing-runner/src/runtime/run-orchestrator.ts`
- Modify: `packages/testing-runner/src/runtime/evidence-store.ts`
- Modify: `packages/testing-runner/src/actions/api-adapter.ts`
- Modify: `packages/testing-runner/src/actions/web-adapter.ts`
- Modify: `packages/testing-runner/src/types.ts`
- Modify: `packages/testing-runner/tests/runtime-evidence.test.ts`
- Modify: `packages/testing-runner/tests/assertions-verdict.test.ts`
- Create: `packages/testing-runner/tests/demo-skillmart.test.ts`
- Create: `packages/testing-runner/tests/fixtures/skillmart-app.ts`
- Create: `demo/skillmart/requirements/prd-v0.md`
- Create: `demo/skillmart/requirements/product-confirmation.md`
- Create: `demo/skillmart/requirements/prd-v1.md`
- Create: `demo/skillmart/contracts/*.md`
- Create: `demo/skillmart/scripts/build-demo-materials.mjs`
- Create: `demo/skillmart/README.md`
- Output only: `build/skillmart-demo/**`

---

### Task 1: Remove the Global npm Requirement from Bootstrap

**Files:**
- Modify: `tests/runner-bootstrap.test.mjs`
- Modify: `skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs`
- Regenerate: `skills/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs`

**Interfaces:**
- `ensureRunnerRuntime(options)` still returns `{ cliPath, cacheHit, runtimeDir }`.
- `cliPath` points to the extracted package CLI under the versioned runtime cache.
- The bootstrap extracts the locked `.tgz` with Node built-ins and never requires `npm`, `pnpm` or `npx`.

- [ ] **Step 1: Write the failing npm-free bootstrap test**

Add a test that builds a small gzipped tar fixture containing `package/dist/cli.js`, calls `ensureRunnerRuntime()` with no npm path in env and with `runProcess` throwing if called, and expects the CLI to exist.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/runner-bootstrap.test.mjs`

Expected: FAIL because current bootstrap tries to resolve npm on Windows when no npm CLI is adjacent to Node.

- [ ] **Step 3: Implement a safe built-in `.tgz` extractor**

Use `node:zlib` to gunzip and parse USTAR headers. Extract only regular files and directories, reject absolute paths, `..`, links and unsupported types, write into a temporary install directory, then atomically rename it to the runtime cache.

- [ ] **Step 4: Verify GREEN**

Run: `node --test tests/runner-bootstrap.test.mjs`

Expected: PASS and no test invokes npm/pnpm/npx.

- [ ] **Step 5: Regenerate the Skill package**

Run: `python tooling/build_skills.py`

Expected: generated eighth Skill script matches the source script.

### Task 2: Persist Success Screenshots, API Evidence and Real Run Timing

**Files:**
- Modify: `packages/testing-runner/src/runtime/evidence-store.ts`
- Modify: `packages/testing-runner/src/runtime/run-orchestrator.ts`
- Modify: `packages/testing-runner/src/actions/api-adapter.ts`
- Modify: `packages/testing-runner/src/actions/web-adapter.ts`
- Modify: `packages/testing-runner/tests/runtime-evidence.test.ts`

**Interfaces:**
- Action outcomes may include `attachments`.
- `runApprovedManifest()` stores each attachment and registers it in `run-result.json`.
- `started_at` is captured before case execution and `completed_at` after all execution and evidence writes.

- [ ] **Step 1: Write failing evidence tests**

Add tests for a passed Web action with a PNG attachment and a passed API action with request/response JSON evidence. Assert both are written as independent files, appear in `evidence-index.json`, and are referenced by the case evidence list.

- [ ] **Step 2: Verify RED**

Run: `npm test --workspace @saitamasans/testing-runner -- runtime-evidence.test.ts`

Expected: FAIL because passed actions currently do not persist attachments and run timestamps are created at the end.

- [ ] **Step 3: Store attachments for every outcome**

For each action outcome, write all attachments through `storeEvidence()`. Keep failure evidence behavior. Preserve paths per case/attempt/action so evidence is never overwritten.

- [ ] **Step 4: Add Web and API attachments**

Web passed actions capture a PNG screenshot when a page exists. API request/assert/cleanup actions attach redacted request/response/assertion JSON. Do not create fake screenshots for API-only actions.

- [ ] **Step 5: Verify GREEN**

Run: `npm test --workspace @saitamasans/testing-runner -- runtime-evidence.test.ts web-api-actions.test.ts`

Expected: PASS with evidence paths present for success, failure and retry cases.

### Task 3: Represent `待定` and Root Defect Aggregation

**Files:**
- Modify: `packages/testing-runner/src/types.ts`
- Modify: `packages/testing-runner/src/runtime/run-orchestrator.ts`
- Modify: `packages/testing-runner/tests/assertions-verdict.test.ts`
- Modify: `packages/testing-runner/tests/runtime-evidence.test.ts`

**Interfaces:**
- An action outcome can return `status: "pending"` with a conflict payload.
- A case with a pending outcome becomes business status `待定` and runtime status `completed`.
- Root defect aggregation records one summary key while preserving every failed case evidence reference.

- [ ] **Step 1: Write failing verdict tests**

Add one case where conflicting expectation sources produce `待定`, and two failed idempotency cases with the same `root_cause_key` aggregate into one defect summary.

- [ ] **Step 2: Verify RED**

Run: `npm test --workspace @saitamasans/testing-runner -- assertions-verdict.test.ts runtime-evidence.test.ts`

Expected: FAIL because pending and aggregation are not modeled.

- [ ] **Step 3: Implement pending verdict mapping**

Treat `pending` as executed, collect evidence, set case status to `待定`, keep run status `completed`, and add a clear review note.

- [ ] **Step 4: Implement root defect summaries**

Add a `defects` array to `run-result.json` for failed cases with the same `root_cause_key`. Include case IDs and evidence refs; do not reduce individual case results.

- [ ] **Step 5: Verify GREEN**

Run: `npm test --workspace @saitamasans/testing-runner -- assertions-verdict.test.ts runtime-evidence.test.ts`

Expected: PASS.

### Task 4: Add the SkillMart Local Demo Fixture and Materials Builder

**Files:**
- Create: `packages/testing-runner/tests/fixtures/skillmart-app.ts`
- Create: `packages/testing-runner/tests/demo-skillmart.test.ts`
- Create: `demo/skillmart/requirements/prd-v0.md`
- Create: `demo/skillmart/requirements/product-confirmation.md`
- Create: `demo/skillmart/requirements/prd-v1.md`
- Create: `demo/skillmart/contracts/orders-api.md`
- Create: `demo/skillmart/contracts/query-api.md`
- Create: `demo/skillmart/scripts/build-demo-materials.mjs`
- Create: `demo/skillmart/README.md`

**Interfaces:**
- `startSkillMartApp()` starts a local Web/API system on `127.0.0.1`.
- The app intentionally keeps the duplicate idempotency defect and coupon expiry ambiguity.
- The builder writes `build/skillmart-demo/**` with requirements, prompt files, synthetic Skill outputs, standard Test Cases, execution profile, screenshots and a material index.

- [ ] **Step 1: Write failing demo tests**

Test product list, order creation, duplicate idempotency failure, coupon boundary conflict marker and reset endpoint.

- [ ] **Step 2: Verify RED**

Run: `npm test --workspace @saitamasans/testing-runner -- demo-skillmart.test.ts`

Expected: FAIL because SkillMart does not exist.

- [ ] **Step 3: Implement the local SkillMart fixture**

Use Node HTTP and static HTML. Keep data in memory and reset by `POST /__test/reset`. Listen only on `127.0.0.1`.

- [ ] **Step 4: Add the demo requirements and contracts**

Write PRD v0, product confirmation, PRD v1 and API contracts in Chinese. Use `测试用例（Test Case）` / `测试用例（Test Cases）` consistently.

- [ ] **Step 5: Implement the materials builder**

Generate a deterministic demo archive skeleton with one independent folder per Skill, separate prompts, generated artifacts, evidence folders and a top-level index. The builder must not claim a real Skill invocation where only static demo material is generated.

- [ ] **Step 6: Verify GREEN**

Run: `npm test --workspace @saitamasans/testing-runner -- demo-skillmart.test.ts`

Expected: PASS and `node demo/skillmart/scripts/build-demo-materials.mjs --out build/skillmart-demo` creates the expected directory tree.

### Task 5: Run Focused Gates and Record Verification

**Files:**
- Modify: `docs/release/v1.1.0-execution-skill-verification.md`

**Interfaces:**
- Records exact commands, pass/fail result, remaining gaps and generated material paths.

- [ ] **Step 1: Run focused gates**

Run:

```powershell
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest tests.test_build_skills tests.test_execution_skill_contracts -v
node --test tests/runner-bootstrap.test.mjs
npm test --workspace @saitamasans/testing-runner -- runtime-evidence.test.ts assertions-verdict.test.ts demo-skillmart.test.ts
```

- [ ] **Step 2: Run formatting and git checks**

Run:

```powershell
git diff --check
git status --short
```

- [ ] **Step 3: Update verification notes**

Record the real result, not optimistic language. If a gate is blocked by missing global npm in this local shell, record the exact fallback command used and whether the bootstrap itself no longer depends on npm.

- [ ] **Step 4: Commit**

Run:

```powershell
git add docs/superpowers/plans/2026-07-15-eight-skill-demo-artifacts.md skill-sources skills packages tests demo docs/release
git commit -m "feat: prepare eight-skill demo evidence flow"
```

Expected: commit succeeds with the implementation and verification evidence.

