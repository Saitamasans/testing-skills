import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";
import { collectTarget } from "../src/collector.mjs";
import { startFixture } from "./fixtures/app-server.mjs";

test("controlled browser acceptance produces Stage 3/4 artifacts without business writes", async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-stage5-acceptance-"));
  const output = path.join(root, "controlled-run");
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(fixture.url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(100);
    await browser.close();
    const result = await collectTarget({ url: fixture.url, outputDir: output, dynamicWaitMs: 800 });
    const runData = result.runData;
    assert.equal(runData.active_business_api_calls, 0);
    assert.ok(runData.analysis_focus?.length);
    assert.ok(runData.call_chain_candidates?.some((chain) => chain.branches?.some((branch) => branch.branch_kind === "if_else")));
    const recovery = runData.call_chain_candidates?.find((chain) => chain.expanded_public_layers?.includes("refreshToken()"));
    assert.ok(recovery);
    assert.ok(recovery.nodes.length && recovery.edges.length && recovery.evidence_ids.length);
    assert.ok(runData.stage4?.display_id_registry?.length);
    assert.ok(fixture.requests.every((request) => request.method === "GET"));
    const persisted = await readFile(path.join(output, "evidence", "run-data.json"), "utf8");
    for (const secret of ["fixture-sensitive-token", "fixture-password", "654321", "fixture-cookie", "fixture-json-access-token", "fixture-json-client-secret", "fixture-json-password", "112233", "fixture-json-bearer"]) assert.doesNotMatch(persisted, new RegExp(secret));
  } finally {
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
