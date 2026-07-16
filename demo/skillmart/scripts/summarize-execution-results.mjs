import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const suites = [
  { name: "requirementWorkbench", label: "需求工作台 / Requirement Workbench" },
  { name: "singleApiFull", label: "单接口完整版 / Single API Full" },
  { name: "singleApiConcise", label: "单接口精炼版 / Single API Concise" },
  { name: "multiApiFlow", label: "多接口链路 / Multi API Flow" },
  { name: "productionVerification", label: "正式服 L0 / Production Verification L0" },
];
const statuses = ["未执行", "通过", "不通过", "待定"];

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function summarizeExecutionResults({ root }) {
  const suiteResults = [];
  const totalStatuses = Object.fromEntries(statuses.map((status) => [status, 0]));
  const rootCauses = new Map();

  for (const suite of suites) {
    const resultPath = path.join(root, suite.name, ".testing-run", "result", "run-result.json");
    const result = await readJson(resultPath);
    const suiteStatuses = Object.fromEntries(statuses.map((status) => [status, 0]));
    for (const item of result.cases ?? []) {
      if (!(item.case_status in suiteStatuses)) throw new Error(`不支持的执行状态：${item.case_status}`);
      suiteStatuses[item.case_status] += 1;
      totalStatuses[item.case_status] += 1;
    }

    suiteResults.push({
      suite: suite.name,
      label: suite.label,
      run_status: result.run_status,
      case_count: result.cases?.length ?? 0,
      statuses: suiteStatuses,
      report: `${suite.name}/.testing-run/result/result.html`,
      run_result: `${suite.name}/.testing-run/result/run-result.json`,
    });

    for (const defect of result.defects ?? []) {
      const current = rootCauses.get(defect.root_cause_key) ?? {
        root_cause_key: defect.root_cause_key,
        suites: [],
        case_ids: [],
        evidence_count: 0,
      };
      if (!current.suites.includes(suite.name)) current.suites.push(suite.name);
      for (const caseId of defect.case_ids ?? []) {
        if (!current.case_ids.includes(caseId)) current.case_ids.push(caseId);
      }
      current.evidence_count += defect.evidence?.length ?? 0;
      rootCauses.set(defect.root_cause_key, current);
    }
  }

  return {
    generated_at: new Date().toISOString(),
    source: "web-api-test-execution-evidence",
    suites: suiteResults,
    totals: {
      cases: suiteResults.reduce((sum, suite) => sum + suite.case_count, 0),
      statuses: totalStatuses,
    },
    unique_bug_count: rootCauses.size,
    root_causes: [...rootCauses.values()],
    verdict_rules: {
      pending: "待定表示测试用例（Test Case）已执行且有证据，但需求或多方口径冲突；不计研发 Bug。",
      not_executed: "未执行表示没有触达可判定执行点，包括显式 blocked；不冒充已执行。",
      defect_aggregation: "多个测试用例（Test Cases）命中同一 root_cause_key 时只统计一个 Bug。",
    },
  };
}

function markdown(summary) {
  const lines = [
    "# 第八个 Skill 五套真实执行汇总",
    "",
    `共执行 ${summary.totals.cases} 条测试用例（Test Cases）：通过 ${summary.totals.statuses["通过"]}、不通过 ${summary.totals.statuses["不通过"]}、待定 ${summary.totals.statuses["待定"]}、未执行 ${summary.totals.statuses["未执行"]}。`,
    "",
    "| 套件 | 总数 | 通过 | 不通过 | 待定 | 未执行 | 运行状态 |",
    "|---|---:|---:|---:|---:|---:|---|",
  ];
  for (const suite of summary.suites) {
    lines.push(`| ${suite.label} | ${suite.case_count} | ${suite.statuses["通过"]} | ${suite.statuses["不通过"]} | ${suite.statuses["待定"]} | ${suite.statuses["未执行"]} | ${suite.run_status} |`);
  }
  lines.push(
    "",
    `跨套件唯一 Bug 根因：${summary.unique_bug_count} 个。`,
    "",
    ...summary.root_causes.map((root) => `- \`${root.root_cause_key}\`：覆盖 ${root.case_ids.length} 条测试用例（Test Cases），涉及 ${root.suites.join("、")}，保留 ${root.evidence_count} 份失败证据。`),
    "",
    `- ${summary.verdict_rules.pending}`,
    `- ${summary.verdict_rules.not_executed}`,
    `- ${summary.verdict_rules.defect_aggregation}`,
    "",
  );
  return lines.join("\n");
}

