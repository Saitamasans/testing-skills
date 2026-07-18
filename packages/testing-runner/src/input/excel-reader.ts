import type { NormalizedCaseSet } from "../types.js";
import {
  TEN_COLUMNS,
  ELEVEN_COLUMNS,
  UnsupportedInputError,
  worksheetHasExactTenColumns,
  worksheetCaseColumns,
} from "./detect-input.js";
import { normalizeSourceRows, type SourceRow } from "./report-reader.js";
import { inspectSource } from "./source-snapshot.js";

function rowValues(row: import("exceljs").Row): unknown[] {
  const values: unknown[] = [];
  for (let column = 1; column <= row.cellCount; column += 1) {
    values.push(row.getCell(column).value);
  }
  return values;
}

export async function readStandardExcel(file: string): Promise<NormalizedCaseSet> {
  const inspected = await inspectSource(file);
  if (inspected.detected.input_kind !== "standard-excel") {
    throw new UnsupportedInputError(file, "工作簿不是精确标准十列或工作台十一列");
  }

  const rows: SourceRow[] = [];
  let outputColumns = [...TEN_COLUMNS] as Array<(typeof ELEVEN_COLUMNS)[number]>;
  for (const sheet of inspected.detected.workbook.worksheets) {
    if (!worksheetHasExactTenColumns(sheet)) continue;
    const columns = worksheetCaseColumns(sheet);
    if (!columns) continue;
    if (columns.length === ELEVEN_COLUMNS.length) outputColumns = [...ELEVEN_COLUMNS];
    for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (!row.hasValues) continue;
      const values = rowValues(row);
      rows.push({
        sheet: sheet.name,
        row: rowNumber,
        values,
        columns,
      });
    }
  }

  return {
    columns: outputColumns,
    cases: normalizeSourceRows(rows),
    source_snapshot: inspected.snapshot,
  };
}
