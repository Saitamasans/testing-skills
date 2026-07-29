#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (key.startsWith("--")) {
      args[key.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function statusClass(status) {
  if (status === "通过") return "pass";
  if (status === "不通过") return "fail";
  if (status === "待定") return "pending";
  if (status === "阻塞") return "blocked";
  return "";
}

function statusIcon(status) {
  if (status === "通过") return "✅";
  if (status === "不通过") return "❌";
  if (status === "待定") return "⚠️";
  if (status === "阻塞") return "⛔";
  return "•";
}

function failValidation(message) {
  throw new Error(`Invalid acceptance result JSON: ${message}`);
}

function requireString(summary, field) {
  if (typeof summary[field] !== "string" || !summary[field].trim()) {
    failValidation(`${field} must be a non-empty string`);
  }
}

function requireNumber(summary, field) {
  if (typeof summary[field] !== "number" || !Number.isFinite(summary[field]) || summary[field] < 0) {
    failValidation(`${field} must be a non-negative number`);
  }
}

function validateCase(item, index, allowedStatuses, collectionName) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    failValidation(`${collectionName}[${index}] must be an object`);
  }
  for (const field of ["caseId", "title", "status", "actual"]) {
    if (typeof item[field] !== "string") {
      failValidation(`${collectionName}[${index}].${field} must be a string`);
    }
  }
  if (!allowedStatuses.has(item.status)) {
    failValidation(`${collectionName}[${index}].status must be one of ${Array.from(allowedStatuses).join("|")}`);
  }
  if (item.evidenceId !== undefined && typeof item.evidenceId !== "string") {
    failValidation(`${collectionName}[${index}].evidenceId must be a string when present`);
  }
  if (item.reason !== undefined && typeof item.reason !== "string") {
    failValidation(`${collectionName}[${index}].reason must be a string when present`);
  }
}

function validateSummary(summary) {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    failValidation("root value must be an object");
  }

  for (const field of ["taskName", "source", "environment", "executionMethod", "executedAt"]) {
    requireString(summary, field);
  }
  for (const field of ["totalCases", "pass", "fail", "pending", "blocked"]) {
    requireNumber(summary, field);
  }
  if (!Array.isArray(summary.results)) {
    failValidation("results must be an array");
  }
  if (summary.blockedCases !== undefined && !Array.isArray(summary.blockedCases)) {
    failValidation("blockedCases must be an array when present");
  }
  if (summary.evidences !== undefined && !Array.isArray(summary.evidences)) {
    failValidation("evidences must be an array when present");
  }
  if (summary.keyFindings !== undefined && !Array.isArray(summary.keyFindings)) {
    failValidation("keyFindings must be an array when present");
  }

  const executedStatuses = new Set(["通过", "不通过", "待定"]);
  const blockedStatuses = new Set(["阻塞"]);
  summary.results.forEach((item, index) => validateCase(item, index, executedStatuses, "results"));
  (summary.blockedCases || []).forEach((item, index) => validateCase(item, index, blockedStatuses, "blockedCases"));

  const counted = {
    pass: summary.results.filter((item) => item.status === "通过").length,
    fail: summary.results.filter((item) => item.status === "不通过").length,
    pending: summary.results.filter((item) => item.status === "待定").length,
    blocked: (summary.blockedCases || []).length,
  };
  for (const field of ["pass", "fail", "pending", "blocked"]) {
    if (summary[field] !== counted[field]) {
      failValidation(`${field}=${summary[field]} does not match counted ${counted[field]}`);
    }
  }
  const expectedTotal = summary.results.length + (summary.blockedCases || []).length;
  if (summary.totalCases !== expectedTotal) {
    failValidation(`totalCases=${summary.totalCases} does not match results + blockedCases (${expectedTotal})`);
  }

  const evidenceIds = new Set();
  for (const [index, item] of (summary.evidences || []).entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failValidation(`evidences[${index}] must be an object`);
    }
    for (const field of ["evidenceId", "caseId", "type", "file"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) {
        failValidation(`evidences[${index}].${field} must be a non-empty string`);
      }
    }
    evidenceIds.add(item.evidenceId);
  }
  for (const item of summary.results) {
    if (!item.evidenceId) continue;
    for (const id of item.evidenceId.split(",").map((value) => value.trim()).filter(Boolean)) {
      if (!evidenceIds.has(id)) {
        failValidation(`${item.caseId} references missing evidenceId ${id}`);
      }
    }
  }
}

function shortText(value, max = 180) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function readableActual(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const parts = text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => part.length <= 90 && !/[{}[\]]/.test(part));
  if (parts.length) return parts.slice(0, 2).join("；");
  return "页面状态与交互结果已确认";
}

