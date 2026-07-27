import assert from "node:assert/strict";
import test from "node:test";

import { chromium } from "playwright";

import { discoverCurrentPage } from "../src/locator/page-discovery.js";
import { startDemoApp } from "./fixtures/demo-app.js";

test("black-box discovery proposes reviewable locators without clicking or typing", async () => {
  const app = await startDemoApp();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.goto(`${app.baseUrl}/login`);
    await page.evaluate(() => {
      (window as typeof window & { __discoveryInteractions?: number }).__discoveryInteractions = 0;
      document.addEventListener("click", () => {
        (window as typeof window & { __discoveryInteractions?: number }).__discoveryInteractions! += 1;
      });
      document.addEventListener("input", () => {
        (window as typeof window & { __discoveryInteractions?: number }).__discoveryInteractions! += 1;
      });
    });

    const result = await discoverCurrentPage(page);
    const interactionCount = await page.evaluate(
      () => (window as typeof window & { __discoveryInteractions?: number }).__discoveryInteractions,
    );

    assert.equal(interactionCount, 0);
    assert.equal(result.requires_user_confirmation, true);
    assert.equal(result.url, `${app.baseUrl}/login`);
    assert.match(result.dom_sha256, /^[a-f0-9]{64}$/);
    assert.match(result.accessibility_sha256, /^[a-f0-9]{64}$/);
    assert.ok(result.elements.some((item) => item.label === "Username"));
    assert.ok(result.elements.some((item) => item.name === "Login"));
    assert.ok(result.elements.every((item) => item.candidates.every((candidate) => candidate.matched_count >= 1)));
    assert.equal("approved_locator" in result, false);
  } finally {
    await browser.close();
    await app.close();
  }
});
