import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  inventoryTree,
  validateBundleLayout,
  validateInventoryEntries,
  validateRuntimeLock,
  writeBundleManifest,
} from "../packages/testing-runner/scripts/windows-bundle-lib.mjs";
import {
  buildWindowsBundle,
  createDeterministicZip,
} from "../packages/testing-runner/scripts/build-windows-bundle.mjs";
import {
  createSmokeDocuments,
  validateSmokeArtifacts,
} from "../packages/testing-runner/scripts/installation-smoke-test.mjs";
import { renderBoth } from "../packages/testing-runner/vendor/test-case-renderer.mjs";

const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const fixturePath = path.join(
  repoRoot,
  "packages/testing-runner/assets/installation-smoke-fixture.html",
);
const smokeColumns = [
  "用例 ID",
  "所属模块",
  "用例标题",
  "验证功能点",
  "前置条件",
  "测试步骤",
  "预期结果",
  "优先级",
  "执行结果",
  "备注",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function readZipEntries(bytes) {
  const endOffset = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.notEqual(endOffset, -1, "ZIP end record");
  const count = bytes.readUInt16LE(endOffset + 10);
  let offset = bytes.readUInt32LE(endOffset + 16);
  const entries = new Map();
  for (let index = 0; index < count; index += 1) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50, `central entry ${index}`);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    assert.equal(entries.has(name), false, `duplicate ZIP entry ${name}`);
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50, `local entry ${name}`);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, inflateRawSync(bytes.subarray(dataOffset, dataOffset + compressedSize)));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

async function tempDir(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function checkedLock() {
  return readJson(path.join(
    repoRoot,
    "packages/testing-runner/release/windows-runtime-lock.json",
  ));
}

test("root package exposes the locked Windows bundle build entry point", async () => {
  const packageJson = await readJson(path.join(repoRoot, "package.json"));
  assert.equal(
    packageJson.scripts["build:windows-bundle"],
    "node packages/testing-runner/scripts/build-windows-bundle.mjs",
  );
});

test("installation smoke compares the Runner CLI version with the bundle manifest dynamically", async () => {
  const smoke = await import("../packages/testing-runner/scripts/installation-smoke-test.mjs");
  assert.equal(typeof smoke.assertRunnerVersionMatchesManifest, "function");
  assert.doesNotThrow(() => smoke.assertRunnerVersionMatchesManifest("7.8.9", "7.8.9"));
  assert.throws(
    () => smoke.assertRunnerVersionMatchesManifest("7.8.8", "7.8.9"),
    /Runner CLI version does not match payload manifest/,
  );
});

test("release CI builds the requested architecture on its native Windows host", async () => {
  const workflow = await readFile(
    path.join(repoRoot, ".github/workflows/build-complete-windows-bundles.yml"),
    "utf8",
  );
  assert.match(workflow, /architecture:[\s\S]*required:\s*true[\s\S]*source_commit:/);
  assert.match(workflow, /runs-on:.*inputs\.architecture.*windows-2025.*windows-11-arm/);
  assert.match(workflow, /architecture:\s*\$\{\{ inputs\.architecture \}\}/);
  assert.match(workflow, /build-windows-bundle\.mjs.*inputs\.architecture/);
  assert.match(workflow, /ref:\s*\$\{\{ inputs\.source_commit \}\}/);
  assert.match(workflow, /node\\node\.exe.*installation-smoke-test\.mjs/);
});

async function createFakeBundle(root, lock) {
  lock ??= await checkedLock();
  const files = {
    "node/node.exe": "fake-node",
    "runner/dist/cli.js": "fake-runner-cli",
    "runner/node_modules/playwright/cli.js": "fake-playwright-cli",
    "skill/web-api-test-execution-evidence/SKILL.md": "---\nname: web-api-test-execution-evidence\n---\n",
    "smoke/installation-smoke-test.mjs": "export const smoke = true;\n",
    "smoke/installation-smoke-fixture.html": "<!doctype html><p>Bundle Smoke Ready</p>\n",
    [`browser-cache/chromium-${lock.playwright.chromium_revision}/chrome-win64/chrome.exe`]: "chromium",
    [`browser-cache/chromium_headless_shell-${lock.playwright.chromium_headless_shell_revision}/chrome-headless-shell-win64/chrome-headless-shell.exe`]: "headless-shell",
    [`browser-cache/ffmpeg-${lock.playwright.ffmpeg_revision}/ffmpeg-win64.exe`]: "ffmpeg",
  };
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, "utf8");
  }
  await writeJson(path.join(root, "runner/package.json"), {
    name: lock.runner.name,
    version: lock.runner.version,
    dependencies: { playwright: lock.playwright.version },
  });
  await writeJson(path.join(root, "runner/node_modules/playwright/package.json"), {
    name: "playwright",
    version: lock.playwright.version,
  });
  await writeJson(path.join(root, "runner/node_modules/playwright-core/package.json"), {
    name: "playwright-core",
    version: lock.playwright.version,
  });
  await writeJson(path.join(root, "runner/node_modules/playwright-core/browsers.json"), {
    browsers: [
      { name: "chromium", revision: lock.playwright.chromium_revision, installByDefault: true, browserVersion: "149.0.7827.55" },
      { name: "chromium-headless-shell", revision: lock.playwright.chromium_headless_shell_revision, installByDefault: true, browserVersion: "149.0.7827.55" },
      { name: "ffmpeg", revision: lock.playwright.ffmpeg_revision, installByDefault: true },
    ],
  });
}

