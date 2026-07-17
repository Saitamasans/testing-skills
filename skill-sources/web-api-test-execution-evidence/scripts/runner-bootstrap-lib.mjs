import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { gunzip } from "node:zlib";

const PACKAGE_NAME = "@saitamasans/testing-runner";
const RELEASE_HOST = "github.com";
const RELEASE_PATH_PREFIX = "/Saitamasans/testing-skills/releases/download/testing-runner-v";
const DEFAULT_LOCK_RETRY_MS = 100;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;
const STALE_LOCK_MS = 10 * 60 * 1000;
const gunzipAsync = promisify(gunzip);
const RUNTIME_ENV_ALLOWLIST = new Set([
  "ALL_PROXY",
  "APPDATA",
  "CI",
  "COMSPEC",
  "HOME",
  "HTTPS_PROXY",
  "HTTP_PROXY",
  "LANG",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "OS",
  "PATH",
  "PATHEXT",
  "PLAYWRIGHT_BROWSERS_PATH",
  "PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT",
  "PROCESSOR_ARCHITECTURE",
  "PROGRAMDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
]);

export class BootstrapError extends Error {
  constructor(code, message) {
    super(code + ": " + message);
    this.name = "BootstrapError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new BootstrapError(code, message);
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("bootstrap_manifest_invalid", label + " must be an object");
  }
  return value;
}

export function validateReleaseManifest(value) {
  const root = requireObject(value, "manifest");
  const runner = requireObject(root.runner, "runner");
  const browser = requireObject(root.browser, "browser");

  if (root.schema_version !== 1) {
    fail("bootstrap_manifest_invalid", "schema_version must be 1");
  }
  if (runner.name !== PACKAGE_NAME) {
    fail("bootstrap_manifest_invalid", "runner.name must be " + PACKAGE_NAME);
  }
  if (runner.version !== "1.1.0") {
    fail("bootstrap_manifest_invalid", "runner.version must be 1.1.0");
  }
  if (!/^[a-f0-9]{64}$/.test(String(runner.sha256 ?? ""))) {
    fail("bootstrap_manifest_invalid", "runner.sha256 must be 64 lowercase hexadecimal characters");
  }
  if (!Number.isSafeInteger(runner.size_bytes) || runner.size_bytes <= 0) {
    fail("bootstrap_manifest_invalid", "runner.size_bytes must be a positive integer");
  }
  if (!Number.isSafeInteger(runner.minimum_node) || runner.minimum_node < 20) {
    fail("bootstrap_manifest_invalid", "runner.minimum_node must be at least 20");
  }

  let releaseUrl;
  try {
    releaseUrl = new URL(runner.download_url);
  } catch {
    fail("bootstrap_manifest_invalid", "runner.download_url must be a valid URL");
  }
  const expectedAsset = "saitamasans-testing-runner-" + runner.version + ".tgz";
  if (
    releaseUrl.protocol !== "https:"
    || releaseUrl.hostname !== RELEASE_HOST
    || !releaseUrl.pathname.startsWith(RELEASE_PATH_PREFIX + runner.version + "/")
    || path.posix.basename(releaseUrl.pathname) !== expectedAsset
  ) {
    fail("bootstrap_manifest_invalid", "runner.download_url must be the fixed project GitHub Release asset");
  }
  if (browser.provider !== "playwright" || browser.name !== "chromium") {
    fail("bootstrap_manifest_invalid", "browser must be Playwright Chromium");
  }
  if (!Number.isSafeInteger(browser.estimated_size_bytes) || browser.estimated_size_bytes <= 0) {
    fail("bootstrap_manifest_invalid", "browser.estimated_size_bytes must be a positive integer");
  }

  return {
    schema_version: 1,
    runner: {
      name: PACKAGE_NAME,
      version: runner.version,
      download_url: releaseUrl.href,
      sha256: runner.sha256,
      size_bytes: runner.size_bytes,
      minimum_node: runner.minimum_node,
    },
    browser: {
      provider: "playwright",
      name: "chromium",
      estimated_size_bytes: browser.estimated_size_bytes,
    },
  };
}

function packageDirectoryName(name) {
  return name.replace("/", path.sep);
}

