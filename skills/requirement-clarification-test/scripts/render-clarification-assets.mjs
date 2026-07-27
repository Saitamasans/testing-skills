#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SHEET1_HEADERS = ["问题 ID", "问题分类", "需要产品确认的问题", "影响范围", "优先级", "阻断状态", "产品答复", "备注"];
const SHEET2_SECTION_HEADERS = {
  admission: "1. 开测准入结论",
  understanding: "2. 当前需求理解",
  confirmed: "3. 已明确内容",
  excluded: "4. 本轮不纳入",
};

const PRIORITIES = ["P0", "P1", "P2"];
const BLOCKING_STATUSES = ["⛔ BLOCKING", "非阻断"];
const ADMISSION_RESULTS = ["可开测", "有条件开测", "不建议开测", "不可开测"];

const COLUMNS = {
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[char]);
}

function unesc(value) {
  return String(value ?? "")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
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
  const local = [];
  const central = [];
  let offset = 0;
  for (const [name, raw] of files) {
    const nameBytes = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);

    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x0800, 8);
    record.writeUInt16LE(0, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(nameBytes.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, nameBytes);
    offset += header.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, centralBuffer, end]);
}

function readZipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) !== eocdSignature) continue;
    const totalEntries = buffer.readUInt16LE(offset + 10);
    const centralDirOffset = buffer.readUInt32LE(offset + 16);
    const entries = new Map();
    let cursor = centralDirOffset;
    for (let i = 0; i < totalEntries; i++) {
      if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("ZIP 中央目录损坏");
      const compressedSize = buffer.readUInt32LE(cursor + 20);
      const uncompressedSize = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28);
      const extraLength = buffer.readUInt16LE(cursor + 30);
      const commentLength = buffer.readUInt16LE(cursor + 32);
      const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
      const name = buffer.toString("utf8", cursor + 46, cursor + 46 + nameLength);
      const localHeaderSize = 30;
      if (buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) throw new Error("ZIP 本地文件头损坏");
      const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataOffset = localHeaderOffset + localHeaderSize + localNameLength + localExtraLength;
      entries.set(name, buffer.subarray(dataOffset, dataOffset + compressedSize || uncompressedSize));
      cursor += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  }
  throw new Error("未找到 ZIP 结束目录");
}

function xmlTextCell(ref, value, style = 0) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function xmlNumberCell(ref, value, style = 0) {
  return `<c r="${ref}" s="${style}"><v>${String(value)}</v></c>`;
}

function colName(index) {
  let value = index;
  let name = "";
  while (value > 0) {
    value--;
    name = String.fromCharCode(65 + (value % 26)) + name;
    value = Math.floor(value / 26);
  }
  return name;
}

function rowHeight(texts, min = 22) {
  const maxLines = Math.max(
    1,
    ...texts.map((text) => {
      const raw = String(text ?? "");
      const byBreaks = raw.split(/\r?\n/).length;
      const byLength = Math.ceil(raw.length / 28);
      return Math.max(byBreaks, byLength);
    }),
  );
  return Math.min(120, Math.max(min, 18 + maxLines * 14));
}

function normalizeDatePart(value) {
  const match = String(value ?? "").match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1].replaceAll("-", "") : new Date().toISOString().slice(0, 10).replaceAll("-", "");
}