function renderStatusSummary(pass, fail, pending, blocked) {
  const rows = [
    ["✅ 通过", pass, pass > 0 ? "已实际操作并符合预期" : "—"],
    ["⚠️ 待确认", pending, pending > 0 ? "需求口径或页面表现仍需确认" : "—"],
    ["⛔ 阻塞", blocked, blocked > 0 ? "缺账号、权限、数据、测试桩或外部条件" : "—"],
    ["❌ 不通过", fail, fail > 0 ? "存在明确偏差且可复现" : "—"],
  ];
  return rows.map(([label, count, desc]) => `
    <tr>
      <td>${label}</td>
      <td class="count">${count}</td>
      <td>${esc(desc)}</td>
    </tr>`).join("");
}

function deriveHighlights(summary) {
  if (Array.isArray(summary.keyFindings) && summary.keyFindings.length) {
    return summary.keyFindings.slice(0, 8);
  }
  return (summary.results || [])
    .filter((item) => item.status === "通过")
    .slice(0, 6)
    .map((item) => `${item.caseId} ${item.title}：${readableActual(item.actual)}`);
}

function renderHighlights(summary) {
  const items = deriveHighlights(summary);
  if (!items.length) return "<p class=\"muted\">本轮暂无已通过关键点。</p>";
  return `<ul class="check-list">${items.map((item) => `<li>✅ ${esc(item)}</li>`).join("")}</ul>`;
}

function normalizeFollowUp(reason, title) {
  const text = `${reason || ""} ${title || ""}`;
  if (/(账号|权限|角色|登录后|有效账号|密码)/.test(text)) {
    return "账号/权限：缺少有效账号、特定角色或登录后页面条件";
  }
  if (/测试桩|网络/.test(text)) {
    return "外部依赖：需要测试桩或网络控制策略";
  }
  if (/口径|解析异常|失效路径|next/.test(text)) {
    return "口径确认：next 解析、失效路径或异常值需要明确";
  }
  if (/服务异常|超时/.test(text)) {
    return "异常链路：需要服务异常或超时触发条件";
  }
  if (/剪贴板|粘贴/.test(text)) {
    return "执行权限：剪贴板或系统权限需要补齐";
  }
  return reason || title || "待确认项";
}

function renderFollowUps(issueCases) {
  const items = [];
  for (const item of issueCases) {
    const line = normalizeFollowUp(item.reason, item.title);
    if (!items.includes(line)) {
      items.push(line);
    }
    if (items.length >= 4) break;
  }
  if (!items.length) return "<p class=\"muted\">无</p>";
  return `<ol class="followups">${items.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`;
}

function renderExecutedRows(results) {
  return results.map((item, index) => `
    <tr class="${statusClass(item.status)}">
      <td>${index + 1}</td>
      <td>${esc(item.caseId)}</td>
      <td>${esc(item.title)}</td>
      <td><span class="badge ${statusClass(item.status)}">${statusIcon(item.status)} ${esc(item.status)}</span></td>
      <td class="result-text">${esc(shortText(item.actual, 260))}</td>
      <td>${esc(item.reason || "—")}</td>
      <td>${esc(item.evidenceId || "—")}</td>
    </tr>`).join("");
}

function renderIssueRows(items) {
  if (!items.length) {
    return `<tr><td colspan="5" class="empty">无</td></tr>`;
  }
  return items.map((item, index) => `
    <tr class="${statusClass(item.status)}">
      <td>${index + 1}</td>
      <td>${esc(item.caseId)}</td>
      <td>${esc(item.title)}</td>
      <td><span class="badge ${statusClass(item.status)}">${statusIcon(item.status)} ${esc(item.status)}</span></td>
      <td>${esc(item.reason || item.actual || "—")}</td>
    </tr>`).join("");
}

function renderEvidence(evidences, baseDir) {
  if (!evidences.length) return "<p class=\"muted\">本次没有截图证据。</p>";
  return evidences.map((item) => {
    const file = String(item.file || "");
    const src = esc(file);
    const exists = file && fs.existsSync(path.join(baseDir, file));
    return `
      <figure class="shot">
        ${exists ? `<img src="${src}" alt="${esc(item.evidenceId)}">` : `<div class="missing">截图文件缺失</div>`}
        <figcaption>${esc(item.evidenceId)}｜${esc(item.caseId)}｜${esc(item.desc || item.node || "")}</figcaption>
      </figure>`;
  }).join("");
}

