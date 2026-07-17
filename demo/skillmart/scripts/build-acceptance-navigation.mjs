import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const chapters = [
  { no: "01", folder: "01-需求澄清_Requirement-Clarification", title: "需求澄清 / Requirement Clarification", skill: "requirement-clarification-test", output: "03-完整输出/requirement-clarification.md" },
  { no: "02", folder: "02-需求工作台_Requirement-Workbench", title: "需求工作台 / Requirement Workbench", skill: "requirement-test-workbench", output: "03-完整输出/requirement-workbench.md", report: "04-生成文件/skillmart-requirement-workbench.html", workbook: "04-生成文件/skillmart-requirement-workbench.xlsx" },
  { no: "03", folder: "03-单接口完整版_Single-API-Full", title: "单接口完整版 / Single API Full", skill: "single-api-test-full", output: "03-完整输出/single-api-full.md", report: "04-生成文件/skillmart-single-api-full.html", workbook: "04-生成文件/skillmart-single-api-full.xlsx" },
  { no: "04", folder: "04-单接口精炼版_Single-API-Concise", title: "单接口精炼版 / Single API Concise", skill: "single-api-test-concise", output: "03-完整输出/single-api-concise.md", report: "04-生成文件/skillmart-single-api-concise.html", workbook: "04-生成文件/skillmart-single-api-concise.xlsx" },
  { no: "05", folder: "05-多接口链路_Multi-API-Flow", title: "多接口链路 / Multi API Flow", skill: "multi-api-flow-test", output: "03-完整输出/multi-api-flow.md", report: "04-生成文件/skillmart-multi-api-flow.html", workbook: "04-生成文件/skillmart-multi-api-flow.xlsx" },
  { no: "06", folder: "06-正式服验证_Production-Verification", title: "正式服 L0 / Production Verification", skill: "production-verification-test", output: "03-完整输出/production-verification.md", report: "04-生成文件/skillmart-production-verification.html", workbook: "04-生成文件/skillmart-production-verification.xlsx" },
  { no: "07", folder: "07-测试用例审计_Test-Case-Audit", title: "测试用例审计 / Test Case Audit", skill: "test-case-quality-audit", output: "03-完整输出/test-case-audit.md" },
  { no: "08", folder: "08-自动执行与证据_Automated-Execution-Evidence", title: "自动执行与证据 / Automated Execution Evidence", skill: "web-api-test-execution-evidence", output: "06-验证记录/execution-summary.md", report: "06-验证记录/execution-overview.html" },
];
const executionSuites = [
  ["requirementWorkbench", "需求工作台执行报告"],
  ["singleApiFull", "单接口完整版执行报告"],
  ["singleApiConcise", "单接口精炼版执行报告"],
  ["multiApiFlow", "多接口链路执行报告"],
  ["productionVerification", "正式服 L0 执行报告"],
];
const keyShots = [
  "08-01-Web页面初始状态.png",
  "08-02-库存不足断言证据.png",
  "08-03-幂等测试操作前.png",
  "08-04-幂等测试第一次点击.png",
  "08-05-幂等缺陷第二次创建订单.png",
];

function href(target) {
  return `../${target.replaceAll("\\", "/")}`;
}

