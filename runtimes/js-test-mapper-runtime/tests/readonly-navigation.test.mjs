import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { collectTarget } from "../src/collector.mjs";
import { classifyReadonlyEntry } from "../src/readonly-navigation.mjs";
import { startDcatReadonlyFixture } from "./fixtures/app-server.mjs";

test("automatic readonly traversal maps Dcat-style navigation without business mutations", async () => {
  const fixture = await startDcatReadonlyFixture();
  const output = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-dcat-readonly-"));
  try {
    const result = await collectTarget({
      url: fixture.url,
      outputDir: output,
      interactive: true,
      interactiveController: async () => {},
      dynamicWaitMs: 10,
    });
    const observation = result.runData.runtime_observations.find((item) => item.type === "readonly_navigation");
    assert.ok(observation);
    const visitedUrls = observation.visited.map((item) => new URL(item.url).pathname + new URL(item.url).search);
    assert.ok(visitedUrls.some((url) => url === "/admin/login"));
    assert.ok(visitedUrls.some((url) => url === "/admin/dashboard"));
    assert.ok(visitedUrls.some((url) => url === "/admin/orders"));
    assert.ok(visitedUrls.some((url) => url.startsWith("/admin/orders/1")));
    assert.ok(visitedUrls.some((url) => url.includes("page=2")));
    assert.ok(observation.visited.some((item) => item.category === "safe_tab" && item.entry_label === "History"));
    assert.ok(observation.visited.some((item) => item.url.includes("/admin/orders/1/history")));
    assert.ok(visitedUrls.some((url) => url === "/admin/delayed"));
    assert.ok(visitedUrls.some((url) => url === "/admin/safe-a"));
    assert.ok(visitedUrls.some((url) => url === "/admin/safe-b"));
    assert.ok(observation.skipped.some((item) => item.href?.includes("/admin/broken") && item.reason === "navigation_failed"));
    const missing = observation.skipped.find((item) => item.href?.includes("/admin/missing-page"));
    assert.equal(missing?.reason, "navigation_http_error");
    assert.equal(missing?.http_status, 404);
    assert.ok(!visitedUrls.some((url) => url === "/admin/missing-page"));
    assert.ok(observation.blocked.some((item) => /create|edit|export|delete|regenerate/i.test(item.href || item.label)));
    assert.ok(observation.skipped.some((item) => item.reason === "readonly_intent_not_proven"));
    const orders = observation.visited.find((item) => new URL(item.url).pathname === "/admin/orders");
    assert.deepEqual(orders.table_fields, ["ID", "Status", "Total"]);
    assert.ok(orders.filters.includes("Search orders"));
    assert.ok(orders.breadcrumbs.includes("Home"));
    assert.ok(result.runData.assets.some((asset) => new URL(asset.canonical_url).pathname === "/assets/admin.js"));
    assert.equal(result.runData.active_business_api_calls, 0);
    assert.ok(fixture.requests.length > 0);
    assert.ok(fixture.requests.every((request) => request.method === "GET"));
    assert.equal(fixture.mutationCount, 0);
    assert.ok(!fixture.requests.some((request) => /clear|reset|sync|refund|cancel|regenerate|tasks\/run|export/.test(request.url)));
    assert.ok(result.runData.runtime_observations.some((item) => item.type === "browser_navigation_requests"));
    assert.ok(result.runData.runtime_observations.some((item) => item.type === "page_initiated_requests"));
  } finally {
    await fixture.close();
    await rm(output, { recursive: true, force: true });
  }
});

test("readonly entry classification defaults to deny for dangerous and ambiguous targets", () => {
  const current = "https://admin.example.test/admin/orders";
  assert.equal(classifyReadonlyEntry({ text: "Orders", href: "/admin/orders", inReadonlyContainer: true, menuDepth: 1 }, current).decision, "visit");
  assert.equal(classifyReadonlyEntry({ text: "View", href: "/admin/orders/1" }, current).category, "readonly_detail");
  assert.equal(classifyReadonlyEntry({ text: "Next", href: "/admin/orders?page=2", inPagination: true }, current).category, "pagination");
  assert.equal(classifyReadonlyEntry({ text: "Edit", href: "/admin/orders/1/edit", inNavigation: true }, current).decision, "blocked");
  assert.equal(classifyReadonlyEntry({ text: "Open", href: "/admin/unknown" }, current).reason, "readonly_intent_not_proven");
  assert.equal(classifyReadonlyEntry({ kind: "tab", text: "External", href: "https://outside.example/#x" }, current).reason, "cross_origin");
  assert.equal(classifyReadonlyEntry({ kind: "tab", text: "JS", href: "javascript:alert(1)" }, current).reason, "unsupported_protocol");
  assert.equal(classifyReadonlyEntry({ kind: "tab", text: "Delete", href: "#delete", dataAction: "delete" }, current).decision, "blocked");
  assert.equal(classifyReadonlyEntry({ kind: "tab", text: "History", href: "#history" }, current).category, "safe_tab");
  assert.equal(classifyReadonlyEntry({ text: "External", href: "https://outside.example/" }, current).reason, "cross_origin");
});