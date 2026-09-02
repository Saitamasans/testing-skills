import assert from "node:assert/strict";
import test from "node:test";
import { applyBatch, buildExcelProjection, createLineage } from "../src/stage4-artifacts.mjs";
import { applyCognitionToLineage } from "../src/cognition.mjs";
import { buildTraceabilityIndex } from "../src/traceability.mjs";

test("same-batch same identity is emitted once without a fake revision", () => {
  const lineage = createLineage({ lineageId: "blocker-fix", baseRunId: "run-1" });
  const candidate = { module: "x", feature: "x", route: "/x", technical_route: "/x", technical_entry: "/x", current_status: "静态恢复", evidence: ["e1"] };
  const summary = applyBatch(lineage, { batch_id: "B01", scanned_at: "now", purpose: "test", scope: {}, status: "完成", asset_counts: { added: 0, updated: 0 }, routes: [candidate, { ...candidate, feature: "same identity wording", evidence: ["e2"] }] });
  assert.equal(summary.added.route, 1);
  assert.equal(lineage.entities.route.length, 1);
  assert.equal(lineage.revisions.length, 0);
});

test("validated cognition is applied to Excel batch history rows", () => {
  const lineage = createLineage({ lineageId: "blocker-fix-cognition", baseRunId: "run-1" });
  applyBatch(lineage, { batch_id: "B01", scanned_at: "now", purpose: "test", scope: {}, status: "完成", asset_counts: { added: 0, updated: 0 }, routes: [{ module: "待确认", feature: "待确认", route: "/x", technical_route: "/x", technical_entry: "/x", current_status: "静态恢复", evidence: ["e1"] }] });
  const runData = { active_business_api_calls: 0 };
  const presented = applyCognitionToLineage(lineage, { route_presentations: [{ display_id: "ROUTE-001", module: "订单中心", feature: "订单列表", capability: "加载列表" }], chain_presentations: [], risk_items: [] });
  const projection = buildExcelProjection({ runData, lineage: presented });
  const row = projection.sheets.find((sheet) => sheet.name.startsWith("02_")).rows.find((item) => !item.divider);
  assert.equal(row.values[0], "订单中心");
  assert.equal(row.values[1], "订单列表");
});

test("order-only set reordering does not create a B02 route revision", () => {
  const lineage = createLineage({ lineageId: "order-only", baseRunId: "run-order-only" });
  const route = (routePath, factIds, assetIds) => ({
    route: routePath,
    technical_route: routePath,
    technical_entry: routePath,
    fact_ids: factIds,
    asset_ids: assetIds,
    evidence: factIds,
    current_status: "静态恢复",
  });
  applyBatch(lineage, {
    batch_id: "B01", scanned_at: "now", purpose: "test", scope: {}, status: "完成", asset_counts: { added: 2, updated: 0 },
    routes: [route("/protected", ["fact-a"], ["asset-a"]), route("/dashboard", ["fact-a", "fact-b"], ["asset-a", "asset-b"])], chains: [], rules: [], risks: [],
  });
  const summary = applyBatch(lineage, {
    batch_id: "B02", scanned_at: "now", purpose: "test", scope: {}, status: "完成", asset_counts: { added: 1, updated: 0 },
    routes: [route("/dashboard", ["fact-b", "fact-a"], ["asset-b", "asset-a"]), route("/protected", ["fact-a"], ["asset-a"]), route("/dashboard/preferences", ["fact-c"], ["asset-c"])], chains: [], rules: [], risks: [],
  });
  assert.equal(summary.added.route, 1);
  assert.equal(summary.updated.route, 0);
  assert.equal(summary.unchanged.route, 2);
  assert.equal(lineage.entities.route.find((item) => item.route === "/dashboard").revisions.length, 0);
});

test("entity fact refs do not expand from all facts on the same asset", () => {
  const assetId = "asset-aaaaaaaaaaaaaaaa";
  const routeFact = "fact-aaaaaaaaaaaaaaaa";
  const unrelatedFact = "fact-bbbbbbbbbbbbbbbb";
  const importFact = "fact-cccccccccccccccc";
  const evidenceId = "evidence-asset-aaaaaaaaaaaaaaaa";
  const runData = {
    assets: [{ asset_id: assetId }],
    technical_facts: [
      { fact_id: routeFact, asset_id: assetId, value: "/dashboard" },
      { fact_id: unrelatedFact, asset_id: assetId, value: "fixture:read" },
      { fact_id: importFact, asset_id: assetId, value: "/assets/lazy.js" },
    ],
    evidence: [{ evidence_id: evidenceId, asset_id: assetId }],
  };
  const lineage = { entities: { route: [{ display_id: "ROUTE-001", route: "/dashboard", fact_ids: [routeFact], asset_ids: [assetId] }] } };
  const refs = buildTraceabilityIndex(runData, lineage).refsForDisplayId("ROUTE-001");
  assert.deepEqual(refs.fact_ids, [routeFact]);
  assert.deepEqual(refs.asset_ids, [assetId]);
  assert.deepEqual(refs.evidence_ids, [evidenceId]);
});
