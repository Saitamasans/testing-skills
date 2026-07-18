import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const SKILL = "web-api-test-execution-evidence";
const BUNDLE_VERSION = "1.0.0";
const RELEASE_TAG = "web-api-test-execution-evidence-v1.0.0";
const PASS_STATUS = "\u901a\u8fc7";
const CASE_ID = "BUNDLE-SMOKE-001";
const ASSERTION_ID = "BUNDLE-SMOKE-001-visible-text";
const REQUIRED_SMOKE_ARTIFACTS = [
  "run-result.json",
  "projected-report.json",
  "result.html",
  "result.xlsx",
  "run-events.jsonl",
];
const SHA256 = /^[a-f0-9]{64}$/;
const REQUIRED_FILES = [
  "node/node.exe",
  "runner/dist/cli.js",
  "runner/package.json",
  "runner/node_modules/playwright/cli.js",
  "runner/node_modules/playwright/package.json",
  "runner/node_modules/playwright-core/package.json",
  "runner/node_modules/playwright-core/browsers.json",
  "skill/web-api-test-execution-evidence/SKILL.md",
  "skill/web-api-test-execution-evidence/scripts/testing-runner.mjs",
  "skill/web-api-test-execution-evidence/scripts/installed-runtime-lib.mjs",
  "smoke/installation-smoke-test.mjs",
  "smoke/installation-smoke-fixture.html",
  "browser-cache/chromium-1228/chrome-win64/chrome.exe",
  "browser-cache/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe",
  "browser-cache/ffmpeg-1011/ffmpeg-win64.exe",
];
const BLOCKED_ENV = new Set(["NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE"]);

export class InstallationError extends Error {
  constructor(code, detail) {
    super(`${code}: ${detail}. Rerun the GitHub Release installer with -Repair.`);
    this.name = "InstallationError";
    this.code = code;
  }
}

function incomplete(detail) { throw new InstallationError("installation_incomplete", detail); }
function corrupt(detail) { throw new InstallationError("installation_corrupt", detail); }

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) corrupt(`${label} must be an object`);
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) corrupt(`${label} has an unexpected value`);
}

function integer(value, label, allowZero = true) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) corrupt(`${label} must be a ${allowZero ? "non-negative" : "positive"} integer`);
}

function normalizeArchitecture(value) {
  const normalized = String(value).toLowerCase();
  if (normalized === "x64" || normalized === "amd64") return "x64";
  if (normalized === "arm64") return "arm64";
  incomplete(`unsupported bundled Node architecture ${String(value)}`);
}

function userHome(env) { return env.USERPROFILE || env.HOME || os.homedir(); }

function resolveRoot(env, name, fallback) {
  const value = env[name] || fallback;
  if (typeof value !== "string" || value.length === 0 || !path.isAbsolute(value)) incomplete(`${name} must resolve to an absolute path`);
  return path.resolve(value);
}

function contained(child, root) {
  const relative = path.relative(root, child);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function samePath(left, right) {
  return path.resolve(left).toLocaleLowerCase("en-US") === path.resolve(right).toLocaleLowerCase("en-US");
}

function safeRelative(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\") || value.includes("\0")) corrupt("payload inventory contains an unsafe path");
  const parts = value.split("/");
  if (path.posix.isAbsolute(value) || parts.some((part) => !part || part === "." || part === ".." || part.includes(":"))) corrupt("payload inventory contains an unsafe path");
  return value;
}

async function fileInfo(file, label) {
  let info;
  try { info = await lstat(file); } catch { incomplete(`${label} is missing`); }
  if (info.isSymbolicLink() || !info.isFile()) corrupt(`${label} must be a regular file`);
  return info;
}

async function directoryInfo(directory, label) {
  let info;
  try { info = await lstat(directory); } catch { incomplete(`${label} is missing`); }
  if (info.isSymbolicLink() || !info.isDirectory()) corrupt(`${label} must be a real directory`);
  return info;
}

async function physicalContained(root, target, label) {
  const lexicalRoot = path.resolve(root);
  const lexicalTarget = path.resolve(target);
  if (!contained(lexicalTarget, lexicalRoot)) incomplete(`${label} is outside the allowed installation roots`);
  await directoryInfo(lexicalRoot, `${label} root`);
  const pieces = path.relative(lexicalRoot, lexicalTarget).split(path.sep);
  let cursor = lexicalRoot;
  for (const piece of pieces) {
    cursor = path.join(cursor, piece);
    let info;
    try { info = await lstat(cursor); } catch { incomplete(`${label} is missing`); }
    if (info.isSymbolicLink()) corrupt(`${label} contains a reparse point`);
  }
  let physicalRoot;
  let physicalTarget;
  try {
    physicalRoot = await realpath(lexicalRoot);
    physicalTarget = await realpath(lexicalTarget);
  } catch { incomplete(`${label} cannot be resolved physically`); }
  if (!contained(physicalTarget, physicalRoot)) corrupt(`${label} escapes its physical installation root`);
  return physicalTarget;
}

async function jsonFile(file, label) {
  await fileInfo(file, label);
  try { return JSON.parse(await readFile(file, "utf8")); } catch { corrupt(`${label} is not valid JSON`); }
}

async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function inventory(root, label) {
  await directoryInfo(root, label);
  const entries = [];
  async function visit(directory, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      const info = await lstat(absolute);
      if (info.isSymbolicLink()) corrupt(`${label} contains a reparse point: ${relative}`);
      if (info.isDirectory()) await visit(absolute, relative);
      else if (info.isFile()) entries.push({ path: relative, absolute, size_bytes: info.size });
      else corrupt(`${label} contains an unsupported filesystem entry: ${relative}`);
    }
  }
  await visit(root);
  return entries;
}

