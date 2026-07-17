# Eighth Skill Showcase UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete, understandable SkillMart showcase and a reusable visual Runner cockpit that explains preflight, each test case (Test Case), live Web/API actions, evidence collection, and final delivery without affecting execution accuracy.

**Architecture:** Keep `run-result.json` and existing action adapters as the only business-verdict path. Extend the observer-driven presentation layer with a pure state model, render it inside an isolated Shadow DOM, and add an idempotent browser-session delivery phase after reports and Trace exist. Move SkillMart from a test-fixture HTML string into a standalone local demo application whose existing APIs and stable `data-testid` values remain compatible.

**Tech Stack:** TypeScript 5.8, Node.js 20+, Playwright 1.52, Node test runner, vanilla HTML/CSS/JavaScript, existing Excel/HTML report renderer, local bitmap assets.

## Global Constraints

- Use Chinese and English together whenever naming test cases: single item `测试用例（Test Case）`, collection `测试用例（Test Cases）`.
- Preserve the standard ten-column order and the four business statuses `未执行、通过、不通过、待定`.
- Preserve the seven run statuses and keep `run-result.json` as the only verdict source.
- Do not infer production or test environments from URL, database, or data characteristics.
- The visual layer must not participate in locators, clicks, assertions, retries, or verdict calculation.
- Formal Web evidence PNG files must hide all Runner UI and target-highlighting layers; desktop recordings must retain them.
- Keep existing API paths, request semantics, seeded defect, and current `data-testid` values compatible.
- Interactive visible runs default to a maximized browser and visible progress; CI, headless, and `--progress off` remain unchanged.
- Keep credentials, tokens, cookies, passwords, and database connection data out of UI, logs, HTML, JSON, screenshots, and presentation state.
- Target recording output is 1920×1080, 60 fps; edited tutorial remains under 20 minutes, and the full unedited recording is also retained.

## File Structure

- Create `packages/testing-runner/src/runtime/visual-progress-model.ts`: pure presentation types, state transitions, readable action summaries, redaction-safe view data.
- Modify `packages/testing-runner/src/runtime/visual-progress.ts`: Shadow DOM renderer and controller orchestration only.
- Modify `packages/testing-runner/src/runtime/browser-session.ts`: lifecycle for preflight, Trace finalization, result-center delivery, and close.
- Modify `packages/testing-runner/src/commands/run.ts`: produce delivery artifact metadata and notify the browser only after consistency checks and Trace finalization.
- Modify `packages/testing-runner/src/actions/web-adapter.ts`: keep formal screenshot hiding tied to the single Runner host.
- Create `demo/skillmart/src/app.ts`: standalone local HTTP application and API state.
- Create `demo/skillmart/public/index.html`, `app.css`, and `app.js`: complete product, checkout, order, and runtime-data UI.
- Create `demo/skillmart/public/assets/skillmart-products.png`: local four-product bitmap sheet used by the storefront.
- Modify `demo/skillmart/scripts/start-local-demo.ts`: import the standalone demo application.
- Modify `packages/testing-runner/tests/fixtures/skillmart-app.ts`: re-export the standalone demo application for existing tests.
- Modify `packages/testing-runner/tests/visual-progress.test.ts`, `browser-session.test.ts`, and `demo-skillmart.test.ts`: TDD coverage for all new behavior.
- Modify `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md` and generated `skills/web-api-test-execution-evidence/SKILL.md`: describe the five-stage visible experience and evidence rules.

---

### Task 1: Pure Five-Stage Presentation Model

**Files:**
- Create: `packages/testing-runner/src/runtime/visual-progress-model.ts`
- Modify: `packages/testing-runner/src/runtime/visual-progress.ts`
- Test: `packages/testing-runner/tests/visual-progress.test.ts`

**Interfaces:**
- Produces: `PresentationPhase`, `PresentationView`, `PanelSide`, `VisualProgressState`, `DeliveryArtifact`, `DeliverySummary`, and pure transition functions.
- Produces: `actionPresentation(action, outcome?)` returning only safe human-readable request, response, expected, actual, and assertion fields.
- Consumes: existing `RunObserver` event types and `ManifestAction`.

