import type { RunCaseResult, RunResult } from "../types.js";
import type {
  NativeReportDocument,
  NativeReportRow,
  NativeReportSheet,
} from "../input/detect-input.js";
import { loadReportRenderer, type RenderedReportBundle } from "./renderer-loader.js";

export type TestingSkillsReport = NativeReportDocument;

export interface ProjectExecutionReportInput {
  report: TestingSkillsReport;
  result: RunResult;
}

function cloneReport(report: TestingSkillsReport): TestingSkillsReport {
  return JSON.parse(JSON.stringify(report)) as TestingSkillsReport;
}

function ensureColumnValues(row: NativeReportRow, count: number): void {
  while (row.values.length < count) row.values.push("");
  if (row.values.length > count) row.values = row.values.slice(0, count);
}

function columnIndex(sheet: NativeReportSheet, name: string): number {
  const index = sheet.columns.indexOf(name);
  if (index < 0) throw new Error(`${sheet.name} 缺少 ${name} 列`);
  return index;
}

function appendRemark(row: NativeReportRow, index: number, note: string): void {
  const existing = String(row.values[index] ?? "").trim();
  row.values[index] = existing ? `${existing}\n${note}` : note;
}

function actualText(value: unknown): string {
  if (value === undefined) return "未记录实际值";
  if (typeof value === "string") return value;
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}

function assertionSummary(item: RunCaseResult): string {
  const lines = item.assertions.map((assertion) => {
    const text = actualText(assertion.actual).replaceAll(/\s+/g, " ").trim();
    const bounded = text.length > 500 ? `${text.slice(0, 497)}...` : text;
    return `${assertion.assertion_id}: ${bounded}`;
  });
  if (lines.length === 0) return "未记录业务断言";
  const summary = lines.join("\n");
  return summary.length > 2000 ? `${summary.slice(0, 1997)}...` : summary;
}

function executionNote(result: RunResult, item: RunCaseResult): string {
  return [
    "[runner]",
    `run_id=${result.run_id}`,
    `run_status=${item.run_status}`,
    `assertions=${item.assertions.length}`,
    `evidence=${item.evidence.length}`,
    `manifest=${result.manifest_hash}`,
    "verdict_source=run-result.json",
  ].join(" ");
}

function findCaseRow(report: TestingSkillsReport, caseId: string): { row: NativeReportRow; sheet: NativeReportSheet } | undefined {
  for (const sheet of report.sheets) {
    if ((sheet as NativeReportSheet).kind !== "test_cases") continue;
    const caseIdIndex = columnIndex(sheet, "用例 ID");
    for (const row of sheet.rows) {
      if (row.divider === true) continue;
      ensureColumnValues(row, sheet.columns.length);
      if (String(row.values[caseIdIndex] ?? "").trim() === caseId) return { row, sheet };
    }
  }
  return undefined;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}

function jsonCell(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(value);
}

function createAssertionSheet(result: RunResult): NativeReportSheet {
  return {
    name: "Assertion outcomes",
    kind: "supplementary",
    columns: ["Case ID", "Assertion ID", "Passed", "Actual", "Expected"],
    rows: result.cases.flatMap((item) => item.assertions.map((assertion) => ({
      values: [
        item.case_id,
        assertion.assertion_id,
        String(assertion.passed),
        jsonCell(assertion.actual),
        jsonCell(assertion.expected),
      ],
    }))),
  };
}

function createDetailEvidenceSheet(result: RunResult): NativeReportSheet {
  return {
    name: "Evidence references",
    kind: "supplementary",
    columns: ["Case ID", "Run status", "Case status", "Evidence path", "SHA-256"],
    rows: result.cases.flatMap((item) => item.evidence.map((evidence) => ({
      values: [
        item.case_id,
        item.run_status,
        item.case_status,
        evidence.path,
        evidence.sha256,
      ],
    }))),
  };
}

function createContractSemanticsSheet(result: RunResult): NativeReportSheet {
  return {
    name: "Execution contract semantics",
    kind: "supplementary",
    columns: ["Case ID", "Contract field", "Runtime status", "Contract value JSON"],
    rows: result.cases.flatMap((item) => {
      if (!item.execution_contract || !item.contract_field_status) return [];
      return Object.entries(item.execution_contract).map(([field, value]) => ({
        values: [item.case_id, field, item.contract_field_status![field as keyof typeof item.contract_field_status], JSON.stringify(value)],
      }));
    }),
  };
}

function rowsByName(report: TestingSkillsReport, name: string): NativeReportRow[] | undefined {
  const matching = report.sheets.filter((sheet) => sheet.name === name);
  return matching.length === 1 ? matching[0]!.rows : undefined;
}

function rowKey(values: unknown[]): string {
  return JSON.stringify(values.map((value) => String(value ?? "")));
}

