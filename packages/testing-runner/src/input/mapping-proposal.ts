import { createHash } from "node:crypto";

import ExcelJS from "exceljs";

import type { OriginalSourceRow, SourceSnapshot, TenColumnName } from "../types.js";
import { TEN_COLUMNS, UnsupportedInputError } from "./detect-input.js";
import type { MappingColumnRule, SplitColumnRule } from "./mapping-approval.js";
import { inspectSource } from "./source-snapshot.js";

export interface InspectedSheet {
  source_sheet: string;
  columns: string[];
  rows: OriginalSourceRow[];
}

export interface WorkbookInspection {
  file: string;
  workbook: ExcelJS.Workbook;
  source_snapshot: SourceSnapshot & { rows: OriginalSourceRow[] };
  sheets: InspectedSheet[];
}

export interface MappingColumnProposal {
  source_sheet: string;
  source_column: string;
  source_column_index: number;
  sample_values: string[];
  suggested_standard_field: TenColumnName | ["测试步骤", "预期结果"] | null;
  suggested_rule: MappingColumnRule | null;
  matching_rationale: string;
  confidence: number;
}

export interface SplitPreview {
  source_sheet: string;
  source_column: string;
  source_column_index: number;
  split_rule: SplitColumnRule["split_rule"];
  rows: Array<{ source: string; input: string; outputs: [string, string] }>;
}

export interface ExtensionColumnDescriptor {
  source_sheet: string;
  source_column: string;
  source_column_index: number;
  extension_key: string;
}

export interface MappingProposal {
  source_snapshot: SourceSnapshot & { rows: OriginalSourceRow[] };
  sheets: Array<{ source_sheet: string; columns: string[]; row_count: number }>;
  columns: MappingColumnProposal[];
  missing_fields: Array<{ source_sheet: string; fields: TenColumnName[] }>;
  duplicate_mappings: Array<{ source_sheet: string; target_field: TenColumnName; source_columns: string[] }>;
  conflicting_mappings: Array<{ source_sheet: string; source_column: string; targets: TenColumnName[] }>;
  extension_columns: ExtensionColumnDescriptor[];
  split_previews: SplitPreview[];
  normalized_sample_rows: Array<{
    id: string;
    source: string;
    values: Record<TenColumnName, string>;
    extensions: Record<string, string>;
  }>;
  confidence: number;
  human_preview: string;
  proposal_sha256: string;
}

const DIRECT_ALIASES = new Map<string, TenColumnName>([
  ["编号", "用例 ID"],
  ["用例编号", "用例 ID"],
  ["id", "用例 ID"],
  ["模块", "所属模块"],
  ["所属模块", "所属模块"],
  ["标题", "用例标题"],
  ["用例标题", "用例标题"],
  ["功能", "验证功能点"],
  ["功能点", "验证功能点"],
  ["验证功能点", "验证功能点"],
  ["前置", "前置条件"],
  ["前置条件", "前置条件"],
  ["步骤", "测试步骤"],
  ["测试步骤", "测试步骤"],
  ["预期", "预期结果"],
  ["预期结果", "预期结果"],
  ["优先", "优先级"],
  ["优先级", "优先级"],
  ["执行状态", "执行结果"],
  ["执行结果", "执行结果"],
  ["备注", "备注"],
]);

const MERGED_ALIASES = new Set(["步骤与预期", "步骤及预期", "操作与预期"]);

export const MAX_SPLIT_SEPARATOR_LENGTH = 256;
export const MAX_SPLIT_INPUT_LENGTH = 100_000;

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return text(value.result);
    if ("text" in value) return text(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) =>
        typeof part === "object" && part !== null && "text" in part ? text(part.text) : "",
      ).join("");
    }
  }
  return String(value);
}

function normalizedHeader(value: unknown, index: number): string {
  return text(value).replace(/^\uFEFF/, "").trim() || `列 ${index + 1}`;
}

function rawRowValues(row: ExcelJS.Row, width: number): unknown[] {
  return Array.from({ length: width }, (_, index) => row.getCell(index + 1).value);
}