function mapInventory(entries, label) {
  const mapped = new Map();
  for (const entry of entries) {
    const key = entry.path.toLocaleLowerCase("en-US");
    if (mapped.has(key)) corrupt(`${label} contains duplicate case-insensitive paths`);
    mapped.set(key, entry);
  }
  return mapped;
}

async function compareInventory(expectedRoot, actualRoot) {
  const expected = mapInventory(await inventory(expectedRoot, "bundled Skill"), "bundled Skill inventory");
  const actual = mapInventory(await inventory(actualRoot, "installed Skill"), "installed Skill inventory");
  if (actual.size !== expected.size) corrupt("installed Skill inventory file count does not match bundled Skill");
  for (const [key, expectedEntry] of expected) {
    const actualEntry = actual.get(key);
    if (!actualEntry || actualEntry.path !== expectedEntry.path || actualEntry.size_bytes !== expectedEntry.size_bytes || await sha256File(actualEntry.absolute) !== await sha256File(expectedEntry.absolute)) {
      corrupt(`installed Skill inventory does not match ${expectedEntry.path}`);
    }
  }
}

function validateComponents(manifest) {
  const components = object(manifest.components, "payload components");
  exact(object(components.node, "node component").version, "22.23.1", "bundled Node version");
  const runner = object(components.runner, "runner component");
  exact(runner.name, "@saitamasans/testing-runner", "bundled Runner name");
  exact(runner.version, "1.1.1", "bundled Runner version");
  const playwright = object(components.playwright, "Playwright component");
  exact(playwright.version, "1.61.1", "bundled Playwright version");
  exact(playwright.chromium_revision, "1228", "bundled Chromium revision");
  exact(playwright.chromium_headless_shell_revision, "1228", "bundled headless shell revision");
  exact(playwright.ffmpeg_revision, "1011", "bundled FFmpeg revision");
  exact(object(components.skill, "skill component").name, SKILL, "bundled Skill name");
}

async function validateRuntimeIdentity(runtimePath) {
  const runner = await jsonFile(path.join(runtimePath, "runner", "package.json"), "Runner package");
  exact(runner.name, "@saitamasans/testing-runner", "Runner package name");
  exact(runner.version, "1.1.1", "Runner package version");
  exact(runner.dependencies?.playwright, "1.61.1", "Runner Playwright dependency");
  const playwright = await jsonFile(path.join(runtimePath, "runner", "node_modules", "playwright", "package.json"), "Playwright package");
  exact(playwright.version, "1.61.1", "Playwright package version");
  const core = await jsonFile(path.join(runtimePath, "runner", "node_modules", "playwright-core", "package.json"), "Playwright core package");
  exact(core.name, "playwright-core", "Playwright core name");
  exact(core.version, "1.61.1", "Playwright core version");
  const browsers = await jsonFile(path.join(runtimePath, "runner", "node_modules", "playwright-core", "browsers.json"), "Playwright browsers metadata");
  if (!Array.isArray(browsers.browsers)) corrupt("Playwright browsers metadata is invalid");
  for (const [name, revision] of [["chromium", "1228"], ["chromium-headless-shell", "1228"], ["ffmpeg", "1011"]]) {
    const entry = browsers.browsers.find((item) => item?.name === name);
    if (entry?.revision !== revision || entry.installByDefault !== true) corrupt(`Playwright ${name} identity is invalid`);
  }
}