function rowCounts(rows: NativeReportRow[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = rowKey(row.values);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function compareDetailRows(
  label: string,
  expected: NativeReportRow[],
  actual: NativeReportRow[] | undefined,
): string[] {
  if (!actual) return [`${label} sheet is missing or duplicated`];
  const errors: string[] = [];
  const expectedCounts = rowCounts(expected);
  const actualCounts = rowCounts(actual);
  for (const [key, count] of expectedCounts) {
    if (actualCounts.get(key) !== count) {
      const values = JSON.parse(key) as string[];
      errors.push(`${label} ${values[1] ?? values[0] ?? "row"} projection drift`);
    }
  }
  for (const [key, count] of actualCounts) {
    if (expectedCounts.get(key) !== count) {
      const values = JSON.parse(key) as string[];
      errors.push(`${label} ${values[1] ?? values[0] ?? "row"} has an extra or duplicate projection`);
    }
  }
  return errors;
}

export function verifyExecutionDetailProjection(input: ProjectExecutionReportInput): {
  valid: boolean;
  errors: string[];
} {
  const errors = [
    ...compareDetailRows(
      "assertion",
      createAssertionSheet(input.result).rows,
      rowsByName(input.report, "Assertion outcomes"),
    ),
    ...compareDetailRows(
      "evidence",
      createDetailEvidenceSheet(input.result).rows,
      rowsByName(input.report, "Evidence references"),
    ),
    ...compareDetailRows(
      "contract semantics",
      createContractSemanticsSheet(input.result).rows,
      rowsByName(input.report, "Execution contract semantics"),
    ),
  ];
  return { valid: errors.length === 0, errors };
}

function createOverviewSheet(result: RunResult): NativeReportSheet {
  const caseCounts = countBy(result.cases.map(({ case_status }) => case_status));
  const runCounts = countBy(result.cases.map(({ run_status }) => run_status));
  return {
    name: "执行汇总",
    kind: "overview",
    columns: ["项目", "值"],
    rows: [
      { values: ["run_id", result.run_id] },
      { values: ["manifest_hash", result.manifest_hash] },
      { values: ["contract_version", result.contract_version ?? ""] },
      { values: ["package_sha256", result.package_sha256 ?? ""] },
      { values: ["run_status", result.run_status] },
      { values: ["started_at", result.started_at] },
      { values: ["completed_at", result.completed_at ?? ""] },
      { values: ["case_status_counts", JSON.stringify(caseCounts)] },
      { values: ["run_status_counts", JSON.stringify(runCounts)] },
      { values: ["evidence_total", String(result.cases.reduce((sum, item) => sum + item.evidence.length, 0))] },
    ],
  };
}

function createEvidenceSheet(result: RunResult): NativeReportSheet {
  return {
    name: "执行证据",
    kind: "supplementary",
    columns: [
      "用例 ID",
      "运行状态",
      "执行结果",
      "证据路径",
      "SHA-256",
      "断言数",
      "断言明细 JSON",
    ],
    rows: result.cases.flatMap((item) => {
      const assertionDetails = JSON.stringify(item.assertions);
      if (item.evidence.length === 0) {
        return [{
          values: [
            item.case_id,
            item.run_status,
            item.case_status,
            "",
            "",
            String(item.assertions.length),
            assertionDetails,
          ],
        }];
      }
      return item.evidence.map((evidence) => ({
        values: [
          item.case_id,
          item.run_status,
          item.case_status,
          evidence.path,
          evidence.sha256,
          String(item.assertions.length),
          assertionDetails,
        ],
      }));
    }),
  };
}

export function projectExecutionReport(input: ProjectExecutionReportInput): TestingSkillsReport {
  const projected = cloneReport(input.report);

  for (const sheet of projected.sheets) {
    if ((sheet as NativeReportSheet).kind !== "test_cases") continue;
    for (const row of sheet.rows) ensureColumnValues(row, sheet.columns.length);
  }

  for (const item of input.result.cases) {
    const found = findCaseRow(projected, item.case_id);
    if (!found) continue;
    const { row, sheet } = found;
    row.values[columnIndex(sheet, "执行结果")] = item.case_status;
    const actualResultIndex = sheet.columns.indexOf("实际结果");
    if (actualResultIndex >= 0) row.values[actualResultIndex] = assertionSummary(item);
    const remarkIndex = sheet.columns.indexOf("备注");
    if (remarkIndex >= 0) appendRemark(row, remarkIndex, executionNote(input.result, item));
  }

  projected.sheets.push(
    createOverviewSheet(input.result),
    createEvidenceSheet(input.result),
    createAssertionSheet(input.result),
    createDetailEvidenceSheet(input.result),
    createContractSemanticsSheet(input.result),
  );
  return projected;
}

export async function renderExecutionReports(
  report: TestingSkillsReport,
  outputDir: string,
  basename = "result",
): Promise<RenderedReportBundle> {
  const renderer = await loadReportRenderer();
  return renderer.renderBoth(report, outputDir, basename);
}
