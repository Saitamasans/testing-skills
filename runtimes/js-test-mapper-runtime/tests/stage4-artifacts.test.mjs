import assert from "node:assert/strict";
import test from "node:test";

import {
  buildExcelProjection,
  applyBatch,
  createLineage,
  buildMachineIdentity,
  buildLineage,
  buildStage4Bundle,
  buildWordProjection,
  validateStage4Data,
} from "../src/stage4-artifacts.mjs";
import { buildStage4DemoFixture, buildStage4NonOrderFixture } from "./fixtures/stage4-lineage.mjs";
import { readFile } from "node:fs/promises";

function idsByKey(lineage, kind, key) {
  return lineage.entities[kind]
    .filter((entity) => entity.action === key || entity.feature === key || entity.route === key || entity.expression === key)
    .map((entity) => entity.display_id)
    .sort();
}

test("Stable ID and revision remain stable across reordered B01/B02 input", () => {
  const fixture = buildStage4DemoFixture();
  const first = buildLineage({ lineageId: "stable-test", baseRunId: fixture.runData.run.run_id, batches: fixture.batches });
  const reordered = fixture.batches.map((batch) => ({
    ...batch,
    routes: [...(batch.routes || [])].reverse(),
    chains: [...(batch.chains || [])].reverse(),
    rules: [...(batch.rules || [])].reverse(),
    risks: [...(batch.risks || [])].reverse(),
  }));
  const second = buildLineage({ lineageId: "stable-test", baseRunId: fixture.runData.run.run_id, batches: reordered });
  for (const kind of ["route", "chain", "rule", "risk"]) assert.deepEqual(idsByKey(first, kind, kind === "route" ? "/orders" : kind === "chain" ? "取消订单" : kind === "rule" ? "order.status !== 2" : "status 值 2 的业务含义需要产品或页面证据确认"), idsByKey(second, kind, kind === "route" ? "/orders" : kind === "chain" ? "取消订单" : kind === "rule" ? "order.status !== 2" : "status 值 2 的业务含义需要产品或页面证据确认"));

  const b01Cancel = first.batch_entities.B01.chain.find((entity) => entity.action === "取消订单");
  const b02Cancel = first.batch_entities.B02.chain.find((entity) => entity.action === "取消订单");
  const currentCancel = first.entities.chain.find((entity) => entity.action === "取消订单");
  assert.equal(b01Cancel.display_id, b02Cancel.display_id);
  assert.notEqual(b01Cancel.content_digest, b02Cancel.content_digest);
  assert.equal(currentCancel.revisions.length, 1);
  assert.equal(currentCancel.revisions[0].batch, "B02");
  assert.ok(first.batches.find((batch) => batch.batch_id === "B02").unchanged.route >= 1);
  assert.ok(first.batches.find((batch) => batch.batch_id === "B02").unchanged.chain >= 1);
  assert.ok(first.successor_candidates.some((item) => item.possible_successor_of === b02Cancel.display_id));
  assert.ok(first.entities.route.some((entity) => entity.route === "/settings" && entity.first_seen_batch === "B02"));
  assert.ok(first.display_id_registry.every((item) => item.identity_version === "stage4-v2" && item.identity_basis));
});

