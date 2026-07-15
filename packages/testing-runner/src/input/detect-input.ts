import { readFile } from "node:fs/promises";
import path from "node:path";

import ExcelJS from "exceljs";

import { validateDocument } from "../schema-registry.js";
import type { InputKind } from "../types.js";

export type { InputKind } from "../types.js";

export const TEN_COLUMNS = [
  "用例 ID",
  "所属模块",
  "用例标题",
  "验证功能点",
  "前置条件",
  "测试步骤",
  "预期结果",
  "优先级",
  "执行结果",
  "备注",
] as const;

const OLE_COMPOUND_FILE_SIGNATURE = Buffer.from("d0cf11e0a1b11ae1", "hex");
const SUPPORTED_INPUT_MESSAGE =
  "仅支持符合 report.schema.json 的 JSON 报告或标准十列 .xlsx 工作簿";

export class UnsupportedInputError extends Error {
  readonly file: string;

  constructor(file: string, detail?: string) {
    super(`${detail ? `${detail}；` : ""}${SUPPORTED_INPUT_MESSAGE}：${file}`);
    this.name = "UnsupportedInputError";
    this.file = file;
  }
}

export class EncryptedInputError extends UnsupportedInputError {
  constructor(file: string) {
    super(file, "加密工作簿不支持");
    this.name = "EncryptedInputError";
  }
}

export class MacroEnabledInputError extends UnsupportedInputError {
  constructor(file: string) {
    super(file, "宏工作簿不支持");
    this.name = "MacroEnabledInputError";
  }
}

export interface NativeReportRow {
  divider?: boolean;
  values: unknown[];
}

export interface NativeReportSheet {
  name: string;
  kind: "test_cases" | "overview" | "supplementary";
  columns: string[];
  rows: NativeReportRow[];
}

export interface NativeReportDocument {
  title: string;
  generated_at: string;
  skill_invocation: string | Record<string, string>;
  sheets: NativeReportSheet[];
}

export type DetectedInput =
  | {
      input_kind: "native-report";
      sheet_names: string[];
      report: NativeReportDocument;
    }
  | {
      input_kind: "standard-excel" | "nonstandard-excel";
      sheet_names: string[];
      workbook: ExcelJS.Workbook;
    };

function normalizedHeader(value: unknown): string {
  return String(value ?? "").replace(/^\uFEFF/, "").trim();
}

function headerValues(sheet: ExcelJS.Worksheet): string[] {
  const values: string[] = [];
  const row = sheet.getRow(1);
  for (let column = 1; column <= row.cellCount; column += 1) {
    values.push(normalizedHeader(row.getCell(column).text));
  }
  while (values.at(-1) === "") values.pop();
  return values;
}

function hasExactTenColumns(workbook: ExcelJS.Workbook): boolean {
  return workbook.worksheets.some((sheet) => {
    const headers = headerValues(sheet);
    return (
      headers.length === TEN_COLUMNS.length &&
      headers.every((header, index) => header === TEN_COLUMNS[index])
    );
  });
}

function hasMacroContent(bytes: Buffer): boolean {
  return bytes.toString("latin1").toLowerCase().includes("vbaproject.bin");
}

function isOleCompoundFile(bytes: Buffer): boolean {
  return (
    bytes.length >= OLE_COMPOUND_FILE_SIGNATURE.length &&
    bytes.subarray(0, OLE_COMPOUND_FILE_SIGNATURE.length).equals(OLE_COMPOUND_FILE_SIGNATURE)
  );
}

function isZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

export async function detectInputFromBytes(file: string, bytes: Buffer): Promise<DetectedInput> {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".xlsm") throw new MacroEnabledInputError(file);

  if (extension === ".json") {
    let value: unknown;
    try {
      value = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
    } catch {
      throw new UnsupportedInputError(file, "文件内容不是有效 JSON");
    }
    const report = validateDocument<NativeReportDocument>("report", value);
    return {
      input_kind: "native-report",
      sheet_names: report.sheets.map(({ name }) => name),
      report,
    };
  }

  if (extension !== ".xlsx") throw new UnsupportedInputError(file);
  if (isOleCompoundFile(bytes)) throw new EncryptedInputError(file);
  if (hasMacroContent(bytes)) throw new MacroEnabledInputError(file);
  if (!isZip(bytes)) throw new UnsupportedInputError(file, "文件内容不是有效 Excel 工作簿");

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(bytes as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new UnsupportedInputError(file, "文件内容不是可读取的 Excel 工作簿");
  }

  return {
    input_kind: hasExactTenColumns(workbook) ? "standard-excel" : "nonstandard-excel",
    sheet_names: workbook.worksheets.map(({ name }) => name),
    workbook,
  };
}

export async function detectInputKind(file: string): Promise<InputKind> {
  const bytes = await readFile(file);
  return (await detectInputFromBytes(file, bytes)).input_kind;
}

export function worksheetHasExactTenColumns(sheet: ExcelJS.Worksheet): boolean {
  const headers = headerValues(sheet);
  return (
    headers.length === TEN_COLUMNS.length &&
    headers.every((header, index) => header === TEN_COLUMNS[index])
  );
}
