import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectTarget } from "../src/collector.mjs";
import { startInteractiveFixture } from "./fixtures/app-server.mjs";

test("interactive scan keeps one browser context and run across fixture login", async () => {
  const fixture = await startInteractiveFixture();
  const output = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-interactive-auth-"));
  try {
    let ready;
    const result = await collectTarget({
      url: fixture.url,
      outputDir: output,
      interactive: true,
      onInteractiveReady: ({ browser, context, page }) => { ready = { browser, context, page }; },
      interactiveController: async ({ browser, context, page }) => {
        assert.equal(browser, ready.browser);
        assert.equal(context, ready.context);
        assert.equal(page, ready.page);
        await page.click("#login");
        await page.waitForURL(/\/dashboard$/);
        await page.waitForTimeout(200);
      },
    });
    const paths = result.runData.assets.map((asset) => new URL(asset.canonical_url).pathname);
    assert.ok(paths.includes("/assets/login.js"));
    assert.ok(paths.includes("/assets/dashboard.js"));
    assert.ok(paths.includes("/assets/protected-lazy.js"));
    assert.equal(result.runData.active_business_api_calls, 0);
    assert.ok(fixture.requests.some((request) => request.url === "/login"));
    assert.ok(fixture.requests.some((request) => request.url === "/dashboard"));
    assert.ok(fixture.requests.every((request) => request.method === "GET"));
  } finally {
    await fixture.close();
    await rm(output, { recursive: true, force: true });
  }
});