function sanitizeFilenamePart(value) {
  return String(value ?? "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.+$/g, "");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function validateClarificationReport(report) {
  assert(report && typeof report === "object" && !Array.isArray(report), "报告必须是对象");
  for (const key of ["report_meta", "admission", "requirement_understanding", "confirmed_items", "excluded_items", "questions"]) {
    assert(key in report, `缺少字段：${key}`);
  }

  const { report_meta, admission, requirement_understanding, confirmed_items, excluded_items, questions } = report;
  assert(report_meta && typeof report_meta === "object" && !Array.isArray(report_meta), "report_meta 必须是对象");
  for (const key of ["requirement_name", "source_name", "generated_at"]) assert(typeof report_meta[key] === "string" && report_meta[key].trim(), `report_meta.${key} 无效`);

  assert(admission && typeof admission === "object" && !Array.isArray(admission), "admission 必须是对象");
  for (const key of ["result", "largest_risk"]) assert(typeof admission[key] === "string" && admission[key].trim(), `admission.${key} 无效`);
  assert(ADMISSION_RESULTS.includes(admission.result), "admission.result 无效");
  assert(typeof admission.can_generate_test_cases === "boolean", "admission.can_generate_test_cases 必须是布尔值");
  assert(typeof admission.has_p0_blocking === "boolean", "admission.has_p0_blocking 必须是布尔值");

  assert(requirement_understanding && typeof requirement_understanding === "object" && !Array.isArray(requirement_understanding), "requirement_understanding 必须是对象");
  for (const key of ["business_goal", "roles", "entry_path", "operation_object", "main_flow", "success_result", "failure_result"]) {
    assert(typeof requirement_understanding[key] === "string", `requirement_understanding.${key} 必须是字符串`);
  }

  const validateList = (items, prefix) => {
    assert(Array.isArray(items), `${prefix} 必须是数组`);
    const ids = new Set();
    items.forEach((item, index) => {
      assert(item && typeof item === "object" && !Array.isArray(item), `${prefix}[${index}] 必须是对象`);
      for (const key of Object.keys(item)) assert(["id", "content", "source", "scope", "note", "reason", "follow_up", "category", "question", "impact_scope", "priority", "blocking_status", "product_answer"].includes(key), `${prefix}[${index}] 出现未知字段：${key}`);
      const id = item.id;
      assert(typeof id === "string", `${prefix}[${index}].id 必须是字符串`);
      assert(id === `${prefix === "questions" ? "Q" : prefix === "confirmed_items" ? "C" : "N"}${String(index + 1).padStart(3, "0")}`, `${prefix} ID 必须连续且从 001 开始：${id}`);
      assert(!ids.has(id), `${prefix} ID 重复：${id}`);
      ids.add(id);
      return item;
    });
    return items;
  };

  validateList(confirmed_items, "confirmed_items").forEach((item, index) => {
    for (const key of ["content", "source", "scope", "note"]) assert(typeof item[key] === "string", `confirmed_items[${index}].${key} 必须是字符串`);
  });
  validateList(excluded_items, "excluded_items").forEach((item, index) => {
    for (const key of ["content", "reason", "follow_up"]) assert(typeof item[key] === "string", `excluded_items[${index}].${key} 必须是字符串`);
  });

  const questionIds = new Set();
  questions.forEach((question, index) => {
    assert(question && typeof question === "object" && !Array.isArray(question), `questions[${index}] 必须是对象`);
    for (const key of ["id", "category", "question", "impact_scope", "priority", "blocking_status", "product_answer", "note"]) {
      assert(key in question, `questions[${index}] 缺少字段：${key}`);
    }
    assert(question.id === `Q${String(index + 1).padStart(3, "0")}`, `questions ID 必须连续且从 Q001 开始：${question.id}`);
    assert(!questionIds.has(question.id), `questions ID 重复：${question.id}`);
    questionIds.add(question.id);
    assert(typeof question.category === "string" && question.category.trim(), `questions[${index}].category 无效`);
    assert(typeof question.question === "string" && question.question.trim().length >= 4, `questions[${index}].question 无效`);
    assert(!/^(请确认|规则不清|需要补充|待确认|麻烦确认|请补充)/.test(question.question.trim()), `questions[${index}].question 过于空泛`);
    assert(typeof question.impact_scope === "string", `questions[${index}].impact_scope 必须是字符串`);
    assert(PRIORITIES.includes(question.priority), `questions[${index}].priority 无效`);
    assert(BLOCKING_STATUSES.includes(question.blocking_status), `questions[${index}].blocking_status 无效`);
    assert(typeof question.product_answer === "string", `questions[${index}].product_answer 必须是字符串`);
    assert(typeof question.note === "string", `questions[${index}].note 必须是字符串`);
    if (question.priority === "P0") assert(question.blocking_status === "⛔ BLOCKING", `P0 问题必须是 ⛔ BLOCKING：${question.id}`);
    if (question.priority === "P1" || question.priority === "P2") assert(question.blocking_status === "非阻断", `P1/P2 问题必须是 非阻断：${question.id}`);
  });

  const hasP0 = questions.some((q) => q.priority === "P0");
  if (hasP0) {
    assert(admission.has_p0_blocking === true, "存在 P0 时，has_p0_blocking 必须为 true");
    assert(admission.can_generate_test_cases === false, "存在 P0 时，can_generate_test_cases 必须为 false");
    assert(["不建议开测", "不可开测"].includes(admission.result), "存在 P0 时，admission.result 必须是不建议开测或不可开测");
  }

  return {
    p0: questions.filter((q) => q.priority === "P0").length,
    p1: questions.filter((q) => q.priority === "P1").length,
    p2: questions.filter((q) => q.priority === "P2").length,
  };
}

function buildStylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="6">
    <font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF1F2937"/></font>
    <font><b/><sz val="14"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FFFFFFFF"/></font>
    <font><b/><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF1F4E78"/></font>
    <font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF555555"/></font>
    <font><sz val="10"/><name val="Microsoft YaHei"/><color rgb="FF9C0006"/></font>
  </fonts>
  <fills count="5">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFCE4D6"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>
      <left style="thin"><color rgb="FFD9E2F3"/></left>
      <right style="thin"><color rgb="FFD9E2F3"/></right>
      <top style="thin"><color rgb="FFD9E2F3"/></top>
      <bottom style="thin"><color rgb="FFD9E2F3"/></bottom>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="10">
    <xf fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf fontId="4" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
    <xf fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf fontId="2" fillId="2" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf fontId="3" fillId="3" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf fontId="5" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf fontId="5" fillId="4" borderId="1" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function makeSheetXml({
  cells,
  merges = [],
  widths = [],
  freeze = null,
  autoFilter = null,
  rowHeights = {},
  showGridLines = false,
}) {
  const byRow = new Map();
  for (const [ref, cell] of Object.entries(cells)) {
    const match = ref.match(/^([A-Z]+)(\d+)$/);
    if (!match) throw new Error(`非法单元格坐标：${ref}`);
    const row = Number(match[2]);
    const list = byRow.get(row) ?? [];
    list.push({ ref, ...cell });
    byRow.set(row, list);
  }
  const rows = [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rowNum, rowCells]) => {
      const height = rowHeights[rowNum];
      const attrs = [`r="${rowNum}"`];
      if (height) attrs.push(`ht="${height}" customHeight="1"`);
      const cellXml = rowCells
        .sort((a, b) => a.ref.localeCompare(b.ref))
        .map((cell) => cell.type === "n" ? xmlNumberCell(cell.ref, cell.value, cell.style) : xmlTextCell(cell.ref, cell.value, cell.style))
        .join("");
      return `<row ${attrs.join(" ")}>${cellXml}</row>`;
    })
    .join("");

  const cols = widths.length
    ? `<cols>${widths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";
  const mergeCells = merges.length ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>` : "";
  const sheetView = freeze
    ? `<sheetViews><sheetView workbookViewId="0" showGridLines="${showGridLines ? "1" : "0"}"><pane ySplit="${freeze.ySplit}" topLeftCell="${freeze.topLeftCell}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0" showGridLines="${showGridLines ? "1" : "0"}"/></sheetViews>`;
  const autoFilterXml = autoFilter ? `<autoFilter ref="${autoFilter}"/>` : "";
  const validations = [];
  if (autoFilter && autoFilter.startsWith("A4:H")) {
    const lastRow = autoFilter.split(":H")[1];
    validations.push(
      `<dataValidations count="2">` +
        `<dataValidation type="list" allowBlank="0" showErrorMessage="1" sqref="E5:E${lastRow}"><formula1>"P0,P1,P2"</formula1></dataValidation>` +
        `<dataValidation type="list" allowBlank="0" showErrorMessage="1" sqref="F5:F${lastRow}"><formula1>"⛔ BLOCKING,非阻断"</formula1></dataValidation>` +
      `</dataValidations>`,
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${sheetView}
  ${cols}
  <sheetData>${rows}</sheetData>
  ${mergeCells}
  ${autoFilterXml}
  ${validations.join("")}
</worksheet>`;
}

function buildWorkbookXml(sheetNames) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheetNames.map((name, index) => `<sheet name="${esc(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets>
</workbook>`;
}

function buildWorkbookRels(sheetCount) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${Array.from({ length: sheetCount }, (_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}
  <Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
}

function buildContentTypes(sheetCount) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${Array.from({ length: sheetCount }, (_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}
</Types>`;
}

function buildRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function buildSheet1(report, counts) {
  const { report_meta, admission, requirement_understanding, confirmed_items, excluded_items, questions } = report;
  const rows = new Map();
  const merges = ["A1:H1", "A2:H2"];
  const widths = [12, 14, 44, 22, 10, 12, 20, 16];
  const set = (ref, value, style = 0, type = "s") => rows.set(ref, { value, style, type });
  const setRow = (row, values, styles, types = []) => {
    values.forEach((value, index) => {
      const col = colName(index + 1);
      set(`${col}${row}`, value, styles[index] ?? 0, types[index] ?? "s");
    });
  };

  setRow(1, [`${report_meta.requirement_name}——产品核对问题表`], [1]);
  setRow(2, ["使用说明：产品请填写“产品答复”。P0 ⛔ BLOCKING 未关闭前，不进入正式测试用例生成。"], [2]);
  setRow(4, SHEET1_HEADERS, [4, 4, 4, 4, 4, 4, 4, 4]);

  let currentRow = 5;
  questions.forEach((question) => {
    const p0 = question.priority === "P0";
    const styles = p0
      ? [9, 7, 7, 7, 9, 9, 7, 7]
      : [8, 6, 6, 6, 8, 8, 6, 6];
    const values = [
      question.id,
      question.category,
      question.question,
      question.impact_scope,
      question.priority,
      question.blocking_status,
      question.product_answer ?? "",
      question.note,
    ];
    setRow(currentRow, values, styles);
    rows.set(`A${currentRow}`, { value: question.id, style: styles[0], type: "s" });
    rows.set(`E${currentRow}`, { value: question.priority, style: styles[4], type: "s" });
    rows.set(`F${currentRow}`, { value: question.blocking_status, style: styles[5], type: "s" });
    rows.set(`G${currentRow}`, { value: question.product_answer ?? "", style: styles[6], type: "s" });
    currentRow++;
  });

  const lastRow = currentRow - 1;
  const cells = Object.fromEntries(rows.entries());
  const rowHeights = {
    1: 28,
    2: 32,
    4: 24,
  };
  questions.forEach((question, index) => {
    const row = 5 + index;
    rowHeights[row] = rowHeight([
      question.id,
      question.category,
      question.question,
      question.impact_scope,
      question.priority,
      question.blocking_status,
      question.product_answer ?? "",
      question.note,
    ], 36);
  });
  return {
    name: "产品核对问题表",
    widths,
    cells,
    merges,
    freeze: { ySplit: 4, topLeftCell: "A5" },
    autoFilter: `A4:H${lastRow}`,
    rowHeights,
  };
}

function buildSheet2(report, counts) {
  const { report_meta, admission, requirement_understanding, confirmed_items, excluded_items } = report;
  const cells = {};
  const merges = [];
  const widths = [14, 14, 16, 16, 16, 16, 16, 16];
  const set = (ref, value, style = 0, type = "s") => {
    cells[ref] = { value, style, type };
  };
  const mergeRow = (row, fromCol, toCol, value, style) => {
    const ref = `${fromCol}${row}:${toCol}${row}`;
    merges.push(ref);
    set(`${fromCol}${row}`, value, style);
  };
  const setRow = (row, values, styles, types = []) => {
    values.forEach((value, index) => {
      const col = colName(index + 1);
      set(`${col}${row}`, value, styles[index] ?? 0, types[index] ?? "s");
    });
  };

  mergeRow(1, "A", "H", `${report_meta.requirement_name}——需求澄清摘要`, 1);
  mergeRow(2, "A", "H", `资料来源：${report_meta.source_name}    生成时间：${report_meta.generated_at}`, 2);
  mergeRow(4, "A", "H", SHEET2_SECTION_HEADERS.admission, 3);

  const admissionRows = [
    ["需求名称", report_meta.requirement_name],
    ["资料来源", report_meta.source_name],
    ["开测准入", admission.result],
    ["是否可进入用例生成", admission.can_generate_test_cases ? "是" : "否"],
    ["是否存在 P0 阻断", admission.has_p0_blocking ? "是" : "否"],
    ["当前最大风险", admission.largest_risk],
  ];
  admissionRows.forEach((pair, index) => {
    const row = 5 + index;
    set(`${colName(1)}${row}`, pair[0], 5);
    set(`${colName(3)}${row}`, pair[1], 6);
    merges.push(`C${row}:E${row}`);
  });
  mergeRow(5, "F", "H", "问题统计", 3);
  merges.push("F6:G6", "F7:G7", "F8:G8", "F9:G9");
  set("F6", "P0", 5);
  set("H6", counts.p0, 8, "n");
  set("F7", "P1", 5);
  set("H7", counts.p1, 8, "n");
  set("F8", "P2", 5);
  set("H8", counts.p2, 8, "n");
  set("F9", "总计", 5);
  set("H9", counts.p0 + counts.p1 + counts.p2, 8, "n");

  mergeRow(11, "A", "H", SHEET2_SECTION_HEADERS.understanding, 3);
  const understandingRows = [
    ["业务目标", requirement_understanding.business_goal],
    ["使用角色", requirement_understanding.roles],
    ["入口路径", requirement_understanding.entry_path],
    ["操作对象", requirement_understanding.operation_object],
    ["主流程", requirement_understanding.main_flow],
    ["成功结果", requirement_understanding.success_result],
    ["失败结果", requirement_understanding.failure_result],
  ];
  understandingRows.forEach((pair, index) => {
    const row = 12 + index;
    set(`${colName(1)}${row}`, pair[0], 5);
    set(`${colName(3)}${row}`, pair[1], 6);
    merges.push(`C${row}:H${row}`);
  });

  mergeRow(20, "A", "H", SHEET2_SECTION_HEADERS.confirmed, 3);
  setRow(21, ["规则 ID", "已明确内容", "来源/依据", "涉及范围", "备注", "", "", ""], [4, 4, 4, 4, 4, 0, 0, 0]);
  confirmed_items.forEach((item, index) => {
    const row = 22 + index;
    setRow(row, [item.id, item.content, item.source, item.scope, item.note, "", "", ""], [6, 6, 6, 6, 6, 0, 0, 0]);
  });

  const excludedStart = 23 + confirmed_items.length;
  mergeRow(excludedStart, "A", "H", SHEET2_SECTION_HEADERS.excluded, 3);
  setRow(excludedStart + 1, ["范围 ID", "不纳入内容", "原因", "后续处理", "", "", "", ""], [4, 4, 4, 4, 0, 0, 0, 0]);
  excluded_items.forEach((item, index) => {
    const row = excludedStart + 2 + index;
    setRow(row, [item.id, item.content, item.reason, item.follow_up, "", "", "", ""], [6, 6, 6, 6, 0, 0, 0, 0]);
  });

  const rowHeights = {
    1: 28,
    2: 30,
    4: 24,
    5: 32,
    6: 26,
    7: 26,
    8: 26,
    9: 26,
    10: 32,
    11: 24,
    20: 24,
    [excludedStart]: 24,
  };
  admissionRows.forEach((pair, index) => {
    const row = 5 + index;
    rowHeights[row] = rowHeight([pair[0], pair[1]], 30);
  });
  understandingRows.forEach((pair, index) => {
    const row = 12 + index;
    rowHeights[row] = rowHeight([pair[0], pair[1]], 32);
  });
  confirmed_items.forEach((item, index) => {
    const row = 22 + index;
    rowHeights[row] = rowHeight([item.id, item.content, item.source, item.scope, item.note], 30);
  });
  excluded_items.forEach((item, index) => {
    const row = excludedStart + 2 + index;
    rowHeights[row] = rowHeight([item.id, item.content, item.reason, item.follow_up], 30);
  });

  return {
    name: "需求澄清摘要",
    widths,
    cells,
    merges,
    freeze: null,
    autoFilter: null,
    rowHeights,
  };
}

function buildWorkbook(report) {
  const counts = validateClarificationReport(report);
  const sheet1 = buildSheet1(report, counts);
  const sheet2 = buildSheet2(report, counts);
  const sheetSpecs = [sheet1, sheet2];
  const files = [];
  files.push(["[Content_Types].xml", buildContentTypes(sheetSpecs.length)]);
  files.push(["_rels/.rels", buildRels()]);
  files.push(["xl/workbook.xml", buildWorkbookXml(sheetSpecs.map((sheet) => sheet.name))]);
  files.push(["xl/_rels/workbook.xml.rels", buildWorkbookRels(sheetSpecs.length)]);
  files.push(["xl/styles.xml", buildStylesXml()]);
  sheetSpecs.forEach((sheet, index) => {
    files.push([
      `xl/worksheets/sheet${index + 1}.xml`,
      makeSheetXml({
        cells: sheet.cells,
        merges: sheet.merges,
        widths: sheet.widths,
        freeze: sheet.freeze,
        autoFilter: sheet.autoFilter,
        rowHeights: sheet.rowHeights,
        showGridLines: false,
      }),
    ]);
  });
  const buffer = zipStore(files);
  return { buffer, sheetSpecs, counts };
}

function parseWorkbookEntries(buffer) {
  const entries = readZipEntries(buffer);
  const required = [
    "[Content_Types].xml",
    "_rels/.rels",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
    "xl/worksheets/sheet2.xml",
  ];
  for (const file of required) assert(entries.has(file), `缺少 xlsx 文件：${file}`);
  return entries;
}

function findSheetNames(workbookXml) {
  const names = [];
  const regex = /<sheet name="([^"]+)" sheetId="(\d+)" r:id="rId\d+"\/>/g;
  let match;
  while ((match = regex.exec(workbookXml))) names.push(match[1]);
  return names;
}

