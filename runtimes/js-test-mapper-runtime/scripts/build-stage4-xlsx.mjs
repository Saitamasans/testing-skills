#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function columnName(index) {
  let value = "";
  let current = index + 1;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function rowHeight(values, divider) {
  if (divider) return 28;
  const longest = Math.max(0, ...values.map((value) => String(value ?? "").length));
  return Math.max(34, Math.min(82, 26 + Math.ceil(longest / 52) * 14));
}

const args = process.argv.slice(2);
const input = path.resolve(valueAfter(args, "--input"));
const output = path.resolve(valueAfter(args, "--output"));
const previewDir = path.resolve(valueAfter(args, "--preview-dir") || path.join(path.dirname(output), "xlsx-previews"));
if (!input || !output) throw new Error("Usage: build-stage4-xlsx.mjs --input excel-projection.json --output output.xlsx [--preview-dir dir]");

const projection = JSON.parse(await fs.readFile(input, "utf8"));
const workbook = Workbook.create();
const tableNames = new Set();
const widths = {
  "01_扫描批次与范围": [12, 18, 22, 22, 28, 34, 12, 12, 14, 12, 28],
  "02_系统功能与路由地图": [16, 18, 26, 34, 30, 14],
  "03_JS调用链与接口引用": [14, 18, 18, 52, 28, 42, 14],
  "04_权限状态与生命周期": [18, 18, 42, 42, 14],
  "05_测试关注点与风险待确认": [14, 18, 16, 46, 34, 10, 14],
};
const statusValues = ["静态恢复", "运行观察", "待执行验证"];
const batchStatusValues = ["完成", "部分完成", "阻塞"];
const focusValues = ["测试关注点", "风险", "待确认"];

for (const declared of projection.sheets) {
  const sheet = workbook.worksheets.add(declared.name);
  sheet.showGridLines = false;
  const columnCount = declared.columns.length;
  const lastColumn = columnName(columnCount - 1);
  const values = [declared.columns, ...declared.rows.map((row) => [...row.values, ...Array(Math.max(0, columnCount - row.values.length)).fill("")])];
  const lastRow = values.length;
  sheet.getRange(`A1:${lastColumn}${lastRow}`).values = values;
  const header = sheet.getRange(`A1:${lastColumn}1`);
  header.format = {
    fill: "#1F4E78",
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#FFFFFF" },
    horizontalAlignment: "center",
    verticalAlignment: "center",
    wrapText: true,
    borders: { preset: "outside", style: "thin", color: "#163A5A" },
  };
  header.format.rowHeight = 34;
  if (lastRow > 1) {
    const body = sheet.getRange(`A2:${lastColumn}${lastRow}`);
    body.format = {
      font: { name: "Microsoft YaHei", size: 10, color: "#1F2937" },
      verticalAlignment: "top",
      wrapText: true,
      borders: { preset: "inside", style: "thin", color: "#D9E2F3" },
    };
    declared.rows.forEach((row, index) => {
      const excelRow = index + 2;
      const rowRange = sheet.getRange(`A${excelRow}:${lastColumn}${excelRow}`);
      rowRange.format.rowHeight = rowHeight(row.values, row.divider);
      if (row.divider) {
        rowRange.format = {
          fill: "#D9EAF7",
          font: { name: "Microsoft YaHei", size: 10, bold: true, color: "#1F4E78" },
          verticalAlignment: "center",
          wrapText: true,
          borders: { preset: "outside", style: "thin", color: "#9BBBD4" },
        };
        rowRange.format.rowHeight = 28;
      }
    });
  }
  const sheetWidths = widths[declared.name] || declared.columns.map(() => 22);
  sheetWidths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, lastRow, 1).format.columnWidth = width; });
  sheet.freezePanes.freezeRows(1);
  const tableName = `Stage4Table${String(declared.name.match(/^0([1-5])/)?.[1] || declared.name.length)}`;
  if (!tableNames.has(tableName)) {
    sheet.tables.add(`A1:${lastColumn}${lastRow}`, true, tableName);
    tableNames.add(tableName);
  }
  if (declared.name === "01_扫描批次与范围" && lastRow > 1) sheet.getRange(`J2:J${lastRow}`).dataValidation = { rule: { type: "list", values: batchStatusValues } };
  if (declared.name === "02_系统功能与路由地图" && lastRow > 1) sheet.getRange(`F2:F${lastRow}`).dataValidation = { rule: { type: "list", values: statusValues } };
  if (declared.name === "03_JS调用链与接口引用" && lastRow > 1) sheet.getRange(`G2:G${lastRow}`).dataValidation = { rule: { type: "list", values: statusValues } };
  if (declared.name === "04_权限状态与生命周期" && lastRow > 1) sheet.getRange(`E2:E${lastRow}`).dataValidation = { rule: { type: "list", values: statusValues } };
  if (declared.name === "05_测试关注点与风险待确认" && lastRow > 1) {
    sheet.getRange(`C2:C${lastRow}`).dataValidation = { rule: { type: "list", values: focusValues } };
    sheet.getRange(`G2:G${lastRow}`).dataValidation = { rule: { type: "list", values: statusValues } };
    sheet.getRange(`F2:F${lastRow}`).conditionalFormats.addCustom('=$F2="P1"', { fill: "#FFF2CC" });
  }
}

await fs.mkdir(path.dirname(output), { recursive: true });
await fs.mkdir(previewDir, { recursive: true });
for (const sheet of workbook.worksheets.items) {
  const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1, format: "png" });
  await fs.writeFile(path.join(previewDir, `${sheet.name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
const exported = await SpreadsheetFile.exportXlsx(workbook);
await exported.save(output);
console.log(JSON.stringify({ output, previewDir, sheets: workbook.worksheets.items.map((sheet) => sheet.name) }, null, 2));
