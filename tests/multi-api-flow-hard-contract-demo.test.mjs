import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  COLUMNS,
  buildReportId,
  renderBoth,
  validateReport,
} from "../tooling/test-case-renderer.mjs";

// Deliberately tiny input: two endpoints share orderId, but the M1 report must
// remain a non-formal asset because no PRD, call trace, or expected result exists.
const demoInput = {
  mode: "M1",
  openapi: {
    openapi: "3.0.3",
    paths: {
      "/orders": { post: { operationId: "createOrder" } },
      "/orders/{orderId}": { get: { operationId: "getOrder" } },
    },
  },
};

function reportBase(title, eligible) {
  return {
    title,
    project: "multi-api-hard-contract-demo",
    report_key: "multi-api-hard-contract-demo-v1",
    generated_at: "2026-10-13T00:00:00Z",
    formal_case_eligible: eligible,
    skill_invocation: {
      primary: "multi-api-flow-test",
      secondary: "无",
      roles: "仅验证硬性输出契约",
    },
  };
}

function makeM1Report() {
  return {
    ...reportBase("M1 低资料降级 Demo", false),
    sheets: [
      {
        name: "01_总览与结论",
        kind: "overview",
        columns: ["字段", "值"],
        rows: [{ values: ["输入模式", demoInput.mode] }, { values: ["正式用例准入", "不通过：缺少可观测预期与数据准备" ] }],
      },
      {
        name: "02_依赖缺口与风险",
        kind: "supplementary",
        columns: ["缺口", "说明"],
        rows: [{ values: ["业务预期", "未提供" ] }, { values: ["数据准备/清理", "未提供" ] }],
      },
      {
        name: "03_候选链路与非正式方向",
        kind: "supplementary",
        columns: ["资产", "证据状态"],
        rows: [{ values: ["createOrder -> getOrder", "仅共享 orderId 线索，不能进入正式用例" ] }],
      },
    ],
  };
}

function makeM2Report() {
  return {
    ...reportBase("M2 正式准入 Demo", true),
    sheets: [
      {
        name: "01_总览与结论",
        kind: "overview",
        columns: ["字段", "值"],
        rows: [{ values: ["输入模式", "M2 需求驱动" ] }, { values: ["正式用例准入", "通过" ] }],
      },
      {
        name: "02_测试用例",
        kind: "test_cases",
        columns: COLUMNS,
        rows: [{
          values: [
            "ORD-001",
            "订单链路",
            "创建订单后查询详情",
            "测试账号已登录；准备合法商品数据；允许执行后清理订单",
            "1. POST /orders 保存响应 orderId。\n2. GET /orders/{orderId} 查询详情。",
            "创建接口返回 orderId；查询接口返回同一 orderId；状态和金额符合已确认契约。",
            "P0",
            "未执行",
          ],
        }],
      },
      {
        name: "03_待确认与风险",
        kind: "supplementary",
        columns: ["风险", "说明"],
        rows: [{ values: ["无", "本 Demo 只验证结构，不验证业务质量" ] }],
      },
      {
        name: "04_链路与覆盖说明",
        kind: "supplementary",
        columns: ["链路", "字段依赖"],
        rows: [{ values: ["createOrder -> getOrder", "createOrder.orderId -> getOrder.path.orderId" ] }],
      },
    ],
  };
}

test("hard contract demo: M1 downgrades and M2 uses the default eight columns", async () => {
  assert.equal(demoInput.openapi.paths["/orders"].post.operationId, "createOrder");
  assert.equal(demoInput.openapi.paths["/orders/{orderId}"].get.operationId, "getOrder");

  const m1 = makeM1Report();
  assert.doesNotThrow(() => validateReport(m1));
  assert.equal(m1.formal_case_eligible, false);
  assert.equal(m1.sheets.some((sheet) => sheet.kind === "test_cases"), false);

  const m2 = makeM2Report();
  assert.doesNotThrow(() => validateReport(m2));
  assert.equal(m2.formal_case_eligible, true);
  const cases = m2.sheets.find((sheet) => sheet.kind === "test_cases");
  assert.deepEqual(cases.columns, COLUMNS);
  assert.equal(cases.columns.length, 8);

  const regenerated = structuredClone(m2);
  regenerated.generated_at = "2026-10-14T00:00:00Z";
  assert.equal(buildReportId(m2), buildReportId(regenerated));

  const forbidden = structuredClone(m1);
  forbidden.sheets.push(cases);
  assert.throws(() => validateReport(forbidden), /formal_case_eligible=false/);

  const out = await fs.mkdtemp(path.join(os.tmpdir(), "multi-api-hard-contract-demo-"));
  const previousPortableMode = process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX;
  process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX = "1";
  try {
    const m1Rendered = await renderBoth(m1, out, "m1-low-data");
    const m1Workbook = (await fs.readFile(m1Rendered.xlsx)).toString("utf8");
    assert.equal(m1Workbook.startsWith("PK"), true);
    assert.doesNotMatch(m1Workbook, /02_测试用例/);

    const rendered = await renderBoth(m2, out, "m2-formal");
    const workbook = (await fs.readFile(rendered.xlsx)).toString("utf8");
    assert.equal(workbook.startsWith("PK"), true);
    for (const header of COLUMNS) assert.ok(workbook.includes(header), `missing XLSX header: ${header}`);
    assert.match(workbook, /02_测试用例/);
    const html = await fs.readFile(rendered.html, "utf8");
    assert.match(html, /localStorage/);
    assert.doesNotMatch(html, /https?:\/\//);
  } finally {
    if (previousPortableMode === undefined) delete process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX;
    else process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX = previousPortableMode;
  }
});