test("runtime lock accepts only the complete exact Windows component contract", async () => {
  const lock = await checkedLock();
  assert.equal(validateRuntimeLock(lock), lock);

  const floating = structuredClone(lock);
  floating.playwright.version = "^1.61.1";
  assert.throws(() => validateRuntimeLock(floating), /playwright.*1\.61\.1|exact/i);

  const insecure = structuredClone(lock);
  insecure.runner.download_url = "http://example.invalid/runner.tgz";
  assert.throws(() => validateRuntimeLock(insecure), /https/i);
});

test("runtime lock requires exact verified Windows archives for every Playwright browser component", async () => {
  const lock = await checkedLock();
  const archives = lock.playwright.archives?.windows;
  assert.deepEqual(archives, {
    chromium: {
      download_url: "https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/win64/chrome-win64.zip",
      size_bytes: 192511857,
      sha256: "ebc0c2b75e2ea98151a7f18ff47037bfcbab44a8660e79b9ffa6520f9b7607ab",
    },
    chromium_headless_shell: {
      download_url: "https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/win64/chrome-headless-shell-win64.zip",
      size_bytes: 119099822,
      sha256: "5cfda0c763aa6a867ce2efad0c467e3220e9c5c01c4cba02fd57afe49ede5457",
    },
    ffmpeg: {
      download_url: "https://cdn.playwright.dev/dbazure/download/playwright/builds/ffmpeg/1011/ffmpeg-win64.zip",
      size_bytes: 1411741,
      sha256: "8d08827c019ad36e7b9d49d3648447d884534cb2acf200e71c715f6dd834cc50",
    },
  });

  const missing = structuredClone(lock);
  delete missing.playwright.archives;
  assert.throws(() => validateRuntimeLock(missing), /archive|windows|chromium/i);

  for (const component of ["chromium", "chromium_headless_shell", "ffmpeg"]) {
    const invalidUrl = structuredClone(lock);
    invalidUrl.playwright.archives.windows[component].download_url = "http://example.invalid/archive.zip";
    assert.throws(() => validateRuntimeLock(invalidUrl), /https/i, component);

    const invalidSize = structuredClone(lock);
    invalidSize.playwright.archives.windows[component].size_bytes = 0;
    assert.throws(() => validateRuntimeLock(invalidSize), /size|positive/i, component);

    const invalidHash = structuredClone(lock);
    invalidHash.playwright.archives.windows[component].sha256 = "a".repeat(63);
    assert.throws(() => validateRuntimeLock(invalidHash), /sha-256/i, component);
  }
  assert.doesNotMatch(JSON.stringify(archives), /win-arm64/i);
});

test("inventory uses normalized slash paths and records exact size and SHA-256", async () => {
  const root = await tempDir("windows-bundle-inventory-");
  await mkdir(path.join(root, "Nested"), { recursive: true });
  await writeFile(path.join(root, "Nested", "a.txt"), "alpha", "utf8");
  await writeFile(path.join(root, "z.bin"), Buffer.from([0, 1, 2]));

  const inventory = await inventoryTree(root);

  assert.deepEqual(inventory, [
    { path: "Nested/a.txt", size_bytes: 5, sha256: sha256("alpha") },
    { path: "z.bin", size_bytes: 3, sha256: sha256(Buffer.from([0, 1, 2])) },
  ]);
});

