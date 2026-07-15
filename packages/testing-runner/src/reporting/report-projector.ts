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

const CASE_ID_INDEX = 0;
const STATUS_INDEX = 8;
const REMARK_INDEX = 9;
const TEN_COLUMN_COUNT = 10;

function cloneReport(report: TestingSkillsReport): TestingSkillsReport {
  return JSON.parse(JSON.stringify(report)) as TestingSkillsReport;
}

function ensureTenValues(row: NativeReportRow): void {
  while (row.values.length < TEN_COLUMN_COUNT) row.values.push("");
  if (row.values.length > TEN_COLUMN_COUNT) row.values = row.values.slice(0, TEN_COLUMN_COUNT);
}

function rowCaseId(row: NativeReportRow): string {
  return String(row.values[CASE_ID_INDEX] ?? "").trim();
}

function appendRemark(row: NativeReportRow, note: string): void {
  const existing = String(row.values[REMARK_INDEX] ?? "").trim();
  row.values[REMARK_INDEX] = existing ? `${existing}\n${note}` : note;
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

function findCaseRow(report: TestingSkillsReport, caseId: string): NativeReportRow | undefined {
  for (const sheet of report.sheets) {
    if ((sheet as NativeReportSheet).kind !== "test_cases") continue;
    for (const row of sheet.rows) {
      if (row.divider === true) continue;
      ensureTenValues(row);
      if (rowCaseId(row) === caseId) return row;
    }
  }
  return undefined;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
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
    columns: ["用例 ID", "运行状态", "执行结果", "证据路径", "SHA-256", "断言数"],
    rows: result.cases.flatMap((item) => {
      if (item.evidence.length === 0) {
        return [{
          values: [item.case_id, item.run_status, item.case_status, "", "", String(item.assertions.length)],
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
        ],
      }));
    }),
  };
}

export function projectExecutionReport(input: ProjectExecutionReportInput): TestingSkillsReport {
  const projected = cloneReport(input.report);

  for (const sheet of projected.sheets) {
    if ((sheet as NativeReportSheet).kind !== "test_cases") continue;
    for (const row of sheet.rows) ensureTenValues(row);
  }

  for (const item of input.result.cases) {
    const row = findCaseRow(projected, item.case_id);
    if (!row) continue;
    row.values[STATUS_INDEX] = item.case_status;
    appendRemark(row, executionNote(input.result, item));
  }

  projected.sheets.push(createOverviewSheet(input.result), createEvidenceSheet(input.result));
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
