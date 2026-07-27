import type {
  CaseStatus,
  CaseColumnName,
  CaseValues,
  NormalizedCase,
  NormalizedCaseSet,
  SkillInvocation,
  TenColumnName,
} from "../types.js";
import { COMPACT_COLUMNS, ELEVEN_COLUMNS, TEN_COLUMNS, UnsupportedInputError, isSupportedCaseColumns, type NativeReportDocument } from "./detect-input.js";
import { inspectSource } from "./source-snapshot.js";

export type { NormalizedCase, NormalizedCaseSet } from "../types.js";

export const CASE_STATUSES = ["未执行", "通过", "不通过", "待定"] as const;

function asText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return asText(value.result);
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) =>
          typeof part === "object" && part !== null && "text" in part ? asText(part.text) : "",
        )
        .join("");
    }
    if ("error" in value) return asText(value.error);
  }
  return String(value);
}

function padRawValues(sourceValues: readonly unknown[], length: number): unknown[] {
  const values = [...sourceValues];
  while (values.length < length) values.push("");
  return values;
}

function normalizedStatus(originalStatus: string, divider: boolean, source: string): CaseStatus | "-" {
  if (divider) {
    if (originalStatus !== "-") throw new Error(`模块分割行执行结果必须为 -：${source}`);
    return "-";
  }
  if (originalStatus === "") return "未执行";
  if (CASE_STATUSES.some((status) => status === originalStatus)) return originalStatus as CaseStatus;
  throw new Error(`执行结果无效：${originalStatus}（${source}）`);
}

function validateIds(cases: readonly NormalizedCase[]): void {
  const sourcesById = new Map<string, string>();
  for (const item of cases) {
    if (item.divider) continue;
    if (item.id === "") throw new Error(`用例 ID 为空：${item.source}`);
    const previousSource = sourcesById.get(item.id);
    if (previousSource) {
      throw new Error(`用例 ID 重复：${item.id}（${previousSource}、${item.source}）`);
    }
    sourcesById.set(item.id, item.source);
  }
}

export interface SourceRow {
  sheet: string;
  row: number;
  values: readonly unknown[];
  divider?: boolean;
  columns?: readonly string[];
  extensionColumns?: readonly string[];
}

export function normalizeSourceRows(rows: readonly SourceRow[]): NormalizedCase[] {
  const cases = rows.map((row): NormalizedCase => {
    const columns = row.columns ?? TEN_COLUMNS;
    if (!isSupportedCaseColumns(columns)) {
      throw new Error(`${row.sheet}!1 不是受支持的十列或十一列用例表头`);
    }
    const rawValues = padRawValues(row.values, columns.length);
    const normalizedValues = rawValues.map(asText);
    const source = `${row.sheet}!${row.row}`;
    const valueByColumn = new Map(columns.map((column, index) => [column, normalizedValues[index] ?? ""]));
    const originalStatus = valueByColumn.get("执行结果") ?? "";
    const divider = row.divider ?? normalizedValues[0] === "【模块分割行】";
    const values = Object.fromEntries(
      TEN_COLUMNS.map((column) => [column, valueByColumn.get(column) ?? ""]),
    ) as CaseValues;
    if (valueByColumn.has("实际结果")) values["实际结果"] = valueByColumn.get("实际结果") ?? "";
    values["执行结果"] = normalizedStatus(originalStatus, divider, source);

    const extensions: Record<string, string> = {};
    for (let index = columns.length; index < rawValues.length; index += 1) {
      const header = row.extensionColumns?.[index - columns.length]?.trim();
      extensions[header || `列 ${index + 1}`] = normalizedValues[index] ?? "";
    }

    return {
      id: divider
        ? normalizedValues[0] ?? ""
        : (normalizedValues[0] ?? "").trim(),
      values,
      raw_values: rawValues,
      source,
      source_sheet: row.sheet,
      source_row: row.row,
      divider,
      extensions,
      original_status: originalStatus,
      status: values["执行结果"] as CaseStatus | "-",
    };
  });
  validateIds(cases);
  return cases;
}

export async function readNativeReport(file: string): Promise<NormalizedCaseSet> {
  const inspected = await inspectSource(file);
  if (inspected.detected.input_kind !== "native-report") {
    throw new UnsupportedInputError(file, "文件不是原生报告 JSON");
  }
  const report: NativeReportDocument = inspected.detected.report;
  const rows: SourceRow[] = [];
  let outputColumns: CaseColumnName[] = [...COMPACT_COLUMNS];
  for (const sheet of report.sheets) {
    if (sheet.kind !== "test_cases") continue;
    if (!isSupportedCaseColumns(sheet.columns)) {
      throw new UnsupportedInputError(file, `${sheet.name} 不是精确标准十列或工作台十一列`);
    }
    if (sheet.columns.length === TEN_COLUMNS.length) outputColumns = [...TEN_COLUMNS];
    if (sheet.columns.length === ELEVEN_COLUMNS.length) outputColumns = [...ELEVEN_COLUMNS];
    sheet.rows.forEach((row, index) => {
      rows.push({
        sheet: sheet.name,
        row: index + 2,
        values: row.values,
        columns: sheet.columns,
        ...(row.divider === undefined ? {} : { divider: row.divider }),
      });
    });
  }

  return {
    columns: outputColumns,
    cases: normalizeSourceRows(rows),
    source_snapshot: inspected.snapshot,
    skill_invocation: report.skill_invocation as SkillInvocation,
  };
}