- [ ] **Step 1: Write failing state-transition and content tests**

Add focused tests that require the five phases, bilingual labels, API details, and exact status styling markers:

```ts
const manifestCase = (caseId: string): RunManifest["cases"][number] => ({
  case_id: caseId,
  original: {
    "用例 ID": caseId,
    "所属模块": "订单创建",
    "用例标题": "重复提交不得生成两笔订单",
    "验证功能点": "订单幂等",
    "前置条件": "商品库存充足",
    "测试步骤": "重复提交相同幂等键",
    "预期结果": "只生成一笔订单",
    "优先级": "P0",
    "执行结果": "",
    "备注": "",
  },
  steps: [],
});

const apiRequest = (method: "POST", path: string): ManifestAction => ({
  type: "api.request",
  action_id: "API-007-request",
  target_alias: "api",
  method,
  path,
  risk: "R1",
});

const caseResult = (caseId: string, status: CaseStatus): RunCaseResult => ({
  case_id: caseId,
  case_status: status,
  run_status: status === "未执行" ? "blocked" : "completed",
  assertions: [],
  evidence: [],
});

const completedResult = (): RunResult => ({
  protocol_version: "1.0.0",
  run_id: "run-demo",
  manifest_hash: "a".repeat(64),
  run_status: "completed",
  started_at: "2026-07-17T00:00:00.000Z",
  completed_at: "2026-07-17T00:01:00.000Z",
  cases: [
    ...Array.from({ length: 5 }, (_, index) => caseResult(`PASS-${index}`, "通过")),
    caseResult("FAIL-1", "不通过"),
    caseResult("PENDING-1", "待定"),
    ...Array.from({ length: 11 }, (_, index) => caseResult(`IDLE-${index}`, "未执行")),
  ],
});

const deliverySummary = (): DeliverySummary => ({
  result: completedResult(),
  artifacts: [{ kind: "html", label: "HTML 报告", fileName: "result.html", href: "file:///result.html", exists: true }],
});

test("presentation moves from preflight through results without changing verdicts", () => {
  let state = createInitialVisualProgressState({
    manifestHash: "a".repeat(64),
    origins: ["http://127.0.0.1:64214"],
    caseTotal: 18,
    actionTotal: 42,
  });
  assert.equal(state.phase, "preflight");

  state = casePreviewState(state, manifestCase("WEB-007"), 7);
  assert.equal(state.phase, "case-preview");
  assert.equal(state.caseLabel, "第 7 / 18 条测试用例（Test Case）");

  state = actionStartedState(state, apiRequest("POST", "/api/orders"));
  assert.equal(state.phase, "running");
  assert.equal(state.view, "api");

  state = collectingState(state, completedResult());
  assert.equal(state.phase, "collecting");

  state = resultsState(state, deliverySummary());
  assert.equal(state.phase, "results");
  assert.deepEqual(state.counts, { 通过: 5, 不通过: 1, 待定: 1, 未执行: 11 });
});

test("rendered status rows follow the approved four-state treatment", () => {
  const html = renderVisualProgressHtml(resultsState(collectingState(
    createInitialVisualProgressState({ manifestHash: "a".repeat(64), origins: [], caseTotal: 18, actionTotal: 42 }),
    completedResult(),
  ), deliverySummary()));
  assert.match(html, /data-case-status="通过"/);
  assert.match(html, /data-case-status="不通过"[^>]*class="[^"]*status-failed/);
  assert.match(html, /data-case-status="待定"[^>]*class="[^"]*status-pending/);
  assert.match(html, /data-case-status="未执行"[^>]*class="[^"]*status-idle/);
});

test("API presentation exposes response and assertion but never secret references", () => {
  const view = actionPresentation({
    ...apiRequest("POST", "/api/orders"),
    header_refs: { Authorization: { source: "env", name: "SECRET_TOKEN" } },
    input_ref: { source: "fixture", name: "PRIVATE_ORDER_PAYLOAD" },
  }, {
    status: "passed",
    actual: { request: { method: "POST", path: "/api/orders" }, response: { status: 201, body: { order_id: "ORD-0001" } } },
    attachments: [],
  });
  assert.equal(view.method, "POST");
  assert.equal(view.path, "/api/orders");
  assert.equal(view.responseStatus, 201);
  assert.doesNotMatch(JSON.stringify(view), /SECRET_TOKEN|PRIVATE_ORDER_PAYLOAD|Authorization/);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- --test-name-pattern "presentation|status rows|API presentation"
```