test("inventory rejects traversal, case-insensitive duplicates, and reparse points", async () => {
  const digest = "a".repeat(64);
  assert.throws(
    () => validateInventoryEntries([{ path: "../escape", size_bytes: 1, sha256: digest }]),
    /traversal|unsafe/i,
  );
  assert.throws(
    () => validateInventoryEntries([
      { path: "Runner/package.json", size_bytes: 1, sha256: digest },
      { path: "runner/package.json", size_bytes: 1, sha256: digest },
    ]),
    /duplicate.*case|case-insensitive/i,
  );

  const root = await tempDir("windows-bundle-reparse-");
  const target = path.join(root, "target.txt");
  const link = path.join(root, "link.txt");
  await writeFile(target, "target", "utf8");
  await writeFile(link, "placeholder", "utf8");
  const realLstat = (await import("node:fs/promises")).lstat;
  await assert.rejects(
    inventoryTree(root, {
      lstat: async (file) => file === link
        ? { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false }
        : realLstat(file),
    }),
    /reparse|symbolic link/i,
  );
});

test("bundle layout locks exact components and requires the local smoke fixture", async () => {
  const lock = await checkedLock();
  const root = await tempDir("windows-bundle-layout-");
  await createFakeBundle(root, lock);

  const layout = await validateBundleLayout(root, lock, "x64");

  assert.deepEqual(layout, {
    bundle_version: "1.0.1",
    release_tag: "web-api-test-execution-evidence-v1.0.1",
    os: "windows",
    arch: "x64",
    node: { version: "22.23.1" },
    runner: {
      name: "@saitamasans/testing-runner",
      version: "1.1.2",
      download_url: lock.runner.download_url,
      sha256: lock.runner.sha256,
      size_bytes: lock.runner.size_bytes,
    },
    playwright: {
      version: "1.61.1",
      chromium_revision: "1228",
      chromium_headless_shell_revision: "1228",
      ffmpeg_revision: "1011",
      archives: lock.playwright.archives,
    },
    skill: { name: "web-api-test-execution-evidence" },
  });

  await writeFile(path.join(root, "smoke/installation-smoke-fixture.html"), "", "utf8");
  await assert.rejects(validateBundleLayout(root, lock, "x64"), /Bundle Smoke Ready/);
});

test("bundle layout rejects playwright-core drift and empty browser cache directories", async () => {
  const lock = await checkedLock();
  const root = await tempDir("windows-bundle-browser-layout-");
  await createFakeBundle(root, lock);
  await writeJson(path.join(root, "runner/node_modules/playwright-core/package.json"), {
    name: "playwright-core",
    version: "1.61.0",
  });
  await assert.rejects(validateBundleLayout(root, lock, "x64"), /playwright-core.*1\.61\.1/i);

  await writeJson(path.join(root, "runner/node_modules/playwright-core/package.json"), {
    name: "playwright-core",
    version: lock.playwright.version,
  });
  const executable = path.join(
    root,
    `browser-cache/chromium-${lock.playwright.chromium_revision}/chrome-win64/chrome.exe`,
  );
  await rm(executable);
  await assert.rejects(validateBundleLayout(root, lock, "x64"), /chromium.*chrome\.exe|browser executable/i);
});

test("payload manifest inventories every payload file without a self-hash cycle", async () => {
  const lock = await checkedLock();
  const root = await tempDir("windows-bundle-manifest-");
  await createFakeBundle(root, lock);

  const written = await writeBundleManifest({ root, lock, arch: "arm64" });
  const manifest = await readJson(written.path);

  assert.equal(written.sha256, sha256(await readFile(written.path)));
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.bundle.arch, "arm64");
  assert.equal(manifest.components.runner.version, "1.1.2");
  assert.equal(manifest.components.playwright.chromium_revision, "1228");
  assert.equal(manifest.files.some((entry) => entry.path === "bundle-manifest.json"), false);
  assert.equal(manifest.files.some((entry) => entry.path === "smoke/installation-smoke-fixture.html"), true);
  assert.equal(
    manifest.installed_size_bytes,
    manifest.files.reduce((total, entry) => total + entry.size_bytes, 0),
  );
});

