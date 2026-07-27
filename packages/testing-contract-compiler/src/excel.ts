import ExcelJS from "exceljs";
import type { InspectResult, SourceCase } from "./types.js";
import { assertNoInlineSecret } from "./security.js";

const FIELDS = ["case_id", "module", "title", "feature", "precondition", "steps", "expected", "priority", "actual_result", "execution_result"] as const;
const TEN = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"];
const ALIASES: Record<(typeof FIELDS)[number], string[]> = {
  case_id: ["用例 ID", "用例ID", "编号", "case_id"], module: ["所属模块", "模块", "module"],
  title: ["用例标题", "名称", "标题", "title"], feature: ["验证功能点", "功能点", "feature"],
  precondition: ["前置条件", "前置", "precondition"], steps: ["测试步骤", "步骤说明", "步骤", "steps"],
  expected: ["预期结果", "结果说明", "预期", "expected"], priority: ["优先级", "priority"],
  actual_result: ["实际结果", "actual_result"], execution_result: ["执行结果", "execution_result"],
};

function value(cell: ExcelJS.Cell): string {
  const raw = cell.value;
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object" && "text" in raw) return String(raw.text).trim();
  if (typeof raw === "object" && "result" in raw) return String(raw.result ?? "").trim();
  return String(raw).trim();
}

function normalized(text: string): string { return text.replace(/\s+/g, "").toLocaleLowerCase(); }

function mappingFor(headers: string[], explicit?: Record<string, string>): Record<string, string | null> {
  if (explicit) return Object.fromEntries(FIELDS.map((field) => [field, explicit[field] ?? null]));
  return Object.fromEntries(FIELDS.map((field) => [field, headers.find((header) => ALIASES[field].some((alias) => normalized(alias) === normalized(header))) ?? null]));
}

async function inspectLoadedWorkbook(workbook: ExcelJS.Workbook, explicitMapping?: Record<string, string>): Promise<InspectResult> {
  const workbookValues: string[] = [];
  for (const sheet of workbook.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => workbookValues.push(value(cell)));
    });
  }
  assertNoInlineSecret(workbookValues);
  const source_sheet_names = workbook.worksheets.map((sheet) => sheet.name);
  const cases: SourceCase[] = [];
  let selectedHeaders: string[] = [];
  let selectedMapping: Record<string, string | null> = {};
  let format: InspectResult["format"] = "non_standard";

  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount < 2) continue;
    const headers = sheet.getRow(1).values instanceof Array
      ? (sheet.getRow(1).values as unknown[]).slice(1).map((item) => String(item ?? "").trim())
      : [];
    const stripped = headers[0] === "序号" ? headers.slice(1) : headers;
    const isStandard = stripped.length >= TEN.length && TEN.every((header, index) => normalized(stripped[index] ?? "") === normalized(header));
    if (!selectedHeaders.length) {
      selectedHeaders = headers;
      selectedMapping = mappingFor(headers, explicitMapping);
      format = isStandard ? (headers[0] === "序号" ? "standard_11" : "standard_10") : "non_standard";
    }
    const mapping = mappingFor(headers, explicitMapping);
    const indexes = Object.fromEntries(Object.entries(mapping).map(([field, header]) => [field, header ? headers.indexOf(header) + 1 : 0]));
    if (!indexes.case_id || !indexes.title) continue;
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      const caseId = value(row.getCell(indexes.case_id));
      if (!caseId) continue;
      const get = (field: (typeof FIELDS)[number]) => indexes[field] ? value(row.getCell(indexes[field])) : "";
      cases.push({ case_id: caseId, module: get("module"), title: get("title"), feature: get("feature"), precondition: get("precondition"), steps: get("steps"), expected: get("expected"), priority: get("priority"), actual_result: get("actual_result"), execution_result: get("execution_result"), source_sheet: sheet.name, source_row: rowNumber });
    }
  }
  const duplicate = cases.map((item) => item.case_id).find((id, index, all) => all.indexOf(id) !== index);
  if (duplicate) throw new Error(`duplicate_case_id: ${duplicate}`);
  assertNoInlineSecret(cases);
  return { format, requires_confirmation: format === "non_standard" && !explicitMapping, source_sheet_names, case_ids: cases.map((item) => item.case_id), field_mapping: selectedMapping, cases };
}

export async function inspectWorkbook(input: string, explicitMapping?: Record<string, string>): Promise<InspectResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(input);
  return inspectLoadedWorkbook(workbook, explicitMapping);
}

export async function inspectWorkbookBytes(bytes: Buffer, explicitMapping?: Record<string, string>): Promise<InspectResult> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  return inspectLoadedWorkbook(workbook, explicitMapping);
}
