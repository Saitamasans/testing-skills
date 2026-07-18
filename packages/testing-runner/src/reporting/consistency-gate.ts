import type {
  CaseStatus,
  RunResult,
  RunStatus,
} from "../types.js";
import type {
  NativeReportDocument,
  NativeReportRow,
  NativeReportSheet,
} from "../input/detect-input.js";

export interface ConsistencyResult {
  valid: boolean;
  errors: string[];
  statistics: {
    case_statuses: Record<CaseStatus, number>;
    run_statuses: Partial<Record<RunStatus, number>>;
    evidence_by_case: Record<string, number>;
    manifest_hash: string;
  };
}

interface ReportCaseRow {
  caseId: string;
  status: string;
  sheetName: string;
  rowNumber: number;
  row: NativeReportRow;
}

const CASE_STATUSES: CaseStatus[] = ["未执行", "通过", "不通过", "待定"];

function emptyCaseStatusCounts(): Record<CaseStatus, number> {
  return Object.fromEntries(CASE_STATUSES.map((status) => [status, 0])) as Record<CaseStatus, number>;
}

function countRunStatuses(result: RunResult): Partial<Record<RunStatus, number>> {
  const counts: Partial<Record<RunStatus, number>> = {};
  for (const item of result.cases) counts[item.run_status] = (counts[item.run_status] ?? 0) + 1;
  return counts;
}

function rowValue(row: NativeReportRow, index: number): string {
  return String(row.values[index] ?? "").trim();
}

function isDivider(row: NativeReportRow): boolean {
  return row.divider === true;
}

function collectReportCases(report: NativeReportDocument): ReportCaseRow[] {
  const rows: ReportCaseRow[] = [];

  for (const sheet of report.sheets) {
    if ((sheet as NativeReportSheet).kind !== "test_cases") continue;
    const caseIdIndex = sheet.columns.indexOf("用例 ID");
    const statusIndex = sheet.columns.indexOf("执行结果");
    if (caseIdIndex < 0 || statusIndex < 0) continue;
    for (const [index, row] of sheet.rows.entries()) {
      if (isDivider(row)) continue;
      rows.push({
        caseId: rowValue(row, caseIdIndex),
        status: rowValue(row, statusIndex),
        sheetName: sheet.name,
        rowNumber: index + 2,
        row,
      });
    }
  }

  return rows;
}

function groupByCaseId(rows: ReportCaseRow[]): Map<string, ReportCaseRow[]> {
  const grouped = new Map<string, ReportCaseRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.caseId) ?? [];
    list.push(row);
    grouped.set(row.caseId, list);
  }
  return grouped;
}

export function verifyReportConsistency(input: {
  report: NativeReportDocument;
  result: RunResult;
}): ConsistencyResult {
  const errors: string[] = [];
  const reportRows = collectReportCases(input.report);
  const rowsByCaseId = groupByCaseId(reportRows);
  const resultCaseIds = new Set(input.result.cases.map(({ case_id }) => case_id));
  const caseStatusCounts = emptyCaseStatusCounts();
  const evidenceByCase: Record<string, number> = {};

  for (const [caseId, rows] of rowsByCaseId) {
    if (caseId === "") errors.push("report contains an empty case ID");
    if (rows.length > 1) {
      const locations = rows.map(({ sheetName, rowNumber }) => `${sheetName}!${rowNumber}`).join(", ");
      errors.push(`duplicate report case ID ${caseId || "<empty>"} at ${locations}`);
    }
    if (!resultCaseIds.has(caseId)) errors.push(`report contains case ${caseId} that is missing from RunResult`);
  }

  for (const item of input.result.cases) {
    evidenceByCase[item.case_id] = item.evidence.length;
    caseStatusCounts[item.case_status] += 1;

    const rows = rowsByCaseId.get(item.case_id) ?? [];
    if (rows.length === 0) {
      errors.push(`RunResult case ${item.case_id} is missing from projected report`);
      continue;
    }
    if (rows.length !== 1) continue;

    const [row] = rows;
    if (!row) continue;
    if (row.status !== item.case_status) {
      errors.push(
        `case ${item.case_id} status drift: report=${row.status || "<empty>"} RunResult=${item.case_status}`,
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    statistics: {
      case_statuses: caseStatusCounts,
      run_statuses: countRunStatuses(input.result),
      evidence_by_case: evidenceByCase,
      manifest_hash: input.result.manifest_hash,
    },
  };
}
