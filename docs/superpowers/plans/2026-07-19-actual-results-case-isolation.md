# Actual Results and Case Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate executable eleven-column requirement test cases, preserve actual observations through execution reports, and isolate every Web test case in its own browser context.

**Architecture:** Keep legacy ten-column inputs valid while adding an eleven-column workbench contract. Detect formats by exact headers, preserve optional actual results through normalized cases and manifests, project assertion actuals by column name, and add case lifecycle hooks that rotate Playwright BrowserContexts without restarting the browser.

**Tech Stack:** Python contract tests and skill builder; Node.js/TypeScript; ExcelJS; Playwright; JSON Schema.

## Global Constraints

- Preserve unrelated dirty worktree changes.
- `requirement-test-workbench` emits eleven columns; other generators may remain ten-column.
- Runner accepts both exact formats and never truncates an actual-result column.
- Secrets remain redacted from JSON, Excel, HTML, logs, screenshots, and Trace summaries.
- Web cases are isolated by BrowserContext; state remains continuous only inside one case.

---

### Task 1: Lock the new Skill and renderer contract

**Files:**
- Modify: `tests/test_source_contracts.py`
- Modify: `tests/test-case-renderer.test.mjs`
- Modify: `根据需求-用例生成_skill.md`
- Modify: `tooling/test-case-renderer.mjs`
- Test: `tests/test_source_contracts.py`, `tests/test-case-renderer.test.mjs`

**Interfaces:**
- Consumes: legacy ten-column report JSON.
- Produces: workbench eleven-column contract and renderer support for both exact header sets.

- [ ] Add failing tests requiring “实际结果”, “尚未执行”, independent start state, and renderer acceptance of exact ten/eleven-column reports.
- [ ] Run `python -m unittest tests.test_source_contracts` and `node --test tests/test-case-renderer.test.mjs`; confirm failures are caused by the missing contract.
- [ ] Update the source Skill and make renderer status/priority indexes derive from header names.
- [ ] Re-run the focused tests and rebuild generated skills with `python tooling/build_skills.py`.

### Task 2: Preserve eleven-column input and manifest data

**Files:**
- Modify: `packages/testing-runner/src/input/detect-input.ts`
- Modify: `packages/testing-runner/src/input/report-reader.ts`
- Modify: `packages/testing-runner/src/input/excel-reader.ts`
- Modify: `packages/testing-runner/src/types.ts`
- Modify: `schemas/run-manifest.schema.json`
- Modify: `packages/testing-runner/tests/input-native.test.ts`
- Modify: `packages/testing-runner/tests/schema-contract.test.ts`

**Interfaces:**
- Consumes: exact legacy ten-column or workbench eleven-column JSON/XLSX.
- Produces: normalized core values plus optional `实际结果`, preserved in `RunManifestCase.original`.

- [ ] Add failing tests using the user workbook shape with “实际结果” before “执行结果”.
- [ ] Verify the eleven-column sample is currently detected as nonstandard or loses the added field.
- [ ] Add exact header constants and header-driven normalization without changing legacy semantics.
- [ ] Update schema/types and run focused input/schema tests.

### Task 3: Project truthful actual results

**Files:**
- Modify: `packages/testing-runner/src/reporting/report-projector.ts`
- Modify: `packages/testing-runner/src/reporting/consistency-gate.ts`
- Modify: `packages/testing-runner/src/commands/run.ts`
- Modify: `packages/testing-runner/tests/report-projection.test.ts`

**Interfaces:**
- Consumes: `RunResult.cases[].assertions[].actual` and ten/eleven-column source reports.
- Produces: eleven-column output with actual-result summaries and matching status by header name.

- [ ] Add failing projection tests for passed, failed, blocked, and legacy reports.
- [ ] Verify current projector truncates the eleventh value and discards assertion actuals.
- [ ] Implement deterministic, bounded actual-result summaries and dynamic column lookup.
- [ ] Run report projection and consistency tests.

### Task 4: Isolate Web cases by BrowserContext

**Files:**
- Modify: `packages/testing-runner/src/runtime/run-orchestrator.ts`
- Modify: `packages/testing-runner/src/runtime/browser-session.ts`
- Modify: `packages/testing-runner/src/commands/run.ts`
- Modify: `packages/testing-runner/tests/browser-session.test.ts`
- Modify: `packages/testing-runner/tests/runtime-evidence.test.ts`

**Interfaces:**
- Consumes: orchestrator case boundaries and manifest action types.
- Produces: `beforeCase`/`afterCase` lifecycle and a fresh Page for each Web case.

- [ ] Add a failing test showing two Web cases currently share one BrowserContext/Page.
- [ ] Add lifecycle hooks to the orchestrator and a context rotation API to BrowserSession.
- [ ] Update execution context page at each Web case boundary; keep API-only behavior unchanged.
- [ ] Verify per-case Trace paths, cleanup on errors, and all browser-session tests.

### Task 5: Build, install, regression test, and publish

**Files:**
- Modify generated files under `skills/` via `tooling/build_skills.py`.
- Modify release documentation only where the contract is user-visible.

**Interfaces:**
- Consumes: completed source and runner changes.
- Produces: verified generated package, installed Skill, commit, pushed branch, PR, and merged default branch.

- [ ] Run Python tests, Node tests, Runner tests, typecheck, build, and skill drift checks.
- [ ] Generate an eleven-column login report fixture and visually inspect rendered Excel/HTML output.
- [ ] Install the rebuilt workbench and execution Skill into the current Codex skill directory and verify hashes/contracts.
- [ ] Review the scoped diff, stage only intended files, commit, push, open a ready PR, merge it, and verify the remote default branch contains the commit.
