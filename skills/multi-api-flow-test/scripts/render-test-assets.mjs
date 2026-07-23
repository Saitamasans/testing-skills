#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const COLUMNS = ["用例 ID", "所属模块", "用例标题", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果"];
export const LEGACY_COLUMNS = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "执行结果", "备注"];
export const WORKBENCH_COLUMNS = [...LEGACY_COLUMNS.slice(0, 8), "实际结果", ...LEGACY_COLUMNS.slice(8)];
export const REQUIREMENT_COLUMNS = [...LEGACY_COLUMNS.slice(0, 8), "执行结果（通过 / 不通过 / 未执行）", "备注"];
export const GRAYBOX_COLUMNS = REQUIREMENT_COLUMNS;
export const STATUSES = ["未执行", "通过", "不通过", "待定"];
const PRIORITIES = ["P0", "P1", "P2"];
const REQUIREMENT_SKILLS = new Set(["requirement-test-workbench", "enhanced-graybox-test-case-generation"]);

function primarySkill(data) {
  const invocation = data?.skill_invocation;
  return typeof invocation === "string" ? invocation : invocation?.primary;
}

function usesRequirementContract(data) {
  return data?.case_contract === "requirement-test-case-v1" || REQUIREMENT_SKILLS.has(primarySkill(data));
}