test("deterministic ZIP is extractable, complete, duplicate-free, and stable across builds", async () => {
  const root = await tempDir("windows-bundle-real-zip-");
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "a.txt"), "alpha", "utf8");
  await writeFile(path.join(root, "nested", "b.bin"), Buffer.from([0, 1, 2, 3]));
  const first = path.join(await tempDir("windows-bundle-zip-out-"), "first.zip");
  const second = path.join(await tempDir("windows-bundle-zip-out-"), "second.zip");

  await createDeterministicZip({ root, outputPath: first });
  await createDeterministicZip({ root, outputPath: second });

  const firstBytes = await readFile(first);
  const secondBytes = await readFile(second);
  assert.equal(sha256(firstBytes), sha256(secondBytes));
  assert.deepEqual(
    [...readZipEntries(firstBytes)].map(([name, content]) => [name, content.toString("hex")]),
    [
      ["a.txt", Buffer.from("alpha").toString("hex")],
      ["nested/b.bin", Buffer.from([0, 1, 2, 3]).toString("hex")],
    ],
  );
});

test("deterministic ZIP retries partial FileHandle writes until every byte is persisted", async () => {
  const root = await tempDir("windows-bundle-short-write-");
  await writeFile(path.join(root, "payload.txt"), "partial-write-contract", "utf8");
  const expectedPath = path.join(await tempDir("windows-bundle-full-write-"), "expected.zip");
  await createDeterministicZip({ root, outputPath: expectedPath });
  const expected = await readFile(expectedPath);
  let persisted = Buffer.alloc(0);
  const handle = {
    write: async (buffer, bufferOffset, length, position) => {
      const bytesWritten = Math.min(7, length);
      const required = position + bytesWritten;
      if (persisted.length < required) {
        const grown = Buffer.alloc(required);
        persisted.copy(grown);
        persisted = grown;
      }
      buffer.copy(persisted, position, bufferOffset, bufferOffset + bytesWritten);
      return { bytesWritten, buffer };
    },
    close: async () => undefined,
  };

  await createDeterministicZip({
    root,
    outputPath: "ignored-by-injected-open.zip",
    openFile: async () => handle,
  });

  assert.deepEqual(persisted, expected);
});

async function createBuilderSources(root, lock, runnerPlaywrightVersion = "1.61.1", arch = "x64") {
  const nodeSource = path.join(root, "node-source", `node-v${lock.node.version}-win-${arch}`);
  const runnerSource = path.join(root, "runner-source", "package");
  const skillRoot = path.join(root, "generated-skill");
  await mkdir(nodeSource, { recursive: true });
  await writeFile(path.join(nodeSource, "node.exe"), "fake-node", "utf8");
  await mkdir(path.join(runnerSource, "dist"), { recursive: true });
  await writeFile(path.join(runnerSource, "dist/cli.js"), "fake-runner", "utf8");
  await writeJson(path.join(runnerSource, "package.json"), {
    name: lock.runner.name,
    version: lock.runner.version,
    dependencies: { playwright: runnerPlaywrightVersion },
  });
  await writeJson(path.join(runnerSource, "node_modules/playwright/package.json"), {
    name: "playwright",
    version: runnerPlaywrightVersion,
  });
  await writeJson(path.join(runnerSource, "node_modules/playwright-core/package.json"), {
    name: "playwright-core",
    version: runnerPlaywrightVersion,
  });
  await writeFile(path.join(runnerSource, "node_modules/playwright/cli.js"), "fake-cli", "utf8");
  await writeJson(path.join(runnerSource, "node_modules/playwright-core/browsers.json"), {
    browsers: [
      { name: "chromium", revision: "1228", installByDefault: true, browserVersion: "149.0.7827.55" },
      { name: "chromium-headless-shell", revision: "1228", installByDefault: true, browserVersion: "149.0.7827.55" },
      { name: "ffmpeg", revision: "1011", installByDefault: true },
    ],
  });
  await mkdir(skillRoot, { recursive: true });
  await writeFile(path.join(skillRoot, "SKILL.md"), "---\nname: web-api-test-execution-evidence\n---\n", "utf8");
  return { nodeSource, runnerSource, skillRoot };
}

