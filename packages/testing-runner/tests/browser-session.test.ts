import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { Browser, Page } from "playwright";

import {
  openBrowserSession,
  resolveBrowserSettings,
} from "../src/runtime/browser-session.js";
import type { RunManifest } from "../src/types.js";

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