function sameColumns(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function convertRequirementRow(row, sourceColumns, nextId) {
  const value = (column) => {
    const index = sourceColumns.indexOf(column);
    return index < 0 ? "" : row.values[index];
  };
  if (row.divider) {
    return {
      ...row,
      values: [
        value("用例 ID") || "【模块分割行】",
        value("所属模块"),
        value("用例标题"),
        value("验证功能点") || "-",
        value("前置条件") || "-",
        value("测试步骤") || "-",
        value("预期结果") || "-",
        value("优先级") || "-",
        "-",
        value("备注") || "模块起始分割",
      ],
    };
  }
  const title = String(value("用例标题") || "").trim();
  return {
    ...row,
    values: [
      String(nextId),
      value("所属模块"),
      title,
      value("验证功能点") || `1. ${title}`,
      value("前置条件"),
      value("测试步骤"),
      value("预期结果"),
      value("优先级"),
      "未执行",
      value("备注") || "",
    ],
  };
}

export function normalizeRequirementReport(data) {
  if (!usesRequirementContract(data)) return data;
  const normalized = JSON.parse(JSON.stringify(data));
  let nextId = 1;
  for (const sheet of normalized.sheets || []) {
    if (sheet.kind !== "test_cases") continue;
    if (![COLUMNS, LEGACY_COLUMNS, WORKBENCH_COLUMNS, REQUIREMENT_COLUMNS].some((columns) => sameColumns(sheet.columns, columns))) continue;
    const sourceColumns = [...sheet.columns];
    sheet.rows = sheet.rows.map((row) => convertRequirementRow(row, sourceColumns, row.divider ? null : nextId++));
    sheet.columns = [...REQUIREMENT_COLUMNS];
  }
  return normalized;
}

function isSupportedCaseColumns(columns) {
  return [COLUMNS, LEGACY_COLUMNS, WORKBENCH_COLUMNS, REQUIREMENT_COLUMNS].some((expected) =>
    JSON.stringify(columns) === JSON.stringify(expected));
}

function caseColumnIndexes(sheet) {
  return {
    priority: sheet.columns.indexOf("优先级"),
    status: Math.max(sheet.columns.indexOf("执行结果"), sheet.columns.indexOf("执行结果（通过 / 不通过 / 未执行）")),
  };
}

function testCaseWidths(columns) {
  const widths = {
    "用例 ID": 15, "所属模块": 18, "用例标题": 30, "验证功能点": 34,
    "前置条件": 34, "测试步骤": 42, "预期结果": 42, "优先级": 10,
    "实际结果": 42, "执行结果": 14, "执行结果（通过 / 不通过 / 未执行）": 24, "备注": 24,
  };
  return columns.map((column) => widths[column] ?? 24);
}

export function validateReport(data) {
  if (!data || typeof data !== "object") throw new Error("报告必须是 JSON 对象");
  for (const key of ["title", "generated_at", "skill_invocation", "sheets"]) {
    if (!data[key]) throw new Error(`缺少字段：${key}`);
  }
  if (!Array.isArray(data.sheets) || data.sheets.length === 0) throw new Error("sheets 不能为空");
  if (data.excel_font !== undefined && (typeof data.excel_font !== "string" || !data.excel_font.trim())) throw new Error("excel_font 必须是非空字符串");
  const primary = primarySkill(data);
  const isRequirementReport = usesRequirementContract(data);
  if (isRequirementReport && data.excel_font !== "SimHei") throw new Error("需求类正式用例报告必须显式使用 SimHei 字体");
  let requirementNextId = 1;
  let requirementCaseSheets = 0;
  const ids = new Set();
  for (const sheet of data.sheets) {
    if (!sheet.name || !Array.isArray(sheet.columns) || !Array.isArray(sheet.rows)) throw new Error("sheet 结构无效");
    if (sheet.kind !== "test_cases") continue;
    if (isRequirementReport) {
      requirementCaseSheets++;
      if (sheet.name !== "正式测试用例") throw new Error("需求类报告的主 Sheet 必须是：正式测试用例");
      if (!sameColumns(sheet.columns, REQUIREMENT_COLUMNS)) throw new Error("需求类正式用例必须严格使用统一十列表头");
    }
    if (!isSupportedCaseColumns(sheet.columns)) throw new Error(`${sheet.name} 必须使用受支持的用例列合同`);
    const { priority: priorityIndex, status: statusIndex } = caseColumnIndexes(sheet);
    for (const row of sheet.rows) {
      if (!Array.isArray(row.values) || row.values.length !== sheet.columns.length) throw new Error(`${sheet.name} 存在与表头不一致的数据`);
      if (row.divider) continue;
      const id = row.values[0], priority = row.values[priorityIndex], status = row.values[statusIndex];
      if (!id || ids.has(id)) throw new Error(`用例 ID 为空或重复：${id}`);
      ids.add(id);
      if (isRequirementReport && String(id) !== String(requirementNextId++)) throw new Error("需求类用例 ID 必须从 1 开始使用连续阿拉伯数字");
      if (!PRIORITIES.includes(priority)) throw new Error(`优先级无效：${priority}`);
      if (!STATUSES.includes(status)) throw new Error(`执行结果无效：${status}`);
      if (isRequirementReport && status !== "未执行") throw new Error("需求类新生成正式用例的执行结果必须默认为未执行");
    }
  }
  if (isRequirementReport && requirementCaseSheets !== 1) throw new Error("需求类报告必须且只能包含一个正式测试用例 Sheet");
}

export function buildReportId(data) {
  const stable = JSON.stringify({
    skill: data.skill_invocation,
    project: data.project || data.title,
    generated_at: data.generated_at,
    sheets: data.sheets,
  });
  return `testing-skills:${crypto.createHash("sha256").update(stable).digest("hex").slice(0, 24)}`;
}

function excelSafeName(name, used) {
  const base = String(name).replace(/[\\/*?:[\]]/g, "_").slice(0, 31) || "Sheet";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base.slice(0, 27)}_${n++}`;
  used.add(candidate);
  return candidate;
}

function xml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, raw] of files) {
    const nameBytes = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8); record.writeUInt16LE(0, 10); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42); central.push(record, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function columnName(index) {
  let value = index + 1, name = "";
  while (value) { value--; name = String.fromCharCode(65 + (value % 26)) + name; value = Math.floor(value / 26); }
  return name;
}

function rowHeightForValues(values) {
  const lineCount = Math.max(1, ...values.map((value) => String(value ?? "").split(/\r?\n/).length));
  return Math.min(150, Math.max(42, 18 + lineCount * 15));
}

async function renderPortableXlsx(data, outputPath) {
  const fontName = xml(data.excel_font || "Microsoft YaHei");
  const used = new Set();
  const sheets = data.sheets.map((sheet, index) => ({ ...sheet, safeName: excelSafeName(sheet.name, used), index: index + 1 }));
  const files = [];
  files.push(["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map(s=>`<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`]);
  files.push(["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`]);
  files.push(["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(s=>`<sheet name="${xml(s.safeName)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join("")}</sheets></workbook>`]);
  files.push(["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map(s=>`<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`).join("")}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`]);
  files.push(["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF1F2937"/></font><font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font><font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF1F4E78"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFD9E2F3"/></left><right style="thin"><color rgb="FFD9E2F3"/></right><top style="thin"><color rgb="FFD9E2F3"/></top><bottom style="thin"><color rgb="FFD9E2F3"/></bottom></border></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="4"><xf fontId="0" fillId="0" borderId="0" xfId="0"/><xf fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf fontId="2" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs><dxfs count="5"><dxf><font><color rgb="FF7F1D1D"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFFCE8E6"/><bgColor indexed="64"/></patternFill></fill></dxf><dxf><font><color rgb="FF374151"/></font><fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></dxf><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill></dxf></dxfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`]);
  files[4][1] = files[4][1].replaceAll('name val="Microsoft YaHei"', `name val="${fontName}"`);
  for (const sheet of sheets) {
    const matrix = [sheet.columns, ...sheet.rows.map(row=>row.values)];
    const widths = sheet.kind === "test_cases" ? testCaseWidths(sheet.columns) : sheet.columns.map((_,i)=>i===0?22:36);
    const rows = matrix.map((values, rowIndex) => {
      const declared = rowIndex ? sheet.rows[rowIndex - 1] : null;
      const cells = values.map((value, colIndex) => {
        let style = rowIndex === 0 ? 1 : (declared?.divider ? 3 : 2);
        const ref = `${columnName(colIndex)}${rowIndex + 1}`;
        return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      }).join("");
      const rowHeight = rowIndex === 0 ? 28 : (declared?.divider ? 25 : rowHeightForValues(values));
      return `<row r="${rowIndex+1}" ht="${rowHeight}" customHeight="1">${cells}</row>`;
    }).join("");
    const lastCol = columnName(sheet.columns.length - 1), lastRow = matrix.length;
    const indexes = caseColumnIndexes(sheet);
    const statusCol = columnName(indexes.status), priorityCol = columnName(indexes.priority);
    const validRows = sheet.kind === "test_cases" ? sheet.rows.map((row,i)=>row.divider?null:`${statusCol}${i+2}`).filter(Boolean).join(" ") : "";
    const extra = sheet.kind === "test_cases" ? `<conditionalFormatting sqref="A2:${lastCol}${lastRow}"><cfRule type="expression" dxfId="0" priority="1" stopIfTrue="1"><formula>$${statusCol}2="不通过"</formula></cfRule><cfRule type="expression" dxfId="1" priority="2" stopIfTrue="1"><formula>$${statusCol}2="待定"</formula></cfRule></conditionalFormatting><conditionalFormatting sqref="${priorityCol}2:${priorityCol}${lastRow}"><cfRule type="expression" dxfId="2" priority="3"><formula>AND($${statusCol}2&lt;&gt;"不通过",$${statusCol}2&lt;&gt;"待定",$${priorityCol}2="P0")</formula></cfRule><cfRule type="expression" dxfId="3" priority="4"><formula>AND($${statusCol}2&lt;&gt;"不通过",$${statusCol}2&lt;&gt;"待定",$${priorityCol}2="P1")</formula></cfRule><cfRule type="expression" dxfId="4" priority="5"><formula>AND($${statusCol}2&lt;&gt;"不通过",$${statusCol}2&lt;&gt;"待定",$${priorityCol}2="P2")</formula></cfRule></conditionalFormatting><dataValidations count="1"><dataValidation type="list" allowBlank="0" showErrorMessage="1" sqref="${validRows}"><formula1>"未执行,通过,不通过,待定"</formula1></dataValidation></dataValidations>` : "";
    files.push([`xl/worksheets/sheet${sheet.index}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths.map((w,i)=>`<col min="${i+1}" max="${i+1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${rows}</sheetData><autoFilter ref="A1:${lastCol}${lastRow}"/>${extra}</worksheet>`]);
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, zipStore(files));
  return outputPath;
}

async function renderArtifactXlsx(data, outputPath, { previewDir } = {}) {
  const { SpreadsheetFile, Workbook } = await import("@oai/artifact-tool");
  validateReport(data);
  const workbook = Workbook.create();
  const used = new Set();
  for (const declared of data.sheets) {
    const name = excelSafeName(declared.name, used);
    const sheet = workbook.worksheets.add(name);
    sheet.showGridLines = false;
    const matrix = [declared.columns, ...declared.rows.map((row) => row.values)];
    const rowCount = matrix.length;
    const colCount = Math.max(...matrix.map((row) => row.length));
    const lastCol = String.fromCharCode(64 + Math.min(colCount, 26));
    sheet.getRange(`A1:${lastCol}${rowCount}`).values = matrix;
    sheet.getRange(`A1:${lastCol}1`).format = {
      fill: "#1F4E78",
      font: { name: data.excel_font || "Microsoft YaHei", bold: true, color: "#FFFFFF" },
      rowHeight: 28,
      verticalAlignment: "center",
      horizontalAlignment: "center",
      borders: { preset: "outside", style: "thin", color: "#163A5A" },
    };
    if (rowCount > 1) {
      const body = sheet.getRange(`A2:${lastCol}${rowCount}`);
      body.format = {
        font: { name: data.excel_font || "Microsoft YaHei", size: 10, color: "#1F2937" },
        wrapText: true,
        verticalAlignment: "top",
        borders: { preset: "inside", style: "thin", color: "#D9E2F3" },
      };
      body.format.rowHeight = 42;
    }
    sheet.freezePanes.freezeRows(1);

    const widths = declared.kind === "test_cases"
      ? testCaseWidths(declared.columns)
      : declared.columns.map((_, index) => index === 0 ? 22 : 36);
    widths.forEach((width, index) => { sheet.getRangeByIndexes(0, index, rowCount, 1).format.columnWidth = width; });

    if (declared.kind === "test_cases") {
      const indexes = caseColumnIndexes(declared);
      const statusCol = columnName(indexes.status);
      const priorityCol = columnName(indexes.priority);
      declared.rows.forEach((row, index) => {
        const excelRow = index + 2;
        const full = sheet.getRange(`A${excelRow}:${lastCol}${excelRow}`);
        if (row.divider) {
          full.format = { fill: "#D9EAF7", font: { name: data.excel_font || "Microsoft YaHei", bold: true, color: "#1F4E78" }, rowHeight: 25 };
        } else {
          full.format.rowHeight = rowHeightForValues(row.values);
          sheet.getRange(`${statusCol}${excelRow}`).dataValidation = { rule: { type: "list", values: STATUSES } };
          const priority = row.values[indexes.priority];
          if (priority === "P0") sheet.getRange(`${priorityCol}${excelRow}`).format.fill = "#FCE4D6";
          if (priority === "P1") sheet.getRange(`${priorityCol}${excelRow}`).format.fill = "#FFF2CC";
          if (priority === "P2") sheet.getRange(`${priorityCol}${excelRow}`).format.fill = "#E2F0D9";
        }
      });
      if (rowCount > 1) {
        const rows = sheet.getRange(`A2:${lastCol}${rowCount}`);
        rows.conditionalFormats.addCustom(`=$${statusCol}2="不通过"`, { fill: "#FCE8E6", font: { color: "#7F1D1D" } });
        rows.conditionalFormats.addCustom(`=$${statusCol}2="待定"`, { fill: "#E5E7EB", font: { color: "#374151" } });
      }
    }
  }
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const exported = await SpreadsheetFile.exportXlsx(workbook);
  await exported.save(outputPath);
  if (previewDir) {
    await fs.mkdir(previewDir, { recursive: true });
    for (const sheet of workbook.worksheets.items) {
      const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1, format: "png" });
      await fs.writeFile(path.join(previewDir, `${sheet.name}.png`), new Uint8Array(await preview.arrayBuffer()));
    }
  }
  return outputPath;
}

export async function renderXlsx(data, outputPath, options = {}) {
  data = normalizeRequirementReport(data);
  validateReport(data);
  if (process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX !== "1") {
    try {
      return await renderArtifactXlsx(data, outputPath, options);
    } catch (error) {
      if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    }
  }
  return renderPortableXlsx(data, outputPath);
}

function escapeInlineJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");
}

export async function renderHtml(data, outputPath) {
  data = normalizeRequirementReport(data);
  validateReport(data);
  const reportId = buildReportId(data);
  const payload = escapeInlineJson({ ...data, report_id: reportId });
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${String(data.title).replaceAll("<", "&lt;")}</title><style>
:root{--navy:#163a5a;--blue:#1f4e78;--line:#dbe5ef;--bg:#f4f7fb;--text:#1f2937}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.55 "Microsoft YaHei",system-ui,sans-serif}.page{max-width:1600px;margin:auto;padding:24px}header{background:linear-gradient(135deg,var(--navy),var(--blue));color:#fff;border-radius:14px;padding:24px;box-shadow:0 10px 30px #163a5a20}h1{margin:0 0 6px;font-size:24px}.meta{opacity:.85}.toolbar,.stats{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.toolbar input,.toolbar select,.status-select{border:1px solid #c8d5e3;border-radius:8px;background:#fff;padding:8px 10px}.toolbar input{min-width:280px}.stat{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 16px;min-width:120px}.stat b{font-size:20px;color:var(--blue)}.warning{display:none;background:#fff3cd;border:1px solid #ffe69c;padding:10px;border-radius:8px}.sheet{background:#fff;margin:18px 0;border-radius:12px;overflow:auto;box-shadow:0 4px 18px #163a5a12}.sheet h2{position:sticky;left:0;margin:0;padding:14px 16px;color:var(--navy)}table{width:100%;border-collapse:separate;border-spacing:0;min-width:1200px}th{position:sticky;top:0;z-index:2;background:var(--blue);color:#fff;text-align:center;padding:11px;border-right:1px solid #ffffff24}td{padding:10px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);vertical-align:top;white-space:pre-wrap}.divider td{background:#d9eaf7!important;color:var(--blue);font-weight:700}.status-failed td{background:#fce8e6!important;color:#7f1d1d}.status-pending td{background:#e5e7eb!important;color:#374151}.priority-P0{background:#fce4d6}.priority-P1{background:#fff2cc}.priority-P2{background:#e2f0d9}.hidden{display:none!important}@media(max-width:720px){.page{padding:10px}.toolbar>*{width:100%}.toolbar input{min-width:0}}
</style></head><body><main class="page"><header><h1 id="title"></h1><div class="meta" id="invocation"></div></header><p id="storage-warning" class="warning">浏览器未允许本地保存，本次状态仅在当前页面有效。</p><section class="toolbar"><input id="search" placeholder="搜索用例 ID、标题、步骤、预期……"><select id="module-filter"><option value="">全部模块</option></select><select id="priority-filter"><option value="">全部优先级</option><option>P0</option><option>P1</option><option>P2</option></select><select id="status-filter"><option value="">全部状态</option>${STATUSES.map(s=>`<option>${s}</option>`).join("")}</select></section><section id="stats" class="stats"></section><div id="content"></div></main>
<script>const report=${payload};const statuses=${JSON.stringify(STATUSES)};let storageOK=true;try{localStorage.setItem('__ts_probe','1');localStorage.removeItem('__ts_probe')}catch(e){storageOK=false;document.querySelector('#storage-warning').style.display='block'}let saved={};if(storageOK){try{saved=JSON.parse(localStorage.getItem(report.report_id)||'{}')}catch(e){saved={}}}const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));document.querySelector('#title').textContent=report.title;const invoke=report.skill_invocation||{};document.querySelector('#invocation').textContent='主 Skill：'+(invoke.primary||invoke)+' ｜ 辅助 Skill：'+(invoke.secondary||'无')+' ｜ 分工：'+(invoke.roles||'由主 Skill 完成');const content=document.querySelector('#content');const modules=new Set();for(const sheet of report.sheets){const priorityCol=sheet.columns.indexOf('优先级'),statusCol=sheet.columns.indexOf('执行结果');const box=document.createElement('section');box.className='sheet';box.innerHTML='<h2>'+esc(sheet.name)+'</h2>';const table=document.createElement('table');table.innerHTML='<thead><tr>'+sheet.columns.map(c=>'<th>'+esc(c)+'</th>').join('')+'</tr></thead>';const body=document.createElement('tbody');sheet.rows.forEach((row,idx)=>{const tr=document.createElement('tr');tr.dataset.search=row.values.join(' ').toLowerCase();if(row.divider){tr.className='divider'}else if(sheet.kind==='test_cases'){const id=row.values[0],module=row.values[1],priority=row.values[priorityCol];modules.add(module);row.values[statusCol]=saved[id]||row.values[statusCol]||'未执行';tr.dataset.module=module;tr.dataset.priority=priority;tr.dataset.status=row.values[statusCol];}row.values.forEach((value,col)=>{const td=document.createElement('td');if(sheet.kind==='test_cases'&&!row.divider&&col===statusCol){const select=document.createElement('select');select.className='status-select';select.setAttribute('aria-label','执行结果 '+row.values[0]);statuses.forEach(s=>{const o=document.createElement('option');o.value=s;o.textContent=s;o.selected=s===value;select.appendChild(o)});select.addEventListener('change',()=>{tr.dataset.status=select.value;saved[row.values[0]]=select.value;if(storageOK)localStorage.setItem(report.report_id,JSON.stringify(saved));paint(tr);update()});td.appendChild(select)}else{td.innerHTML=esc(value).replace(/\\n/g,'<br>')}if(col===priorityCol&&!row.divider)td.classList.add('priority-'+value);tr.appendChild(td)});paint(tr);body.appendChild(tr)});table.appendChild(body);box.appendChild(table);content.appendChild(box)}const moduleSelect=document.querySelector('#module-filter');[...modules].sort().forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;moduleSelect.appendChild(o)});function paint(tr){tr.classList.toggle('status-failed',tr.dataset.status==='不通过');tr.classList.toggle('status-pending',tr.dataset.status==='待定')}function update(){const q=document.querySelector('#search').value.trim().toLowerCase(),m=moduleSelect.value,p=document.querySelector('#priority-filter').value,s=document.querySelector('#status-filter').value;const counts=Object.fromEntries(statuses.map(x=>[x,0]));document.querySelectorAll('tbody tr:not(.divider)').forEach(tr=>{const show=(!q||tr.dataset.search.includes(q))&&(!m||tr.dataset.module===m)&&(!p||tr.dataset.priority===p)&&(!s||tr.dataset.status===s);tr.classList.toggle('hidden',!show);if(show&&tr.dataset.status)counts[tr.dataset.status]++});document.querySelector('#stats').innerHTML=statuses.map(x=>'<div class="stat">'+x+'<br><b>'+counts[x]+'</b></div>').join('')}['search','module-filter','priority-filter','status-filter'].forEach(id=>document.querySelector('#'+id).addEventListener(id==='search'?'input':'change',update));update();</script></body></html>`;
  const compatibleHtml = html.replace(
    "statusCol=sheet.columns.indexOf('执行结果')",
    "statusCol=Math.max(sheet.columns.indexOf('执行结果'),sheet.columns.indexOf('执行结果（通过 / 不通过 / 未执行）'))",
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, compatibleHtml, "utf8");
  return outputPath;
}

export async function renderBoth(data, outputDir, basename) {
  data = normalizeRequirementReport(data);
  validateReport(data);
  await fs.mkdir(outputDir, { recursive: true });
  const xlsx = path.join(outputDir, `${basename}.xlsx`);
  const html = path.join(outputDir, `${basename}.html`);
  await renderXlsx(data, xlsx, { previewDir: path.join(outputDir, `${basename}-previews`) });
  await renderHtml(data, html);
  return { xlsx, html, reportId: buildReportId(data) };
}

async function main() {
  const args = process.argv.slice(2);
  const value = (flag) => args[args.indexOf(flag) + 1];
  const input = value("--input"), outputDir = value("--output-dir"), basename = value("--basename");
  if (!input || !outputDir || !basename) throw new Error("用法：node render-test-assets.mjs --input REPORT.json --output-dir DIR --basename NAME");
  const data = JSON.parse(await fs.readFile(input, "utf8"));
  console.log(JSON.stringify(await renderBoth(data, outputDir, basename), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error); process.exitCode = 1; });