test("Stable identity ignores AI presentation wording but changes with technical anchors", () => {
  const routeOne = { module: "订单中心", technical_route: "/orders", technical_entry: "/orders" };
  const routeTwo = { module: "订单管理", technical_route: "/orders", technical_entry: "/orders" };
  assert.equal(buildMachineIdentity("route", routeOne), buildMachineIdentity("route", routeTwo));
  assert.notEqual(buildMachineIdentity("route", routeOne), buildMachineIdentity("route", { ...routeTwo, technical_route: "/orders/history" }));

  const chainOne = { module: "订单中心", action: "查询订单", technical_function: "loadOrders", route_anchor: "/orders", api_references: [{ method: "GET", url: "/api/orders" }] };
  const chainTwo = { module: "订单管理", action: "加载订单列表", technical_function: "loadOrders", route_anchor: "/orders", api_references: [{ method: "GET", url: "/api/orders" }] };
  assert.equal(buildMachineIdentity("chain", chainOne), buildMachineIdentity("chain", chainTwo));
  assert.notEqual(buildMachineIdentity("chain", chainOne), buildMachineIdentity("chain", { ...chainTwo, api_references: [{ method: "GET", url: "/api/orders/history" }] }));

  const riskOne = { feature: "订单取消", focus_type: "待确认", statement: "status 值 2 的业务含义需要确认", basis: "L1/L2 状态条件：order.status !== 2", technical_basis: "condition:order.status !== 2" };
  const riskTwo = { feature: "取消动作", focus_type: "待确认", statement: "需要确认 status=2 的具体业务含义", basis: "AST 已恢复 order.status !== 2 条件", technical_basis: "condition:order.status !== 2" };
  assert.equal(buildMachineIdentity("risk", riskOne), buildMachineIdentity("risk", riskTwo));
  assert.notEqual(buildMachineIdentity("risk", riskOne), buildMachineIdentity("risk", { ...riskTwo, technical_basis: "condition:order.status !== 3" }));
});

test("401 representative chain keeps the real Stage 3 candidate and technical evidence", () => {
  const fixture = buildStage4DemoFixture();
  const bundle = buildStage4Bundle(fixture);
  const auth = bundle.lineage.batch_entities.B01.chain.find((chain) => chain.action === "401 恢复");
  assert.equal(auth.stage3_candidate_found, true);
  assert.equal(auth.action_label, "request()");
  assert.ok(auth.asset_id);
  assert.ok(auth.nodes?.length);
  assert.ok(auth.edges?.length);
  assert.ok(auth.branches?.some((branch) => branch.branch_kind === "recovery"));
  assert.ok(auth.evidence_ids?.length);
  assert.ok(auth.identity_basis.entry_anchor || auth.identity_basis.api_semantic.length || auth.identity_basis.branch_signature.length);
  assert.equal(bundle.wordProjection.chapters.find((chapter) => chapter.number === 3).chains.some((chain) => chain.display_id === auth.display_id), true);
});

test("presentation-only static representative chains fail the identity completeness gate", () => {
  const lineage = createLineage({ lineageId: "empty-identity-test" });
  assert.throws(() => applyBatch(lineage, {
    batch_id: "B01",
    scanned_at: "2026-09-01 12:00",
    purpose: "identity gate",
    status: "完成",
    routes: [],
    chains: [
      { module: "展示模块", feature: "展示功能", action: "401 恢复", current_status: "静态恢复", representative: true },
      { module: "展示模块", feature: "展示功能", action: "本地缓存恢复", current_status: "静态恢复", representative: true },
    ],
    rules: [],
    risks: [],
  }), /stage4_representative_chain_identity_basis_required/);
});

