import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Browser, Page } from "playwright";

import {
  applyBrowserContextCleanupFailures,
  openBrowserSession,
  resolveBrowserSettings,
} from "../src/runtime/browser-session.js";
import { runApprovedManifest } from "../src/runtime/run-orchestrator.js";
import type { RunManifest, RunResult } from "../src/types.js";

function manifestWith(actionType: string): RunManifest {
  return {
    cases: [{ steps: [{ type: actionType }] }],
  } as unknown as RunManifest;
}

test("interactive auto mode is visible with 200ms slow motion", () => {
  assert.deepEqual(
    resolveBrowserSettings({ mode: "interactive", visibility: "auto" }),
    { headless: false, slowMo: 200 },
  );
});

test("ci mode is always headless", () => {
  assert.deepEqual(
    resolveBrowserSettings({ mode: "ci", visibility: "visible", slowMo: 999 }),
    { headless: true, slowMo: 0 },
  );
});

test("interactive api-only auto mode launches a maximized visual progress browser", async () => {
  let launches = 0;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "api-only-browser-"));
  let launchOptions;
  let contextOptions;
  let neutralPageLoaded = false;
  const page = {
    setContent: async () => { neutralPageLoaded = true; },
    evaluate: async () => undefined,
  } as unknown as Page;
  const context = {
    tracing: { start: async () => undefined, stop: async () => undefined },
    newPage: async () => page,
    close: async () => undefined,
  };
  const browser = {
    newContext: async (options) => { contextOptions = options; return context; },
    close: async () => undefined,
  };
  const session = await openBrowserSession({
    manifest: manifestWith("api.request"),
    mode: "interactive",
    visibility: "auto",
    outputDir,
    launchBrowser: async (options) => {
      launches += 1;
      launchOptions = options;
      return browser as unknown as Browser;
    },
  });
  assert.ok(session);
  assert.equal(launches, 1);
  assert.deepEqual(launchOptions, { headless: false, slowMo: 200, args: ["--start-maximized"] });
  assert.deepEqual(contextOptions, { viewport: null });
  assert.equal(neutralPageLoaded, true);
  await session?.close();
});

for (const [name, settings] of [
  ["progress off", { mode: "interactive", visibility: "auto", progress: "off" }],
  ["ci", { mode: "ci", visibility: "visible", progress: "auto" }],
  ["headless", { mode: "interactive", visibility: "headless", progress: "auto" }],
] as const) {
  test(`api-only ${name} mode does not launch a browser`, async () => {
    let launches = 0;
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "api-only-no-browser-"));
    const session = await openBrowserSession({
      manifest: manifestWith("api.request"),
      ...settings,
      outputDir,
      launchBrowser: async () => {
        launches += 1;
        throw new Error("must not launch");
      },
    });
    assert.equal(session, undefined);
    assert.equal(launches, 0);
  });
}

test("visible session launches headed and writes Playwright trace", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "visible-browser-"));
  const page = { kind: "page" } as unknown as Page;
  let launchOptions;
  let contextOptions;
  let browserClosed = false;
  let contextClosed = false;
  let tracingStarted = false;
  const context = {
    tracing: {
      start: async () => { tracingStarted = true; },
      stop: async ({ path: tracePath }) => {
        await writeFile(tracePath, "trace", "utf8");
      },
    },
    newPage: async () => page,
    close: async () => { contextClosed = true; },
  };
  const browser = {
    newContext: async (options) => { contextOptions = options; return context; },
    close: async () => { browserClosed = true; },
  };

  const session = await openBrowserSession({
    manifest: manifestWith("web.goto"),
    mode: "interactive",
    visibility: "visible",
    outputDir,
    launchBrowser: async (options) => {
      launchOptions = options;
      return browser as unknown as Browser;
    },
  });

  assert.deepEqual(launchOptions, { headless: false, slowMo: 200, args: ["--start-maximized"] });
  assert.deepEqual(contextOptions, { viewport: null });
  assert.equal(session?.page, page);
  assert.equal(tracingStarted, true);
  await session?.close();
  assert.equal(contextClosed, true);
  assert.equal(browserClosed, true);
  assert.equal(
    await readFile(path.join(outputDir, "evidence", "playwright-trace.zip"), "utf8"),
    "trace",
  );
});