Expected: FAIL because the five-stage model and transition functions do not exist.

- [ ] **Step 3: Implement the pure model**

Create the model with these exact public shapes and exhaustive transitions:

```ts
export type PresentationPhase = "preflight" | "case-preview" | "running" | "collecting" | "results";
export type PresentationView = "web" | "api";
export type PanelSide = "left" | "right";

export interface DeliveryArtifact {
  kind: "excel" | "html" | "json" | "screenshots" | "logs" | "trace";
  label: string;
  fileName: string;
  href: string;
  exists: boolean;
}

export interface DeliverySummary {
  result: RunResult;
  artifacts: DeliveryArtifact[];
}

export interface VisualActionPresentation {
  category: "web" | "api" | "database" | "cleanup" | "blocked";
  title: string;
  summary: string;
  method?: string;
  path?: string;
  responseStatus?: number;
  expected?: string;
  actual?: string;
  assertionSource?: string;
}
```

Implement `createInitialVisualProgressState`, `casePreviewState`, `actionStartedState`, `actionCompletedState`, `collectingState`, `resultsState`, `countsFromResult`, and `actionPresentation`. Only read fields already present in manifest actions and `ActionOutcome.actual`; stringify bounded values and never resolve credential/data references.

- [ ] **Step 4: Rebuild the renderer around the model**

Keep one `VISUAL_PROGRESS_HOST_ID`. Render phase-specific semantic sections:

```ts
export function renderVisualProgressHtml(state: VisualProgressState): string {
  if (state.phase === "preflight") return renderPreflight(state);
  if (state.phase === "case-preview") return renderCasePreview(state);
  if (state.phase === "collecting") return renderCollecting(state);
  if (state.phase === "results") return renderResults(state);
  return state.view === "api" ? renderApiExecution(state) : renderWebCockpit(state);
}
```

Use the approved professional-quality theme. Keep numbers tabular, card radius at or below 8px, no purple/blue gradients, and no nested cards. Add `data-phase`, `data-view`, `data-panel-side`, and `data-case-status` for tests and inspection.

