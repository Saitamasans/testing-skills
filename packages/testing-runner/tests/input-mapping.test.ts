import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";

import ExcelJS from "exceljs";

import type { MappingApproval } from "../src/input/mapping-approval.js";
import {
  calculateProposalSha256,
  canonicalize,
  inspectNonstandardWorkbook,
  proposeMapping,
  type MappingProposal,
} from "../src/input/mapping-proposal.js";
import { applyConfirmedMapping } from "../src/input/nonstandard-excel.js";

const MAX_SPLIT_SEPARATOR_LENGTH = 256;
const MAX_SPLIT_INPUT_LENGTH = 100_000;

const tempDirectories: string[] = [];

async function newFixture(rows?: readonly (readonly unknown[])[]): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-mapping-"));
  tempDirectories.push(directory);
  const file = path.join(directory, "nonstandard-cases.xlsx");
  const workbook = new ExcelJS.Workbook();
  const headers = ["编号", "模块", "标题", "步骤与预期", "优先", "执行状态", "负责人", "环境"];
  const login = workbook.addWorksheet("登录用例");
  login.addRow(headers);
  for (const row of rows ?? [
    ["LOGIN-001", "认证", "正确密码登录", "输入正确账号密码\n预期：进入首页", "P0", "未执行", "Alice", "测试"],
    ["", "认证", "错误密码登录", "输入错误密码\n预期：提示密码错误", "P0", "未执行", "Bob", "测试"],
    ["LOGIN-003", "认证", "锁定用户登录", "输入锁定账号\n预期：提示账号锁定", "P1", "待定", "Carol", "预发"],
    ["LOGIN-004", "认证", "空密码登录", "密码留空\n预期：提示密码必填", "P1", "通过", "Dave", "测试"],
  ]) login.addRow([...row]);

  const refund = workbook.addWorksheet("退款用例");
  refund.addRow(headers);
  refund.addRow([
    "REFUND-001",
    "退款",
    "已支付订单退款",
    "发起全额退款\n预期：退款成功",
    "P0",
    "未执行",
    "Erin",
    "测试",
  ]);
  workbook.addWorksheet("说明").addRows([
    ["项目", "内容"],
    ["版本", "1.0"],
  ]);
  await workbook.xlsx.writeFile(file);
  return file;
}