test("prepares every Web case in a fresh browser context", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "isolated-browser-cases-"));
  const contexts: Array<{ id: number; closed: boolean }> = [];
  const guardedContexts: number[] = [];
  const browser = {
    newContext: async () => {
      const state = { id: contexts.length + 1, closed: false };
      contexts.push(state);
      return {
        tracing: {
          start: async () => undefined,
          stop: async ({ path: tracePath }: { path: string }) => writeFile(tracePath, `trace-${state.id}`, "utf8"),
        },
        route: async () => { guardedContexts.push(state.id); },
        newPage: async () => ({ contextId: state.id } as unknown as Page),
        close: async () => { state.closed = true; },
      };
    },
    close: async () => undefined,
  };
  const session = await openBrowserSession({
    manifest: manifestWith("web.goto"),
    mode: "ci",
    outputDir,
    allowedNetworkOrigin: "http://127.0.0.1:43123",
    launchBrowser: async () => browser as unknown as Browser,
  });

  const first = await session?.prepareCase("LOGIN-001");
  const second = await session?.prepareCase("LOGIN-002");
  assert.notEqual(first, second);
  assert.deepEqual(contexts.map(({ id }) => id), [1, 2]);
  assert.deepEqual(guardedContexts, [1, 2]);
  assert.equal(contexts[0]?.closed, true);
  await session?.close();
  assert.equal(contexts[1]?.closed, true);
  const records = session?.contextRecords() ?? [];
  assert.deepEqual(records.map(({ case_id }) => case_id), ["LOGIN-001", "LOGIN-002"]);
  assert.equal(new Set(records.map(({ context_id }) => context_id)).size, 2);
  assert.equal(records.every(({ context_close_status }) => context_close_status === "closed"), true);
  assert.deepEqual(records.map(({ context_reused, isolation_scope, flow_group }) => ({ context_reused, isolation_scope, flow_group })), [
    { context_reused: false, isolation_scope: "case", flow_group: null },
    { context_reused: false, isolation_scope: "case", flow_group: null },
  ]);
  assert.equal(await readFile(path.join(outputDir, "evidence", "LOGIN-001", "playwright-trace.zip"), "utf8"), "trace-1");
  assert.equal(await readFile(path.join(outputDir, "evidence", "LOGIN-002", "playwright-trace.zip"), "utf8"), "trace-2");
  assert.deepEqual(await session?.finalizeTraces(), [
    path.join(outputDir, "evidence", "LOGIN-001", "playwright-trace.zip"),
    path.join(outputDir, "evidence", "LOGIN-002", "playwright-trace.zip"),
  ]);
});

test("explicit flow group shares one context only inside the group", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "flow-group-browser-"));
  let contexts = 0;
  const browser = {
    newContext: async () => {
      contexts += 1;
      return { tracing: { start: async () => undefined, stop: async () => undefined }, newPage: async () => ({ context: contexts } as unknown as Page), close: async () => undefined };
    },
    close: async () => undefined,
  };
  const session = await openBrowserSession({ manifest: manifestWith("web.goto"), mode: "ci", outputDir, launchBrowser: async () => browser as unknown as Browser });
  const first = await session?.prepareCase("FLOW-1", { isolationScope: "flow_group", flowGroup: "login-flow" });
  const second = await session?.prepareCase("FLOW-2", { isolationScope: "flow_group", flowGroup: "login-flow" });
  const third = await session?.prepareCase("CASE-3", { isolationScope: "case", flowGroup: null });
  assert.equal(first, second);
  assert.notEqual(second, third);
  assert.equal(contexts, 2);
  await session?.close();
  const records = session?.contextRecords() ?? [];
  assert.equal(records[0]?.context_id, records[1]?.context_id);
  assert.notEqual(records[1]?.context_id, records[2]?.context_id);
  assert.deepEqual(records.map(({ context_reused, isolation_scope, flow_group }) => ({ context_reused, isolation_scope, flow_group })), [
    { context_reused: false, isolation_scope: "flow_group", flow_group: "login-flow" },
    { context_reused: true, isolation_scope: "flow_group", flow_group: "login-flow" },
    { context_reused: false, isolation_scope: "case", flow_group: null },
  ]);
});

