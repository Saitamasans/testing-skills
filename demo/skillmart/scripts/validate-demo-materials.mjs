import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const phaseOrder = ["skeleton", "skills", "execution", "video"];
const skillFolders = [
  "01-需求澄清_Requirement-Clarification",
  "02-需求工作台_Requirement-Workbench",
  "03-单接口完整版_Single-API-Full",
  "04-单接口精炼版_Single-API-Concise",
  "05-多接口链路_Multi-API-Flow",
  "06-正式服验证_Production-Verification",
  "07-测试用例审计_Test-Case-Audit",
  "08-自动执行与证据_Automated-Execution-Evidence",
];
const formalGeneratorFolders = skillFolders.slice(1, 6);
const executionSuites = [
  { name: "requirementWorkbench", caseCount: 18, requiresWebEvidence: true },
  { name: "singleApiFull", caseCount: 20 },
  { name: "singleApiConcise", caseCount: 7 },
  { name: "multiApiFlow", caseCount: 12 },
  { name: "productionVerification", caseCount: 5 },
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function filesIn(dirPath) {
  if (!await exists(dirPath)) return [];
  return (await readdir(dirPath, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
}

function issue(code, target, message) {
  return { code, target, message };
}

export function validateRecordingInspection(inspection) {
  const issues = [];
  const probe = inspection?.video_probe;
  if (!probe || probe.width !== 1920 || probe.height !== 1080) {
    issues.push(issue("recording_resolution_invalid", "video_probe", "FFprobe 分辨率必须为 1920x1080。"));
  }
  if (!probe || probe.codec_name !== "h264") {
    issues.push(issue("recording_codec_invalid", "video_probe", "FFprobe 视频编码必须为 H.264。"));
  }
  if (!probe || probe.avg_frame_rate !== "60/1" || probe.r_frame_rate !== "60/1") {
    issues.push(issue("recording_frame_rate_invalid", "video_probe", "FFprobe 平均帧率和标称帧率必须均为 60/1。"));
  }
  return issues;
}

async function validateSkeleton(root) {
  const issues = [];
  for (const folder of ["00-演示导航与视频材料", ...skillFolders]) {
    if (!await exists(path.join(root, folder))) {
      issues.push(issue("missing_skeleton_folder", folder, `缺少演示骨架目录：${folder}`));
    }
  }
  if (!await exists(path.join(root, "material-index.json"))) {
    issues.push(issue("missing_material_index", "material-index.json", "缺少材料索引。"));
  }
  return issues;
}

async function validateSkills(root) {
  const issues = [];
  for (const folder of skillFolders.slice(0, 7)) {
    const outputDir = path.join(root, folder, "03-完整输出");
    const outputFiles = await filesIn(outputDir);
    const realOutputs = outputFiles.filter((name) => name.toLowerCase() !== "readme.md" && name.toLowerCase().endsWith(".md"));
    let placeholder = realOutputs.length === 0;
    for (const name of realOutputs) {
      const content = await readFile(path.join(outputDir, name), "utf8");
      if (/演示素材骨架|真实录制时|占位/.test(content)) placeholder = true;
    }
    if (placeholder) {
      issues.push(issue("placeholder_skill_output", folder, "完整输出仍是骨架或占位内容。"));
    }
    if (!await exists(path.join(root, folder, "06-验证记录", "invocation.json"))) {
      issues.push(issue("missing_invocation_record", folder, "缺少真实 Skill 调用记录 invocation.json。"));
    }
  }

  for (const folder of formalGeneratorFolders) {
    const generatedDir = path.join(root, folder, "04-生成文件");
    const generatedFiles = (await filesIn(generatedDir)).map((name) => name.toLowerCase());
    const missing = [".json", ".xlsx", ".html"].filter((extension) => !generatedFiles.some((name) => name.endsWith(extension)));
    if (missing.length > 0) {
      issues.push(issue("missing_dual_delivery", folder, `缺少同源正式产物：${missing.join(", ")}`));
    }
  }
  return issues;
}

async function recursiveFiles(dirPath) {
  const files = [];
  async function walk(currentDir) {
    if (!await exists(currentDir)) return;
    for (const entry of await readdir(currentDir, { withFileTypes: true })) {
      const absolutePath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) await walk(absolutePath);
      else if (entry.isFile()) files.push(absolutePath);
    }
  }
  await walk(dirPath);
  return files;
}

export async function validateExecution(root) {
  const executionDir = path.join(root, skillFolders[7], "04-生成文件");
  const requiredNames = [
    "run-manifest.json",
    "approval.json",
    "run-result.json",
    "projected-report.json",
    "result.xlsx",
    "result.html",
    "evidence-index.json",
    "event-log.jsonl",
    "reset-before.json",
    "reset-after.json",
  ];
  const issues = [];

  for (const suite of executionSuites) {
    const suiteRoot = path.join(executionDir, suite.name);
    if (!await exists(suiteRoot)) {
      issues.push(issue("missing_execution_suite", suite.name, `缺少执行套件：${suite.name}`));
      continue;
    }

    const resultDir = path.join(suiteRoot, ".testing-run", "result");
    const topLevelNames = (await filesIn(resultDir)).map((name) => name.toLowerCase());
    const missing = requiredNames.filter((name) => !topLevelNames.includes(name));
    if (missing.length > 0) {
      issues.push(issue(
        "incomplete_execution_suite",
        suite.name,
        `执行套件缺少证据：${missing.join(", ")}`,
      ));
    }

    const runResultPath = path.join(resultDir, "run-result.json");
    if (await exists(runResultPath)) {
      try {
        const runResult = JSON.parse(await readFile(runResultPath, "utf8"));
        if (!Array.isArray(runResult.cases) || runResult.cases.length !== suite.caseCount) {
          issues.push(issue(
            "execution_case_count_mismatch",
            suite.name,
            `测试用例（Test Cases）数量应为 ${suite.caseCount}。`,
          ));
        }
      } catch {
        issues.push(issue("invalid_execution_result", suite.name, "run-result.json 不是有效 JSON。"));
      }
    }

    const evidenceFiles = await recursiveFiles(path.join(resultDir, "evidence"));
    if (evidenceFiles.length === 0) {
      issues.push(issue("missing_execution_evidence", suite.name, "证据目录为空。"));
    }
    if (suite.requiresWebEvidence) {
      if (!evidenceFiles.some((file) => file.toLowerCase().endsWith(".png"))) {
        issues.push(issue("missing_web_png", suite.name, "Web 执行缺少独立 PNG。"));
      }
      if (!evidenceFiles.some((file) => file.toLowerCase().endsWith(".zip"))) {
        issues.push(issue("missing_playwright_trace", suite.name, "Web 执行缺少 Playwright Trace。"));
      }
    }
  }
  return issues;
}

async function validateVideo(root) {
  const videoDir = path.join(root, "10-视频_Video");
  const required = [
    "完整未剪辑录屏_Raw-Full-Session.mp4",
    "20分钟精剪版_Edited-Demo.mp4",
    "字幕_Subtitles.srt",
    "时间点与剪辑清单_Timeline.md",
  ];
  const missing = [];
  for (const name of required) {
    if (!await exists(path.join(videoDir, name))) missing.push(name);
  }
  return missing.length === 0
    ? []
    : [issue("missing_video_artifacts", "10-视频_Video", `缺少视频交付：${missing.join(", ")}`)];
}

export async function validateDemoMaterials({ root, phase }) {
  if (!phaseOrder.includes(phase)) throw new Error(`不支持的校验阶段：${phase}`);
  const issues = await validateSkeleton(root);
  if (phaseOrder.indexOf(phase) >= phaseOrder.indexOf("skills")) issues.push(...await validateSkills(root));
  if (phaseOrder.indexOf(phase) >= phaseOrder.indexOf("execution")) issues.push(...await validateExecution(root));
  if (phaseOrder.indexOf(phase) >= phaseOrder.indexOf("video")) issues.push(...await validateVideo(root));
  return { valid: issues.length === 0, phase, root, issues };
}

async function main() {
  const root = path.resolve(argValue("--root", path.join(process.cwd(), "build", "skillmart-demo")));
  const phase = argValue("--phase", "skeleton");
  const result = await validateDemoMaterials({ root, phase });
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else if (result.valid) {
    console.log(`SkillMart ${phase} 材料门禁通过：${root}`);
  } else {
    console.error(`SkillMart ${phase} 材料门禁不通过，共 ${result.issues.length} 项。`);
    for (const item of result.issues) console.error(`- [${item.code}] ${item.target}: ${item.message}`);
  }
  if (!result.valid) process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
