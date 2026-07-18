import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createDeflateRaw } from "node:zlib";
import { fileURLToPath, pathToFileURL } from "node:url";
import unzipper from "unzipper";

import {
  inventoryTree,
  validateBundleLayout,
  validateRuntimeLock,
  writeBundleManifest,
} from "./windows-bundle-lib.mjs";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_LOCK_PATH = path.join(PACKAGE_ROOT, "release", "windows-runtime-lock.json");
const DEFAULT_SKILL_ROOT = path.join(REPO_ROOT, "skills", "web-api-test-execution-evidence");
const SMOKE_PROGRAM = path.join(PACKAGE_ROOT, "scripts", "installation-smoke-test.mjs");
const SMOKE_FIXTURE = path.join(PACKAGE_ROOT, "assets", "installation-smoke-fixture.html");

function bundleError(message) {
  const error = new Error(`windows_bundle_build_failed: ${message}`);
  error.name = "WindowsBundleBuildError";
  return error;
}

async function sha256File(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

async function defaultDownload({ url, destination }) {
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw bundleError(`download failed with HTTP ${response.status}: ${url}`);
  if (new URL(response.url).protocol !== "https:") {
    throw bundleError(`download redirected outside HTTPS: ${response.url}`);
  }
  await writeFile(destination, Buffer.from(await response.arrayBuffer()));
}

async function defaultRun({ executable, args, cwd, env = {} }) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        reject(bundleError(
          `${path.basename(executable)} exited with ${signal ?? code}\n${stdout}\n${stderr}`,
        ));
      } else {
        resolve();
      }
    });
  });
}

async function defaultExtractArchive({ archivePath, destination }) {
  await mkdir(destination, { recursive: true });
  await defaultRun({
    executable: process.platform === "win32" ? "tar.exe" : "tar",
    args: ["-xf", archivePath, "-C", destination],
    cwd: destination,
  });
}

function safeZipPath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw bundleError("browser ZIP entry path must be a non-empty string");
  }
  if (value.includes("\\") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    throw bundleError(`browser ZIP entry path is unsafe: ${value}`);
  }
  const trimmed = value.endsWith("/") ? value.slice(0, -1) : value;
  if (trimmed.length === 0) throw bundleError("browser ZIP entry path is unsafe: root entry");
  const segments = trimmed.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === ".." || segment.includes(":"))) {
    throw bundleError(`browser ZIP entry path is unsafe: ${value}`);
  }
  if (path.posix.normalize(trimmed) !== trimmed) {
    throw bundleError(`browser ZIP entry path is not normalized: ${value}`);
  }
  return trimmed;
}

function isZipSymbolicLink(entry) {
  const attributes = entry.externalFileAttributes ?? entry.vars?.externalFileAttributes;
  if (!Number.isSafeInteger(attributes)) return false;
  return ((attributes >>> 16) & 0o170000) === 0o120000;
}

async function defaultExtractBrowserArchive({ archivePath, destination }) {
  const archive = await unzipper.Open.file(archivePath);
  const entries = [];
  const caseInsensitive = new Set();
  for (const entry of archive.files) {
    const relative = safeZipPath(entry.path);
    const folded = relative.toLocaleLowerCase("en-US");
    if (caseInsensitive.has(folded)) {
      throw bundleError(`browser ZIP has duplicate case-insensitive entry: ${relative}`);
    }
    caseInsensitive.add(folded);
    if (isZipSymbolicLink(entry) || (entry.type !== "File" && entry.type !== "Directory")) {
      throw bundleError(`browser ZIP entry is not a regular file or directory: ${relative}`);
    }
    entries.push({ entry, relative });
  }

  await mkdir(destination, { recursive: true });
  for (const { entry, relative } of entries) {
    const outputPath = path.join(destination, ...relative.split("/"));
    if (entry.type === "Directory") {
      await mkdir(outputPath, { recursive: true });
      continue;
    }
    await mkdir(path.dirname(outputPath), { recursive: true });
    if (await lstat(outputPath).catch(() => undefined)) {
      throw bundleError(`browser ZIP extraction would overwrite an existing path: ${relative}`);
    }
    await pipeline(entry.stream(), createWriteStream(outputPath, { flags: "wx" }));
  }
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function updateCrc32(crc, bytes) {
  let value = crc;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return value >>> 0;
}

function localHeader(nameLength) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x0808, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0x0021, 12);
  header.writeUInt16LE(nameLength, 26);
  return header;
}