test("observer rendering follows the new Page after case context rotation", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "observer-page-rotation-"));
  const contexts: Array<{ id: number; closed: boolean; evaluations: number }> = [];
  const browser = {
    newContext: async () => {
      const state = { id: contexts.length + 1, closed: false, evaluations: 0 };
      contexts.push(state);
      const page = {
        evaluate: async () => {
          if (state.closed) throw new Error(`page-${state.id}-closed`);
          state.evaluations += 1;
        },
      } as unknown as Page;
      return {
        tracing: { start: async () => undefined, stop: async () => undefined },
        newPage: async () => page,
        close: async () => { state.closed = true; },
      };
    },
    close: async () => undefined,
  };
  const manifest = orderedWebManifest(["CASE-1", "CASE-2"]);
  const session = await openBrowserSession({ manifest, mode: "interactive", visibility: "visible", outputDir, launchBrowser: async () => browser as unknown as Browser });
  await session?.prepareCase("CASE-1");
  await session?.observer?.caseStarted?.({ item: manifest.cases[0], case_index: 1 } as never);
  await session?.prepareCase("CASE-2");
  await session?.observer?.caseStarted?.({ item: manifest.cases[1], case_index: 2 } as never);
  assert.deepEqual(contexts.map(({ evaluations }) => evaluations), [1, 1]);
  await session?.close();
});

test("a context close failure is recorded while the next independent case continues in a fresh context", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "close-failure-browser-"));
  let contexts = 0;
  const browser = {
    newContext: async () => {
      contexts += 1;
      const id = contexts;
      return {
        tracing: { start: async () => undefined, stop: async () => undefined },
        newPage: async () => ({ context: id } as unknown as Page),
        close: async () => { if (id === 1 || id === 3) throw new Error(`close failed: ${id}`); },
      };
    },
    close: async () => undefined,
  };
  const session = await openBrowserSession({ manifest: manifestWith("web.goto"), mode: "ci", outputDir, launchBrowser: async () => browser as unknown as Browser });
  await session?.prepareCase("CASE-1");
  const second = await session?.prepareCase("CASE-2");
  assert.equal((second as unknown as { context: number }).context, 2);
  const third = await session?.prepareCase("CASE-3");
  assert.equal((third as unknown as { context: number }).context, 3);
  assert.equal(contexts, 3);
  await session?.close();
  const records = session?.contextRecords() ?? [];
  assert.equal(records.find(({ case_id }) => case_id === "CASE-1")?.context_close_status, "failed");
  assert.equal(records.find(({ case_id }) => case_id === "CASE-3")?.context_close_status, "failed");
  assert.notEqual(records.find(({ case_id }) => case_id === "CASE-2")?.context_id, records.find(({ case_id }) => case_id === "CASE-3")?.context_id);
});

test("context close failures affect their owning cases without erasing business failures", () => {
  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id: "run-context-cleanup",
    manifest_hash: "a".repeat(64),
    run_status: "completed",
    started_at: new Date().toISOString(),
    cases: [
      { case_id: "CASE-1", case_status: "通过", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "CASE-2", case_status: "不通过", run_status: "completed", assertions: [], evidence: [] },
      { case_id: "CASE-3", case_status: "通过", run_status: "completed", assertions: [], evidence: [] },
    ],
  };
  applyBrowserContextCleanupFailures(result, [
    { case_id: "CASE-1", browser_id: "browser", context_id: "one", context_created_at: "created", context_closed_at: "closed", context_close_status: "failed", context_reused: false, isolation_scope: "case", flow_group: null },
    { case_id: "CASE-2", browser_id: "browser", context_id: "two", context_created_at: "created", context_closed_at: "closed", context_close_status: "failed", context_reused: false, isolation_scope: "case", flow_group: null },
    { case_id: "CASE-3", browser_id: "browser", context_id: "three", context_created_at: "created", context_closed_at: "closed", context_close_status: "closed", context_reused: false, isolation_scope: "case", flow_group: null },
  ]);
  assert.equal(result.run_status, "executor_error");
  assert.deepEqual(result.cases.map(({ case_status, run_status }) => ({ case_status, run_status })), [
    { case_status: "未执行", run_status: "executor_error" },
    { case_status: "不通过", run_status: "executor_error" },
    { case_status: "通过", run_status: "completed" },
  ]);
});