export function resolveRuntimePaths(manifestValue, env = process.env) {
  const manifest = validateReleaseManifest(manifestValue);
  const userHome = env.USERPROFILE || env.HOME || os.homedir();
  const root = path.resolve(env.TESTING_SKILLS_HOME || path.join(userHome, ".testing-skills"));
  const runtimeDir = path.join(root, "runtime", "testing-runner", manifest.runner.version);
  const archiveName = path.posix.basename(new URL(manifest.runner.download_url).pathname);
  const archivePath = path.join(root, "downloads", archiveName);
  return {
    root,
    runtimeDir,
    archivePath,
    readyPath: path.join(runtimeDir, "runtime-ready.json"),
    lockPath: runtimeDir + ".lock",
    cliPath: path.join(runtimeDir, "package", "dist", "cli.js"),
  };
}

function formatMegabytes(bytes) {
  return Math.ceil(bytes / 1024 / 1024) + " MB";
}

export function renderBootstrapNotice(manifestValue, paths) {
  const manifest = validateReleaseManifest(manifestValue);
  return [
    "第八个 Skill 首次运行需要自动准备执行环境。",
    "- Runner " + manifest.runner.version + " 与锁定依赖：项目 GitHub Release（约 " + formatMegabytes(manifest.runner.size_bytes) + "）",
    "- 浏览器组件：Playwright Chromium（按 Web 动作或交互可视执行需要下载，约 " + formatMegabytes(manifest.browser.estimated_size_bytes) + "）",
    "- 缓存位置：" + paths.runtimeDir,
    "- 无需 npm 账号，也不需要手动输入 Runner 安装命令；下载完成后将复用缓存。",
  ].join("\n");
}

function manifestDigest(manifest) {
  return createHash("sha256")
    .update(JSON.stringify(validateReleaseManifest(manifest)))
    .digest("hex");
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readReady(paths, digest, releaseSha) {
  try {
    const ready = JSON.parse(await readFile(paths.readyPath, "utf8"));
    return ready.manifest_sha256 === digest
      && ready.release_sha256 === releaseSha
      && await fileExists(paths.cliPath);
  } catch {
    return false;
  }
}

function sanitizedRuntimeEnv(env) {
  const output = {};
  for (const [key, value] of Object.entries(env)) {
    const normalized = key.toUpperCase();
    if (RUNTIME_ENV_ALLOWLIST.has(normalized) || normalized.startsWith("LC_")) {
      output[key] = value;
    }
  }
  return output;
}

function sanitizedBrowserInstallEnv(env) {
  return sanitizedRuntimeEnv(env);
}

export async function defaultRunProcess(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.stdio ?? "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error("process terminated by " + signal));
      else resolve(code ?? 1);
    });
  });
}

async function sha256File(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

async function downloadResponseToFile(response, file, expectedSize, log) {
  if (!response?.body || typeof response.body.getReader !== "function") {
    fail("bootstrap_network_failed", "GitHub Release response has no readable body");
  }
  const handle = await open(file, "wx");
  const reader = response.body.getReader();
  let received = 0;
  let lastReported = 0;
  log("Runner 下载进度：0%");
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (received + value.byteLength > expectedSize) {
        try {
          await reader.cancel("download exceeds release manifest size");
        } catch {
          // Preserve the integrity failure as the primary error.
        }
        fail("bootstrap_integrity_failed", "downloaded Runner exceeds release manifest size");
      }
      let offset = 0;
      while (offset < value.byteLength) {
        const { bytesWritten } = await handle.write(
          value,
          offset,
          value.byteLength - offset,
          null,
        );
        offset += bytesWritten;
      }
      received += value.byteLength;
      const percent = Math.min(100, Math.floor(received * 100 / expectedSize));
      if (percent === 100 || percent >= lastReported + 10) {
        lastReported = percent;
        log("Runner 下载进度：" + percent + "%");
      }
    }
  } finally {
    reader.releaseLock();
    await handle.close();
  }
  if (received === expectedSize && lastReported < 100) {
    log("Runner 下载进度：100%");
  }
  return received;
}

async function removeStaleLock(lockPath) {
  try {
    const info = await stat(lockPath);
    if (Date.now() - info.mtimeMs > STALE_LOCK_MS) {
      await rm(lockPath, { force: true });
    }
  } catch {
    // The lock disappeared between attempts.
  }
}

async function acquireRuntimeLock(paths, isReady, retryMs) {
  await mkdir(path.dirname(paths.lockPath), { recursive: true });
  while (true) {
    if (await isReady()) return null;
    try {
      const handle = await open(paths.lockPath, "wx");
      await handle.writeFile(String(process.pid) + "\n", "utf8");
      return async () => {
        await handle.close();
        await rm(paths.lockPath, { force: true });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await removeStaleLock(paths.lockPath);
      await new Promise((resolve) => setTimeout(resolve, retryMs));
    }
  }
}

function tarString(buffer, start, length) {
  const raw = buffer.subarray(start, start + length);
  const end = raw.indexOf(0);
  return raw.subarray(0, end < 0 ? raw.length : end).toString("utf8");
}

function tarOctal(buffer, start, length) {
  const value = tarString(buffer, start, length).trim().replace(/\0/g, "");
  if (value === "") return 0;
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    fail("bootstrap_integrity_failed", "Runner archive contains an invalid tar header");
  }
  return parsed;
}