function render(summary, baseDir) {
  const pass = Number(summary.pass || 0);
  const fail = Number(summary.fail || 0);
  const pending = Number(summary.pending || 0);
  const blocked = Number(summary.blocked || 0);
  const total = Number(summary.totalCases || 0);
  const conclusion = fail === 0 ? (blocked > 0 ? "部分通过，存在阻塞项" : "全部通过") : "存在不通过项";
  const headline = fail > 0 ? "验收完成：存在不通过项" : (blocked > 0 || pending > 0) ? "验收完成：存在待确认/阻塞项" : "验收完成：全部通过";
  const heroClass = fail > 0 ? "hero fail" : blocked > 0 ? "hero blocked" : "hero pass";
  const executedResults = summary.results || [];
  const issueCases = [
    ...executedResults.filter((item) => item.status !== "通过"),
    ...(summary.blockedCases || []),
  ];
  const evidenceCount = (summary.evidences || []).length;

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(summary.taskName || "验收测试报告")}</title>
  <style>
    :root { --green:#2fb344; --green-bg:#effbea; --yellow:#d99a00; --yellow-bg:#fff8df; --red:#e03131; --red-bg:#fff1f1; --blue:#2563eb; --blue-bg:#eef5ff; --line:#e5e7eb; --text:#111827; --muted:#6b7280; --card:#fff; --bg:#f5f6f8; }
    * { box-sizing: border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font:14px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",Arial,sans-serif; }
    .wrap { max-width:1180px; margin:0 auto; padding:28px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:8px; box-shadow:0 8px 22px rgba(15,23,42,.06); margin-bottom:22px; overflow:hidden; }
    .hero { color:#fff; padding:32px 40px; }
    .hero.pass { background:linear-gradient(135deg,#35b90f,#269a31); }
    .hero.blocked { background:linear-gradient(135deg,#d99a00,#b87900); }
    .hero.fail { background:linear-gradient(135deg,#e03131,#b42323); }
    .hero h1 { margin:0 0 10px; font-size:30px; letter-spacing:0; }
    .hero p { margin:0; font-size:16px; opacity:.96; }
    .hero .sub { margin-top:8px; font-size:14px; opacity:.92; }
    section h2 { margin:0; padding:22px 28px; font-size:21px; border-bottom:1px solid var(--line); }
    .content { padding:24px 28px; }
    .stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:16px; }
    .stat { border:1px solid var(--line); border-radius:8px; padding:20px; text-align:center; background:#fff; }
    .stat.pass { background:var(--green-bg); border-color:#a7e28f; }
    .stat.pending,.stat.blocked { background:var(--yellow-bg); border-color:#f3d26b; }
    .stat.fail { background:var(--red-bg); border-color:#ffc5c5; }
    .stat .num { font-size:42px; font-weight:800; line-height:1; }
    .stat.pass .num { color:#139a21; } .stat.pending .num,.stat.blocked .num { color:#c47f00; } .stat.fail .num { color:var(--red); }
    .summary-grid { display:grid; grid-template-columns:minmax(0,1.1fr) minmax(320px,.9fr); gap:18px; margin-top:18px; }
    table { width:100%; border-collapse:collapse; background:#fff; }
    th,td { border:1px solid #ddd; padding:12px 14px; vertical-align:top; }
    th { background:#f0f0f0; text-align:left; font-weight:700; }
    tr.pass { background:#f2fde9; } tr.blocked,tr.pending { background:#fff9e8; } tr.fail { background:#fff1f1; }
    .badge { display:inline-block; padding:4px 8px; border-radius:6px; font-weight:700; white-space:nowrap; }
    .badge.pass { background:#d8f5df; color:#127a25; } .badge.blocked,.badge.pending { background:#fff1bd; color:#9a6700; } .badge.fail { background:#ffd7d7; color:#b42323; }
    .meta { color:var(--muted); margin-top:14px; }
    .note { border-left:4px solid var(--blue); background:var(--blue-bg); padding:14px 16px; color:#1f2937; }
    .check-list { margin:0; padding-left:0; list-style:none; }
    .check-list li { padding:7px 0; border-bottom:1px dashed #e5e7eb; }
    .check-list li:last-child { border-bottom:0; }
    .followups { margin:0; padding-left:20px; }
    .followups li { margin:8px 0; }
    .table-wrap { overflow:auto; border:1px solid #ddd; }
    .table-wrap table { min-width:920px; border:0; }
    .table-wrap th:first-child,.table-wrap td:first-child { border-left:0; }
    .table-wrap th:last-child,.table-wrap td:last-child { border-right:0; }
    .result-text { min-width:280px; max-width:420px; }
    .count { font-size:18px; font-weight:800; text-align:right; }
    .empty { text-align:center; color:var(--muted); padding:22px; }
    .gallery { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:18px; }
    .shot { margin:0; border:1px solid #dcdfe4; border-radius:8px; overflow:hidden; background:#fff; }
    .shot img { width:100%; display:block; border-bottom:1px solid #e5e7eb; }
    .shot figcaption { padding:10px 14px; color:#374151; }
    .missing { height:180px; display:flex; align-items:center; justify-content:center; color:var(--muted); background:#f3f4f6; }
    .final { border-left:5px solid var(--green); background:var(--green-bg); padding:20px 24px; }
    .muted { color:var(--muted); }
    @media (max-width:860px) { .wrap{padding:16px}.stats{grid-template-columns:repeat(2,1fr)}.summary-grid{grid-template-columns:1fr}.gallery{grid-template-columns:1fr}.hero{padding:26px}.hero h1{font-size:24px} }
  </style>
</head>
<body>
  <main class="wrap">
    <div class="card">
      <div class="${heroClass}">
        <h1>${fail === 0 ? "✅" : "❌"} ${esc(headline)}</h1>
        <p>${esc(summary.taskName || "需求验收测试报告")}</p>
        <p class="sub">环境：${esc(summary.environment)} ｜ 方式：${esc(summary.executionMethod)} ｜ 结论：${esc(conclusion)}</p>
      </div>
    </div>
    <section class="card">
      <h2>📋 测试结果</h2>
      <div class="content">
        <p class="meta" style="margin-top:0;font-size:15px;"><strong>测试结果：</strong>${pass}/${executedResults.length} 通过${pending ? `，${pending} 待确认` : ""}${blocked ? `，${blocked} 阻塞` : ""}，${fail} 不通过</p>
        <div class="stats">
          <div class="stat pass"><div class="num">${pass}</div><div>✅ 通过</div></div>
          <div class="stat pending"><div class="num">${pending}</div><div>⚠️ 待定</div></div>
          <div class="stat fail"><div class="num">${fail}</div><div>❌ 不通过</div></div>
          <div class="stat blocked"><div class="num">${blocked}</div><div>⛔ 阻塞</div></div>
        </div>
        <div class="summary-grid">
          <table>
            <thead><tr><th>状态</th><th>数量</th><th>说明</th></tr></thead>
            <tbody>${renderStatusSummary(pass, fail, pending, blocked)}</tbody>
          </table>
          <div class="note">
            <strong>执行说明</strong>
            <p>本轮按需求工作台生成用例执行浏览器 UI 验收；截图用于证据留存，定位以 DOM snapshot/ref、role/text/aria 为主，CSS selector 与 JS eval 仅作辅助。</p>
          </div>
        </div>
        <p class="meta">来源：${esc(summary.source)} ｜ 总用例：${total} ｜ 截图：${evidenceCount} ｜ 执行时间：${esc(summary.executedAt)}</p>
      </div>
    </section>

    <section class="card">
      <h2>🔑 已验证的关键点</h2>
      <div class="content">${renderHighlights(summary)}</div>
    </section>

    <section class="card">
      <h2>⚠️ 上线前建议补充验证</h2>
      <div class="content">${renderFollowUps(issueCases)}</div>
    </section>

    <section class="card">
      <h2>🔎 已执行用例与结果</h2>
      <div class="content">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>用例 ID</th><th>用例标题</th><th>结果</th><th>实际结果</th><th>阻塞/失败原因</th><th>证据</th></tr></thead>
            <tbody>${renderExecutedRows(executedResults)}</tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>⚠️ 待确认 / 阻塞 / 不通过</h2>
      <div class="content">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>用例 ID</th><th>用例标题</th><th>状态</th><th>原因</th></tr></thead>
            <tbody>${renderIssueRows(issueCases)}</tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>📸 关键截图</h2>
      <div class="content gallery">${renderEvidence(summary.evidences || [], baseDir)}</div>
    </section>

    <section class="card">
      <h2>✅ 最终验收结论</h2>
      <div class="content">
        <div class="final">
          <strong>验收结果：${esc(conclusion)}</strong>
          <p>已执行用例 ${executedResults.length} 条，其中通过 ${pass} 条，不通过 ${fail} 条，待定 ${pending} 条。阻塞项 ${blocked} 条需补充账号、权限、测试数据、测试桩或需求口径后继续执行。</p>
        </div>
      </div>
    </section>
  </main>
</body>
</html>`;
}

const args = parseArgs(process.argv);
if (!args.input || !args.output) {
  console.error("Usage: node render-acceptance-report.mjs --input result.json --output report.html");
  process.exit(2);
}

const inputPath = path.resolve(args.input);
const outputPath = path.resolve(args.output);
const summary = JSON.parse(fs.readFileSync(inputPath, "utf8"));
validateSummary(summary);
const html = render(summary, path.dirname(inputPath));
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, html, "utf8");
console.log(outputPath);