for (const [name, caseIds, outcomes] of [
  ["failure/success/failure", ["CASE-1", "CASE-2", "CASE-3"], ["failed", "passed", "failed"]],
  ["success/failure/success", ["LOGIN-MINI-001", "LOGIN-MINI-002", "LOGIN-MINI-003"], ["passed", "failed", "passed"]],
] as const) {
  test(`${name} Runner execution keeps every case isolated and observable`, async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), "case-state-ordering-"));
    const contextStates: Array<Record<string, string>> = [];
    let currentPage: { context: number; state: Record<string, string> } | undefined;
    const browser = {
      newContext: async () => {
        const state: Record<string, string> = {};
        contextStates.push(state);
        const id = contextStates.length;
        return {
          tracing: { start: async () => undefined, stop: async () => undefined },
          newPage: async () => ({ context: id, state } as unknown as Page),
          close: async () => undefined,
        };
      },
      close: async () => undefined,
    };
    const manifest = orderedWebManifest(caseIds);
    const session = await openBrowserSession({ manifest, mode: "ci", outputDir, launchBrowser: async () => browser as unknown as Browser });
    const observed: string[] = [];
    const result = await runApprovedManifest({
      manifest,
      outputDir,
      observer: {
        caseStarted: ({ item }) => { observed.push(`started:${item.case_id}`); },
        caseCompleted: ({ item }) => { observed.push(`completed:${item.case_id}`); },
      },
      beforeCase: async (item) => {
        currentPage = await session?.prepareCase(item.case_id, { isolationScope: "case" }) as unknown as typeof currentPage;
        assert.deepEqual(currentPage?.state, {});
        currentPage!.state.case_id = item.case_id;
      },
      executeAction: async (action) => {
        const index = caseIds.findIndex((caseId) => action.action_id.startsWith(caseId));
        const outcome = outcomes[index]!;
        currentPage!.state.outcome = outcome;
        return {
          action_id: action.action_id,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
          status: outcome,
          attachments: [],
          ...(outcome === "failed" ? { error: { type: "business_assertion_failed", message: "declared failure" } } : { actual: { isolated: true } }),
        };
      },
    });
    await session?.close();
    assert.deepEqual(contextStates.map((state) => state.outcome), outcomes);
    assert.equal(new Set((session?.contextRecords() ?? []).map(({ context_id }) => context_id)).size, 3);
    assert.deepEqual(result.cases.map(({ case_id, case_status }) => ({ case_id, case_status })), caseIds.map((caseId, index) => ({
      case_id: caseId,
      case_status: outcomes[index] === "passed" ? "通过" : "不通过",
    })));
    assert.deepEqual(observed, caseIds.flatMap((caseId) => [`started:${caseId}`, `completed:${caseId}`]));
    if (caseIds.includes("LOGIN-MINI-003")) {
      assert.equal(result.cases.find(({ case_id }) => case_id === "LOGIN-MINI-002")?.case_status, "不通过");
      assert.equal(result.cases.find(({ case_id }) => case_id === "LOGIN-MINI-003")?.case_status, "通过");
      assert.equal(observed.includes("started:LOGIN-MINI-003"), true);
    }
  });
}

function orderedWebManifest(caseIds: readonly string[]): RunManifest {
  return {
    protocol_version: "1.0.0",
    manifest_id: "ordered-browser-cases",
    runner: { version: "1.0.0" },
    source: { path: "report.json", sha256: "a".repeat(64) },
    cases: caseIds.map((caseId) => ({
      case_id: caseId,
      isolation_scope: "case",
      flow_group: null,
      original: {
        "用例 ID": caseId, "所属模块": "browser", "用例标题": caseId,
        "验证功能点": "context isolation", "前置条件": "clean context", "测试步骤": "assert",
        "预期结果": "declared outcome", "优先级": "P0", "执行结果": "", "备注": "",
      },
      steps: [{ type: "web.assert", action_id: `${caseId}-assert`, target_alias: "web", assertion: "url=https://example.test/", risk: "R0" }],
    })),
  };
}

test("suite and external-existing context reuse require explicit approval", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "shared-browser-approval-"));
  const browser = {
    newContext: async () => ({ tracing: { start: async () => undefined, stop: async () => undefined }, newPage: async () => ({} as Page), close: async () => undefined }),
    close: async () => undefined,
  };
  const session = await openBrowserSession({ manifest: manifestWith("web.goto"), mode: "ci", outputDir, launchBrowser: async () => browser as unknown as Browser });
  await assert.rejects(() => session!.prepareCase("SUITE-1", { isolationScope: "suite" }), /shared_context_approval_required/);
  await assert.rejects(() => session!.prepareCase("EXTERNAL-1", { isolationScope: "external_existing" }), /shared_context_approval_required/);
  await session?.prepareCase("SUITE-1", { isolationScope: "suite", sharedContextApproved: true });
  const reused = await session?.prepareCase("SUITE-2", { isolationScope: "suite", sharedContextApproved: true });
  assert.ok(reused);
  await session?.close();
});