function dataDescriptor(crc, compressedSize, uncompressedSize) {
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(crc, 4);
  descriptor.writeUInt32LE(compressedSize, 8);
  descriptor.writeUInt32LE(uncompressedSize, 12);
  return descriptor;
}

function centralHeader(entry) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(0x0808, 8);
  header.writeUInt16LE(8, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt16LE(0x0021, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.uncompressedSize, 24);
  header.writeUInt16LE(entry.name.length, 28);
  header.writeUInt32LE(entry.localOffset, 42);
  return header;
}

function endRecord(count, centralSize, centralOffset) {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(0x06054b50, 0);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  return record;
}

export async function createDeterministicZip({ root, outputPath, openFile = open }) {
  const inventory = await inventoryTree(root);
  if (inventory.length > 0xffff) throw bundleError("ZIP has too many entries");
  const handle = await openFile(outputPath, "w");
  let offset = 0;
  const centralEntries = [];
  const append = async (bytes) => {
    if (offset + bytes.length > 0xffffffff) throw bundleError("ZIP64 bundles are not supported");
    let bufferOffset = 0;
    while (bufferOffset < bytes.length) {
      const { bytesWritten } = await handle.write(
        bytes,
        bufferOffset,
        bytes.length - bufferOffset,
        offset,
      );
      if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0) {
        throw bundleError("ZIP writer made no forward progress");
      }
      bufferOffset += bytesWritten;
      offset += bytesWritten;
    }
  };
  try {
    for (const item of inventory) {
      const name = Buffer.from(item.path, "utf8");
      const localOffset = offset;
      await append(localHeader(name.length));
      await append(name);
      let crc = 0xffffffff;
      let uncompressedSize = 0;
      let compressedSize = 0;
      const calculate = new Transform({
        transform(chunk, _encoding, callback) {
          crc = updateCrc32(crc, chunk);
          uncompressedSize += chunk.length;
          callback(null, chunk);
        },
      });
      const compressed = createReadStream(path.join(root, ...item.path.split("/")))
        .pipe(calculate)
        .pipe(createDeflateRaw({ level: 9 }));
      for await (const chunk of compressed) {
        compressedSize += chunk.length;
        await append(chunk);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      await append(dataDescriptor(crc, compressedSize, uncompressedSize));
      centralEntries.push({ name, localOffset, crc, compressedSize, uncompressedSize });
    }
    const centralOffset = offset;
    for (const entry of centralEntries) {
      await append(centralHeader(entry));
      await append(entry.name);
    }
    const centralSize = offset - centralOffset;
    await append(endRecord(centralEntries.length, centralSize, centralOffset));
  } finally {
    await handle.close();
  }
}

function defaultOperations(overrides = {}) {
  return {
    download: overrides.download ?? defaultDownload,
    extractArchive: overrides.extractArchive ?? defaultExtractArchive,
    extractBrowserArchive: overrides.extractBrowserArchive ?? defaultExtractBrowserArchive,
    run: overrides.run ?? defaultRun,
    createArchive: overrides.createArchive ?? createDeterministicZip,
  };
}

async function requireDirectory(directory, label) {
  const metadata = await lstat(directory).catch(() => undefined);
  if (!metadata?.isDirectory() || metadata.isSymbolicLink()) {
    throw bundleError(`${label} is missing or is a reparse point: ${directory}`);
  }
}

async function verifyArchive(file, expectedHash, expectedSize, label) {
  const metadata = await stat(file);
  if (expectedSize !== undefined && metadata.size !== expectedSize) {
    throw bundleError(`${label} size mismatch: expected ${expectedSize}, got ${metadata.size}`);
  }
  const actualHash = await sha256File(file);
  if (actualHash !== expectedHash) {
    throw bundleError(`${label} SHA-256 mismatch: expected ${expectedHash}, got ${actualHash}`);
  }
}

async function findOnlyDirectory(root, expectedName, label) {
  const entries = await readdir(root, { withFileTypes: true });
  const matches = entries.filter((entry) => entry.isDirectory() && entry.name === expectedName);
  if (matches.length !== 1 || entries.length !== 1) {
    throw bundleError(`${label} archive must contain only ${expectedName}`);
  }
  return path.join(root, expectedName);
}