async function findLatestEighthSkillTutorial(root) {
  const folder = "12-第八个Skill专用教程_Eighth-Skill-Tutorial";
  const tutorialRoot = path.join(root, folder);
  let entries;
  try {
    entries = await readdir(tutorialRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory() && /^final-(?:v\d+\.\d+\.\d+-)?\d{8}-\d{6}$/.test(entry.name))
    .sort((left, right) => right.name.localeCompare(left.name));
  for (const entry of candidates) {
    const relative = `${folder}/${entry.name}`;
    const required = [
      "完整未剪辑桌面录屏_Raw-Desktop-Session.mp4",
      "第八个Skill教程_8th-Skill-Tutorial-Edited.mp4",
      "01-真实执行_Live-Execution/result.html",
      "证据索引_Evidence-Index.json",
      "02-视频关键帧_Key-Frames/教程版接触表_Edited-Contact-Sheet.png",
    ];
    try {
      await Promise.all(required.map((file) => stat(path.join(root, relative, file))));
      return { relative };
    } catch {
      // Continue to the next complete timestamped tutorial package.
    }
  }
  return undefined;
}

function chapterCard(chapter) {
  const links = [
    `<a href="${href(`${chapter.folder}/02-调用口令/prompt.md`)}">原始调用口令</a>`,
    `<a href="${href(`${chapter.folder}/${chapter.output}`)}">完整回答</a>`,
    `<a href="${href(`${chapter.folder}/06-验证记录/invocation.json`)}">调用记录与哈希</a>`,
  ];
  if (chapter.report) links.push(`<a href="${href(`${chapter.folder}/${chapter.report}`)}">HTML 报告</a>`);
  if (chapter.workbook) links.push(`<a href="${href(`${chapter.folder}/${chapter.workbook}`)}">Excel 测试用例（Test Cases）</a>`);
  return `<article class="chapter"><div class="number">${chapter.no}</div><div><h2>${chapter.title}</h2><code>${chapter.skill}</code><div class="links">${links.join("")}</div></div></article>`;
}

function renderNavigation(summary, tutorial) {
  const totals = summary?.totals ?? { cases: 0, statuses: { 未执行: 0, 通过: 0, 不通过: 0, 待定: 0 } };
  const executionLinks = executionSuites.map(([suite, label]) => `<a class="report" href="${href(`08-自动执行与证据_Automated-Execution-Evidence/04-生成文件/${suite}/.testing-run/result/result.html`)}">${label}</a>`).join("");
  const gallery = keyShots.map((name) => `<figure><img src="${href(`08-自动执行与证据_Automated-Execution-Evidence/05-关键截图/${name}`)}" alt="${name}"><figcaption>${name.replace(/\.png$/i, "")}</figcaption></figure>`).join("");
  const focusedTutorial = tutorial ? `<section class="section"><h2>第八个 Skill 可视化执行教程</h2><p>最大化浏览器真实执行 18 条测试用例（Test Cases），同步展示 Web/API 动作、断言与四状态进度。</p><div class="videos"><a href="${href(`${tutorial.relative}/完整未剪辑桌面录屏_Raw-Desktop-Session.mp4`)}">完整未剪辑桌面录屏</a><a href="${href(`${tutorial.relative}/第八个Skill教程_8th-Skill-Tutorial-Edited.mp4`)}">1080p60 中文字幕教程</a><a href="${href(`${tutorial.relative}/01-真实执行_Live-Execution/result.html`)}">真实执行 HTML 报告</a><a href="${href(`${tutorial.relative}/证据索引_Evidence-Index.json`)}">SHA-256 证据索引</a><a href="${href(`${tutorial.relative}/02-视频关键帧_Key-Frames/教程版接触表_Edited-Contact-Sheet.png`)}">教程关键帧</a></div></section>` : "";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SkillMart 八 Skill 验收导航</title><style>
  :root{font-family:"Microsoft YaHei",system-ui,sans-serif;color:#172033;background:#f4f7fb}*{box-sizing:border-box}body{margin:0;padding:36px}.wrap{max-width:1280px;margin:auto}.hero{background:linear-gradient(135deg,#111c44,#175cd3);color:#fff;padding:34px;border-radius:24px;box-shadow:0 20px 50px #1e40af33}.hero h1{margin:0 0 10px;font-size:38px}.hero p{margin:0;opacity:.88}.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:22px 0}.stat{background:#fff;border-radius:16px;padding:18px;box-shadow:0 8px 24px #33415514}.stat span{display:block;color:#64748b}.stat strong{font-size:30px}.stat.fail{background:#fff1f2}.stat.pending{background:#eef2f7}.chapters{display:grid;grid-template-columns:1fr 1fr;gap:14px}.chapter{display:grid;grid-template-columns:58px 1fr;gap:16px;background:#fff;border-radius:18px;padding:20px;box-shadow:0 8px 24px #33415512}.number{width:52px;height:52px;border-radius:16px;background:#e8efff;color:#1d4ed8;display:grid;place-items:center;font-size:22px;font-weight:800}.chapter h2{margin:0 0 7px}.chapter code{color:#475569}.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:15px}a{color:#174ea6;text-decoration:none}.links a,.report{border:1px solid #cbd5e1;border-radius:10px;padding:8px 10px;background:#f8fafc}.section{margin-top:24px;background:#fff;border-radius:20px;padding:24px;box-shadow:0 8px 24px #33415512}.reports{display:flex;flex-wrap:wrap;gap:10px}.gallery{display:grid;grid-template-columns:repeat(2,1fr);gap:14px}.gallery figure{margin:0}.gallery img{width:100%;border:1px solid #dbe3ef;border-radius:14px}.gallery figcaption{padding:7px;color:#475569}.videos{display:flex;gap:12px;flex-wrap:wrap}.videos a{background:#172554;color:#fff;padding:12px 16px;border-radius:12px}@media(max-width:860px){body{padding:18px}.chapters,.gallery{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}
  </style></head><body><main class="wrap"><section class="hero"><h1>SkillMart 八 Skill 真实演示验收导航</h1><p>七次独立 Skill 调用 + 第八个 Skill 五套真实执行 + 同源 Excel / HTML / JSON + PNG / Trace / 日志 / 双版本视频</p></section><section class="stats"><div class="stat"><span>测试用例（Test Cases）</span><strong>${totals.cases}</strong></div><div class="stat"><span>通过</span><strong>${totals.statuses["通过"]}</strong></div><div class="stat fail"><span>不通过</span><strong>${totals.statuses["不通过"]}</strong></div><div class="stat pending"><span>待定</span><strong>${totals.statuses["待定"]}</strong></div><div class="stat"><span>未执行</span><strong>${totals.statuses["未执行"]}</strong></div></section><section class="chapters">${chapters.map(chapterCard).join("")}</section><section class="section"><h2>五套执行报告</h2><div class="reports">${executionLinks}</div><p>跨套件幂等失败按 root_cause_key 聚合为 ${summary?.unique_bug_count ?? 0} 个 Bug；待定不计研发 Bug。</p></section><section class="section"><h2>关键流程 PNG</h2><div class="gallery">${gallery}</div></section><section class="section"><h2>视频</h2><div class="videos"><a href="${href("10-视频_Video/完整未剪辑录屏_Raw-Full-Session.mp4")}">完整未剪辑录屏_Raw-Full-Session.mp4</a><a href="${href("10-视频_Video/20分钟精剪版_Edited-Demo.mp4")}">20分钟精剪版_Edited-Demo.mp4</a><a href="${href("10-视频_Video/字幕_Subtitles.srt")}">字幕_Subtitles.srt</a></div></section>${focusedTutorial}</main></body></html>`;
}

async function walkFiles(root, current = root) {
  const files = [];
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (entry.isFile()) files.push(absolute);
  }
  return files;
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

export async function buildAcceptanceNavigation({ root }) {
  const navigationDir = path.join(root, "00-演示导航与视频材料");
  const summaryPath = path.join(root, "08-自动执行与证据_Automated-Execution-Evidence", "06-验证记录", "execution-summary.json");
  let summary;
  try {
    summary = JSON.parse(await readFile(summaryPath, "utf8"));
  } catch {
    summary = undefined;
  }
  await mkdir(navigationDir, { recursive: true });
  const navigationPath = path.join(navigationDir, "验收导航.html");
  const indexPath = path.join(navigationDir, "证据索引.json");
  const tutorial = await findLatestEighthSkillTutorial(root);
  await writeFile(navigationPath, renderNavigation(summary, tutorial), "utf8");

  const files = [];
  for (const file of await walkFiles(root)) {
    if (path.resolve(file) === path.resolve(indexPath)) continue;
    const relative = path.relative(root, file).replaceAll("\\", "/");
    const metadata = await stat(file);
    files.push({ path: relative, size: metadata.size, sha256: await sha256(file) });
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  const index = { generated_at: new Date().toISOString(), algorithm: "SHA-256", files };
  await writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { navigationPath, indexPath, fileCount: files.length };
}

async function main() {
  const rootIndex = process.argv.indexOf("--root");
  const root = path.resolve(rootIndex >= 0 && process.argv[rootIndex + 1] ? process.argv[rootIndex + 1] : path.join(process.cwd(), "build", "skillmart-demo"));
  console.log(JSON.stringify(await buildAcceptanceNavigation({ root }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