test("live smoke third case keeps fixed order without a business dependency or logout", async () => {
  const fixtureRoot = new URL("../../../tests/fixtures/live-smoke/", import.meta.url);
  const overrides = JSON.parse(await readFile(new URL("contract-overrides.json", fixtureRoot), "utf8")) as Record<string, { dependencies?: string[]; isolation_scope?: string; flow_group?: string | null }>;
  const profile = JSON.parse(await readFile(new URL("execution-profile.json", fixtureRoot), "utf8")) as { case_plans: Record<string, Array<{ type: string; locator?: string }>> };
  const generator = await readFile(new URL("generate-fixture.mjs", fixtureRoot), "utf8");

  assert.deepEqual(overrides["LOGIN-MINI-003"]?.dependencies ?? [], []);
  assert.deepEqual({ isolation_scope: overrides["LOGIN-MINI-003"]?.isolation_scope, flow_group: overrides["LOGIN-MINI-003"]?.flow_group }, { isolation_scope: "case", flow_group: null });
  assert.ok(generator.indexOf('"LOGIN-MINI-002"') < generator.indexOf('"LOGIN-MINI-003"'));
  assert.match(generator, /固定执行顺序/);
  assert.equal(profile.case_plans["LOGIN-MINI-003"]?.some(({ type, locator }) => type === "cleanup.web" || /logout|退出/i.test(locator ?? "")), false);
});

test("visible session finalizes Trace before showing delivery results and closes idempotently", async () => {
  const events: string[] = [];
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "delivery-browser-"));
  const page = {
    evaluate: async () => { events.push("results.render"); },
  } as unknown as Page;
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

  const firstTracePath = await session?.finalizeTrace();
  const secondTracePath = await session?.finalizeTrace();
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
    artifacts: [{
      kind: "html",
      label: "HTML 执行报告",
      fileName: "result.html",
      href: "file:///result.html",
      exists: true,
    }],
  });
  await session?.close();
  await session?.close();

  assert.equal(firstTracePath, secondTracePath);
  assert.match(firstTracePath ?? "", /playwright-trace\.zip$/);
  assert.deepEqual(events, [
    "trace.start",
    "trace.stop",
    "results.render",
    "context.close",
    "browser.close",
  ]);
});

test("smoke network policy allows only the exact 127.0.0.1 origin and fails on external requests", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "smoke-network-browser-"));
  let routeHandler: ((route: {
    request(): { url(): string };
    continue(): Promise<void>;
    abort(reason: string): Promise<void>;
  }) => Promise<void>) | undefined;
  const context = {
    tracing: {
      start: async () => undefined,
      stop: async ({ path: tracePath }: { path: string }) => writeFile(tracePath, "trace", "utf8"),
    },
    route: async (_pattern: string, handler: typeof routeHandler) => { routeHandler = handler; },
    newPage: async () => ({ kind: "page" } as unknown as Page),
    close: async () => undefined,
  };
  const browser = {
    newContext: async () => context,
    close: async () => undefined,
  };
  const session = await openBrowserSession({
    manifest: manifestWith("web.goto"),
    mode: "interactive",
    visibility: "visible",
    outputDir,
    allowedNetworkOrigin: "http://127.0.0.1:43123",
    launchBrowser: async () => browser as unknown as Browser,
  });
  assert.ok(routeHandler);
  const events: string[] = [];
  const route = (url: string) => ({
    request: () => ({ url: () => url }),
    continue: async () => { events.push(`continue:${url}`); },
    abort: async (reason: string) => { events.push(`abort:${reason}:${url}`); },
  });

  await routeHandler!(route("http://127.0.0.1:43123/fixture"));
  await routeHandler!(route("http://127.0.0.1:43124/wrong-port"));
  await routeHandler!(route("https://example.com/tracker.js"));

  assert.deepEqual(events, [
    "continue:http://127.0.0.1:43123/fixture",
    "abort:blockedbyclient:http://127.0.0.1:43124/wrong-port",
    "abort:blockedbyclient:https://example.com/tracker.js",
  ]);
  await assert.rejects(
    session?.finalizeTrace(),
    /smoke_external_request.*127\.0\.0\.1:43124.*example\.com/i,
  );
  await assert.rejects(session?.close(), /smoke_external_request/i);
});

test("browser setup failure closes the partial context and browser", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "failed-browser-setup-"));
  let contextClosed = false;
  let browserClosed = false;
  const context = {
    tracing: {
      start: async () => { throw new Error("trace setup failed"); },
    },
    close: async () => { contextClosed = true; },
  };
  const browser = {
    newContext: async () => context,
    close: async () => { browserClosed = true; },
  };

  await assert.rejects(
    openBrowserSession({
      manifest: manifestWith("web.goto"),
      mode: "interactive",
      outputDir,
      launchBrowser: async () => browser as unknown as Browser,
    }),
    /trace setup failed/,
  );
  assert.equal(contextClosed, true);
  assert.equal(browserClosed, true);
});