async function newSeparateColumnsFixture(expected: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-mapping-direct-"));
  tempDirectories.push(directory);
  const file = path.join(directory, "direct-columns.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("接口用例");
  sheet.addRow(["编号", "标题", "步骤", "预期", "负责人"]);
  sheet.addRow(["API-001", "查询详情", "发送 GET 请求", expected, "Alice"]);
  await workbook.xlsx.writeFile(file);
  return file;
}

async function newDuplicateExtensionsFixture(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-mapping-duplicates-"));
  tempDirectories.push(directory);
  const file = path.join(directory, "duplicate-extensions.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("接口用例");
  sheet.addRow(["编号", "步骤", "预期", "负责人", "负责人"]);
  sheet.addRow(["API-001", "发送 GET 请求", "返回 200", "Alice", "Bob"]);
  await workbook.xlsx.writeFile(file);
  return file;
}

function setLabeledSectionRule(proposal: MappingProposal, separator: string): void {
  const firstSplitSheet = proposal.columns.find(({ suggested_rule }) => suggested_rule?.kind === "split")?.source_sheet;
  const splitColumns = proposal.columns.filter(({ source_sheet, suggested_rule }) =>
    source_sheet === firstSplitSheet && suggested_rule?.kind === "split",
  );
  for (const column of splitColumns) {
    assert.ok(column.suggested_rule?.kind === "split");
    column.suggested_rule.split_rule.strategy = "labeled-sections";
    column.suggested_rule.split_rule.separator = separator;
  }
  for (const preview of proposal.split_previews.filter(({ source_sheet }) => source_sheet === firstSplitSheet)) {
    preview.split_rule.strategy = "labeled-sections";
    preview.split_rule.separator = separator;
  }
  proposal.proposal_sha256 = calculateProposalSha256(proposal);
}

function approvalFor(proposal: MappingProposal): MappingApproval {
  return {
    source_sha256: proposal.source_snapshot.sha256,
    proposal_sha256: proposal.proposal_sha256,
    confirmed_at: "2026-07-15T00:00:00.000Z",
    confirmed_by: "qa-owner",
    column_rules: proposal.columns.flatMap(({ suggested_rule }) =>
      suggested_rule === null ? [] : [structuredClone(suggested_rule)],
    ),
  };
}

after(async () => {
  await Promise.all(tempDirectories.map((directory) => rm(directory, { recursive: true, force: true })));
});

test("produces a complete deterministic mapping preview for renamed columns and multiple Sheets", async () => {
  const file = await newFixture();
  const inspection = await inspectNonstandardWorkbook(file);
  const proposal = proposeMapping(inspection);

  assert.equal(proposal.confidence, 1);
  assert.deepEqual(proposal.sheets.map(({ source_sheet }) => source_sheet), ["登录用例", "退款用例", "说明"]);
  assert.ok(proposal.columns.every(({ sample_values }) => sample_values.length <= 3));
  assert.ok(proposal.columns.every(({ source_sheet, source_column, matching_rationale }) =>
    source_sheet !== "" && source_column !== "" && matching_rationale !== "",
  ));
  assert.ok(proposal.columns.some(({ suggested_standard_field }) =>
    Array.isArray(suggested_standard_field) && suggested_standard_field.join("|") === "测试步骤|预期结果",
  ));
  assert.ok(proposal.extension_columns.some(({ source_column }) => source_column === "负责人"));
  assert.ok(proposal.extension_columns.some(({ source_column }) => source_column === "环境"));
  assert.ok(proposal.missing_fields.some(({ source_sheet }) => source_sheet === "说明"));
  assert.deepEqual(proposal.duplicate_mappings, []);
  assert.deepEqual(proposal.conflicting_mappings, []);
  assert.equal(proposal.split_previews.length, 2);
  assert.equal(proposal.split_previews[0]?.rows[0]?.outputs[0], "输入正确账号密码");
  assert.equal(proposal.split_previews[0]?.rows[0]?.outputs[1], "进入首页");
  assert.equal(proposal.normalized_sample_rows.length, 3);
  assert.match(proposal.human_preview, /登录用例/);
  assert.match(proposal.human_preview, /步骤与预期/);
  assert.match(proposal.human_preview, /负责人/);
  assert.match(proposal.human_preview, /重复映射: 无/);
  assert.match(proposal.human_preview, /冲突映射: 无/);
  assert.match(proposal.human_preview, /标准化样例:/);
  const normalizedPreviewLines = proposal.human_preview
    .split("\n")
    .filter((line) => line.startsWith("标准化样例:"));
  assert.equal(normalizedPreviewLines.length, 3);
  for (const line of normalizedPreviewLines) {
    for (const column of [
      "用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件",
      "测试步骤", "预期结果", "优先级", "执行结果", "备注",
    ]) assert.match(line, new RegExp(`${column}=`));
    assert.match(line, /扩展字段=.*负责人/);
  }
  assert.equal(proposal.proposal_sha256.length, 64);
  assert.deepEqual(proposal.source_snapshot.rows?.map(({ source }) => source), [
    "登录用例!2", "登录用例!3", "登录用例!4", "登录用例!5", "退款用例!2", "说明!2",
  ]);
});

test("high confidence never bypasses mapping approval", async () => {
  const proposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture()));
  assert.equal(proposal.confidence, 1);
  await assert.rejects(() => applyConfirmedMapping(proposal, undefined), /必须确认字段映射/);
});