test("Excel and Word projections are bounded, tester-facing, and branch-aware", () => {
  const fixture = buildStage4DemoFixture();
  const bundle = buildStage4Bundle(fixture);
  assert.equal(bundle.consistency.valid, true);
  assert.deepEqual(bundle.excelProjection.sheets.map((sheet) => sheet.name), [
    "01_扫描批次与范围",
    "02_系统功能与路由地图",
    "03_JS调用链与接口引用",
    "04_权限状态与生命周期",
    "05_测试关注点与风险待确认",
  ]);
  assert.deepEqual(bundle.wordProjection.chapters.map((chapter) => chapter.number), [1, 2, 3, 4, 5, 6]);

  const chainSheet = bundle.excelProjection.sheets.find((sheet) => sheet.name === "03_JS调用链与接口引用");
  const b02DividerIndex = chainSheet.rows.findIndex((row) => row.divider && row.values[0].startsWith("【扫描批次】B02"));
  const nextDividerIndex = chainSheet.rows.findIndex((row, index) => index > b02DividerIndex && row.divider);
  const b02Rows = chainSheet.rows.slice(b02DividerIndex + 1, nextDividerIndex < 0 ? chainSheet.rows.length : nextDividerIndex).filter((row) => !row.divider);
  assert.equal(b02Rows.some((row) => row.values[2] === "查询订单"), false);
  const cancelRow = b02Rows.find((row) => row.values[2] === "取消订单");
  assert.match(cancelRow.values[3], /response\.ok true.*false=>showError/);
  assert.doesNotMatch(cancelRow.values[3], /reloadDetail\(\).*showError\(\)/);
  assert.ok(bundle.excelProjection.sheets.find((sheet) => sheet.name === "05_测试关注点与风险待确认").rows.every((row) => row.divider || ["测试关注点", "风险", "待确认"].includes(row.values[2])));
  assert.ok(bundle.wordProjection.summary.representative_chains.some((line) => line.includes("CHAIN-")));

  const b02 = bundle.lineage.batches.find((batch) => batch.batch_id === "B02");
  const expectedCounts = { "02_系统功能与路由地图": "route", "03_JS调用链与接口引用": "chain", "04_权限状态与生命周期": "rule", "05_测试关注点与风险待确认": "risk" };
  for (const [sheetName, kind] of Object.entries(expectedCounts)) {
    const sheet = bundle.excelProjection.sheets.find((item) => item.name === sheetName);
    const divider = sheet.rows.find((row) => row.divider && row.values[0].startsWith("【扫描批次】B02"));
    assert.match(divider.values[1], new RegExp(`新增${b02.added[kind]}项｜更新${b02.updated[kind]}项`));
  }
  const entityStatus = new Map(Object.values(bundle.lineage.entities).flat().map((entity) => [entity.display_id, entity.current_status || "静态恢复"]));
  for (const item of bundle.wordProjection.chapters.find((chapter) => chapter.number === 4).rules) assert.equal(item.current_status, entityStatus.get(item.display_id));
  for (const item of bundle.wordProjection.chapters.find((chapter) => chapter.number === 5).risks) assert.equal(item.current_status, entityStatus.get(item.display_id));
  const badWord = structuredClone(bundle.wordProjection);
  badWord.chapters.find((chapter) => chapter.number === 4).rules[0].current_status = "待执行验证";
  assert.throws(() => validateStage4Data({ runData: bundle.runData, lineage: bundle.lineage, excelProjection: bundle.excelProjection, wordProjection: badWord }), /stage4_status_drift/);
});

test("Word projection remains business-neutral for a non-order system", async () => {
  const fixture = buildStage4NonOrderFixture();
  const bundle = buildStage4Bundle(fixture);
  const text = JSON.stringify(bundle.wordProjection);
  assert.doesNotMatch(text, /订单中心|订单列表|取消订单/);
  const builder = await readFile(new URL("../scripts/build-stage4-docx.py", import.meta.url), "utf8");
  assert.doesNotMatch(builder, /订单中心|订单列表|取消订单|Stage 4 正式交付演示|B02/);
});

test("artifact consistency detects fingerprint and unknown-ID drift", () => {
  const fixture = buildStage4DemoFixture();
  const bundle = buildStage4Bundle(fixture);
  const badExcel = structuredClone(bundle.excelProjection);
  badExcel.run_data_fingerprint = "bad";
  assert.throws(() => validateStage4Data({ ...bundle, runData: fixture.runData, excelProjection: badExcel }), /fingerprint_mismatch/);
  const badWord = structuredClone(bundle.wordProjection);
  badWord.chapters.find((chapter) => chapter.number === 3).chains[0].display_id = "CHAIN-999";
  assert.throws(() => validateStage4Data({ ...bundle, runData: fixture.runData, wordProjection: badWord }), /word_unknown_chain/);
});