export async function inspectNonstandardWorkbook(file: string): Promise<WorkbookInspection> {
  const inspected = await inspectSource(file);
  if (inspected.detected.input_kind !== "nonstandard-excel") {
    throw new UnsupportedInputError(file, "工作簿不是非标准 Excel");
  }
  const sheets: InspectedSheet[] = [];
  const sourceRows: OriginalSourceRow[] = [];
  for (const worksheet of inspected.detected.workbook.worksheets) {
    const header = worksheet.getRow(1);
    const width = Math.max(header.cellCount, worksheet.columnCount);
    const columns = Array.from({ length: width }, (_, index) =>
      normalizedHeader(header.getCell(index + 1).value, index),
    );
    const rows: OriginalSourceRow[] = [];
    for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
      const row = worksheet.getRow(rowNumber);
      if (!row.hasValues) continue;
      const sourceRow: OriginalSourceRow = {
        source: `${worksheet.name}!${rowNumber}`,
        source_sheet: worksheet.name,
        source_row: rowNumber,
        columns: [...columns],
        raw_values: rawRowValues(row, width),
      };
      rows.push(sourceRow);
      sourceRows.push(sourceRow);
    }
    sheets.push({ source_sheet: worksheet.name, columns, rows });
  }
  return {
    file,
    workbook: inspected.detected.workbook,
    source_snapshot: { ...inspected.snapshot, rows: sourceRows },
    sheets,
  };
}

export function splitValue(
  value: string,
  strategy: "delimiter" | "labeled-sections",
  separator: string,
  source?: string,
): [string, string] {
  if (separator.length > MAX_SPLIT_SEPARATOR_LENGTH) {
    throw new Error(`拆分规则长度超过上限（${MAX_SPLIT_SEPARATOR_LENGTH}）`);
  }
  if (value.length > MAX_SPLIT_INPUT_LENGTH) {
    throw new Error(`拆分输入长度超过上限（${MAX_SPLIT_INPUT_LENGTH}）：${source ?? "预览行"}`);
  }
  if (strategy === "delimiter") {
    if (separator === "") throw new Error("分隔符拆分规则不能为空");
    const index = value.indexOf(separator);
    if (index < 0) return [value.trim(), ""];
    return [value.slice(0, index).trim(), value.slice(index + separator.length).trim()];
  }
  const boundary = separator.indexOf("||");
  if (boundary <= 0 || boundary !== separator.lastIndexOf("||") || boundary === separator.length - 2) {
    throw new Error("标签段拆分规则必须是“步骤标签||预期标签”两个非空字面量");
  }
  const stepsLabel = separator.slice(0, boundary);
  const expectedLabel = separator.slice(boundary + 2);
  const stepsLabelIndex = value.indexOf(stepsLabel);
  if (stepsLabelIndex < 0) return ["", ""];
  const stepsStart = stepsLabelIndex + stepsLabel.length;
  const expectedLabelIndex = value.indexOf(expectedLabel, stepsStart);
  if (expectedLabelIndex < 0) return [value.slice(stepsStart).trim(), ""];
  return [
    value.slice(stepsStart, expectedLabelIndex).trim(),
    value.slice(expectedLabelIndex + expectedLabel.length).trim(),
  ];
}

export function extensionColumnKey(header: string, index: number): string {
  return `${header} [列${index + 1}]`;
}

function proposalForColumn(
  sheet: InspectedSheet,
  sourceColumn: string,
  index: number,
  exactRule?: MappingColumnRule | null,
): MappingColumnProposal {
  const key = sourceColumn.replace(/\s+/g, "").toLowerCase();
  const sampleValues = sheet.rows.slice(0, 3).map((row) => text(row.raw_values[index]));
  const source = {
    source_sheet: sheet.source_sheet,
    source_column: sourceColumn,
    source_column_index: index + 1,
  };
  if (exactRule !== undefined) {
    if (exactRule === null) {
      return {
        ...source,
        sample_values: sampleValues,
        suggested_standard_field: null,
        suggested_rule: null,
        matching_rationale: `规则集未映射列“${sourceColumn}”，作为扩展列保留`,
        confidence: 1,
      };
    }
    if (exactRule.source_sheet !== source.source_sheet ||
        exactRule.source_column !== source.source_column ||
        exactRule.source_column_index !== source.source_column_index) {
      throw new Error(`显式映射规则源列不匹配：${source.source_sheet}.${source.source_column}`);
    }
    return {
      ...source,
      sample_values: sampleValues,
      suggested_standard_field: exactRule.kind === "direct"
        ? exactRule.target_field
        : ["测试步骤", "预期结果"],
      suggested_rule: structuredClone(exactRule),
      matching_rationale: exactRule.kind === "direct"
        ? `规则将列“${sourceColumn}”映射到“${exactRule.target_field}”`
        : `规则按 ${exactRule.split_rule.strategy} 拆分列“${sourceColumn}”`,
      confidence: 1,
    };
  }
  const direct = DIRECT_ALIASES.get(key);
  if (direct) {
    return {
      ...source,
      sample_values: sampleValues,
      suggested_standard_field: direct,
      suggested_rule: { kind: "direct", ...source, target_field: direct },
      matching_rationale: `列名“${sourceColumn}”命中标准字段别名“${direct}”`,
      confidence: 1,
    };
  }
  if (MERGED_ALIASES.has(key)) {
    return {
      ...source,
      sample_values: sampleValues,
      suggested_standard_field: ["测试步骤", "预期结果"],
      suggested_rule: {
        kind: "split",
        ...source,
        split_rule: {
          version: "1.0.0",
          source_column: sourceColumn,
          strategy: "delimiter",
          separator: "\n预期：",
          targets: ["测试步骤", "预期结果"],
        },
      },
      matching_rationale: `列名“${sourceColumn}”明确表示测试步骤与预期结果合并`,
      confidence: 1,
    };
  }
  return {
    ...source,
    sample_values: sampleValues,
    suggested_standard_field: null,
    suggested_rule: null,
    matching_rationale: `列名“${sourceColumn}”未命中标准字段，作为扩展列保留`,
    confidence: 0,
  };
}