test("applies only the exact confirmed rules, splits merged fields and preserves provenance", async () => {
  const file = await newFixture();
  const originalHash = createHash("sha256").update(await readFile(file)).digest("hex");
  const proposal = proposeMapping(await inspectNonstandardWorkbook(file));
  const approval = approvalFor(proposal);
  const result = await applyConfirmedMapping(proposal, approval);

  assert.equal(result.cases.length, 5);
  assert.equal(result.cases[0]?.values["测试步骤"], "输入正确账号密码");
  assert.equal(result.cases[0]?.values["预期结果"], "进入首页");
  assert.equal(result.cases[0]?.extensions["负责人"], "Alice");
  assert.equal(result.cases[0]?.extensions["环境"], "测试");
  assert.equal(result.cases[0]?.raw_values[3], "输入正确账号密码\n预期：进入首页");
  assert.equal(result.cases[0]?.source, "登录用例!2");
  assert.equal(result.cases[1]?.id, `EXT-${originalHash.slice(0, 8)}-000003`);
  assert.equal(result.cases[1]?.source, "登录用例!3");
  assert.equal(result.cases[4]?.source_sheet, "退款用例");
  assert.equal(result.source_snapshot.rows?.length, 6);
  assert.deepEqual(
    result.normalization_metadata?.mapping.column_rules,
    approval.column_rules,
  );
  assert.deepEqual(
    result.normalization_metadata?.mapping.split_rule_versions,
    ["1.0.0", "1.0.0"],
  );
  assert.equal(createHash("sha256").update(await readFile(file)).digest("hex"), originalHash);
});

test("rejects stale source and stale or tampered proposal hashes", async () => {
  const sourceProposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture()));
  const wrongSource = approvalFor(sourceProposal);
  wrongSource.source_sha256 = "0".repeat(64);
  await assert.rejects(() => applyConfirmedMapping(sourceProposal, wrongSource), /源文件哈希不匹配/);

  const wrongProposal = approvalFor(sourceProposal);
  wrongProposal.proposal_sha256 = "f".repeat(64);
  await assert.rejects(() => applyConfirmedMapping(sourceProposal, wrongProposal), /映射提案哈希不匹配/);

  const tampered = structuredClone(sourceProposal);
  tampered.columns[0]!.matching_rationale = "changed after approval";
  await assert.rejects(() => applyConfirmedMapping(tampered, approvalFor(sourceProposal)), /映射提案已变更/);
});

test("invalidates approval when workbook bytes change after proposal", async () => {
  const file = await newFixture();
  const proposal = proposeMapping(await inspectNonstandardWorkbook(file));
  const approval = approvalFor(proposal);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  workbook.getWorksheet("登录用例")!.addRow([
    "LOGIN-NEW", "认证", "新增", "执行新增\n预期：新增成功", "P1", "未执行", "Zoe", "测试",
  ]);
  await workbook.xlsx.writeFile(file);

  await assert.rejects(() => applyConfirmedMapping(proposal, approval), /源文件已变更/);
});

test("rejects conflicting rules, absent required fields and unpreviewed split changes", async () => {
  const proposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture()));

  const conflicting = approvalFor(proposal);
  const firstDirect = conflicting.column_rules.find((rule) => rule.kind === "direct")!;
  conflicting.column_rules.push({ ...firstDirect, target_field: "备注" });
  await assert.rejects(() => applyConfirmedMapping(proposal, conflicting), /同一源列.*冲突目标/);

  const missingExpected = approvalFor(proposal);
  missingExpected.column_rules = missingExpected.column_rules.filter((rule) => rule.kind !== "split");
  await assert.rejects(() => applyConfirmedMapping(proposal, missingExpected), /测试步骤.*预期结果.*缺失/);

  const changedSplit = approvalFor(proposal);
  const split = changedSplit.column_rules.find((rule) => rule.kind === "split");
  assert.ok(split?.kind === "split");
  split.split_rule.separator = "EXPECTED:";
  await assert.rejects(() => applyConfirmedMapping(proposal, changedSplit), /拆分规则未在提案中预览/);
});

test("rejects a direct approval rule that is not exactly represented in the hashed proposal", async () => {
  const proposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture()));
  const remapped = approvalFor(proposal);
  const idRule = remapped.column_rules.find((rule) =>
    rule.kind === "direct" && rule.target_field === "用例 ID",
  );
  assert.ok(idRule?.kind === "direct");
  idRule.target_field = "备注";

  await assert.rejects(
    () => applyConfirmedMapping(proposal, remapped),
    /直接映射规则未在提案中预览/,
  );
});

test("rejects an approval that omits a direct rule represented in the hashed proposal", async () => {
  const proposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture()));
  const incomplete = approvalFor(proposal);
  incomplete.column_rules = incomplete.column_rules.filter((rule) =>
    !(rule.kind === "direct" && rule.target_field === "用例 ID"),
  );

  await assert.rejects(
    () => applyConfirmedMapping(proposal, incomplete),
    /审批字段规则与提案不完全一致/,
  );
});