function cellText(sheetXml, ref) {
  const regex = new RegExp(`<c[^>]*r="${ref}"[^>]*>(?:<is><t xml:space="preserve">([\\s\\S]*?)<\\/t><\\/is>|<v>([\\s\\S]*?)<\\/v>)<\\/c>`);
  const match = sheetXml.match(regex);
  if (!match) return "";
  return unesc(match[1] ?? match[2] ?? "");
}

function countRows(sheetXml) {
  return [...sheetXml.matchAll(/<row r="(\d+)"/g)].length;
}

function validateWrittenWorkbook(buffer, report, counts) {
  const entries = parseWorkbookEntries(buffer);
  const workbookXml = entries.get("xl/workbook.xml").toString("utf8");
  const sheetNames = findSheetNames(workbookXml);
  assert(sheetNames.length === 2, "工作簿必须只有两个 Sheet");
  assert(sheetNames[0] === "产品核对问题表", "Sheet1 名称错误");
  assert(sheetNames[1] === "需求澄清摘要", "Sheet2 名称错误");

  const sheet1Xml = entries.get("xl/worksheets/sheet1.xml").toString("utf8");
  const sheet2Xml = entries.get("xl/worksheets/sheet2.xml").toString("utf8");
  for (const header of SHEET1_HEADERS) assert(sheet1Xml.includes(esc(header)), `Sheet1 缺少表头：${header}`);
  assert(sheet1Xml.includes("dataValidations"), "Sheet1 缺少下拉验证");
  assert(sheet1Xml.includes('sqref="E5:E'), "Sheet1 缺少优先级下拉范围");
  assert(sheet1Xml.includes('sqref="F5:F'), "Sheet1 缺少阻断状态下拉范围");
  assert(sheet1Xml.includes('autoFilter ref="A4:H'), "Sheet1 缺少自动筛选");
  assert(countRows(sheet1Xml) >= report.questions.length + 3, "Sheet1 数据行数量不足");
  assert(cellText(sheet2Xml, "A1").includes(report.report_meta.requirement_name), "Sheet2 标题错误");
  for (const section of Object.values(SHEET2_SECTION_HEADERS)) assert(sheet2Xml.includes(esc(section)), `Sheet2 缺少分区标题：${section}`);
  assert(cellText(sheet2Xml, "C5") === report.report_meta.requirement_name, "Sheet2 准入区需求名称错误");
  assert(Number(cellText(sheet2Xml, "H6")) === counts.p0, "P0 统计错误");
  assert(Number(cellText(sheet2Xml, "H7")) === counts.p1, "P1 统计错误");
  assert(Number(cellText(sheet2Xml, "H8")) === counts.p2, "P2 统计错误");
  assert(Number(cellText(sheet2Xml, "H9")) === counts.p0 + counts.p1 + counts.p2, "总计统计错误");
  assert(cellText(sheet2Xml, "A12") === "业务目标", "当前需求理解缺少业务目标");
  assert(cellText(sheet2Xml, "A22") === "C001" || report.confirmed_items.length === 0, "已明确内容起始行错误");
  return {
    sheetNames,
    sheet1Rows: countRows(sheet1Xml),
    sheet2Rows: countRows(sheet2Xml),
  };
}

