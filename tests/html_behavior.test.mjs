import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { renderHtml } from "../tooling/test-case-renderer.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/sample-report.json", import.meta.url), "utf8"));

test("offline HTML supports filters, row colors, counts and persisted status", async (t) => {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    t.skip(`Playwright runtime unavailable: ${error.code || error.message}`);
    return;
  }
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-html-"));
  const htmlPath = path.join(out, "sample.html");
  await renderHtml(fixture, htmlPath);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const external = [];
    page.on("request", (request) => {
      if (!request.url().startsWith("file:")) external.push(request.url());
    });
    await page.goto(pathToFileURL(htmlPath).href);
    assert.equal(external.length, 0);
    assert.equal(await page.locator("select.status-select").count(), 4);
    assert.equal(await page.locator("tr.divider select").count(), 0);

    const first = page.locator("tbody tr").filter({ hasText: "PAY-001" });
    const select = first.locator("select.status-select");
    await select.selectOption("不通过");
    await page.waitForFunction(() => document.querySelector('select[aria-label="执行结果 PAY-001"]')?.closest("tr")?.classList.contains("status-failed"));
    assert.ok(await first.evaluate((node) => node.classList.contains("status-failed")));
    await select.selectOption("待定");
    assert.ok(await first.evaluate((node) => node.classList.contains("status-pending")));
    await page.reload();
    assert.equal(await page.locator('select[aria-label="执行结果 PAY-001"]').inputValue(), "待定");

    await page.locator("#search").fill("余额不足");
    assert.equal(await page.locator("tbody tr:not(.hidden):not(.divider)").count(), 1);
    await page.locator("#search").fill("");
    await page.locator("#module-filter").selectOption("退款");
    assert.equal(await page.locator("tbody tr:not(.hidden):not(.divider)").count(), 2);
    await page.locator("#module-filter").selectOption("");
    await page.locator("#priority-filter").selectOption("P0");
    assert.equal(await page.locator("tbody tr:not(.hidden):not(.divider)").count(), 2);
    await page.locator("#priority-filter").selectOption("");
    await page.locator("#status-filter").selectOption("待定");
    assert.equal(await page.locator("tbody tr:not(.hidden):not(.divider)").count(), 2);
    assert.match(await page.locator("#stats").innerText(), /待定\s+2/);
  } finally {
    await browser.close();
  }
});