test("blocks execution when a confirmed split yields a missing step or expected result", async () => {
  const proposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture([
    ["LOGIN-001", "认证", "坏数据", "只有步骤没有分隔符", "P0", "未执行", "Alice", "测试"],
  ])));
  await assert.rejects(
    () => applyConfirmedMapping(proposal, approvalFor(proposal)),
    /测试步骤或预期结果为空/,
  );
});

test("blocks execution when a directly mapped step or expected result is blank", async () => {
  const proposal = proposeMapping(
    await inspectNonstandardWorkbook(await newSeparateColumnsFixture("")),
  );
  await assert.rejects(
    () => applyConfirmedMapping(proposal, approvalFor(proposal)),
    /测试步骤或预期结果为空/,
  );
});

test("preserves duplicate extension headers with deterministic source-column keys", async () => {
  const proposal = proposeMapping(
    await inspectNonstandardWorkbook(await newDuplicateExtensionsFixture()),
  );
  const result = await applyConfirmedMapping(proposal, approvalFor(proposal));

  assert.deepEqual(result.cases[0]?.extensions, {
    "负责人 [列4]": "Alice",
    "负责人 [列5]": "Bob",
  });
  assert.deepEqual(proposal.normalized_sample_rows[0]?.extensions, {
    "负责人 [列4]": "Alice",
    "负责人 [列5]": "Bob",
  });
});

test("parses catastrophic-looking labeled content literally beyond the three-row preview", async () => {
  const marker = "(a+)+$".repeat(1_000);
  const proposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture([
    ["LOGIN-001", "认证", "一", "步骤：(a+)+$一预期：一", "P0", "未执行", "A", "测试"],
    ["LOGIN-002", "认证", "二", "步骤：(a+)+$二预期：二", "P0", "未执行", "B", "测试"],
    ["LOGIN-003", "认证", "三", "步骤：(a+)+$三预期：三", "P0", "未执行", "C", "测试"],
    ["LOGIN-004", "认证", "四", `步骤：(a+)+$${marker}预期：完成`, "P0", "未执行", "D", "测试"],
  ])));
  setLabeledSectionRule(proposal, "步骤：(a+)+$||预期：");

  const result = await applyConfirmedMapping(proposal, approvalFor(proposal));
  assert.equal(result.cases[3]?.values["测试步骤"], marker);
  assert.equal(result.cases[3]?.values["预期结果"], "完成");
});

test("rejects labeled-section rules and row inputs beyond explicit linear-parser ceilings", async () => {
  assert.equal(MAX_SPLIT_SEPARATOR_LENGTH, 256);
  assert.equal(MAX_SPLIT_INPUT_LENGTH, 100_000);

  const longRuleProposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture()));
  setLabeledSectionRule(longRuleProposal, `${"a".repeat(MAX_SPLIT_SEPARATOR_LENGTH)}||预期：`);
  await assert.rejects(
    () => applyConfirmedMapping(longRuleProposal, approvalFor(longRuleProposal)),
    /拆分规则长度超过上限/,
  );

  const longInputProposal = proposeMapping(await inspectNonstandardWorkbook(await newFixture([
    ["LOGIN-001", "认证", "一", "步骤：一预期：一", "P0", "未执行", "A", "测试"],
    ["LOGIN-002", "认证", "二", "步骤：二预期：二", "P0", "未执行", "B", "测试"],
    ["LOGIN-003", "认证", "三", "步骤：三预期：三", "P0", "未执行", "C", "测试"],
    ["LOGIN-004", "认证", "四", `步骤：${"a".repeat(MAX_SPLIT_INPUT_LENGTH)}预期：完成`, "P0", "未执行", "D", "测试"],
  ])));
  setLabeledSectionRule(longInputProposal, "步骤：||预期：");
  await assert.rejects(
    () => applyConfirmedMapping(longInputProposal, approvalFor(longInputProposal)),
    /拆分输入长度超过上限.*登录用例!5/,
  );
});

test("canonical proposal keys use locale-independent Unicode code-point ordering", () => {
  assert.equal(canonicalize({ "ä": 1, z: 2 }), '{"z":2,"ä":1}');
});
