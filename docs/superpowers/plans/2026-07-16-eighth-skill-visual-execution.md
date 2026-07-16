# Eighth Skill Visual Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `web-api-test-execution-evidence` visibly explain every Web/API test action in a maximized browser by default, preserve clean evidence, and re-record its tutorial at 1920x1080 60 FPS.

**Architecture:** Add a pure run-observer contract to the manifest orchestrator and implement a Playwright-backed visual progress controller in the browser session. Interactive visible runs create a maximized browser for Web, mixed, and API-only manifests; the controller injects an isolated progress surface, while formal evidence screenshots hide that surface through Playwright's screenshot `style` option.

**Tech Stack:** TypeScript 5.8, Node.js 20+, Playwright 1.52, Node test runner through `tsx`, FFmpeg/FFprobe.

## Global Constraints

- Do not rename, merge, or split any of the existing eight Skills.
- Use “测试用例（Test Case）” for one case and “测试用例（Test Cases）” for multiple cases in user-facing Chinese copy.
- Preserve the four business states exactly: 未执行、通过、不通过、待定.
- `run-result.json` remains the only business verdict source.
- Interactive visible execution shows progress by default; `--progress off` disables it.
- CI and headless execution do not show progress and do not wait for user interaction.
- Formal Web evidence PNG files must not contain the progress surface.
- Do not render credentials, tokens, connection strings, request secrets, or unredacted payloads.
- Final tutorial recording must be 1920x1080, 60 FPS, and include real execution rather than a result-page slideshow.
- Keep `skills/web-api-test-execution-evidence/agents/openai.yaml` unchanged; its existing discovery metadata does not contradict the visual execution behavior.

---

### Task 1: Add an observable execution lifecycle

**Files:**
- Modify: `packages/testing-runner/src/runtime/run-orchestrator.ts`
- Test: `packages/testing-runner/tests/runtime-evidence.test.ts`

**Interfaces:**
- Produces: `RunObserver` with `runStarted`, `caseStarted`, `actionStarted`, `actionCompleted`, `caseCompleted`, and `runCompleted` optional async hooks.
- Produces: `RunInput.observer?: RunObserver`.
- Consumes: existing `RunManifest`, `ManifestAction`, `ActionOutcome`, and final four-state case result.

- [ ] **Step 1: Write the failing lifecycle test**

Add a two-case manifest test that records observer events and asserts this order:

```ts
assert.deepEqual(events, [
  "run.started",
  "case.started:CASE-001",
  "action.started:CASE-001-request",
  "action.passed:CASE-001-request",
  "case.completed:CASE-001:通过",
  "case.started:CASE-002",
  "action.started:CASE-002-request",
  "action.pending:CASE-002-request",
  "case.completed:CASE-002:待定",
  "run.completed",
]);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
& $node node_modules/tsx/dist/cli.mjs --test packages/testing-runner/tests/runtime-evidence.test.ts
```

Expected: TypeScript/test failure because `RunInput` has no `observer` and lifecycle hooks are never called.

- [ ] **Step 3: Implement the minimal observer contract**

Define payloads with case/action indexes, totals, manifest hash, case metadata, attempt, outcome, and final result. Await hooks directly around existing event-writer calls so visual progress cannot run ahead of the authoritative execution sequence.

- [ ] **Step 4: Run the focused test and verify GREEN**

Expected: all `runtime-evidence.test.ts` tests pass with the exact lifecycle order.

- [ ] **Step 5: Commit the lifecycle contract**

```powershell
git add packages/testing-runner/src/runtime/run-orchestrator.ts packages/testing-runner/tests/runtime-evidence.test.ts
git commit -m "feat: expose runner execution lifecycle"
```

### Task 2: Build the isolated visual progress controller

**Files:**
- Create: `packages/testing-runner/src/runtime/visual-progress.ts`
- Create: `packages/testing-runner/tests/visual-progress.test.ts`
- Modify: `packages/testing-runner/src/runtime/browser-session.ts`
- Modify: `packages/testing-runner/tests/browser-session.test.ts`

