import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";

const XML = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[char]));

function zipStore(files) {
  const local = [], central = [];
  let offset = 0;
  const crc32 = (buffer) => { let crc = 0xffffffff; for (const byte of buffer) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  for (const [name, content] of files) {
    const nameBytes = Buffer.from(name.replaceAll("\\", "/"), "utf8");
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
    const crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x0800, 6); header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    local.push(header, nameBytes, data);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50, 0); record.writeUInt16LE(20, 4); record.writeUInt16LE(20, 6); record.writeUInt16LE(0x0800, 8); record.writeUInt32LE(crc, 16); record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(nameBytes.length, 28); record.writeUInt32LE(offset, 42); central.push(record, nameBytes); offset += header.length + nameBytes.length + data.length;
  }
  const centralBuffer = Buffer.concat(central); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(centralBuffer.length, 12); end.writeUInt32LE(offset, 16); return Buffer.concat([...local, centralBuffer, end]);
}

function sheetXml(sheet) {
  const rows = [sheet.columns, ...sheet.rows.map((row) => row.values)].map((values, rowIndex) => `<row r="${rowIndex + 1}">${values.map((value, colIndex) => `<c r="${String.fromCharCode(65 + colIndex)}${rowIndex + 1}" t="inlineStr"><is><t xml:space="preserve">${XML(value)}</t></is></c>`).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData><autoFilter ref="A1:${String.fromCharCode(64 + sheet.columns.length)}${sheet.rows.length + 1}"/></worksheet>`;
}

async function buildXlsx(projection, output) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const widths = {
    "01_扫描批次与范围": [12, 22, 30, 26, 42, 40, 12, 12, 14, 12, 34],
    "02_系统功能与路由地图": [18, 18, 30, 38, 34, 16],
    "03_JS调用链与接口引用": [14, 18, 18, 64, 34, 46, 16],
    "04_权限状态与生命周期": [18, 18, 48, 48, 16],
    "05_测试关注点与风险待确认": [14, 18, 16, 48, 38, 12, 16],
  };
  for (const declared of projection.sheets) {
    const sheet = workbook.addWorksheet(declared.name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = declared.columns.map((header, index) => ({ header, key: `c${index}`, width: widths[declared.name]?.[index] || 24 }));
    const header = sheet.getRow(1);
    header.height = 30;
    header.eachCell((cell) => { cell.font = { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }; cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true }; });
    for (const row of declared.rows) {
      const values = row.values.map((value) => typeof value === "object" && value !== null ? (value.summary || value.expression || value.effect || value.target || value.kind || "存在结构化证据，详见 evidence") : String(value ?? ""));
      const excelRow = sheet.addRow(values);
      excelRow.height = row.divider ? 28 : Math.max(32, Math.min(90, 24 + Math.ceil(Math.max(...values.map((value) => value.length), 1) / 55) * 14));
      excelRow.eachCell((cell) => { cell.font = { name: "Microsoft YaHei", size: 10, color: { argb: "FF1F2937" } }; cell.alignment = { vertical: row.divider ? "middle" : "top", wrapText: true }; cell.border = { top: { style: "thin", color: { argb: "FFD9E2F3" } }, left: { style: "thin", color: { argb: "FFD9E2F3" } }, bottom: { style: "thin", color: { argb: "FFD9E2F3" } }, right: { style: "thin", color: { argb: "FFD9E2F3" } } }; if (row.divider) { cell.font.bold = true; cell.font.color = { argb: "FF1F4E78" }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAF7" } }; } });
    }
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: sheet.rowCount, column: declared.columns.length } };
  }
  await writeFile(output, await workbook.xlsx.writeBuffer());
}

function runText(text, bold = false, size = 20) { return new TextRun({ text: String(text ?? ""), font: "Microsoft YaHei", size, bold }); }
function paragraph(text, options = {}) { return new Paragraph({ children: [runText(text, options.bold, options.size || 22)], spacing: { after: options.after || 100 }, ...options }); }
function tableFromRows(headers, rows) { return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [new TableRow({ children: headers.map((header) => new TableCell({ children: [new Paragraph({ children: [runText(header, true, 18)] })] })) }), ...rows.map((row) => new TableRow({ children: row.map((value) => new TableCell({ children: [new Paragraph({ children: [runText(value, false, 18)] })] })) }))] }); }