async function createLockedBrowserArchives(root, lock) {
  const definitions = {
    chromium: { file: "chrome-win64/chrome.exe", content: "chromium" },
    chromium_headless_shell: {
      file: "chrome-headless-shell-win64/chrome-headless-shell.exe",
      content: "headless",
    },
    ffmpeg: { file: "ffmpeg-win64.exe", content: "ffmpeg" },
  };
  const archives = new Map();
  for (const [component, definition] of Object.entries(definitions)) {
    const source = path.join(root, `browser-source-${component}`);
    const archivePath = path.join(root, `${component}.zip`);
    const file = path.join(source, ...definition.file.split("/"));
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, definition.content, "utf8");
    await createDeterministicZip({ root: source, outputPath: archivePath });
    const bytes = await readFile(archivePath);
    const locked = lock.playwright.archives.windows[component];
    locked.size_bytes = bytes.length;
    locked.sha256 = sha256(bytes);
    archives.set(locked.download_url, bytes);
  }
  return archives;
}

function replaceZipEntryName(bytes, from, to) {
  const source = Buffer.from(from, "utf8");
  const target = Buffer.from(to, "utf8");
  assert.equal(target.length, source.length, "ZIP entry replacement must preserve length");
  const replaced = Buffer.from(bytes);
  for (let offset = 0; offset <= replaced.length - source.length; offset += 1) {
    if (replaced.subarray(offset, offset + source.length).equals(source)) target.copy(replaced, offset);
  }
  return replaced;
}

test("builder consumes only locked release assets and binds companion to payload and ZIP hashes", async () => {
  const root = await tempDir("windows-bundle-build-");
  const outputDir = path.join(root, "out");
  const nodeArchive = Buffer.from("fake-node-archive");
  const runnerArchive = Buffer.from("fake-runner-release-archive");
  const lock = await checkedLock();
  lock.node.windows.x64.sha256 = sha256(nodeArchive);
  lock.runner.sha256 = sha256(runnerArchive);
  lock.runner.size_bytes = runnerArchive.length;
  const sources = await createBuilderSources(root, lock);
  const browserArchives = await createLockedBrowserArchives(root, lock);
  const downloads = [];

  const result = await buildWindowsBundle({
    arch: "x64",
    hostArch: "x64",
    outputDir,
    lock,
    skillRoot: sources.skillRoot,
    keepStaging: true,
    operations: {
      download: async ({ url, destination }) => {
        downloads.push(url);
        await writeFile(
          destination,
          url === lock.runner.download_url ? runnerArchive : browserArchives.get(url) ?? nodeArchive,
        );
      },
      extractArchive: async ({ kind, destination }) => {
        await cp(kind === "zip" ? path.dirname(sources.nodeSource) : path.dirname(sources.runnerSource), destination, { recursive: true });
      },
      run: async () => assert.fail("Playwright CLI browser installation must not run"),
      createArchive: async ({ outputPath }) => {
        await writeFile(outputPath, Buffer.from("deterministic-fake-zip"));
      },
    },
  });

  assert.deepEqual(downloads, [
    lock.node.windows.x64.download_url,
    lock.runner.download_url,
    lock.playwright.archives.windows.chromium.download_url,
    lock.playwright.archives.windows.chromium_headless_shell.download_url,
    lock.playwright.archives.windows.ffmpeg.download_url,
  ]);
  assert.equal([...browserArchives.keys()].some((url) => /win-arm64/i.test(url)), false);
  assert.equal(
    await readFile(path.join(
      result.stagingRoot,
      `browser-cache/chromium-${lock.playwright.chromium_revision}/chrome-win64/chrome.exe`,
    ), "utf8"),
    "chromium",
  );
  assert.equal(result.fileName, "web-api-test-execution-evidence-1.0.1-windows-x64.zip");
  const companion = await readJson(result.companionManifestPath);
  const payloadBytes = await readFile(path.join(result.stagingRoot, "bundle-manifest.json"));
  assert.equal(companion.archive.sha256, sha256(await readFile(result.archivePath)));
  assert.equal(companion.payload_manifest.sha256, sha256(payloadBytes));
  assert.equal(companion.payload_manifest.path, "bundle-manifest.json");
  assert.match(companion.archive.download_url, /web-api-test-execution-evidence-v1\.0\.1/);
  assert.match(await readFile(result.checksumPath, "utf8"), new RegExp(companion.archive.sha256));
});