**Interfaces:**
- Produces: `ProgressVisibility = "auto" | "off"`.
- Produces: `VisualProgressController implements RunObserver`.
- Produces: `VISUAL_PROGRESS_HOST_ID = "testing-runner-visual-progress"`.
- Produces: `BrowserSession.observer?: RunObserver`, `BrowserSession.completionPause(): Promise<void>`.
- Consumes: observer lifecycle payloads from Task 1.

- [ ] **Step 1: Write failing pure rendering and browser-session tests**

Cover these exact expectations:

```ts
assert.match(html, /测试用例（Test Case） 2 \/ 18/);
assert.match(html, /WEB-002/);
assert.match(html, /api\.request/);
assert.match(html, /POST \/api\/orders/);
assert.doesNotMatch(html, /SECRET_TOKEN/);
```

Update browser-session expectations so interactive API-only `auto` opens a browser, visible launch options include `args: ["--start-maximized"]`, and visible context uses `{ viewport: null }`. Assert CI, headless, and `progress: "off"` API-only runs do not launch a browser.

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
& $node node_modules/tsx/dist/cli.mjs --test packages/testing-runner/tests/visual-progress.test.ts packages/testing-runner/tests/browser-session.test.ts
```

Expected: missing module/API failures and the existing API-only “does not launch” assertion fails against the new requirement.

- [ ] **Step 3: Implement visual state and HTML/CSS rendering**

Render a fixed, isolated surface with:

```ts
interface VisualProgressState {
  phase: "preparing" | "running" | "completed";
  manifestHash: string;
  origins: string[];
  caseIndex: number;
  caseTotal: number;
  caseId: string;
  caseTitle: string;
  module: string;
  actionIndex: number;
  actionTotal: number;
  actionType: string;
  actionSummary: string;
  actionStatus: "准备" | "执行中" | "通过" | "不通过" | "待定" | "未执行";
  counts: Record<"通过" | "不通过" | "待定" | "未执行", number>;
  elapsedMs: number;
}
```

Create/update one host element with a closed shadow root, `pointer-events: none`, stable dimensions, restrained professional colors, readable Chinese typography, a progress bar, and no gradients or decorative elements. Only render redacted action summaries; API requests show method/path and assertions show the assertion expression.

- [ ] **Step 4: Implement maximized/API-only browser creation**

Open a browser when either the manifest contains Web actions or the run is interactive and visibly showing progress. Use:

```ts
chromium.launch({ headless: false, slowMo, args: ["--start-maximized"] });
browser.newContext({ viewport: null });
```

For API-only execution, keep the page on a neutral local HTML document and let the visual controller fill the viewport. For mixed execution, reinject after navigation through each observer update.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: visual progress and browser-session tests pass; existing trace-writing and cleanup tests remain green.

- [ ] **Step 6: Commit the visual controller**

```powershell
git add packages/testing-runner/src/runtime/visual-progress.ts packages/testing-runner/src/runtime/browser-session.ts packages/testing-runner/tests/visual-progress.test.ts packages/testing-runner/tests/browser-session.test.ts
git commit -m "feat: show visual test execution progress"
```

### Task 3: Wire CLI defaults, execution results, and clean screenshots

**Files:**
- Modify: `packages/testing-runner/src/cli.ts`
- Modify: `packages/testing-runner/src/commands/run.ts`
- Modify: `packages/testing-runner/src/actions/web-adapter.ts`
- Modify: `packages/testing-runner/tests/cli.test.ts`
- Modify: `packages/testing-runner/tests/web-api-actions.test.ts`

**Interfaces:**
- Produces: CLI `--progress <mode>` with values `auto|off`, default `auto`.
- Produces: `RunCommandOptions.progress?: ProgressVisibility`.
- Consumes: `BrowserSession.observer` from Task 2.

- [ ] **Step 1: Write failing CLI and screenshot tests**

Assert `normalizeRunCliOptions` returns `progress: "auto"`, accepts `off`, and rejects other values with `progress_configuration_invalid`. In the Web adapter test, capture screenshot options and assert:

```ts
assert.match(String(screenshotOptions.style), /testing-runner-visual-progress/);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run:

