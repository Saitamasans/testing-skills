import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const manifestPath = fileURLToPath(new URL("./desktop-recording-manifest.json", import.meta.url));

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited ${code}\n${stdout}\n${stderr}`));
    });
  });
}

function defaultFfprobePath(ffmpeg) {
  const extension = path.extname(ffmpeg);
  return path.join(path.dirname(ffmpeg), `ffprobe${extension}`);
}

async function probeVideo(ffprobe, outputPath) {
  const { stdout } = await runProcess(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height,avg_frame_rate,r_frame_rate",
    "-of", "json",
    outputPath,
  ]);
  const parsed = JSON.parse(stdout);
  const stream = parsed.streams?.[0];
  if (!stream) throw new Error("FFprobe 未返回视频流");
  return {
    codec_name: String(stream.codec_name ?? ""),
    width: Number(stream.width),
    height: Number(stream.height),
    avg_frame_rate: String(stream.avg_frame_rate ?? ""),
    r_frame_rate: String(stream.r_frame_rate ?? ""),
  };
}

export async function loadDesktopRecordingManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

export async function recordDesktopCapture({ ffmpeg, ffprobe = defaultFfprobePath(ffmpeg), outputDir, durationSeconds = 5, source }) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "完整未剪辑桌面录屏_Raw-Desktop-Session.mp4");
  const captureSource = source ?? manifest.capture.source;
  const startedAt = new Date().toISOString();
  const input = captureSource === "desktop" ? "desktop" : captureSource;
  const args = [
    "-y",
    "-f", "gdigrab",
    "-framerate", String(manifest.capture.fps),
    "-draw_mouse", manifest.capture.draw_mouse ? "1" : "0",
    "-i", input,
    "-t", String(durationSeconds),
    "-vf", `scale=${manifest.capture.width}:${manifest.capture.height}:flags=lanczos,fps=${manifest.capture.fps}`,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];
  await runProcess(ffmpeg, args);
  const metadata = await stat(outputPath);
  const videoProbe = await probeVideo(ffprobe, outputPath);
  const inspection = {
    schema_version: 1,
    source: captureSource,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    duration_seconds: durationSeconds,
    width: manifest.capture.width,
    height: manifest.capture.height,
    fps: manifest.capture.fps,
    video_probe: videoProbe,
    audio: manifest.capture.audio,
    output_file: path.basename(outputPath),
    size_bytes: metadata.size,
    manifest_sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  };
  await writeFile(path.join(outputDir, "录制检查_Recording-Inspection.json"), `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
  return { outputPath, inspection };
}

export async function recordDesktopCaptureUntilStop({ ffmpeg, ffprobe = defaultFfprobePath(ffmpeg), outputDir, stopFile, maxSeconds = 7200, source }) {
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  await mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, "完整未剪辑桌面录屏_Raw-Desktop-Session.mp4");
  const captureSource = source ?? manifest.capture.source;
  const startedAt = new Date().toISOString();
  const args = [
    "-y",
    "-f", "gdigrab",
    "-framerate", String(manifest.capture.fps),
    "-draw_mouse", manifest.capture.draw_mouse ? "1" : "0",
    "-i", captureSource,
    "-vf", `scale=${manifest.capture.width}:${manifest.capture.height}:flags=lanczos,fps=${manifest.capture.fps}`,
    "-an",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-crf", "18",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputPath,
  ];
  const child = spawn(ffmpeg, args, { stdio: ["pipe", "ignore", "pipe"], windowsHide: true });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-200_000);
  });
  const closed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(undefined);
      else reject(new Error(`ffmpeg exited ${code}\n${stderr}`));
    });
  });
  const stopPath = path.resolve(stopFile);
  const deadline = Date.now() + maxSeconds * 1000;
  let stopReason = "marker";
  while (true) {
    try {
      await access(stopPath);
      break;
    } catch {
      if (Date.now() >= deadline) {
        stopReason = "max_seconds";
        break;
      }
      await delay(500);
    }
  }
  child.stdin.write("q\n");
  child.stdin.end();
  await closed;
  const metadata = await stat(outputPath);
  const videoProbe = await probeVideo(ffprobe, outputPath);
  const completedAt = new Date().toISOString();
  const inspection = {
    schema_version: 1,
    source: captureSource,
    started_at: startedAt,
    completed_at: completedAt,
    duration_seconds: Math.max(0, (Date.parse(completedAt) - Date.parse(startedAt)) / 1000),
    width: manifest.capture.width,
    height: manifest.capture.height,
    fps: manifest.capture.fps,
    video_probe: videoProbe,
    audio: manifest.capture.audio,
    stop_reason: stopReason,
    stop_file: path.basename(stopPath),
    output_file: path.basename(outputPath),
    size_bytes: metadata.size,
    manifest_sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  };
  await writeFile(path.join(outputDir, "录制检查_Recording-Inspection.json"), `${JSON.stringify(inspection, null, 2)}\n`, "utf8");
  return { outputPath, inspection };
}

async function main() {
  const ffmpeg = path.resolve(argValue("--ffmpeg", ""));
  const ffprobeArg = argValue("--ffprobe", "");
  const ffprobe = ffprobeArg ? path.resolve(ffprobeArg) : defaultFfprobePath(ffmpeg);
  const outputDir = path.resolve(argValue("--output-dir", path.join(process.cwd(), "build", "skillmart-demo", "11-真实桌面录制_Real-Desktop-Recording")));
  const durationSeconds = Number(argValue("--smoke-seconds", "5"));
  const stopFile = argValue("--stop-file", "");
  const maxSeconds = Number(argValue("--max-seconds", "7200"));
  const source = argValue("--source", undefined);
  if (!ffmpeg) throw new Error("必须提供 --ffmpeg");
  if (stopFile && (!Number.isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > 14400)) throw new Error("--max-seconds 必须在 1 到 14400 之间");
  if (!stopFile && (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 30)) throw new Error("--smoke-seconds 必须在 1 到 30 之间");
  const result = stopFile
    ? await recordDesktopCaptureUntilStop({ ffmpeg, ffprobe, outputDir, stopFile, maxSeconds, source })
    : await recordDesktopCapture({ ffmpeg, ffprobe, outputDir, durationSeconds, source });
  console.log(JSON.stringify({ outputPath: result.outputPath, inspection: result.inspection }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