async function validatePayload(runtimePath, expectedHash, architecture) {
  const manifestPath = path.join(runtimePath, "bundle-manifest.json");
  await fileInfo(manifestPath, "payload manifest");
  const manifestBytes = await readFile(manifestPath);
  if (createHash("sha256").update(manifestBytes).digest("hex") !== expectedHash) corrupt("payload manifest SHA-256 does not match receipt");
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); } catch { corrupt("payload manifest is not valid JSON"); }
  exact(manifest.schema_version, 1, "payload schema version");
  const bundle = object(manifest.bundle, "payload bundle");
  exact(bundle.name, SKILL, "payload Skill name");
  exact(bundle.version, BUNDLE_VERSION, "payload bundle version");
  exact(bundle.release_tag, RELEASE_TAG, "payload release tag");
  exact(bundle.os, "windows", "payload operating system");
  exact(bundle.arch, architecture, "payload architecture");
  validateComponents(manifest);
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) corrupt("payload inventory is invalid");
  const expected = new Map();
  let total = 0;
  for (const item of manifest.files) {
    const entry = object(item, "payload inventory entry");
    const relative = safeRelative(entry.path);
    const key = relative.toLocaleLowerCase("en-US");
    if (expected.has(key)) corrupt("payload inventory has duplicate paths");
    integer(entry.size_bytes, `payload size for ${relative}`);
    if (!SHA256.test(entry.sha256)) corrupt(`payload SHA-256 is invalid for ${relative}`);
    expected.set(key, { path: relative, size_bytes: entry.size_bytes, sha256: entry.sha256 });
    total += entry.size_bytes;
  }
  if (manifest.installed_size_bytes !== total) corrupt("payload installed size is invalid");
  for (const required of REQUIRED_FILES) {
    const record = expected.get(required.toLocaleLowerCase("en-US"));
    if (!record || record.path !== required) incomplete(`payload is missing ${required}`);
    const absolute = path.resolve(runtimePath, ...required.split("/"));
    const physical = await physicalContained(runtimePath, absolute, `critical payload marker ${required}`);
    const metadata = await fileInfo(physical, `critical payload marker ${required}`);
    if (metadata.size !== record.size_bytes || await sha256File(physical) !== record.sha256) {
      corrupt(`critical payload marker does not match ${required}`);
    }
  }
  await validateRuntimeIdentity(runtimePath);
}

async function validateSmokeEvidence(diagnosticsPath, reference, label) {
  const entry = object(reference, `${label} smoke evidence`);
  const relative = safeRelative(entry.path);
  integer(entry.size_bytes, `${label} smoke evidence size`, false);
  if (!SHA256.test(entry.sha256)) corrupt(`${label} smoke evidence SHA-256 is invalid`);
  const absolute = path.resolve(diagnosticsPath, ...relative.split("/"));
  if (!contained(absolute, diagnosticsPath)) corrupt(`${label} smoke evidence escapes diagnostics`);
  const physical = await physicalContained(diagnosticsPath, absolute, `${label} smoke evidence`);
  const metadata = await fileInfo(physical, `${label} smoke evidence`);
  if (metadata.size !== entry.size_bytes || await sha256File(physical) !== entry.sha256) corrupt(`${label} smoke evidence does not match its smoke marker`);
  return relative;
}

async function validateSmoke(diagnosticsPath, smoke, architecture) {
  exact(smoke.schema_version, 1, "smoke schema version");
  if (smoke.ok !== true) incomplete("installation smoke marker is not successful");
  const node = object(smoke.node, "smoke Node identity");
  exact(node.version, "22.23.1", "smoke Node version");
  exact(node.arch, architecture, "smoke Node architecture");
  exact(object(smoke.runner, "smoke Runner identity").version, "1.1.1", "smoke Runner version");
  exact(object(smoke.browser, "smoke browser identity").visible, true, "smoke visible browser result");
  exact(smoke.case_id, CASE_ID, "smoke case ID");
  exact(smoke.case_status, PASS_STATUS, "smoke case status");
  exact(smoke.assertion_id, ASSERTION_ID, "smoke assertion ID");
  exact(smoke.assertion_passed, true, "smoke assertion result");
  const png = await validateSmokeEvidence(diagnosticsPath, smoke.png, "PNG");
  const trace = await validateSmokeEvidence(diagnosticsPath, smoke.trace, "Trace");
  if (!png.endsWith(`/${ASSERTION_ID}/web-page.png`) || trace !== "evidence/playwright-trace.zip") corrupt("smoke evidence paths do not match the locked smoke case");
  if (!Array.isArray(smoke.artifacts) || smoke.artifacts.length !== REQUIRED_SMOKE_ARTIFACTS.length) {
    corrupt("installation report smoke evidence list is invalid");
  }
  for (let index = 0; index < REQUIRED_SMOKE_ARTIFACTS.length; index += 1) {
    const expected = REQUIRED_SMOKE_ARTIFACTS[index];
    const actual = await validateSmokeEvidence(diagnosticsPath, smoke.artifacts[index], `report ${expected}`);
    if (actual !== expected) corrupt("installation report smoke evidence paths are invalid");
  }
}

