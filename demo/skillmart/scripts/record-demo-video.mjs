import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { copyFile, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAVIGATION = "00-演示导航与视频材料/验收导航.html";

function segment(chapter, skill, title, reason, assetPath, durationMs, scroll = false) {
  return { chapter, skill, title, reason, path: assetPath, durationMs, scroll };
}

export function recordingSegments() {
  return [
    segment("00", "overview", "八个测试 Skill 全流程导航", "先看七次调用、五套执行和证据目录的完整范围。", NAVIGATION, 7000, true),
    segment("01", "requirement-clarification-test", "输入：PRD v0", "只做需求澄清，不生成测试用例（Test Cases）。", "01-需求澄清_Requirement-Clarification/01-输入资料/prd-v0.md", 6000, true),
    segment("01", "requirement-clarification-test", "真实调用口令", "明确要求输出 P0 阻塞项、产品核对问题和准入结论。", "01-需求澄清_Requirement-Clarification/02-调用口令/prompt.md", 5000, true),
    segment("01", "requirement-clarification-test", "完整回答", "展示 P0 ⛔ BLOCKING 和不生成正式用例的边界。", "01-需求澄清_Requirement-Clarification/03-完整输出/requirement-clarification.md", 8000, true),
    segment("01", "requirement-clarification-test", "调用记录与 SHA-256", "保存真实输入、输出哈希和主 Skill 数量。", "01-需求澄清_Requirement-Clarification/06-验证记录/invocation.json", 5000, true),
    segment("02", "requirement-test-workbench", "真实调用口令", "输入澄清后的 PRD v1，生成完整测试设计。", "02-需求工作台_Requirement-Workbench/02-调用口令/prompt.md", 5000, true),
    segment("02", "requirement-test-workbench", "完整回答", "覆盖边界、决策表、状态迁移、权限和十列测试用例（Test Cases）。", "02-需求工作台_Requirement-Workbench/03-完整输出/requirement-workbench.md", 8000, true),
    segment("02", "requirement-test-workbench", "同源 HTML 执行版", "与 Excel、report.json 使用同一份 18 条测试用例（Test Cases）数据。", "02-需求工作台_Requirement-Workbench/04-生成文件/skillmart-requirement-workbench.html", 7000, true),
    segment("02", "requirement-test-workbench", "关键输出 PNG", "直接查看正式测试用例（Test Cases）表格证据。", "02-需求工作台_Requirement-Workbench/05-关键截图/02-需求工作台-正式测试用例.png", 5000),
    segment("03", "single-api-test-full", "真实调用口令", "完整分析 POST /api/orders 的契约、鉴权、参数、幂等和并发。", "03-单接口完整版_Single-API-Full/02-调用口令/prompt.md", 5000, true),
    segment("03", "single-api-test-full", "完整回答", "保留用户原有表达习惯，不以缩短行数牺牲准确性。", "03-单接口完整版_Single-API-Full/03-完整输出/single-api-full.md", 8000, true),
    segment("03", "single-api-test-full", "同源 HTML 执行版", "20 条单接口测试用例（Test Cases），状态规则与 Excel 一致。", "03-单接口完整版_Single-API-Full/04-生成文件/skillmart-single-api-full.html", 7000, true),
    segment("04", "single-api-test-concise", "精炼版真实调用口令", "显式使用精炼版口令，验证低上下文场景下的准确输出。", "04-单接口精炼版_Single-API-Concise/02-调用口令/prompt.md", 5000, true),
    segment("04", "single-api-test-concise", "精炼版完整回答", "短而有用，不删除关键鉴权、异常和边界判断。", "04-单接口精炼版_Single-API-Concise/03-完整输出/single-api-concise.md", 7000, true),
    segment("04", "single-api-test-concise", "精炼版 HTML 执行版", "7 条测试用例（Test Cases）同源输出。", "04-单接口精炼版_Single-API-Concise/04-生成文件/skillmart-single-api-concise.html", 6000, true),
    segment("05", "multi-api-flow-test", "真实调用口令", "按商品查询、优惠校验、创建订单、支付回调和订单查询的顺序生成链路用例。", "05-多接口链路_Multi-API-Flow/02-调用口令/prompt.md", 5000, true),
    segment("05", "multi-api-flow-test", "完整回答", "展示字段依赖、链路断言、清理方式和根因关联。", "05-多接口链路_Multi-API-Flow/03-完整输出/multi-api-flow.md", 8000, true),
    segment("05", "multi-api-flow-test", "链路 HTML 执行版", "12 条联合测试用例（Test Cases）与 Excel、JSON 同源。", "05-多接口链路_Multi-API-Flow/04-生成文件/skillmart-multi-api-flow.html", 7000, true),
    segment("06", "production-verification-test", "正式服验证真实调用口令", "明确声明线上验证目标，但实际地址仍为本地隔离演示系统。", "06-正式服验证_Production-Verification/02-调用口令/prompt.md", 5000, true),
    segment("06", "production-verification-test", "L0 门禁完整回答", "缺少生产写入四项门禁时，必须拦截写操作，只输出只读验证。", "06-正式服验证_Production-Verification/03-完整输出/production-verification.md", 7500, true),
    segment("06", "production-verification-test", "L0 只读 HTML 执行版", "5 条测试用例（Test Cases）仅包含 GET 与断言。", "06-正式服验证_Production-Verification/04-生成文件/skillmart-production-verification.html", 6000, true),
    segment("07", "test-case-quality-audit", "审计真实调用口令", "输入 PRD v1、产品确认和既有 18 条测试用例（Test Cases）。", "07-测试用例审计_Test-Case-Audit/02-调用口令/prompt.md", 5000, true),
    segment("07", "test-case-quality-audit", "完整审计回答", "识别不可执行、断言不清、重复与口径问题，不删除、不合并原用例。", "07-测试用例审计_Test-Case-Audit/03-完整输出/test-case-audit.md", 8000, true),
    segment("07", "test-case-quality-audit", "审计门禁 PNG", "修订后进入人工评审；边界冲突保留待定。", "07-测试用例审计_Test-Case-Audit/05-关键截图/07-测试用例审计-门禁结论.png", 5000),
    segment("08", "web-api-test-execution-evidence", "第八个 Skill 调用口令", "只执行已有测试用例（Test Cases），先预览审批，再真实运行。", "08-自动执行与证据_Automated-Execution-Evidence/02-调用口令/prompt.md", 5000, true),
    segment("08", "web-api-test-execution-evidence", "五套执行总览", "62 条：46 通过、8 不通过、3 待定、5 未执行；跨套件只计 1 个幂等 Bug。", "08-自动执行与证据_Automated-Execution-Evidence/06-验证记录/execution-overview.html", 8000, true),
    ...[
      ["requirementWorkbench", "需求工作台执行报告", 7000],
      ["singleApiFull", "单接口完整版执行报告", 6500],
      ["singleApiConcise", "单接口精炼版执行报告", 5500],
      ["multiApiFlow", "多接口链路执行报告", 6500],
      ["productionVerification", "正式服 L0 执行报告", 5500],
    ].map(([suite, title, duration]) => segment("08", "web-api-test-execution-evidence", title, "Excel、HTML 和 run-result.json 已通过一致性门禁。", `08-自动执行与证据_Automated-Execution-Evidence/04-生成文件/${suite}/.testing-run/result/result.html`, duration, true)),
    segment("08", "web-api-test-execution-evidence", "唯一判定源 run-result.json", "四个业务状态和七个运行状态保持分离。", "08-自动执行与证据_Automated-Execution-Evidence/04-生成文件/requirementWorkbench/.testing-run/result/run-result.json", 6500, true),
    segment("08", "web-api-test-execution-evidence", "证据索引", "每份请求、响应、断言、PNG 与失败证据都有 SHA-256。", "08-自动执行与证据_Automated-Execution-Evidence/04-生成文件/requirementWorkbench/.testing-run/result/evidence-index.json", 6000, true),
    ...[
      ["08-01-Web页面初始状态.png", "Web 页面初始状态"],
      ["08-02-库存不足断言证据.png", "库存不足断言成功"],
      ["08-03-幂等测试操作前.png", "幂等测试操作前"],
      ["08-04-幂等测试第一次点击.png", "第一次点击创建订单"],
      ["08-05-幂等缺陷第二次创建订单.png", "第二次点击生成新订单：真实幂等缺陷"],
    ].map(([name, title]) => segment("08", "web-api-test-execution-evidence", title, "独立 PNG 由 Runner 在真实 Web 动作后自动保存。", `08-自动执行与证据_Automated-Execution-Evidence/05-关键截图/${name}`, 4500)),
    segment("09", "delivery", "最终验收导航", "需求、测试用例（Test Cases）、报告、日志、PNG、Trace 与双版本视频统一交付。", NAVIGATION, 8000, true),
  ];
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function assetUrl(assetPath) {
  return `/asset/${assetPath.split("/").map(encodeURIComponent).join("/")}`;
}

function playerHtml(segments) {
  const safeSegments = JSON.stringify(segments.map((item) => ({ ...item, url: assetUrl(item.path) }))).replaceAll("<", "\\u003c");
  const chapters = [...new Set(segments.map((item) => item.chapter))];
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>SkillMart 八 Skill 连续原始录制</title><style>
  *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;font-family:"Microsoft YaHei",system-ui,sans-serif;background:#0b1220;color:#e5edf8}.shell{height:100vh;display:grid;grid-template-columns:260px 1fr}.side{background:#101a30;padding:30px 22px;border-right:1px solid #26334f}.brand{font-size:24px;font-weight:800}.sub{margin-top:6px;color:#9fb0cc;font-size:13px}.chapters{margin-top:30px;display:grid;gap:8px}.chapter{padding:10px 13px;border-radius:10px;color:#9fb0cc}.chapter.active{background:#1d4ed8;color:white;font-weight:700}.main{display:grid;grid-template-rows:154px 1fr 42px;background:#e8edf6}.head{background:linear-gradient(135deg,#172554,#1d4ed8);padding:22px 30px;display:grid;grid-template-columns:1fr auto;gap:20px}.head h1{font-size:28px;margin:0 0 8px}.skill{display:inline-block;background:#ffffff1c;border:1px solid #ffffff33;border-radius:9px;padding:6px 9px;font-family:Consolas,monospace}.reason{margin:9px 0 0;color:#dbeafe}.control{display:flex;align-items:center;gap:12px}.record{display:flex;align-items:center;gap:8px;font-weight:700}.dot{width:11px;height:11px;border-radius:50%;background:#ef4444;box-shadow:0 0 0 6px #ef44442c;animation:pulse 1.4s infinite}.control button{border:0;border-radius:12px;padding:12px 18px;background:#fff;color:#172554;font-weight:800;cursor:pointer}.content{padding:14px 16px 0}.frame{width:100%;height:100%;border:0;border-radius:15px;background:white;box-shadow:0 12px 34px #0f172a30}.foot{display:grid;grid-template-columns:1fr auto;align-items:center;padding:0 18px;color:#475569}.bar{height:6px;background:#cbd5e1;border-radius:99px;overflow:hidden;margin-right:18px}.bar span{display:block;height:100%;width:0;background:#2563eb;transition:width .4s}.cursor{position:fixed;width:20px;height:20px;border:3px solid #f97316;border-radius:50%;z-index:9999;pointer-events:none;transform:translate(-50%,-50%);box-shadow:0 0 0 4px #fff8}@keyframes pulse{50%{opacity:.45}}
  </style></head><body><div class="shell"><aside class="side"><div class="brand">SkillMart</div><div class="sub">八个测试 Skill｜连续未剪辑录制</div><div class="chapters">${chapters.map((chapter) => `<div class="chapter" data-chapter="${chapter}">第 ${chapter} 章</div>`).join("")}</div></aside><main class="main"><header class="head"><div><h1 id="title">准备开始</h1><span class="skill" id="skill">八个 Skill 真实演示</span><p class="reason" id="reason">所有页面均来自已通过门禁的真实材料。</p></div><div class="control"><div class="record"><span class="dot"></span>REC</div><button data-testid="next" id="next">开始</button></div></header><section class="content"><iframe class="frame" name="asset" id="asset" sandbox="allow-scripts allow-same-origin"></iframe></section><footer class="foot"><div class="bar"><span id="progress"></span></div><div id="counter">0 / ${segments.length}</div></footer></main></div><div class="cursor" id="cursor"></div><script>
  const segments=${safeSegments};let index=-1;window.currentIndex=-1;window.assetLoaded=false;const frame=document.getElementById('asset');frame.addEventListener('load',()=>{window.assetLoaded=true});function load(next){index=next;window.currentIndex=index;window.assetLoaded=false;const item=segments[index];document.getElementById('title').textContent=item.title;document.getElementById('skill').textContent=item.skill;document.getElementById('reason').textContent=item.reason;document.querySelectorAll('.chapter').forEach(node=>node.classList.toggle('active',node.dataset.chapter===item.chapter));document.getElementById('counter').textContent=(index+1)+' / '+segments.length;document.getElementById('progress').style.width=((index+1)/segments.length*100)+'%';document.getElementById('next').textContent=index===segments.length-1?'完成':'下一项';frame.src=item.url}document.getElementById('next').addEventListener('click',()=>{if(index<segments.length-1)load(index+1)});document.addEventListener('mousemove',event=>{const cursor=document.getElementById('cursor');cursor.style.left=event.clientX+'px';cursor.style.top=event.clientY+'px'});
  </script></body></html>`;
}

function textHtml(relativePath, content) {
  let display = content;
  if (relativePath.toLowerCase().endsWith(".json")) {
    try { display = JSON.stringify(JSON.parse(content), null, 2); } catch { /* keep source */ }
  }
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>body{margin:0;background:#f8fafc;color:#172033;font-family:"Microsoft YaHei",system-ui,sans-serif}.path{position:sticky;top:0;background:#e8efff;border-bottom:1px solid #cbd5e1;padding:12px 22px;color:#1d4ed8;font-weight:700}pre{white-space:pre-wrap;word-break:break-word;font:18px/1.7 Consolas,"Microsoft YaHei",monospace;margin:0;padding:24px 30px 80px}</style></head><body><div class="path">${escapeHtml(relativePath)}</div><pre>${escapeHtml(display)}</pre></body></html>`;
}

function contentType(file) {
  const extension = path.extname(file).toLowerCase();
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".png") return "image/png";
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".svg") return "image/svg+xml";
  return "application/octet-stream";
}

