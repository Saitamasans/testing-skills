import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAW_VIDEO = "完整未剪辑桌面录屏_Raw-Desktop-Session.mp4";
const EDITED_VIDEO = "第八个Skill教程_8th-Skill-Tutorial-Edited.mp4";
const NAVIGATION = "验收导航_Acceptance-Navigation.html";
const VERIFICATION = "视频校验_Video-Verification.json";
const EVIDENCE_INDEX = "证据索引_Evidence-Index.json";

function issue(code, target, message) {
  return { code, target, message };
}

function videoStream(probe) {
  return probe?.streams?.find((stream) => stream.codec_type === "video");
}

function durationSeconds(probe) {
  return Number(probe?.format?.duration ?? 0);
}

function validateOneVideo(target, probe) {
  const issues = [];
  const stream = videoStream(probe);
  if (!stream || stream.codec_name !== "h264") {
    issues.push(issue("video_codec_invalid", target, "视频编码必须为 H.264。"));
  }
  if (!stream || stream.width !== 1920 || stream.height !== 1080) {
    issues.push(issue("video_resolution_invalid", target, "视频分辨率必须为 1920x1080。"));
  }
  if (!stream || stream.avg_frame_rate !== "60/1" || stream.r_frame_rate !== "60/1") {
    issues.push(issue("video_frame_rate_invalid", target, "平均帧率和标称帧率必须均为 60/1。"));
  }
  if (!(durationSeconds(probe) > 0)) {
    issues.push(issue("video_duration_invalid", target, "视频时长必须大于 0 秒。"));
  }
  return issues;
}

export function validateTutorialVideoProbes(rawProbe, editedProbe) {
  const issues = [
    ...validateOneVideo("raw", rawProbe),
    ...validateOneVideo("edited", editedProbe),
  ];
  if (durationSeconds(editedProbe) > 1200) {
    issues.push(issue("edited_duration_exceeds_limit", "edited", "教程版时长必须在 20 分钟以内。"));
  }
  return issues;
}

async function runProcess(executable, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(executable)} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function probeVideo(ffprobe, file) {
  const result = await runProcess(ffprobe, [
    "-v", "error",
    "-show_streams",
    "-show_format",
    "-of", "json",
    file,
  ]);
  return JSON.parse(result.stdout);
}