```powershell
& $node node_modules/tsx/dist/cli.mjs --test packages/testing-runner/tests/cli.test.ts packages/testing-runner/tests/web-api-actions.test.ts
```

Expected: CLI normalization has no `progress` option and screenshots do not hide the progress host.

- [ ] **Step 3: Implement CLI and run-command wiring**

Add:

```ts
.option("--progress <mode>", "auto or off", "auto")
```

Pass the browser session observer into `runApprovedManifest`. After report generation, notify the completion state and keep the summary visible for a bounded review pause so automated execution cannot hang indefinitely; use no pause in CI/headless/off modes.

- [ ] **Step 4: Hide the visual host only during formal evidence capture**

Change Web evidence capture to:

```ts
page.screenshot({
  fullPage: true,
  style: `#${VISUAL_PROGRESS_HOST_ID}{display:none!important}`,
});
```

Do not hide the host during desktop video recording.

- [ ] **Step 5: Run focused tests and verify GREEN**

Expected: CLI and Web/API action tests pass, and CI integration tests still write Excel/HTML/JSON without launching a visible browser.

- [ ] **Step 6: Commit CLI and evidence isolation**

```powershell
git add packages/testing-runner/src/cli.ts packages/testing-runner/src/commands/run.ts packages/testing-runner/src/actions/web-adapter.ts packages/testing-runner/tests/cli.test.ts packages/testing-runner/tests/web-api-actions.test.ts
git commit -m "feat: enable visual progress by default"
```

### Task 4: Update the eighth Skill contract and installation package

**Files:**
- Modify: `skills/web-api-test-execution-evidence/SKILL.md`
- Modify: `skills/web-api-test-execution-evidence/references/runner-commands.md`
- Inspect without modifying: `skills/web-api-test-execution-evidence/agents/openai.yaml`
- Test: existing Skill contract and package validation commands.

**Interfaces:**
- Documents: interactive execution is maximized and visually explained by default.
- Documents: `--progress off` disables the panel; CI/headless never shows it.
- Preserves: existing skill name, trigger, approval gate, four states, and fixed Runner version policy.

- [ ] **Step 1: Record the existing real-usage RED baseline**

Reference the accepted failure artifacts from `build/skillmart-demo/12-第八个Skill专用教程_Eighth-Skill-Tutorial/20260716-181727`: the browser was small/occluded and the viewer could not tell which test case was executing. Do not delete these artifacts.

- [ ] **Step 2: Add the minimal Skill guidance**

Add one concise interactive-execution rule to `SKILL.md` and exact command behavior to `references/runner-commands.md`. Do not duplicate the visual controller implementation or inflate the main Skill body.

- [ ] **Step 3: Validate Skill structure and contract**

Run the repository's Skill contract tests and system `quick_validate.py` against `skills/web-api-test-execution-evidence`.

Expected: skill name and routing remain unchanged; validation returns success.

- [ ] **Step 4: Commit Skill documentation**

```powershell
git add skills/web-api-test-execution-evidence
git commit -m "docs: require visible progress for interactive execution"
```

### Task 5: Upgrade and verify 1080p60 recording

**Files:**
- Modify: `demo/skillmart/scripts/desktop-recording-manifest.json`
- Modify: `demo/skillmart/scripts/record-real-desktop-demo.mjs`
- Modify: `demo/skillmart/scripts/validate-demo-materials.mjs`
- Test: `packages/testing-runner/tests/demo-skillmart.test.ts`

**Interfaces:**
- Produces: 1920x1080 H.264 MP4 at `60/1` FPS with visible cursor.
- Produces: focused eighth-Skill tutorial directory containing raw video, edited video, key frames, timeline, and evidence index.

- [ ] **Step 1: Write failing recording validation**

Assert the manifest requires `fps: 60` and video validation rejects any final tutorial whose FFprobe result is not 1920x1080 or `60/1` FPS.

- [ ] **Step 2: Run focused test and verify RED**

Expected: current manifest reports 30 FPS and validation lacks the new focused tutorial requirements.

- [ ] **Step 3: Implement 60 FPS capture and focused tutorial validation**

Set `capture.fps` to `60`. Keep `gdigrab`, visible cursor, H.264, `yuv420p`, and `+faststart`. Update `record-real-desktop-demo.mjs` to persist the actual FFprobe width, height, codec, and frame rate. Update `validate-demo-materials.mjs` to reject recordings whose probed values are not exactly 1920x1080, H.264, and `60/1`, even when manifest metadata claims otherwise.

- [ ] **Step 4: Run focused test and a five-second capture smoke test**

Verify FFprobe reports width `1920`, height `1080`, and frame rate `60/1`. Decode the smoke file fully with FFmpeg `-f null -`.

- [ ] **Step 5: Commit recording support**

```powershell
git add demo/skillmart/scripts/desktop-recording-manifest.json demo/skillmart/scripts/record-real-desktop-demo.mjs demo/skillmart/scripts/validate-demo-materials.mjs packages/testing-runner/tests/demo-skillmart.test.ts
git commit -m "feat: record eighth skill tutorial at 1080p60"
```

### Task 6: Run the real eighth Skill and record the final tutorial

**Files:**
- Create through execution: `build/skillmart-demo/12-第八个Skill专用教程_Eighth-Skill-Tutorial/final-*`
- Modify: `demo/skillmart/scripts/build-acceptance-navigation.mjs`

**Interfaces:**
- Consumes: the existing approved SkillMart manifest and execution profile.
- Produces: real Excel, HTML, `run-result.json`, PNG, API evidence, Trace, logs, raw video, edited video, subtitles/timeline, and evidence index.

- [ ] **Step 1: Build Runner and run all automated tests**

Run typecheck, all Runner tests, renderer tests, Skill contract tests, and `git diff --check`. Stop on any failure.

- [ ] **Step 2: Start a fresh desktop recording before the eighth Skill invocation**

Create a new timestamped final tutorial directory. Record the Codex invocation, materials/readiness preview, manifest hash, target origin, risk/action counts, and user approval.

- [ ] **Step 3: Execute the approved requirementWorkbench suite visibly**

Use `--mode interactive --browser visible --progress auto` with readable slow motion. Verify the maximized window and progress panel show the exact current test case and action while Web/API execution occurs.

- [ ] **Step 4: Show and verify the generated outputs**

Open the final HTML report, one clean Web PNG, one API request/response artifact, the Trace file listing, and the final four-state summary. Confirm panel-free formal screenshots and panel-visible desktop video frames.

- [ ] **Step 5: Stop recording normally and create tutorial deliverables**

Keep the full unedited recording. Produce a tutorial edit under 20 minutes without replacing the raw source. Generate Chinese subtitles/timeline and an evidence index with SHA-256 values.

- [ ] **Step 6: Point acceptance navigation to the final tutorial**

Update `build-acceptance-navigation.mjs` so the eighth-Skill entry resolves to the newest `final-*` tutorial directory and exposes direct links to the raw recording, edited tutorial, execution report, evidence index, and key frames. Regenerate the acceptance navigation and verify every generated link exists.

- [ ] **Step 7: Run final verification**

Verify with fresh commands:

- FFprobe: 1920x1080, `60/1`, H.264;
- full FFmpeg decode: exit 0;
- edited duration: at most 1200 seconds;
- required Web/API/Trace/Excel/HTML/JSON artifacts exist;
- report consistency and demo video gates pass;
- `git diff --check` is clean.

- [ ] **Step 8: Commit final source/navigation changes only**

Do not commit bulky build artifacts unless the repository's existing release policy explicitly tracks them.