- [ ] **Step 5: Run focused and full tests, then commit**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- --test-name-pattern "visual progress|presentation|status rows|API presentation"
npm run typecheck --workspace @saitamasans/testing-runner
```

Expected: PASS with no type errors.

Commit:

```powershell
git add packages/testing-runner/src/runtime/visual-progress-model.ts packages/testing-runner/src/runtime/visual-progress.ts packages/testing-runner/tests/visual-progress.test.ts
git commit -m "feat: add five-stage runner presentation model"
```

---

### Task 2: Browser Cockpit, Target Guidance, Trace, and Result Center

**Files:**
- Modify: `packages/testing-runner/src/runtime/visual-progress.ts`
- Modify: `packages/testing-runner/src/runtime/browser-session.ts`
- Modify: `packages/testing-runner/src/commands/run.ts`
- Modify: `packages/testing-runner/src/actions/web-adapter.ts`
- Test: `packages/testing-runner/tests/browser-session.test.ts`
- Test: `packages/testing-runner/tests/visual-progress.test.ts`
- Test: `packages/testing-runner/tests/runtime-evidence.test.ts`

**Interfaces:**
- Consumes: Task 1 presentation transitions and `DeliveryArtifact`.
- Produces: `BrowserSession.finalizeTrace(): Promise<string | undefined>` and `BrowserSession.showDeliveryResult(summary): Promise<void>`.
- Produces: `writeReports(...) -> Promise<DeliveryArtifact[]>` after report consistency succeeds.
- Produces: `formalEvidenceScreenshotOptions()` as the single screenshot rule used by `executeWebAction`.

- [ ] **Step 1: Write failing browser lifecycle tests**

Add tests for maximized preflight, case-preview pause, API-only full-screen content, one-host reinjection, Trace finalization before result display, and idempotent close:

```ts
test("visible session finalizes Trace before showing delivery results", async () => {
  const events: string[] = [];
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "delivery-browser-"));
  const page = { evaluate: async () => { events.push("results.render"); } } as unknown as Page;
  const context = {
    tracing: {
      start: async () => { events.push("trace.start"); },
      stop: async ({ path: tracePath }: { path: string }) => {
        events.push("trace.stop");
        await writeFile(tracePath, "trace", "utf8");
      },
    },
    newPage: async () => page,
    close: async () => { events.push("context.close"); },
  };
  const browser = {
    newContext: async () => context,
    close: async () => { events.push("browser.close"); },
  };
  const session = await openBrowserSession({
    manifest: manifestWith("web.goto"),
    mode: "interactive",
    visibility: "visible",
    outputDir,
    launchBrowser: async () => browser as unknown as Browser,
  });
  const tracePath = await session?.finalizeTrace();
  await session?.showDeliveryResult({
    result: {
      protocol_version: "1.0.0",
      run_id: "run-delivery",
      manifest_hash: "a".repeat(64),
      run_status: "completed",
      started_at: "2026-07-17T00:00:00.000Z",
      completed_at: "2026-07-17T00:01:00.000Z",
      cases: [],
    },
    artifacts: [{ kind: "html", label: "HTML 报告", fileName: "result.html", href: "file:///result.html", exists: true }],
  });
  await session?.close();
  assert.deepEqual(events, ["trace.start", "trace.stop", "results.render", "context.close", "browser.close"]);
  assert.match(tracePath ?? "", /playwright-trace\.zip$/);
});