export async function renderClarificationXlsx(report, outputPath, { overwrite = false } = {}) {
  const { buffer, counts } = buildWorkbook(report);
  const finalPath = path.resolve(outputPath);
  await fs.mkdir(path.dirname(finalPath), { recursive: true });
  if (await exists(finalPath) && !overwrite) throw new Error(`文件已存在：${finalPath}`);
  const tempPath = `${finalPath}.tmp-${crypto.randomBytes(6).toString("hex")}`;
  try {
    await fs.writeFile(tempPath, buffer);
    const reread = await fs.readFile(tempPath);
    validateWrittenWorkbook(reread, report, counts);
    if (overwrite) await fs.rm(finalPath, { force: true }).catch(() => {});
    await fs.rename(tempPath, finalPath);
    return { outputPath: finalPath, counts };
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function buildDefaultOutputPath(report, target) {
  const requirement = sanitizeFilenamePart(report.report_meta.requirement_name) || "需求澄清";
  const datePart = normalizeDatePart(report.report_meta.generated_at);
  const fileName = `需求澄清问题表_${requirement}_${datePart}.xlsx`;
  if (!target) return path.resolve(fileName);
  const resolved = path.resolve(target);
  if (resolved.toLowerCase().endsWith(".xlsx")) return resolved;
  return path.join(resolved, fileName);
}

async function readInput(inputPath) {
  return JSON.parse(await fs.readFile(inputPath, "utf8"));
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const input = get("--input");
  const output = get("--output");
  const outputDir = get("--output-dir");
  const overwrite = args.includes("--overwrite");
  assert(input, "用法：node render-clarification-assets.mjs --input REPORT.json --output-dir DIR | --output FILE.xlsx");
  assert(output || outputDir, "必须提供 --output 或 --output-dir");
  const report = await readInput(input);
  const target = buildDefaultOutputPath(report, output ?? outputDir);
  const result = await renderClarificationXlsx(report, target, { overwrite });
  console.log(result.outputPath);
  console.log(`P0=${result.counts.p0} P1=${result.counts.p1} P2=${result.counts.p2}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error?.stack || error?.message || String(error));
    process.exitCode = 1;
  });
}

export {
  buildDefaultOutputPath,
  buildWorkbook,
  buildSheet1,
  buildSheet2,
  validateWrittenWorkbook,
  readZipEntries,
};