test("ARM64 fake builder consumes the ARM64 Node asset on an ARM64 host", async () => {
  const root = await tempDir("windows-bundle-arm64-");
  const nodeArchive = Buffer.from("fake-arm64-node-archive");
  const runnerArchive = Buffer.from("fake-runner-release-archive");
  const lock = await checkedLock();
  lock.node.windows.arm64.sha256 = sha256(nodeArchive);
  lock.runner.sha256 = sha256(runnerArchive);
  lock.runner.size_bytes = runnerArchive.length;
  const sources = await createBuilderSources(root, lock, "1.61.1", "arm64");
  const browserArchives = await createLockedBrowserArchives(root, lock);
  const downloads = [];

  const result = await buildWindowsBundle({
    arch: "arm64",
    hostArch: "arm64",
    outputDir: path.join(root, "out"),
    lock,
    skillRoot: sources.skillRoot,
    operations: {
      download: async ({ url, destination }) => {
        downloads.push(url);
        await writeFile(
          destination,
          url === lock.runner.download_url ? runnerArchive : browserArchives.get(url) ?? nodeArchive,
        );
      },
      extractArchive: async ({ kind, destination }) => cp(
        kind === "zip" ? path.dirname(sources.nodeSource) : path.dirname(sources.runnerSource),
        destination,
        { recursive: true },
      ),
      run: async () => assert.fail("Playwright CLI browser installation must not run"),
      createArchive: async ({ outputPath }) => writeFile(outputPath, "arm64-zip", "utf8"),
    },
  });

  assert.deepEqual(downloads, [
    lock.node.windows.arm64.download_url,
    lock.runner.download_url,
    lock.playwright.archives.windows.chromium.download_url,
    lock.playwright.archives.windows.chromium_headless_shell.download_url,
    lock.playwright.archives.windows.ffmpeg.download_url,
  ]);
  assert.equal(result.fileName, "web-api-test-execution-evidence-1.0.1-windows-arm64.zip");
});

test("builder rejects a verified browser ZIP that attempts path traversal before extraction", async () => {
  const root = await tempDir("windows-bundle-browser-zip-slip-");
  const nodeArchive = Buffer.from("fake-node-archive");
  const runnerArchive = Buffer.from("fake-runner-release-archive");
  const lock = await checkedLock();
  lock.node.windows.x64.sha256 = sha256(nodeArchive);
  lock.runner.sha256 = sha256(runnerArchive);
  lock.runner.size_bytes = runnerArchive.length;
  const sources = await createBuilderSources(root, lock);
  const browserArchives = await createLockedBrowserArchives(root, lock);
  const chromiumUrl = lock.playwright.archives.windows.chromium.download_url;
  const maliciousChromium = replaceZipEntryName(
    browserArchives.get(chromiumUrl),
    "chrome-win64",
    "../evil-zip!",
  );
  lock.playwright.archives.windows.chromium.size_bytes = maliciousChromium.length;
  lock.playwright.archives.windows.chromium.sha256 = sha256(maliciousChromium);
  browserArchives.set(chromiumUrl, maliciousChromium);

  await assert.rejects(buildWindowsBundle({
    arch: "x64",
    hostArch: "x64",
    outputDir: path.join(root, "out"),
    lock,
    skillRoot: sources.skillRoot,
    operations: {
      download: async ({ url, destination }) => writeFile(
        destination,
        url === lock.runner.download_url ? runnerArchive : browserArchives.get(url) ?? nodeArchive,
      ),
      extractArchive: async ({ kind, destination }) => cp(
        kind === "zip" ? path.dirname(sources.nodeSource) : path.dirname(sources.runnerSource),
        destination,
        { recursive: true },
      ),
      run: async () => assert.fail("Playwright CLI browser installation must not run"),
      createArchive: async () => assert.fail("payload archive must not be created"),
    },
  }), /ZIP.*unsafe|ZIP.*traversal|traversal.*ZIP/i);
});