async function startServer(root, segments) {
  const rootPath = path.resolve(root);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/__player") {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(playerHtml(segments));
        return;
      }
      if (!url.pathname.startsWith("/asset/")) {
        response.writeHead(404).end("not found");
        return;
      }
      const relativePath = decodeURIComponent(url.pathname.slice("/asset/".length));
      const absolutePath = path.resolve(rootPath, relativePath);
      if (absolutePath !== rootPath && !absolutePath.startsWith(rootPath + path.sep)) {
        response.writeHead(403).end("forbidden");
        return;
      }
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) throw new Error("not a file");
      const extension = path.extname(absolutePath).toLowerCase();
      if ([".md", ".json", ".jsonl", ".log", ".txt"].includes(extension)) {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        response.end(textHtml(relativePath, await readFile(absolutePath, "utf8")));
      } else {
        response.writeHead(200, { "content-type": contentType(absolutePath), "cache-control": "no-store" });
        response.end(await readFile(absolutePath));
      }
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("recording server failed to bind");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function runProcess(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`${path.basename(command)} terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`${path.basename(command)} exited with ${code}\n${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

function srtTime(milliseconds) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor((value % 3_600_000) / 60_000);
  const seconds = Math.floor((value % 60_000) / 1000);
  const ms = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function chapterSubtitles(timeline, speedFactor) {
  const groups = new Map();
  for (const item of timeline) {
    const current = groups.get(item.chapter) ?? { start_ms: item.start_ms, end_ms: item.end_ms, title: item.title, skill: item.skill };
    current.end_ms = item.end_ms;
    groups.set(item.chapter, current);
  }
  return [...groups.entries()].map(([chapter, item], index) => `${index + 1}\n${srtTime(item.start_ms * speedFactor)} --> ${srtTime(item.end_ms * speedFactor)}\n第 ${chapter} 章｜${item.skill}\n${item.title}\n`).join("\n");
}

async function probeVideo(ffprobe, file) {
  const result = await runProcess(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  return JSON.parse(result.stdout);
}

export function sanitizeProbeForEvidence(probe) {
  const filename = probe?.format?.filename;
  if (typeof filename !== "string") return probe;
  return {
    ...probe,
    format: {
      ...probe.format,
      filename: path.posix.basename(filename.replaceAll("\\", "/")),
    },
  };
}

export async function recordDemoVideo({ root, outputDir, ffmpeg, ffprobe }) {
  const segments = recordingSegments();
  for (const item of segments) await stat(path.join(root, item.path));
  await mkdir(outputDir, { recursive: true });
  const workingDir = path.join(outputDir, ".recording");
  await rm(workingDir, { recursive: true, force: true });
  await mkdir(workingDir, { recursive: true });
  const { chromium } = await import("playwright");
  const { server, origin } = await startServer(root, segments);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: workingDir, size: { width: 1920, height: 1080 } } });
  const page = await context.newPage();
  const video = page.video();
  const timeline = [];
  const recordingStarted = Date.now();
  try {
    await page.goto(`${origin}/__player`, { waitUntil: "load" });
    const next = page.getByTestId("next");
    for (let index = 0; index < segments.length; index += 1) {
      const box = await next.boundingBox();
      if (!box) throw new Error("recording next button is not visible");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction((expected) => window.currentIndex === expected && window.assetLoaded === true, index);
      const item = segments[index];
      const startMs = Date.now() - recordingStarted;
      if (item.scroll) {
        const assetFrame = page.frames().find((frame) => frame.name() === "asset");
        if (assetFrame) {
          await page.waitForTimeout(Math.max(900, Math.floor(item.durationMs * 0.25)));
          await assetFrame.evaluate(() => window.scrollTo({ top: Math.floor(document.documentElement.scrollHeight * 0.52), behavior: "smooth" }));
          await page.waitForTimeout(Math.max(900, Math.floor(item.durationMs * 0.35)));
          await assetFrame.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" }));
          await page.waitForTimeout(Math.max(800, Math.floor(item.durationMs * 0.40)));
        } else {
          await page.waitForTimeout(item.durationMs);
        }
      } else {
        await page.waitForTimeout(item.durationMs);
      }
      timeline.push({ ...item, start_ms: startMs, end_ms: Date.now() - recordingStarted });
    }
  } finally {
    await page.close();
    await context.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }

  const recordedWebm = await video.path();
  const preservedWebm = path.join(workingDir, "完整连续浏览器录制.webm");
  await copyFile(recordedWebm, preservedWebm);
  const rawMp4 = path.join(outputDir, "完整未剪辑录屏_Raw-Full-Session.mp4");
  await runProcess(ffmpeg, ["-y", "-i", preservedWebm, "-vf", "scale=1920:1080:flags=lanczos,fps=30", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", rawMp4]);

  const speedFactor = 0.82;
  const srt = chapterSubtitles(timeline, speedFactor);
  const subtitlePath = path.join(outputDir, "字幕_Subtitles.srt");
  const asciiSubtitlePath = path.join(outputDir, "edited-subtitles.srt");
  await writeFile(subtitlePath, srt, "utf8");
  await writeFile(asciiSubtitlePath, srt, "utf8");
  const editedMp4 = path.join(outputDir, "20分钟精剪版_Edited-Demo.mp4");
  await runProcess(ffmpeg, [
    "-y", "-i", rawMp4, "-i", asciiSubtitlePath,
    "-filter:v", `setpts=${speedFactor}*PTS,fps=30`,
    "-map", "0:v:0", "-map", "1:0", "-an",
    "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
    "-c:s", "mov_text", "-metadata:s:s:0", "language=zho", "-disposition:s:0", "default",
    "-movflags", "+faststart", editedMp4,
  ], { cwd: outputDir });

  const rawProbe = await probeVideo(ffprobe, rawMp4);
  const editedProbe = await probeVideo(ffprobe, editedMp4);
  const inspection = {
    generated_at: new Date().toISOString(),
    raw: sanitizeProbeForEvidence(rawProbe),
    edited: sanitizeProbeForEvidence(editedProbe),
  };
  await writeFile(path.join(outputDir, "原始录屏检查.json"), `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
  await writeFile(path.join(outputDir, "recording-timeline.json"), `${JSON.stringify(timeline, null, 2)}\n`, "utf8");

  const timelineMarkdown = [
    "# SkillMart 八 Skill 视频时间点与剪辑清单",
    "",
    "原始版是一段连续浏览器录制，只做容器、分辨率和帧率统一，没有切段。精剪版从原始版整体加速至 82%，并加入默认中文字幕轨。",
    "",
    "| 章节 | 开始 | 结束 | 主 Skill | 画面 |",
    "|---|---:|---:|---|---|",
    ...timeline.map((item) => `| ${item.chapter} | ${srtTime(item.start_ms)} | ${srtTime(item.end_ms)} | ${item.skill} | ${item.title} |`),
    "",
  ].join("\n");
  await writeFile(path.join(outputDir, "时间点与剪辑清单_Timeline.md"), timelineMarkdown, "utf8");
  return { rawMp4, editedMp4, subtitlePath, timeline, inspection };
}

async function main() {
  const value = (name) => {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
  };
  const root = path.resolve(value("--root") ?? path.join(process.cwd(), "build", "skillmart-demo"));
  const outputDir = path.resolve(value("--output-dir") ?? path.join(root, "10-视频_Video"));
  const ffmpeg = value("--ffmpeg");
  const ffprobe = value("--ffprobe");
  if (!ffmpeg || !ffprobe) throw new Error("必须提供 --ffmpeg 和 --ffprobe");
  const result = await recordDemoVideo({ root, outputDir, ffmpeg: path.resolve(ffmpeg), ffprobe: path.resolve(ffprobe) });
  console.log(JSON.stringify({ rawMp4: result.rawMp4, editedMp4: result.editedMp4, segments: result.timeline.length }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