function html(summary) {
  const cards = statuses.map((status) => `<div class="card ${status}"><span>${status}</span><strong>${summary.totals.statuses[status]}</strong></div>`).join("");
  const rows = summary.suites.map((suite) => `<tr><td>${suite.label}</td><td>${suite.case_count}</td><td>${suite.statuses["通过"]}</td><td>${suite.statuses["不通过"]}</td><td>${suite.statuses["待定"]}</td><td>${suite.statuses["未执行"]}</td><td>${suite.run_status}</td></tr>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkillMart 八 Skill 执行总览</title><style>
  :root{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#172033;background:#f4f7fb}body{margin:0;padding:40px}.wrap{max-width:1180px;margin:auto}.hero{background:linear-gradient(135deg,#172554,#1d4ed8);color:white;padding:32px;border-radius:20px;box-shadow:0 18px 44px #1e3a8a33}.hero p{opacity:.86;margin-bottom:0}.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:22px 0}.card{background:white;border-radius:16px;padding:20px;box-shadow:0 8px 24px #33415514;border-left:5px solid #cbd5e1}.card span{display:block;color:#64748b}.card strong{font-size:34px}.card.不通过{background:#fff1f2;border-color:#ef4444}.card.待定{background:#f1f5f9;border-color:#94a3b8}.card.通过{border-color:#22c55e}.card.未执行{border-color:#f59e0b}table{width:100%;border-collapse:collapse;background:white;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px #33415514}th,td{padding:14px 16px;border-bottom:1px solid #e2e8f0;text-align:left}th{background:#eaf0fb}.note{margin-top:22px;background:white;padding:22px;border-radius:16px}.bug{font-size:22px;color:#b91c1c;font-weight:700}@media(max-width:800px){body{padding:18px}.cards{grid-template-columns:repeat(2,1fr)}}
  </style></head><body><main class="wrap"><section class="hero"><h1>SkillMart 八 Skill 真实执行总览</h1><p>第八个 Skill：web-api-test-execution-evidence｜62 条测试用例（Test Cases）｜五套独立执行</p></section><section class="cards">${cards}</section><table><thead><tr><th>执行套件</th><th>总数</th><th>通过</th><th>不通过</th><th>待定</th><th>未执行</th><th>运行状态</th></tr></thead><tbody>${rows}</tbody></table><section class="note"><div class="bug">跨套件唯一 Bug 根因：${summary.unique_bug_count} 个</div><p><code>${summary.root_causes[0]?.root_cause_key ?? "无"}</code></p><p>${summary.verdict_rules.pending}</p><p>${summary.verdict_rules.defect_aggregation}</p></section></main></body></html>`;
}

async function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : path.join(process.cwd(), "build", "skillmart-demo", "08-自动执行与证据_Automated-Execution-Evidence", "04-生成文件"));
  const outputIndex = process.argv.indexOf("--output-dir");
  const outputDir = path.resolve(outputIndex >= 0 && process.argv[outputIndex + 1] ? process.argv[outputIndex + 1] : path.join(root, "..", "06-验证记录"));
  const summary = await summarizeExecutionResults({ root });
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "execution-summary.json"), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "execution-summary.md"), markdown(summary), "utf8");
  await writeFile(path.join(outputDir, "execution-overview.html"), html(summary), "utf8");
  console.log(JSON.stringify({ outputDir, totals: summary.totals, unique_bug_count: summary.unique_bug_count }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