async function verifyRunnerIdentity(runnerRoot, lock) {
  const readJson = async (relative) => JSON.parse(await readFile(path.join(runnerRoot, relative), "utf8"));
  const runner = await readJson("package.json");
  if (
    runner.name !== lock.runner.name
    || runner.version !== lock.runner.version
    || runner.dependencies?.playwright !== lock.playwright.version
  ) {
    throw bundleError("released Runner identity or Playwright dependency does not match the runtime lock");
  }
  const playwright = await readJson("node_modules/playwright/package.json");
  if (playwright.version !== lock.playwright.version) {
    throw bundleError(`released Runner Playwright identity must be exactly ${lock.playwright.version}`);
  }
  const playwrightCore = await readJson("node_modules/playwright-core/package.json");
  if (playwrightCore.name !== "playwright-core" || playwrightCore.version !== lock.playwright.version) {
    throw bundleError(`released Runner playwright-core identity must be exactly ${lock.playwright.version}`);
  }
  const browsers = await readJson("node_modules/playwright-core/browsers.json");
  const revision = (name) => browsers.browsers?.find((item) => item.name === name)?.revision;
  if (
    revision("chromium") !== lock.playwright.chromium_revision
    || revision("chromium-headless-shell") !== lock.playwright.chromium_headless_shell_revision
    || revision("ffmpeg") !== lock.playwright.ffmpeg_revision
  ) {
    throw bundleError("released Runner Playwright browser identity does not match locked revisions");
  }
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function buildWindowsBundle(input = {}) {
  const arch = input.arch ?? process.arch;
  const hostArch = input.hostArch ?? process.arch;
  const lock = validateRuntimeLock(input.lock ?? JSON.parse(await readFile(
    input.lockPath ?? DEFAULT_LOCK_PATH,
    "utf8",
  )));
  if (!(arch in lock.node.windows)) throw bundleError(`unsupported Windows architecture: ${arch}`);
  if (hostArch !== arch) {
    throw bundleError(`host architecture ${hostArch} does not match target architecture ${arch}`);
  }
  const outputDir = path.resolve(input.outputDir ?? path.join(REPO_ROOT, "build", "windows-bundles"));
  const skillRoot = path.resolve(input.skillRoot ?? DEFAULT_SKILL_ROOT);
  await requireDirectory(skillRoot, "generated Skill package");
  await mkdir(outputDir, { recursive: true });
  const operations = defaultOperations(input.operations);
  const buildRoot = path.join(outputDir, `.windows-bundle-${arch}-${randomUUID()}`);
  const stagingRoot = path.join(buildRoot, "payload");
  const downloadsRoot = path.join(buildRoot, "downloads");
  const extractsRoot = path.join(buildRoot, "extracts");
  await mkdir(stagingRoot, { recursive: true });
  await mkdir(downloadsRoot, { recursive: true });
  await mkdir(extractsRoot, { recursive: true });
  let completed = false;
  try {
    const nodeArchivePath = path.join(downloadsRoot, "node.zip");
    const runnerArchivePath = path.join(downloadsRoot, "runner.tgz");
    await operations.download({
      url: lock.node.windows[arch].download_url,
      destination: nodeArchivePath,
    });
    await verifyArchive(nodeArchivePath, lock.node.windows[arch].sha256, undefined, "portable Node archive");
    await operations.download({ url: lock.runner.download_url, destination: runnerArchivePath });
    await verifyArchive(runnerArchivePath, lock.runner.sha256, lock.runner.size_bytes, "released Runner archive");

    const nodeExtract = path.join(extractsRoot, "node");
    const runnerExtract = path.join(extractsRoot, "runner");
    await mkdir(nodeExtract, { recursive: true });
    await mkdir(runnerExtract, { recursive: true });
    await operations.extractArchive({ kind: "zip", archivePath: nodeArchivePath, destination: nodeExtract });
    await operations.extractArchive({ kind: "tgz", archivePath: runnerArchivePath, destination: runnerExtract });
    const extractedNode = await findOnlyDirectory(
      nodeExtract,
      `node-v${lock.node.version}-win-${arch}`,
      "portable Node",
    );
    const extractedRunner = await findOnlyDirectory(runnerExtract, "package", "released Runner");
    await verifyRunnerIdentity(extractedRunner, lock);

    await cp(extractedNode, path.join(stagingRoot, "node"), { recursive: true });
    await cp(extractedRunner, path.join(stagingRoot, "runner"), { recursive: true });
    await cp(
      skillRoot,
      path.join(stagingRoot, "skill", "web-api-test-execution-evidence"),
      { recursive: true },
    );
    await mkdir(path.join(stagingRoot, "smoke"), { recursive: true });
    await cp(SMOKE_PROGRAM, path.join(stagingRoot, "smoke", "installation-smoke-test.mjs"));
    await cp(SMOKE_FIXTURE, path.join(stagingRoot, "smoke", "installation-smoke-fixture.html"));

    const browserCache = path.join(stagingRoot, "browser-cache");
    await mkdir(browserCache, { recursive: true });
    const browserArchives = [
      {
        name: "Chromium",
        archiveName: "chromium.zip",
        destination: `chromium-${lock.playwright.chromium_revision}`,
        lock: lock.playwright.archives.windows.chromium,
      },
      {
        name: "Chromium headless shell",
        archiveName: "chromium-headless-shell.zip",
        destination: `chromium_headless_shell-${lock.playwright.chromium_headless_shell_revision}`,
        lock: lock.playwright.archives.windows.chromium_headless_shell,
      },
      {
        name: "FFmpeg",
        archiveName: "ffmpeg.zip",
        destination: `ffmpeg-${lock.playwright.ffmpeg_revision}`,
        lock: lock.playwright.archives.windows.ffmpeg,
      },
    ];
    for (const browser of browserArchives) {
      const archivePath = path.join(downloadsRoot, browser.archiveName);
      await operations.download({ url: browser.lock.download_url, destination: archivePath });
      await verifyArchive(
        archivePath,
        browser.lock.sha256,
        browser.lock.size_bytes,
        `${browser.name} archive`,
      );
      await operations.extractBrowserArchive({
        archivePath,
        destination: path.join(browserCache, browser.destination),
      });
    }

    await validateBundleLayout(stagingRoot, lock, arch);
    const payload = await writeBundleManifest({ root: stagingRoot, lock, arch });
    const fileName = `web-api-test-execution-evidence-${lock.bundle_version}-windows-${arch}.zip`;
    const archivePath = path.join(outputDir, fileName);
    await rm(archivePath, { force: true });
    await operations.createArchive({ root: stagingRoot, outputPath: archivePath });
    const archiveSha256 = await sha256File(archivePath);
    const archiveSize = (await stat(archivePath)).size;
    const companionFileName = fileName.replace(/\.zip$/, ".manifest.json");
    const companionManifestPath = path.join(outputDir, companionFileName);
    const companion = {
      schema_version: 1,
      bundle: payload.manifest.bundle,
      archive: {
        file_name: fileName,
        download_url: `https://github.com/Saitamasans/testing-skills/releases/download/${lock.release_tag}/${fileName}`,
        size_bytes: archiveSize,
        sha256: archiveSha256,
      },
      payload_manifest: {
        path: "bundle-manifest.json",
        size_bytes: payload.size_bytes,
        sha256: payload.sha256,
      },
      installed_size_bytes: payload.manifest.installed_size_bytes + payload.size_bytes,
    };
    await writeJson(companionManifestPath, companion);
    const companionSha256 = await sha256File(companionManifestPath);
    const checksumPath = path.join(outputDir, "SHA256SUMS.txt");
    await writeFile(
      checksumPath,
      `${companionSha256}  ${companionFileName}\n${archiveSha256}  ${fileName}\n`,
      "utf8",
    );
    completed = true;
    return {
      arch,
      fileName,
      archivePath,
      companionManifestPath,
      checksumPath,
      stagingRoot,
      archiveSha256,
      companionSha256,
      payloadManifestSha256: payload.sha256,
    };
  } finally {
    if (!input.keepStaging || !completed) await rm(buildRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildWindowsBundle({ arch: process.argv[2], outputDir: process.argv[3] });
  console.log(JSON.stringify(result, null, 2));
}