test("builder rejects target and host architecture mismatch before downloads", async () => {
  const root = await tempDir("windows-bundle-host-mismatch-");
  const lock = await checkedLock();
  const sources = await createBuilderSources(root, lock, "1.61.1", "arm64");
  await assert.rejects(buildWindowsBundle({
    arch: "arm64",
    hostArch: "x64",
    outputDir: path.join(root, "out"),
    lock,
    skillRoot: sources.skillRoot,
    operations: {
      download: async () => assert.fail("host mismatch must fail before download"),
      extractArchive: async () => assert.fail("host mismatch must fail before extract"),
      run: async () => assert.fail("host mismatch must fail before process"),
      createArchive: async () => assert.fail("host mismatch must fail before archive"),
    },
  }), /host architecture x64.*target architecture arm64/i);
});

test("builder rejects a released Runner whose internal Playwright identity drifts", async () => {
  const root = await tempDir("windows-bundle-runner-drift-");
  const nodeArchive = Buffer.from("node");
  const runnerArchive = Buffer.from("runner");
  const lock = await checkedLock();
  lock.node.windows.x64.sha256 = sha256(nodeArchive);
  lock.runner.sha256 = sha256(runnerArchive);
  lock.runner.size_bytes = runnerArchive.length;
  const sources = await createBuilderSources(root, lock, "1.61.0");

  await assert.rejects(buildWindowsBundle({
    arch: "x64",
    outputDir: path.join(root, "out"),
    lock,
    skillRoot: sources.skillRoot,
    operations: {
      download: async ({ url, destination }) => writeFile(
        destination,
        url === lock.runner.download_url ? runnerArchive : nodeArchive,
      ),
      extractArchive: async ({ kind, destination }) => cp(
        kind === "zip" ? path.dirname(sources.nodeSource) : path.dirname(sources.runnerSource),
        destination,
        { recursive: true },
      ),
      run: async () => assert.fail("browser install must not start"),
      createArchive: async () => assert.fail("archive must not be created"),
    },
  }), /Playwright.*1\.61\.1|identity/i);
});

test("smoke contract is loopback-only R0 with one explicit visible-text assertion", async () => {
  const documents = createSmokeDocuments({ origin: "http://127.0.0.1:43123" });

  assert.deepEqual(documents.profile.targets, {
    fixture: { kind: "web", origin: "http://127.0.0.1:43123" },
  });
  assert.deepEqual(documents.approval.targets, ["http://127.0.0.1:43123"]);
  assert.equal(documents.manifest.cases.length, 1);
  assert.deepEqual(documents.manifest.cases[0].steps.map((step) => step.risk), ["R0", "R0"]);
  assert.deepEqual(documents.manifest.cases[0].steps.at(-1), {
    type: "web.assert",
    action_id: "BUNDLE-SMOKE-001-visible-text",
    target_alias: "fixture",
    assertion: "text=Bundle Smoke Ready",
    risk: "R0",
  });
  assert.match(await readFile(fixturePath, "utf8"), /Bundle Smoke Ready/);
});

test("smoke artifact inventory reads run events from the Runner run directory", async () => {
  const smoke = await import("../packages/testing-runner/scripts/installation-smoke-test.mjs");
  assert.deepEqual(smoke.requiredSmokeArtifactPaths("run-bundle-smoke"), [
    "run-result.json",
    "projected-report.json",
    "result.html",
    "result.xlsx",
    "run-bundle-smoke/run-events.jsonl",
  ]);
});