async function buildDocx(projection, output) {
  const children = [paragraph(projection.title || "过程小结", { bold: true, size: 40, after: 80 }), paragraph(projection.subtitle || "基于 run-data 的测试认知摘要", { size: 25, after: 160 }), paragraph(`批次: ${projection.current_batch || "当前批次"}`), paragraph(`状态: ${projection.status_label || "静态恢复 / 待执行验证"}`), paragraph(`run-data fingerprint: ${projection.run_data_fingerprint}`, { size: 18 }), paragraph(projection.summary?.lead || projection.summary?.system || "以下内容只展示已有证据支持的代表性结构；没有证据的业务含义保持待确认。", { bold: true, after: 160 })];
  if (projection.summary?.next_tests?.length) {
    children.push(paragraph("下一步最值得验证", { bold: true, after: 80 }));
    for (const item of projection.summary.next_tests.slice(0, 3)) children.push(new Paragraph({ bullet: { level: 0 }, children: [runText(item)] }));
  }
  if (projection.summary?.uncertain?.length) {
    children.push(paragraph("仍待确认", { bold: true, after: 80 }));
    for (const item of projection.summary.uncertain.slice(0, 3)) children.push(new Paragraph({ bullet: { level: 0 }, children: [runText(item)] }));
  }
  for (const chapter of projection.chapters || []) {
    children.push(new Paragraph({ text: `${chapter.number} ${chapter.title}`, heading: HeadingLevel.HEADING_1, style: "Heading1" }));
    for (const text of chapter.paragraphs || []) children.push(paragraph(text));
    for (const text of chapter.bullets || []) children.push(new Paragraph({ bullet: { level: 0 }, children: [runText(text)] }));
    if (chapter.number === 2) children.push(tableFromRows(["功能 / 路由", "当前功能地图"], (chapter.bullets || []).map((item) => { const [left, ...rest] = item.split("："); return [left, rest.join("：")]; })));
    if (chapter.number === 3) children.push(tableFromRows(["调用链ID", "业务动作", "代表性链路", "当前状态"], (chapter.chains || []).map((chain) => [chain.display_id, chain.action || chain.action_label, chain.summary || "证据不足", chain.current_status || "待执行验证"])));
    if (chapter.number === 4) children.push(tableFromRows(["规则ID", "类型", "关键规则 / 对测试影响", "当前状态"], (chapter.rules || []).map((rule) => [rule.display_id, rule.type, rule.content, rule.current_status])));
    if (chapter.number === 5) children.push(tableFromRows(["编号", "类型", "关注内容", "当前状态"], (chapter.risks || []).map((risk) => [risk.display_id, risk.type, risk.content, risk.current_status])));
  }
  const document = new Document({ styles: { default: { document: { run: { font: "Microsoft YaHei", size: 22 } } } }, sections: [{ properties: {}, children }] });
  await writeFile(output, await Packer.toBuffer(document));
}

export async function buildArtifacts(inputDir, outputDir) {
  const evidence = path.join(inputDir, "evidence");
  const wordProjection = JSON.parse(await readFile(path.join(evidence, "word-projection.json"), "utf8"));
  const excelProjection = JSON.parse(await readFile(path.join(evidence, "excel-projection.json"), "utf8"));
  await mkdir(outputDir, { recursive: true });
  await buildDocx(wordProjection, path.join(outputDir, "过程小结.docx"));
  await buildXlsx(excelProjection, path.join(outputDir, "JS逆向测试资产表.xlsx"));
  return { docx: path.join(outputDir, "过程小结.docx"), xlsx: path.join(outputDir, "JS逆向测试资产表.xlsx"), run_data_fingerprint: wordProjection.run_data_fingerprint };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = new Map(); const input = process.argv.slice(2); for (let index = 0; index < input.length; index += 1) args.set(input[index], input[index + 1]);
  console.log(JSON.stringify(await buildArtifacts(path.resolve(args.get("--input-dir")), path.resolve(args.get("--output-dir"))), null, 2));
}