function buildSplitPreviews(columns: readonly MappingColumnProposal[], inspection: WorkbookInspection): SplitPreview[] {
  return columns.flatMap((column): SplitPreview[] => {
    if (column.suggested_rule?.kind !== "split") return [];
    const sheet = inspection.sheets.find(({ source_sheet }) => source_sheet === column.source_sheet)!;
    const splitRule = column.suggested_rule.split_rule;
    return [{
      source_sheet: column.source_sheet,
      source_column: column.source_column,
      source_column_index: column.source_column_index,
      split_rule: splitRule,
      rows: sheet.rows.slice(0, 3).map((row) => {
        const input = text(row.raw_values[column.source_column_index - 1]);
        return {
          source: row.source,
          input,
          outputs: splitValue(input, splitRule.strategy, splitRule.separator, row.source),
        };
      }),
    }];
  });
}

function coveredFields(columns: readonly MappingColumnProposal[]): TenColumnName[] {
  return columns.flatMap(({ suggested_standard_field }) =>
    suggested_standard_field === null
      ? []
      : Array.isArray(suggested_standard_field)
        ? suggested_standard_field
        : [suggested_standard_field],
  );
}

function buildHumanPreview(proposal: Omit<MappingProposal, "proposal_sha256" | "human_preview">): string {
  const lines = [
    `源文件 SHA-256: ${proposal.source_snapshot.sha256}`,
    `整体置信度: ${proposal.confidence}`,
  ];
  for (const sheet of proposal.sheets) lines.push(`Sheet: ${sheet.source_sheet}（${sheet.row_count} 行）`);
  for (const column of proposal.columns) {
    const target = column.suggested_standard_field === null
      ? "扩展列"
      : Array.isArray(column.suggested_standard_field)
        ? column.suggested_standard_field.join(" + ")
        : column.suggested_standard_field;
    lines.push(`${column.source_sheet}.${column.source_column} -> ${target}; 样例: ${column.sample_values.join(" | ")}; ${column.matching_rationale}; 置信度 ${column.confidence}`);
  }
  for (const missing of proposal.missing_fields) lines.push(`${missing.source_sheet} 缺失字段: ${missing.fields.join("、")}`);
  lines.push(proposal.duplicate_mappings.length === 0
    ? "重复映射: 无"
    : `重复映射: ${proposal.duplicate_mappings.map((item) => `${item.source_sheet}.${item.target_field} <- ${item.source_columns.join("、")}`).join("; ")}`);
  lines.push(proposal.conflicting_mappings.length === 0
    ? "冲突映射: 无"
    : `冲突映射: ${proposal.conflicting_mappings.map((item) => `${item.source_sheet}.${item.source_column} -> ${item.targets.join("、")}`).join("; ")}`);
  for (const extension of proposal.extension_columns) {
    const samples = proposal.columns.find((column) =>
      column.source_sheet === extension.source_sheet &&
      column.source_column_index === extension.source_column_index,
    )?.sample_values ?? [];
    lines.push(`未识别扩展列: ${extension.source_sheet}.${extension.source_column}; 源列=${extension.source_column_index}; 键=${extension.extension_key}; 样例=${samples.join(" | ")}`);
  }
  for (const preview of proposal.split_previews) {
    lines.push(`拆分预览: ${preview.source_sheet}.${preview.source_column} / ${preview.split_rule.version} / ${preview.split_rule.strategy} / ${JSON.stringify(preview.split_rule.separator)}`);
    for (const row of preview.rows) lines.push(`${row.source}: ${row.outputs[0]} => ${row.outputs[1]}`);
  }
  for (const row of proposal.normalized_sample_rows) {
    const fields = TEN_COLUMNS.map((column) => `${column}=${JSON.stringify(row.values[column])}`).join("; ");
    lines.push(`标准化样例: ${row.source}; ${fields}; 扩展字段=${JSON.stringify(row.extensions)}`);
  }
  return lines.join("\n");
}