test("formal Web screenshots hide the complete Runner host", async () => {
  assert.deepEqual(formalEvidenceScreenshotOptions(), {
    fullPage: true,
    style: `#${VISUAL_PROGRESS_HOST_ID}{display:none!important}`,
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- --test-name-pattern "finalizes Trace|formal Web screenshots|case preview|API-only"
```

Expected: FAIL because `finalizeTrace` and `showDeliveryResult` do not exist and the new phase timing is absent.

- [ ] **Step 3: Implement visual lifecycle timing and safe target guidance**

Update `VisualProgressController` so `runStarted` renders preflight for a bounded 3–5 seconds, `caseStarted` renders preview for at most 1.5 seconds, and `actionStarted` switches to live execution. Resolve a Web target bounding box only for visual placement; catch every lookup error and never reuse this lookup for the real action.

Use one Shadow DOM host containing both cockpit and highlight. The host remains `pointer-events: none` during execution. Choose the opposite side when the target bounding box intersects the default right-side cockpit area; otherwise keep `right`.

- [ ] **Step 4: Make Trace finalization idempotent and delivery interactive**

Implement:

```ts
export interface BrowserSession {
  page: Page;
  observer?: RunObserver;
  finalizeTrace(): Promise<string | undefined>;
  showDeliveryResult(summary: DeliverySummary): Promise<void>;
  completionPause(): Promise<void>;
  close(): Promise<void>;
}
```

`finalizeTrace` creates `evidence/playwright-trace.zip` once without closing the context. `showDeliveryResult` changes the host to full-screen `pointer-events: auto`, shows filenames rather than absolute local paths, and renders links only for existing artifacts. `close` calls `finalizeTrace` if needed and remains safe when called twice.

Export and use this exact formal-screenshot helper from `web-adapter.ts`:

```ts
export function formalEvidenceScreenshotOptions(): { fullPage: true; style: string } {
  return { fullPage: true, style: `#${VISUAL_PROGRESS_HOST_ID}{display:none!important}` };
}
```

- [ ] **Step 5: Return verified delivery artifacts from the run command**

Change `writeReports` to return exact artifact metadata only after `verifyReportConsistency` passes. In `runRunCommand`, execute this sequence:

```ts
const result = await runApprovedManifest(...);
await writeJson(path.join(options.outputDir, "run-result.json"), result);
const artifacts = await writeReports(options.outputDir, manifest, result);
const tracePath = await browserSession?.finalizeTrace();
await browserSession?.showDeliveryResult({ result, artifacts: withTrace(artifacts, tracePath) });
await browserSession?.completionPause();
```

Include `result.xlsx`, `result.html`, `run-result.json`, `projected-report.json`, evidence directory, run events, and Trace when present. Missing files must render as unavailable rather than as working links.

- [ ] **Step 6: Run focused, full, and build verification, then commit**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- --test-name-pattern "browser|visual progress|evidence|delivery"
npm run typecheck --workspace @saitamasans/testing-runner
npm run build --workspace @saitamasans/testing-runner
```

Expected: PASS; build copies schemas, knowledge, and renderer without warnings.

Commit:

```powershell
git add packages/testing-runner/src packages/testing-runner/tests
git commit -m "feat: add visual runner cockpit and result center"
```

---

### Task 3: Standalone SkillMart Storefront

**Files:**
- Create: `demo/skillmart/src/app.ts`
- Create: `demo/skillmart/public/index.html`
- Create: `demo/skillmart/public/app.css`
- Create: `demo/skillmart/public/app.js`
- Create: `demo/skillmart/public/assets/skillmart-products.png`
- Modify: `demo/skillmart/scripts/start-local-demo.ts`
- Modify: `packages/testing-runner/tests/fixtures/skillmart-app.ts`
- Modify: `packages/testing-runner/tests/demo-skillmart.test.ts`

**Interfaces:**
- Produces: unchanged `startSkillMartApp(options): Promise<{ baseUrl; close() }>`.
- Preserves: all existing API endpoints, `SKU-BOOK-001`, `SKU-MUG-002`, the idempotency defect, and current `data-testid` values.
- Adds: read-only `GET /api/orders` and `GET /api/runtime-state` for the visible order and runtime-data views.

- [ ] **Step 1: Write failing storefront and compatibility tests**

Add real-browser tests that check independent usability and existing locator compatibility:

```ts
test("SkillMart is understandable and usable before Runner injection", async () => {
  const app = await startSkillMartApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(app.baseUrl);
    assert.equal(await page.getByText("SkillMart", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("商品中心", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("订单中心", { exact: true }).isVisible(), true);
    assert.equal(await page.getByText("运行数据", { exact: true }).isVisible(), true);
    await page.getByTestId("coupon-code").fill("SKILL20");
    await page.getByTestId("create-order").click();
    assert.match(await page.getByTestId("status").innerText(), /订单已创建 ORD-/);
  } finally {
    await browser.close();
    await app.close();
  }
});

test("SkillMart assets are local and existing API contracts stay compatible", async () => {
  const app = await startSkillMartApp();
  try {
    const html = await fetch(`${app.baseUrl}/`).then((response) => response.text());
    assert.doesNotMatch(html, /https?:\/\/(?!127\.0\.0\.1)/);
    assert.equal((await fetch(`${app.baseUrl}/api/products`)).status, 200);
    assert.equal((await fetch(`${app.baseUrl}/__test/reset`, { method: "POST" })).status, 200);
  } finally {
    await app.close();
  }
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- --test-name-pattern "understandable and usable|assets are local"
```

Expected: FAIL because the current page has no product/order/runtime information architecture or local product imagery.

- [ ] **Step 3: Generate and add the local product bitmap**

Generate one 2×2 square product sheet with this exact art direction:

```text
Create a clean editorial product photography contact sheet with four equal square panels: a Chinese software-testing handbook, a matte ceramic testing mug, a compact API debugging device, and a small automation toolkit case. Neutral light-gray studio background, soft natural shadows, restrained forest-green accents, realistic materials, no logos, no text, no gradients, no people, front three-quarter views, consistent lighting, high clarity for ecommerce cards.
```

Save it as `demo/skillmart/public/assets/skillmart-products.png`. Use CSS background positions to crop one panel per product card; do not create network dependencies.

- [ ] **Step 4: Move the server into the demo application and preserve APIs**

Move the existing in-memory product/order state into `demo/skillmart/src/app.ts`. Serve the public directory with an explicit MIME map and path traversal rejection. Keep current API branches verbatim except for extracting helpers, add read-only order/runtime endpoints, and keep `POST /__test/reset` local-only.

Change the test fixture to a direct re-export:

```ts
export {
  startSkillMartApp,
  type SkillMartApp,
  type SkillMartAppOptions,
} from "../../../../demo/skillmart/src/app.js";
```

- [ ] **Step 5: Build the usable storefront**

Implement semantic navigation and four work views in vanilla HTML/CSS/JavaScript. The first viewport must show brand, products, stock, price, checkout controls, and current feedback. Use stable element sizes and existing locators:

```html
<input data-testid="coupon-code" aria-label="优惠券代码" value="SKILL20">
<button data-testid="create-order" type="button">创建订单</button>
<p data-testid="status" role="status">尚未创建订单</p>
```

Add loading, empty, stock-shortage, invalid-coupon, create-failure, missing-order, forbidden, non-cancellable, and reset feedback. Use the professional-quality visual direction: neutral storefront, graphite typography, restrained forest green, no marketing Hero, no decorative blobs, no nested cards, and no text overlap at 1920×1080 or narrow viewport.

- [ ] **Step 6: Run API, browser, and visual checks, then commit**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- --test-name-pattern "SkillMart"
npm run typecheck --workspace @saitamasans/testing-runner
```

Capture desktop and narrow screenshots and inspect them for blank images, overflow, overlapping text, and hidden test controls.

Commit:

```powershell
git add demo/skillmart packages/testing-runner/tests/fixtures/skillmart-app.ts packages/testing-runner/tests/demo-skillmart.test.ts
git commit -m "feat: redesign SkillMart demo storefront"
```

---

### Task 4: Skill Instructions and Packaged Runner Synchronization

**Files:**
- Modify: `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md`
- Modify: `skills/web-api-test-execution-evidence/SKILL.md`
- Modify: `skill-sources/web-api-test-execution-evidence/references/runner-commands.md`
- Modify: `skills/web-api-test-execution-evidence/references/runner-commands.md`
- Test: `tests/runner-bootstrap.test.mjs`
- Test: `packages/testing-runner/tests/cli.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 behavior and unchanged command-line flags.
- Produces: discoverable instructions that tell Codex the first run downloads pinned dependencies automatically and visible runs show the five-stage experience by default.

- [ ] **Step 1: Write failing package-content tests**

Require both source and installed copies to contain the same visible-execution contract:

```js
test("eighth Skill documents the complete visible execution journey", async () => {
  for (const file of [sourceSkill, installedSkill]) {
    const content = await readFile(file, "utf8");
    for (const marker of [
      "执行准备",
      "用例预告",
      "实时执行",
      "证据收集",
      "结果中心",
      "测试用例（Test Case）",
      "API 流水",
    ]) assert.match(content, new RegExp(marker));
  }
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
npm test -- --test-name-pattern "complete visible execution journey"
```

Expected: FAIL because the current Skill only describes a single progress panel.

- [ ] **Step 3: Update source, generated Skill, and command reference**

Replace only the interactive-visible-execution section. State that the browser opens maximized, shows 3–5 seconds of preflight, previews each case, displays real Web/API actions, collects evidence, and ends in the result center. Preserve installation, approval, credential, nonstandard-field mapping, risk, and report-consistency wording.

Document that first execution may automatically download the pinned Runner and Playwright Chromium, while the user does not need an npm account or manual npm command.

- [ ] **Step 4: Validate exact synchronization and package behavior**

Run:

```powershell
npm test
npm test --workspace @saitamasans/testing-runner
npm run build --workspace @saitamasans/testing-runner
```

Expected: all repository and Runner tests PASS.

- [ ] **Step 5: Commit**

```powershell
git add skill-sources/web-api-test-execution-evidence skills/web-api-test-execution-evidence tests packages/testing-runner/tests/cli.test.ts
git commit -m "docs: explain visual eighth skill execution"
```

---

### Task 5: Real End-to-End Execution, Visual QA, and Recording Evidence

**Files:**
- Modify: `demo/skillmart/scripts/build-demo-materials.mjs`
- Modify: `demo/skillmart/scripts/finalize-eighth-skill-tutorial.mjs`
- Create under ignored `build/`: new eighth-Skill acceptance run, stage screenshots, unedited recording, edited recording, and acceptance navigation.
- Modify: `docs/release/v1.1.0-eighth-skill-review.md` only after all verification evidence exists.

**Interfaces:**
- Consumes: the installed Skill launcher, pinned Runner, standard ten-column cases, execution profile, approval, SkillMart application, and Tasks 1–4 UI.
- Produces: a complete acceptance directory with requirements, test cases (Test Cases), execution files, stage PNGs, Trace, Excel/HTML/JSON, unedited 1080p60 recording, edited tutorial, and evidence index.

- [ ] **Step 1: Run all automated gates before recording**

Run:

```powershell
npm test
npm test --workspace @saitamasans/testing-runner
npm run typecheck --workspace @saitamasans/testing-runner
npm run build --workspace @saitamasans/testing-runner
```

Expected: every command exits 0 with no failing test.

- [ ] **Step 2: Build fresh demo materials and start the local app**

Run the existing deterministic material builder into a new timestamped directory. Start SkillMart on `127.0.0.1`, record the printed origin, and verify `/api/health`, `/api/products`, and `/shop` before execution.

- [ ] **Step 3: Invoke the installed eighth Skill path exactly as an external user would**

Run `plan`, inspect the preview, create a short-lived approval, and run interactive visible mode with default progress:

```powershell
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs run --manifest <RUN_MANIFEST> --approval <APPROVAL> --output-dir <RESULT_DIR> --mode interactive --browser auto --slow-mo 200 --progress auto
```

Verify the visible sequence is preflight → case preview → real Web/API execution → evidence collection → result center. Do not substitute a static page or prerecorded animation.

- [ ] **Step 4: Capture and inspect stage evidence**

Save independent PNGs for preflight, Web cockpit, API流水, failed case, pending case, evidence collection, and result center. Also inspect formal Web evidence PNG files and confirm they do not contain the Runner host.

At 1920×1080 and a narrow viewport, confirm nonblank images, visible product assets, no text overlap, no panel obstruction of the current target, and readable long titles/paths/JSON.

- [ ] **Step 5: Verify artifacts and report consistency**

Check that these files exist and are nonempty: `result.xlsx`, `result.html`, `run-result.json`, `projected-report.json`, `run-events.jsonl`, `evidence-index.json`, API request/response JSON, Web PNG files, and `playwright-trace.zip`. Run the existing report verification command and compare four-state counts across Excel, HTML, and JSON.

- [ ] **Step 6: Record the complete eighth-Skill tutorial**

Record the full desktop from execution confirmation through the result center at 1920×1080, 60 fps. Retain the complete unedited recording. Create an edited version under 20 minutes without removing the visible proof that real clicks, API calls, assertions, evidence, and report delivery occurred.

- [ ] **Step 7: Finalize acceptance navigation and release audit**

Generate SHA-256 evidence indexing, update the acceptance navigation with every real artifact, validate media through FFprobe, and update `docs/release/v1.1.0-eighth-skill-review.md` with measured results rather than claims.

- [ ] **Step 8: Run verification-before-completion and commit tracked audit changes**

Run all automated gates once more, inspect `git diff --check`, and verify the acceptance links. Commit only tracked source, tests, Skill docs, and release audit; keep large build/video artifacts ignored unless the repository's release workflow explicitly packages them.

```powershell
git add docs/release/v1.1.0-eighth-skill-review.md
git commit -m "test: verify redesigned eighth skill showcase"
```
