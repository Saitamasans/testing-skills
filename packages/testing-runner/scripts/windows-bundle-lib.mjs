import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat as fsLstat,
  readFile as fsReadFile,
  readdir as fsReaddir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const SHA256 = /^[a-f0-9]{64}$/;
const ARCHITECTURES = new Set(["x64", "arm64"]);
const EXPECTED = Object.freeze({
  bundleVersion: "1.0.2",
  nodeVersion: "22.23.1",
  runnerName: "@saitamasans/testing-runner",
  runnerVersion: "1.1.2",
  playwrightVersion: "1.61.1",
  chromiumRevision: "1228",
  headlessShellRevision: "1228",
  ffmpegRevision: "1011",
});

function fail(message) {
  throw new Error(`windows_bundle_invalid: ${message}`);
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) fail(`${label} must be exactly ${expected}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

function httpsUrl(value, label) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(`${label} must be a valid HTTPS URL`);
  }
  if (parsed.protocol !== "https:") fail(`${label} must use HTTPS`);
}

function hash(value, label) {
  if (!SHA256.test(value)) fail(`${label} must be a lowercase SHA-256`);
}

export function validateRuntimeLock(value) {
  const lock = object(value, "runtime lock");
  exact(lock.schema_version, 1, "schema_version");
  exact(lock.bundle_version, EXPECTED.bundleVersion, "bundle_version");
  if (typeof lock.release_tag !== "string" || lock.release_tag.length === 0) {
    fail("release_tag must be a non-empty string");
  }

  const node = object(lock.node, "node");
  exact(node.version, EXPECTED.nodeVersion, "node.version");
  const windows = object(node.windows, "node.windows");
  for (const arch of ARCHITECTURES) {
    const item = object(windows[arch], `node.windows.${arch}`);
    httpsUrl(item.download_url, `node.windows.${arch}.download_url`);
    hash(item.sha256, `node.windows.${arch}.sha256`);
  }

  const runner = object(lock.runner, "runner");
  exact(runner.name, EXPECTED.runnerName, "runner.name");
  exact(runner.version, EXPECTED.runnerVersion, "runner.version");
  httpsUrl(runner.download_url, "runner.download_url");
  hash(runner.sha256, "runner.sha256");
  positiveInteger(runner.size_bytes, "runner.size_bytes");

  const playwright = object(lock.playwright, "playwright");
  exact(playwright.version, EXPECTED.playwrightVersion, "playwright.version");
  exact(playwright.chromium_revision, EXPECTED.chromiumRevision, "playwright.chromium_revision");
  exact(
    playwright.chromium_headless_shell_revision,
    EXPECTED.headlessShellRevision,
    "playwright.chromium_headless_shell_revision",
  );
  exact(playwright.ffmpeg_revision, EXPECTED.ffmpegRevision, "playwright.ffmpeg_revision");
  const archives = object(playwright.archives, "playwright.archives");
  const windowsArchives = object(archives.windows, "playwright.archives.windows");
  for (const component of ["chromium", "chromium_headless_shell", "ffmpeg"]) {
    const archive = object(windowsArchives[component], `playwright.archives.windows.${component}`);
    httpsUrl(archive.download_url, `playwright.archives.windows.${component}.download_url`);
    positiveInteger(archive.size_bytes, `playwright.archives.windows.${component}.size_bytes`);
    hash(archive.sha256, `playwright.archives.windows.${component}.sha256`);
  }
  return value;
}

function validateBundlePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    fail("inventory path must be a non-empty safe path");
  }
  if (value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    fail(`inventory path is unsafe: ${value}`);
  }
  const segments = value.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    fail(`inventory path traversal is forbidden: ${value}`);
  }
  if (segments.some((segment) => segment.includes(":"))) {
    fail(`inventory path is unsafe: ${value}`);
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value) fail(`inventory path is not normalized: ${value}`);
  return value;
}

export function validateInventoryEntries(entries) {
  if (!Array.isArray(entries)) fail("inventory must be an array");
  const caseInsensitive = new Map();
  for (const entryValue of entries) {
    const entry = object(entryValue, "inventory entry");
    const normalized = validateBundlePath(entry.path);
    if (!Number.isSafeInteger(entry.size_bytes) || entry.size_bytes < 0) {
      fail(`inventory size must be a non-negative integer: ${normalized}`);
    }
    hash(entry.sha256, `inventory SHA-256 for ${normalized}`);
    const folded = normalized.toLocaleLowerCase("en-US");
    const prior = caseInsensitive.get(folded);
    if (prior !== undefined) {
      fail(`duplicate case-insensitive inventory paths: ${prior} and ${normalized}`);
    }
    caseInsensitive.set(folded, normalized);
  }
  return entries;
}

async function sha256File(file, readFileOverride) {
  const digest = createHash("sha256");
  if (readFileOverride) {
    digest.update(await readFileOverride(file));
  } else {
    for await (const chunk of createReadStream(file)) digest.update(chunk);
  }
  return digest.digest("hex");
}

function comparePath(left, right) {
  return left.path < right.path ? -1 : left.path > right.path ? 1 : 0;
}

export async function inventoryTree(root, operations = {}) {
  const absoluteRoot = path.resolve(root);
  const lstat = operations.lstat ?? fsLstat;
  const readdir = operations.readdir ?? fsReaddir;
  const entries = [];

  async function visit(directory, relativeDirectory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const absolute = path.join(directory, child.name);
      const relative = relativeDirectory
        ? `${relativeDirectory}/${child.name}`
        : child.name;
      validateBundlePath(relative);
      const metadata = await lstat(absolute);
      if (metadata.isSymbolicLink()) {
        fail(`reparse point or symbolic link is forbidden: ${relative}`);
      }
      if (metadata.isDirectory()) {
        await visit(absolute, relative);
        continue;
      }
      if (!metadata.isFile()) fail(`unsupported filesystem entry: ${relative}`);
      entries.push({
        path: relative,
        size_bytes: metadata.size,
        sha256: await sha256File(absolute, operations.readFile),
      });
    }
  }

  const rootMetadata = await lstat(absoluteRoot);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    fail("inventory root must be a real directory, not a reparse point");
  }
  await visit(absoluteRoot, "");
  entries.sort(comparePath);
  validateInventoryEntries(entries);
  return entries;
}

async function requireRegularFile(root, relative) {
  const absolute = path.join(root, ...relative.split("/"));
  let metadata;
  try {
    metadata = await fsLstat(absolute);
  } catch {
    fail(`required bundle file is missing: ${relative}`);
  }
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    fail(`required bundle file must not be a reparse point: ${relative}`);
  }
  return absolute;
}

async function requireNonEmptyFile(root, relative, label) {
  const absolute = await requireRegularFile(root, relative);
  const metadata = await fsLstat(absolute);
  if (metadata.size <= 0) fail(`${label} is empty: ${relative}`);
  return absolute;
}

async function jsonFile(root, relative) {
  const file = await requireRegularFile(root, relative);
  try {
    return JSON.parse(await fsReadFile(file, "utf8"));
  } catch {
    fail(`required bundle JSON is invalid: ${relative}`);
  }
}

function browserRevision(browsers, name) {
  const entry = browsers.find((item) => item?.name === name);
  return entry?.revision;
}

export async function validateBundleLayout(root, lockValue, arch) {
  const lock = validateRuntimeLock(lockValue);
  if (!ARCHITECTURES.has(arch)) fail(`unsupported Windows architecture: ${arch}`);
  await requireRegularFile(root, "node/node.exe");
  await requireRegularFile(root, "runner/dist/cli.js");
  await requireRegularFile(root, "runner/node_modules/playwright/cli.js");
  await requireRegularFile(root, "skill/web-api-test-execution-evidence/SKILL.md");
  await requireRegularFile(root, "smoke/installation-smoke-test.mjs");
  const fixturePath = await requireRegularFile(root, "smoke/installation-smoke-fixture.html");
  const fixture = await fsReadFile(fixturePath, "utf8");
  if (!fixture.includes("Bundle Smoke Ready")) fail("smoke fixture must contain Bundle Smoke Ready");

  const runnerPackage = await jsonFile(root, "runner/package.json");
  exact(runnerPackage.name, lock.runner.name, "bundled Runner name");
  exact(runnerPackage.version, lock.runner.version, "bundled Runner version");
  exact(
    runnerPackage.dependencies?.playwright,
    lock.playwright.version,
    "bundled Runner Playwright dependency",
  );
  const playwrightPackage = await jsonFile(root, "runner/node_modules/playwright/package.json");
  exact(playwrightPackage.version, lock.playwright.version, "bundled Playwright identity");
  const playwrightCorePackage = await jsonFile(root, "runner/node_modules/playwright-core/package.json");
  exact(playwrightCorePackage.name, "playwright-core", "bundled playwright-core name");
  exact(
    playwrightCorePackage.version,
    lock.playwright.version,
    "bundled playwright-core identity",
  );
  const browsers = await jsonFile(root, "runner/node_modules/playwright-core/browsers.json");
  if (!Array.isArray(browsers.browsers)) fail("Playwright browsers.json must contain browsers");
  const chromium = browsers.browsers.find((item) => item?.name === "chromium");
  const headlessShell = browsers.browsers.find((item) => item?.name === "chromium-headless-shell");
  const ffmpeg = browsers.browsers.find((item) => item?.name === "ffmpeg");
  exact(browserRevision(browsers.browsers, "chromium"), lock.playwright.chromium_revision, "Chromium revision");
  exact(
    browserRevision(browsers.browsers, "chromium-headless-shell"),
    lock.playwright.chromium_headless_shell_revision,
    "Chromium headless shell revision",
  );
  exact(browserRevision(browsers.browsers, "ffmpeg"), lock.playwright.ffmpeg_revision, "FFmpeg revision");
  for (const [label, entry] of [
    ["Chromium", chromium],
    ["Chromium headless shell", headlessShell],
    ["FFmpeg", ffmpeg],
  ]) {
    if (entry?.installByDefault !== true) fail(`${label} must be installed by default in browsers.json`);
  }
  if (
    typeof chromium?.browserVersion !== "string"
    || chromium.browserVersion.length === 0
    || headlessShell?.browserVersion !== chromium.browserVersion
  ) {
    fail("Chromium and headless shell browserVersion metadata must match");
  }

  await requireNonEmptyFile(
    root,
    `browser-cache/chromium-${lock.playwright.chromium_revision}/chrome-win64/chrome.exe`,
    "Chromium browser executable",
  );
  await requireNonEmptyFile(
    root,
    `browser-cache/chromium_headless_shell-${lock.playwright.chromium_headless_shell_revision}/chrome-headless-shell-win64/chrome-headless-shell.exe`,
    "Chromium headless shell executable",
  );
  await requireNonEmptyFile(
    root,
    `browser-cache/ffmpeg-${lock.playwright.ffmpeg_revision}/ffmpeg-win64.exe`,
    "FFmpeg executable",
  );

  return {
    bundle_version: lock.bundle_version,
    release_tag: lock.release_tag,
    os: "windows",
    arch,
    node: { version: lock.node.version },
    runner: {
      name: lock.runner.name,
      version: lock.runner.version,
      download_url: lock.runner.download_url,
      sha256: lock.runner.sha256,
      size_bytes: lock.runner.size_bytes,
    },
    playwright: { ...lock.playwright },
    skill: { name: "web-api-test-execution-evidence" },
  };
}

export async function writeBundleManifest(input) {
  const root = path.resolve(input.root);
  const components = await validateBundleLayout(root, input.lock, input.arch);
  const allFiles = await inventoryTree(root, input.operations);
  const files = allFiles.filter(({ path: relative }) => relative !== "bundle-manifest.json");
  if (allFiles.some(({ path: relative }) =>
    relative.toLocaleLowerCase("en-US") === "bundle-manifest.json" && relative !== "bundle-manifest.json")) {
    fail("payload manifest path has a case-insensitive duplicate");
  }
  validateInventoryEntries(files);
  const manifest = {
    schema_version: 1,
    bundle: {
      name: "web-api-test-execution-evidence",
      version: components.bundle_version,
      release_tag: components.release_tag,
      os: components.os,
      arch: components.arch,
    },
    components: {
      node: components.node,
      runner: components.runner,
      playwright: components.playwright,
      skill: components.skill,
    },
    installed_size_bytes: files.reduce((total, entry) => total + entry.size_bytes, 0),
    files,
  };
  const outputPath = path.join(root, "bundle-manifest.json");
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(outputPath, bytes);
  return {
    path: outputPath,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size_bytes: bytes.length,
    manifest,
  };
}