function isZeroBlock(block) {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

function parsePax(data) {
  const text = data.toString("utf8");
  const output = {};
  let offset = 0;
  while (offset < text.length) {
    const space = text.indexOf(" ", offset);
    if (space < 0) break;
    const size = Number.parseInt(text.slice(offset, space), 10);
    if (!Number.isSafeInteger(size) || size <= 0) break;
    const record = text.slice(space + 1, offset + size - 1);
    const equals = record.indexOf("=");
    if (equals > 0) output[record.slice(0, equals)] = record.slice(equals + 1);
    offset += size;
  }
  return output;
}

function safePackagePath(entryName) {
  const normalized = entryName.replaceAll("\\", "/").replace(/^\.\/+/, "");
  if (
    normalized === ""
    || normalized.startsWith("/")
    || /^[A-Za-z]:/.test(normalized)
    || normalized.split("/").includes("..")
    || !normalized.startsWith("package/")
  ) {
    fail("bootstrap_integrity_failed", "Runner archive contains an unsafe path: " + entryName);
  }
  return normalized;
}

async function extractRunnerArchive(archivePath, installDir) {
  let archive;
  try {
    archive = await gunzipAsync(await readFile(archivePath));
  } catch (error) {
    fail("bootstrap_integrity_failed", "Runner archive is not a valid gzip file");
  }

  let offset = 0;
  let pendingPax = {};
  let pendingLongName;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (isZeroBlock(header)) break;

    const size = tarOctal(header, 124, 12);
    const typeFlag = tarString(header, 156, 1) || "0";
    const dataStart = offset;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) {
      fail("bootstrap_integrity_failed", "Runner archive entry exceeds archive size");
    }
    const data = archive.subarray(dataStart, dataEnd);
    offset += Math.ceil(size / 512) * 512;

    if (typeFlag === "x" || typeFlag === "g") {
      if (typeFlag === "x") pendingPax = parsePax(data);
      continue;
    }
    if (typeFlag === "L") {
      pendingLongName = data.toString("utf8").replace(/\0.*$/s, "");
      continue;
    }

    const prefix = tarString(header, 345, 155);
    const name = pendingLongName
      || pendingPax.path
      || (prefix ? prefix + "/" + tarString(header, 0, 100) : tarString(header, 0, 100));
    pendingPax = {};
    pendingLongName = undefined;

    const relative = safePackagePath(name);
    const target = path.resolve(installDir, relative);
    const installRoot = path.resolve(installDir);
    if (target !== installRoot && !target.startsWith(installRoot + path.sep)) {
      fail("bootstrap_integrity_failed", "Runner archive writes outside the runtime cache");
    }

    if (typeFlag === "5") {
      await mkdir(target, { recursive: true });
      continue;
    }
    if (typeFlag !== "0") {
      if (typeFlag === "1" || typeFlag === "2") {
        continue;
      }
      fail("bootstrap_integrity_failed", "Runner archive contains an unsupported tar entry type: " + typeFlag);
    }

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data, { flag: "wx" });
    const mode = tarOctal(header, 100, 8);
    if (mode) {
      await chmod(target, mode & 0o777).catch(() => undefined);
    }
  }

  if (!await fileExists(path.join(installDir, "package", "dist", "cli.js"))) {
    fail("bootstrap_install_failed", "Runner CLI is missing after archive extraction");
  }
}

