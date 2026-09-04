import assert from "node:assert/strict";
import test from "node:test";
import { launchBrowserRuntime } from "../src/browser-runtime.mjs";

function fakeBrowserType({ managed = "C:/managed/chrome.exe", fail = [] } = {}) {
  const calls = [];
  return { calls, executablePath: () => managed, async launch(options) { calls.push(options); const key = options.executablePath || options.channel; if (fail.includes(key)) throw new Error(`failed ${key}`); return { key }; } };
}

test("browser resolver prefers an explicit executable", async () => { const browserType = fakeBrowserType(); const result = await launchBrowserRuntime({ browserType, env: { JS_TEST_MAPPER_BROWSER_EXECUTABLE: "C:/custom/browser.exe" }, fileAccess: async () => {} }); assert.equal(result.candidate, "executable"); assert.deepEqual(browserType.calls, [{ headless: true, executablePath: "C:/custom/browser.exe" }]); });
test("browser resolver prefers Chrome over Edge", async () => { const browserType = fakeBrowserType(); const result = await launchBrowserRuntime({ browserType, env: {}, fileAccess: async () => {} }); assert.equal(result.label, "system Chrome"); assert.deepEqual(browserType.calls.map((item) => item.channel), ["chrome"]); });
test("browser resolver falls back from Chrome to Edge", async () => { const browserType = fakeBrowserType({ fail: ["chrome"] }); const result = await launchBrowserRuntime({ browserType, env: {}, fileAccess: async () => {} }); assert.equal(result.label, "system Edge"); assert.deepEqual(browserType.calls.map((item) => item.channel), ["chrome", "msedge"]); });
test("browser resolver uses managed Chromium after Chrome and Edge", async () => { const browserType = fakeBrowserType({ fail: ["chrome", "msedge"] }); const result = await launchBrowserRuntime({ browserType, env: {}, fileAccess: async () => {} }); assert.equal(result.candidate, "managed"); assert.deepEqual(browserType.calls.map((item) => item.channel || item.executablePath), ["chrome", "msedge", "C:/managed/chrome.exe"]); });
test("missing explicit executable continues to Chrome", async () => { const browserType = fakeBrowserType(); const result = await launchBrowserRuntime({ browserType, env: { JS_TEST_MAPPER_BROWSER_EXECUTABLE: "C:/missing.exe" }, fileAccess: async (file) => { if (file.includes("missing")) throw new Error("missing"); } }); assert.equal(result.label, "system Chrome"); assert.deepEqual(browserType.calls.map((item) => item.channel), ["chrome"]); });
test("browser resolver reports unavailable", async () => { const browserType = fakeBrowserType({ fail: ["chrome", "msedge", "C:/managed/chrome.exe"] }); await assert.rejects(() => launchBrowserRuntime({ browserType, env: {}, fileAccess: async () => {} }), /browser_runtime_unavailable/); assert.deepEqual(browserType.calls.map((item) => item.channel || item.executablePath), ["chrome", "msedge", "C:/managed/chrome.exe"]); });