async function decodeVideo(ffmpeg, file) {
  await runProcess(ffmpeg, ["-v", "error", "-i", file, "-map", "0:v:0", "-f", "null", "-"]);
  return true;
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

function localHtmlReferences(html) {
  const references = [];
  const pattern = /\b(?:href|src)\s*=\s*["']([^"']+)["']/gi;
  for (const match of html.matchAll(pattern)) {
    const reference = match[1]?.trim();
    if (!reference || reference.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(reference)) continue;
    references.push(reference);
  }
  return [...new Set(references)];
}

async function verifyNavigationLinks(tutorialDir) {
  const navigationPath = path.join(tutorialDir, NAVIGATION);
  const html = await readFile(navigationPath, "utf8");
  const links = [];
  for (const reference of localHtmlReferences(html)) {
    const pathOnly = decodeURIComponent(reference.split("#", 1)[0].split("?", 1)[0]);
    const absolute = path.resolve(path.dirname(navigationPath), pathOnly);
    try {
      const metadata = await stat(absolute);
      links.push({ reference, exists: true, type: metadata.isDirectory() ? "directory" : "file" });
    } catch {
      links.push({ reference, exists: false, type: "missing" });
    }
  }
  return links;
}

export function validateTutorialNavigationLinks(links) {
  return links
    .filter((link) => !link.exists && link.reference !== EVIDENCE_INDEX)
    .map((link) => issue("navigation_link_missing", link.reference, "验收导航引用的本地文件不存在。"));
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function artifactCounts(files) {
  const normalized = files.map((file) => file.replaceAll("\\", "/"));
  return {
    files: normalized.length,
    web_png: normalized.filter((file) => file.endsWith("/web-page.png")).length,
    api_request_response: normalized.filter((file) => file.endsWith("/api-request-response.json")).length,
    api_assertion: normalized.filter((file) => file.endsWith("/api-assertion.json")).length,
    trace: normalized.filter((file) => file.endsWith("/playwright-trace.zip")).length,
    excel: normalized.filter((file) => file.endsWith(".xlsx")).length,
    html: normalized.filter((file) => file.endsWith(".html")).length,
  };
}

export async function finalizeEighthSkillTutorial({ tutorialDir, ffmpeg, ffprobe }) {
  const rawPath = path.join(tutorialDir, RAW_VIDEO);
  const editedPath = path.join(tutorialDir, EDITED_VIDEO);
  const [rawProbe, editedProbe] = await Promise.all([
    probeVideo(ffprobe, rawPath),
    probeVideo(ffprobe, editedPath),
  ]);
  const issues = validateTutorialVideoProbes(rawProbe, editedProbe);

  let rawDecoded = false;
  let editedDecoded = false;
  try {
    [rawDecoded, editedDecoded] = await Promise.all([
      decodeVideo(ffmpeg, rawPath),
      decodeVideo(ffmpeg, editedPath),
    ]);
  } catch (error) {
    issues.push(issue("video_decode_failed", "video", error instanceof Error ? error.message : String(error)));
  }

  const links = await verifyNavigationLinks(tutorialDir);
  const navigationIssues = validateTutorialNavigationLinks(links);
  issues.push(...navigationIssues);

  const filesBeforeVerification = await walkFiles(tutorialDir);
  const verification = {
    generated_at: new Date().toISOString(),
    status: issues.length === 0 ? "passed" : "failed",
    requirements: {
      codec: "h264",
      width: 1920,
      height: 1080,
      frame_rate: "60/1",
      edited_max_duration_seconds: 1200,
      full_decode_required: true,
    },
    raw: { file: RAW_VIDEO, duration_seconds: durationSeconds(rawProbe), decoded: rawDecoded, probe: rawProbe },
    edited: { file: EDITED_VIDEO, duration_seconds: durationSeconds(editedProbe), decoded: editedDecoded, probe: editedProbe },
    navigation: {
      file: NAVIGATION,
      checked_links: links.length,
      planned_outputs: links.filter((item) => !item.exists && item.reference === EVIDENCE_INDEX).map((item) => item.reference),
      missing_links: navigationIssues.map((item) => item.target),
      links,
    },
    artifacts: artifactCounts(filesBeforeVerification),
    issues,
  };
  await writeFile(path.join(tutorialDir, VERIFICATION), `${JSON.stringify(verification, null, 2)}\n`, "utf8");
  if (issues.length > 0) throw new Error(`Tutorial verification failed with ${issues.length} issue(s)`);

  const indexEntries = [];
  for (const file of await walkFiles(tutorialDir)) {
    if (path.basename(file) === EVIDENCE_INDEX) continue;
    const metadata = await stat(file);
    indexEntries.push({
      path: path.relative(tutorialDir, file).replaceAll("\\", "/"),
      size: metadata.size,
      sha256: await sha256(file),
    });
  }
  indexEntries.sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
  const evidenceIndex = {
    generated_at: new Date().toISOString(),
    algorithm: "SHA-256",
    verification: VERIFICATION,
    files: indexEntries,
  };
  await writeFile(path.join(tutorialDir, EVIDENCE_INDEX), `${JSON.stringify(evidenceIndex, null, 2)}\n`, "utf8");
  return { verification, evidenceIndex };
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const tutorialDir = argValue("--tutorial-dir");
  const ffmpeg = argValue("--ffmpeg");
  const ffprobe = argValue("--ffprobe");
  if (!tutorialDir || !ffmpeg || !ffprobe) {
    throw new Error("Usage: finalize-eighth-skill-tutorial.mjs --tutorial-dir <dir> --ffmpeg <path> --ffprobe <path>");
  }
  const result = await finalizeEighthSkillTutorial({
    tutorialDir: path.resolve(tutorialDir),
    ffmpeg: path.resolve(ffmpeg),
    ffprobe: path.resolve(ffprobe),
  });
  console.log(JSON.stringify({
    status: result.verification.status,
    files: result.evidenceIndex.files.length,
    raw_duration_seconds: result.verification.raw.duration_seconds,
    edited_duration_seconds: result.verification.edited.duration_seconds,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
