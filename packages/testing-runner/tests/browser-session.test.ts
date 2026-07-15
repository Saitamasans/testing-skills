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

test("api-only manifest does not launch a browser", async () => {
  let launches = 0;
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "api-only-browser-"));
  const session = await openBrowserSession({
    manifest: manifestWith("api.request"),
    mode: "interactive",
    visibility: "auto",
    outputDir,
    launchBrowser: async () => {
      launches += 1;
      throw new Error("must not launch");
    },
  });
  assert.equal(session, undefined);
  assert.equal(launches, 0);
});

test("visible session launches headed and writes Playwright trace", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "visible-browser-"));
  const page = { kind: "page" } as unknown as Page;
  let launchOptions;
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
    newContext: async () => context,
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

  assert.deepEqual(launchOptions, { headless: false, slowMo: 200 });
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