function normalizeForPreview(
  inspection: WorkbookInspection,
  columns: readonly MappingColumnProposal[],
  splitPreviews: readonly SplitPreview[],
  extensionColumns: readonly ExtensionColumnDescriptor[],
): MappingProposal["normalized_sample_rows"] {
  const rows: MappingProposal["normalized_sample_rows"] = [];
  const extensionBySource = new Map(extensionColumns.map((descriptor) => [
    `${descriptor.source_sheet}\u0000${descriptor.source_column_index}`,
    descriptor,
  ]));
  for (const sheet of inspection.sheets) {
    const sheetColumns = columns.filter(({ source_sheet }) => source_sheet === sheet.source_sheet);
    const fields = coveredFields(sheetColumns);
    if (!fields.includes("测试步骤") || !fields.includes("预期结果")) continue;
    for (const row of sheet.rows) {
      const values = Object.fromEntries(TEN_COLUMNS.map((column) => [column, ""])) as Record<TenColumnName, string>;
      const extensions: Record<string, string> = {};
      for (const column of sheetColumns) {
        const value = text(row.raw_values[column.source_column_index - 1]);
        if (column.suggested_rule?.kind === "direct") {
          values[column.suggested_rule.target_field] = value;
        } else if (column.suggested_rule?.kind === "split") {
          const preview = splitPreviews.find((candidate) =>
            candidate.source_sheet === column.source_sheet &&
            candidate.source_column_index === column.source_column_index,
          )!;
          const outputs = splitValue(value, preview.split_rule.strategy, preview.split_rule.separator, row.source);
          values["测试步骤"] = outputs[0];
          values["预期结果"] = outputs[1];
        } else {
          const descriptor = extensionBySource.get(
            `${column.source_sheet}\u0000${column.source_column_index}`,
          )!;
          extensions[descriptor.extension_key] = value;
        }
      }
      const id = values["用例 ID"]?.trim() ||
        `EXT-${inspection.source_snapshot.sha256.slice(0, 8)}-${String(row.source_row).padStart(6, "0")}`;
      values["用例 ID"] = id;
      rows.push({ id, source: row.source, values, extensions });
      if (rows.length === 3) return rows;
    }
  }
  return rows;
}

function jsonCompatible(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

export function canonicalize(value: unknown): string {
  const compareCodePoints = (left: string, right: string): number => {
    const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
    const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
    for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index += 1) {
      if (leftPoints[index] !== rightPoints[index]) return leftPoints[index]! - rightPoints[index]!;
    }
    return leftPoints.length - rightPoints.length;
  };
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (item !== null && typeof item === "object") {
      return Object.fromEntries(
        Object.entries(item as Record<string, unknown>)
          .sort(([left], [right]) => compareCodePoints(left, right))
          .map(([key, child]) => [key, sort(child)]),
      );
    }
    return item;
  };
  return JSON.stringify(sort(jsonCompatible(value)));
}

export function calculateProposalSha256(proposal: MappingProposal | Omit<MappingProposal, "proposal_sha256">): string {
  const { proposal_sha256: _ignored, ...hashable } = proposal as MappingProposal;
  return createHash("sha256").update(canonicalize(hashable)).digest("hex");
}