export async function ensureRunnerRuntime(options) {
  const manifest = validateReleaseManifest(options.manifest);
  const env = options.env ?? process.env;
  const nodeMajor = Number.parseInt(process.versions.node.split(".")[0], 10);
  if (nodeMajor < manifest.runner.minimum_node) {
    fail("bootstrap_runtime_missing", "Node.js " + manifest.runner.minimum_node + "+ is required");
  }

  const paths = resolveRuntimePaths(manifest, env);
  const digest = manifestDigest(manifest);
  const isReady = () => readReady(paths, digest, manifest.runner.sha256);
  if (await isReady()) {
    return { cliPath: paths.cliPath, cacheHit: true, runtimeDir: paths.runtimeDir };
  }

  const releaseLock = await acquireRuntimeLock(
    paths,
    isReady,
    options.lockRetryMs ?? DEFAULT_LOCK_RETRY_MS,
  );
  if (!releaseLock) {
    return { cliPath: paths.cliPath, cacheHit: true, runtimeDir: paths.runtimeDir };
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const runProcess = options.runProcess ?? defaultRunProcess;
  const log = options.log ?? ((line) => console.error(line));
  const tempArchive = paths.archivePath + "." + randomUUID() + ".tmp";
  const installDir = paths.runtimeDir + ".install-" + randomUUID();

  try {
    if (await isReady()) {
      return { cliPath: paths.cliPath, cacheHit: true, runtimeDir: paths.runtimeDir };
    }

    log(renderBootstrapNotice(manifest, paths));
    await mkdir(path.dirname(paths.archivePath), { recursive: true });
    const downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
    let downloadedSize;
    const preferCurl = options.preferCurl ?? options.fetchImpl === undefined;
    if (preferCurl) {
      const curl = options.curlCommand ?? (process.platform === "win32" ? "curl.exe" : "curl");
      const downloadProcess = options.downloadProcess ?? defaultRunProcess;
      log("Runner 下载方式：系统 curl（自动调用，显示实时进度）。");
      try {
        const curlCode = await downloadProcess(
          curl,
          [
            "--location",
            "--fail",
            "--show-error",
            "--progress-bar",
            "--proto",
            "=https",
            "--tlsv1.2",
            "--max-time",
            String(Math.ceil(downloadTimeoutMs / 1000)),
            "--output",
            tempArchive,
            manifest.runner.download_url,
          ],
          {
            env: sanitizedRuntimeEnv(env),
            stdio: "inherit",
          },
        );
        if (curlCode !== 0) {
          fail("bootstrap_network_failed", "curl exited with code " + curlCode);
        }
        downloadedSize = (await stat(tempArchive)).size;
      } catch (error) {
        if (error instanceof BootstrapError) throw error;
        if (error?.code !== "ENOENT") {
          fail("bootstrap_network_failed", error instanceof Error ? error.message : String(error));
        }
        log("系统未找到 curl，改用 Node 流式下载。");
      }
    }
    if (downloadedSize === undefined) {
      let response;
      try {
        response = await fetchImpl(manifest.runner.download_url, {
          redirect: "follow",
          signal: AbortSignal.timeout(downloadTimeoutMs),
        });
      } catch (error) {
        fail("bootstrap_network_failed", error instanceof Error ? error.message : String(error));
      }
      if (!response?.ok) {
        fail("bootstrap_network_failed", "GitHub Release returned HTTP " + (response?.status ?? "unknown"));
      }
      try {
        downloadedSize = await downloadResponseToFile(
          response,
          tempArchive,
          manifest.runner.size_bytes,
          log,
        );
      } catch (error) {
        if (error instanceof BootstrapError) throw error;
        fail("bootstrap_network_failed", error instanceof Error ? error.message : String(error));
      }
    }
    if (downloadedSize !== manifest.runner.size_bytes) {
      fail("bootstrap_integrity_failed", "downloaded Runner size does not match release manifest");
    }
    const actualSha = await sha256File(tempArchive);
    if (actualSha !== manifest.runner.sha256) {
      fail("bootstrap_integrity_failed", "downloaded Runner SHA-256 does not match release manifest");
    }
    await rm(paths.archivePath, { force: true });
    await rename(tempArchive, paths.archivePath);

    await rm(installDir, { recursive: true, force: true });
    await mkdir(installDir, { recursive: true });
    await extractRunnerArchive(paths.archivePath, installDir);
    const ready = {
      schema_version: 1,
      manifest_sha256: digest,
      release_sha256: manifest.runner.sha256,
      installed_at: new Date().toISOString(),
    };
    const readyTemp = path.join(installDir, "runtime-ready.json.tmp");
    await writeFile(readyTemp, JSON.stringify(ready, null, 2) + "\n", "utf8");
    await rename(readyTemp, path.join(installDir, "runtime-ready.json"));
    await rm(paths.runtimeDir, { recursive: true, force: true });
    await mkdir(path.dirname(paths.runtimeDir), { recursive: true });
    await rename(installDir, paths.runtimeDir);
    return { cliPath: paths.cliPath, cacheHit: false, runtimeDir: paths.runtimeDir };
  } finally {
    await rm(tempArchive, { force: true });
    await rm(installDir, { recursive: true, force: true });
    await releaseLock();
  }
}

function commandOption(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) {
    fail("bootstrap_browser_manifest_missing", name + " is required for browser preparation");
  }
  return args[index + 1];
}