test("smoke validator requires matching assertion, PNG hash, Trace, and every report projection", async () => {
  const outputDir = await tempDir("windows-bundle-smoke-output-");
  const runId = "run-bundle-smoke";
  const runOutputDir = path.join(outputDir, runId);
  const gotoEvidencePath = "evidence/BUNDLE-SMOKE-001/attempt-1/BUNDLE-SMOKE-001-open-fixture/web-page.png";
  const evidencePath = "evidence/BUNDLE-SMOKE-001/attempt-1/BUNDLE-SMOKE-001-visible-text/web-page.png";
  const tracePath = "evidence/BUNDLE-SMOKE-001/playwright-trace.zip";
  const gotoPng = Buffer.from("goto-png");
  const png = Buffer.from("png");
  const trace = Buffer.from("trace");
  await mkdir(path.dirname(path.join(runOutputDir, gotoEvidencePath)), { recursive: true });
  await mkdir(path.dirname(path.join(runOutputDir, evidencePath)), { recursive: true });
  await mkdir(path.dirname(path.join(outputDir, tracePath)), { recursive: true });
  await writeFile(path.join(runOutputDir, gotoEvidencePath), gotoPng);
  await writeFile(path.join(runOutputDir, evidencePath), png);
  await writeFile(path.join(outputDir, tracePath), trace);
  const result = {
    protocol_version: "1.0.1",
    run_id: runId,
    manifest_hash: "a".repeat(64),
    run_status: "completed",
    started_at: "2026-07-18T00:00:00.000Z",
    completed_at: "2026-07-18T00:00:01.000Z",
    cases: [{
      case_id: "BUNDLE-SMOKE-001",
      case_status: "通过",
      run_status: "completed",
      assertions: [{
        assertion_id: "BUNDLE-SMOKE-001-visible-text",
        passed: true,
        actual: { text: "Bundle Smoke Ready", visible_count: 1 },
      }],
      evidence: [
        { path: gotoEvidencePath, sha256: sha256(gotoPng) },
        { path: evidencePath, sha256: sha256(png) },
        { path: tracePath, sha256: sha256(trace) },
      ],
    }],
  };
  const projected = {
    title: "Bundle smoke result",
    generated_at: "2026-07-18T00:00:01.000Z",
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns: smokeColumns,
        rows: [{ values: ["BUNDLE-SMOKE-001", "installation", "smoke", "visible text", "", "open", "ready", "P0", "通过", ""] }],
      },
      {
        name: "Assertion outcomes",
        kind: "supplementary",
        columns: ["Case ID", "Assertion ID", "Passed", "Actual", "Expected"],
        rows: [{ values: [
          "BUNDLE-SMOKE-001",
          "BUNDLE-SMOKE-001-visible-text",
          "true",
          JSON.stringify(result.cases[0].assertions[0].actual),
          JSON.stringify(result.cases[0].assertions[0].expected),
        ] }],
      },
      {
        name: "Evidence references",
        kind: "supplementary",
        columns: ["Case ID", "Run status", "Case status", "Evidence path", "SHA-256"],
        rows: result.cases[0].evidence.map((item) => ({ values: ["BUNDLE-SMOKE-001", "completed", "通过", item.path, item.sha256] })),
      },
    ],
  };
  await writeJson(path.join(outputDir, "run-result.json"), result);
  await writeJson(path.join(outputDir, "projected-report.json"), projected);
  await renderBoth(projected, outputDir, "result");

  const runnerRoot = path.join(repoRoot, "packages/testing-runner");
  const validated = await validateSmokeArtifacts({ outputDir, runnerRoot });

  assert.equal(validated.run_id, runId);
  assert.equal(validated.case_id, "BUNDLE-SMOKE-001");
  assert.equal(validated.assertion_passed, true);
  assert.equal(validated.png.path, evidencePath);
  assert.equal(validated.trace.path, tracePath);

  const htmlPath = path.join(outputDir, "result.html");
  const validHtml = await readFile(htmlPath, "utf8");
  const driftedHtml = validHtml.replace(
    '"BUNDLE-SMOKE-001-visible-text","true"',
    '"BUNDLE-SMOKE-001-visible-text","false"',
  );
  assert.notEqual(driftedHtml, validHtml, "HTML assertion row was not located");
  await writeFile(htmlPath, `${driftedHtml}<!-- true ${evidencePath} ${tracePath} -->`, "utf8");
  await assert.rejects(
    validateSmokeArtifacts({ outputDir, runnerRoot }),
    /HTML.*assertion|assertion.*HTML/i,
  );

  await writeFile(htmlPath, validHtml, "utf8");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(outputDir, "result.xlsx"));
  workbook.getWorksheet("Assertion outcomes").getCell("C2").value = "false";
  await workbook.xlsx.writeFile(path.join(outputDir, "result.xlsx"));
  await assert.rejects(
    validateSmokeArtifacts({ outputDir, runnerRoot }),
    /Excel.*assertion|assertion.*Excel/i,
  );

  result.cases[0].assertions[0].passed = false;
  await writeJson(path.join(outputDir, "run-result.json"), result);
  await assert.rejects(validateSmokeArtifacts({ outputDir, runnerRoot }), /assertion.*pass/i);
});