export function buildMappingProposal(
  inspection: WorkbookInspection,
  exactRules?: readonly MappingColumnRule[],
): MappingProposal {
  if (exactRules === undefined) {
    const automaticRules = inspection.sheets.flatMap((sheet) =>
      sheet.columns.flatMap((column, index) => {
        const rule = proposalForColumn(sheet, column, index).suggested_rule;
        return rule === null ? [] : [rule];
      }),
    );
    return buildMappingProposal(inspection, automaticRules);
  }
  const sourceColumns = new Set(inspection.sheets.flatMap((sheet) =>
    sheet.columns.map((sourceColumn, index) => `${sheet.source_sheet}\u0000${index + 1}\u0000${sourceColumn}`),
  ));
  const exactRulesBySource = new Map<string, MappingColumnRule>();
  for (const rule of exactRules) {
    const identity = `${rule.source_sheet}\u0000${rule.source_column_index}\u0000${rule.source_column}`;
    if (!sourceColumns.has(identity)) {
      throw new Error(`显式映射规则引用了不存在的源列：${rule.source_sheet}.${rule.source_column}`);
    }
    const sourceKey = `${rule.source_sheet}\u0000${rule.source_column_index}`;
    if (exactRulesBySource.has(sourceKey)) {
      throw new Error(`显式映射规则重复引用源列：${rule.source_sheet}.${rule.source_column}`);
    }
    exactRulesBySource.set(sourceKey, rule);
  }
  const columns = inspection.sheets.flatMap((sheet) =>
    sheet.columns.map((column, index) => proposalForColumn(
      sheet,
      column,
      index,
      exactRulesBySource.get(`${sheet.source_sheet}\u0000${index + 1}`) ?? null,
    )),
  );
  const splitPreviews = buildSplitPreviews(columns, inspection);
  const missingFields = inspection.sheets.map((sheet) => {
    const covered = new Set(coveredFields(columns.filter(({ source_sheet }) => source_sheet === sheet.source_sheet)));
    return { source_sheet: sheet.source_sheet, fields: TEN_COLUMNS.filter((field) => !covered.has(field)) };
  }).filter(({ fields }) => fields.length > 0);
  const duplicateMappings: MappingProposal["duplicate_mappings"] = [];
  for (const sheet of inspection.sheets) {
    const byTarget = new Map<TenColumnName, string[]>();
    for (const field of coveredFields(columns.filter(({ source_sheet }) => source_sheet === sheet.source_sheet))) {
      byTarget.set(field, []);
    }
    for (const column of columns.filter(({ source_sheet }) => source_sheet === sheet.source_sheet)) {
      const targets = column.suggested_standard_field === null ? []
        : Array.isArray(column.suggested_standard_field) ? column.suggested_standard_field : [column.suggested_standard_field];
      for (const target of targets) byTarget.get(target)?.push(column.source_column);
    }
    for (const [target_field, source_columns] of byTarget) {
      if (source_columns.length > 1) duplicateMappings.push({ source_sheet: sheet.source_sheet, target_field, source_columns });
    }
  }
  const confidenceColumns = columns.filter(({ suggested_rule }) => suggested_rule !== null);
  const confidence = confidenceColumns.length === 0
    ? 0
    : confidenceColumns.reduce((sum, column) => sum + column.confidence, 0) / confidenceColumns.length;
  const extensionColumns: ExtensionColumnDescriptor[] = columns
    .filter(({ suggested_rule }) => suggested_rule === null)
    .map((column) => ({
      source_sheet: column.source_sheet,
      source_column: column.source_column,
      source_column_index: column.source_column_index,
      extension_key: extensionColumnKey(column.source_column, column.source_column_index - 1),
    }));
  const withoutTextAndHash: Omit<MappingProposal, "proposal_sha256" | "human_preview"> = {
    source_snapshot: inspection.source_snapshot,
    sheets: inspection.sheets.map((sheet) => ({
      source_sheet: sheet.source_sheet,
      columns: [...sheet.columns],
      row_count: sheet.rows.length,
    })),
    columns,
    missing_fields: missingFields,
    duplicate_mappings: duplicateMappings,
    conflicting_mappings: [],
    extension_columns: extensionColumns,
    split_previews: splitPreviews,
    normalized_sample_rows: normalizeForPreview(
      inspection,
      columns,
      splitPreviews,
      extensionColumns,
    ),
    confidence,
  };
  const human_preview = buildHumanPreview(withoutTextAndHash);
  const proposalWithoutHash = { ...withoutTextAndHash, human_preview };
  return { ...proposalWithoutHash, proposal_sha256: calculateProposalSha256(proposalWithoutHash) };
}

export function proposeMapping(inspection: WorkbookInspection): MappingProposal {
  return buildMappingProposal(inspection);
}