function commandOptionOr(args, name, fallback) {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function manifestHasWebActions(value) {
  if (!value || !Array.isArray(value.cases)) {
    fail("bootstrap_browser_manifest_invalid", "run manifest must contain cases");
  }
  return value.cases.some((item) =>
    Array.isArray(item?.steps)
    && item.steps.some((action) =>
      typeof action?.type === "string"
      && (action.type.startsWith("web.") || action.type === "cleanup.web")
    )
  );
}

async function defaultBrowserExecutablePath(packageRoot) {
  const playwrightModulePath = path.join(
    packageRoot,
    "node_modules",
    "playwright",
    "index.mjs",
  );
  try {
    const playwright = await import(pathToFileURL(playwrightModulePath).href);
    const executablePath = playwright.chromium?.executablePath?.();
    if (!executablePath) {
      fail("bootstrap_browser_install_failed", "Playwright did not provide a Chromium executable path");
    }
    return executablePath;
  } catch (error) {
    if (error instanceof BootstrapError) throw error;
    fail(
      "bootstrap_browser_install_failed",
      "cannot resolve bundled Playwright: " + (error instanceof Error ? error.message : String(error)),
    );
  }
}

export async function prepareBrowserForCommand(options) {
  const args = options.args ?? [];
  const discovery = args[0] === "discover-web";
  if (args[0] !== "run" && !discovery) {
    return { required: false, cacheHit: true };
  }

  let hasWebActions = discovery;
  if (!discovery) {
    const manifestPath = path.resolve(commandOption(args, "--manifest"));
    let runManifest;
    try {
      runManifest = JSON.parse(await readFile(manifestPath, "utf8"));
    } catch (error) {
      fail(
        "bootstrap_browser_manifest_invalid",
        error instanceof Error ? error.message : String(error),
      );
    }
    hasWebActions = manifestHasWebActions(runManifest);
  }
  const mode = commandOptionOr(args, "--mode", "interactive");
  const browser = commandOptionOr(args, "--browser", "auto");
  const progress = commandOptionOr(args, "--progress", "auto");
  const needsVisualDashboard = !hasWebActions
    && mode === "interactive"
    && browser !== "headless"
    && progress !== "off";
  if (!hasWebActions && !needsVisualDashboard) {
    return { required: false, cacheHit: true };
  }

  const packageRoot = path.dirname(path.dirname(path.resolve(options.cliPath)));
  const playwrightCli = path.join(packageRoot, "node_modules", "playwright", "cli.js");
  if (!await fileExists(playwrightCli)) {
    fail("bootstrap_browser_install_failed", "bundled Playwright CLI is missing");
  }

  const resolveExecutable = options.browserExecutablePath ?? defaultBrowserExecutablePath;
  const executablePath = await resolveExecutable(packageRoot);
  const log = options.log ?? ((line) => console.error(line));
  if (await fileExists(executablePath)) {
    log("Playwright Chromium 已就绪，复用本机浏览器缓存：" + executablePath);
    return { required: true, cacheHit: true, executablePath };
  }

  log(discovery
    ? "检测到黑盒 Web 只读探测：首次运行将由 Playwright 自动下载 Chromium；探测不会点击或输入。"
    : hasWebActions
      ? "检测到 Web 用例：首次运行将由 Playwright 自动下载 Chromium；后续运行复用浏览器缓存。"
    : "检测到 API-only 交互可视执行：首次运行将自动下载 Chromium 显示全屏执行看板；后续运行复用浏览器缓存。");
  const runProcess = options.runProcess ?? defaultRunProcess;
  const code = await runProcess(
    process.execPath,
    [playwrightCli, "install", "chromium"],
    {
      env: sanitizedBrowserInstallEnv(options.env ?? process.env),
      stdio: "inherit",
    },
  );
  if (code !== 0) {
    fail("bootstrap_browser_install_failed", "Playwright exited with code " + code);
  }
  if (!await fileExists(executablePath)) {
    fail("bootstrap_browser_install_failed", "Chromium executable is missing after installation");
  }
  return { required: true, cacheHit: false, executablePath };
}

export async function forwardRunnerCommand(options) {
  return await (options.runProcess ?? defaultRunProcess)(
    process.execPath,
    [options.cliPath, ...options.args],
    {
      env: options.env ?? process.env,
      stdio: "inherit",
    },
  );
}