export function resolveCanonicalReceipt(env = process.env) {
  const home = userHome(env);
  const stateRoot = resolveRoot(env, "TESTING_SKILLS_STATE_ROOT", path.join(home, ".testing-skills"));
  return {
    stateRoot,
    installRoot: resolveRoot(env, "TESTING_SKILLS_INSTALL_ROOT", path.join(home, ".agents", "skills")),
    receiptPath: path.join(stateRoot, "installations", `${SKILL}.json`),
  };
}

export async function verifyInstalledRuntime(options = {}) {
  const env = options.env ?? process.env;
  const paths = resolveCanonicalReceipt(env);
  const architecture = normalizeArchitecture(options.architecture ?? process.arch);
  await fileInfo(paths.receiptPath, "canonical installation receipt");
  let receipt;
  try { receipt = JSON.parse(await readFile(paths.receiptPath, "utf8")); } catch { incomplete("canonical installation receipt is missing or unreadable"); }
  object(receipt, "installation receipt");
  exact(receipt.schema_version, 1, "receipt schema version");
  exact(receipt.skill, SKILL, "receipt Skill name");
  exact(receipt.bundle_version, BUNDLE_VERSION, "receipt bundle version");
  exact(receipt.release_tag, RELEASE_TAG, "receipt release tag");
  if (receipt.architecture !== architecture) incomplete(`receipt architecture ${String(receipt.architecture)} does not match bundled Node ${architecture}`);
  if (!SHA256.test(receipt.archive_sha256)) corrupt("receipt archive SHA-256 is invalid");
  if (!SHA256.test(receipt.payload_manifest_sha256)) corrupt("receipt payload manifest SHA-256 is invalid");
  for (const [field, root] of [["runtime_path", path.join(paths.stateRoot, "runtime", SKILL)], ["skill_path", paths.installRoot], ["diagnostics_path", path.join(paths.stateRoot, "diagnostics", SKILL)]]) {
    if (typeof receipt[field] !== "string" || !path.isAbsolute(receipt[field])) incomplete(`receipt ${field} is outside the allowed installation roots`);
    if (!contained(path.resolve(receipt[field]), root)) incomplete(`receipt ${field} is outside the allowed installation roots`);
  }
  const runtimePath = await physicalContained(path.join(paths.stateRoot, "runtime", SKILL), receipt.runtime_path, "receipt runtime path");
  const skillPath = await physicalContained(paths.installRoot, receipt.skill_path, "receipt skill path");
  const diagnosticsPath = await physicalContained(path.join(paths.stateRoot, "diagnostics", SKILL), receipt.diagnostics_path, "receipt diagnostics path");
  if (!samePath(skillPath, path.join(paths.installRoot, SKILL))) incomplete("receipt skill path is not the canonical installed Skill");
  await fileInfo(path.join(skillPath, "SKILL.md"), "installed Skill marker");
  const smoke = await jsonFile(path.join(diagnosticsPath, "smoke-result.json"), "installation smoke marker");
  await validateSmoke(diagnosticsPath, smoke, architecture);
  await validatePayload(runtimePath, receipt.payload_manifest_sha256, architecture);
  await compareInventory(path.join(runtimePath, "skill", SKILL), skillPath);
  return {
    receiptPath: paths.receiptPath,
    runtimePath,
    nodePath: path.join(runtimePath, "node", "node.exe"),
    cliPath: path.join(runtimePath, "runner", "dist", "cli.js"),
    browserCachePath: path.join(runtimePath, "browser-cache"),
  };
}

export function sanitizedRuntimeEnv(env = process.env, browserCachePath) {
  const output = {};
  for (const [key, value] of Object.entries(env)) if (!BLOCKED_ENV.has(key.toUpperCase())) output[key] = value;
  output.PLAYWRIGHT_BROWSERS_PATH = browserCachePath;
  return output;
}

export async function defaultRunProcess(command, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: options.stdio ?? "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => signal ? reject(new Error(`process terminated by ${signal}`)) : resolve(code ?? 1));
  });
}

export async function forwardInstalledRunnerCommand(options) {
  const runProcess = options.runProcess ?? defaultRunProcess;
  return await runProcess(options.runtime.nodePath, [options.runtime.cliPath, ...(options.args ?? [])], {
    env: sanitizedRuntimeEnv(options.env ?? process.env, options.runtime.browserCachePath),
    stdio: options.stdio ?? "inherit",
  });
}
