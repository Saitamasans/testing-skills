import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildReleaseTarball,
  hashBundledWorkspace,
  listTarEntries,
  normalizeReleaseTextTree,
  resolveReleaseOutputDir,
  sha256File,
} from "../packages/testing-runner/scripts/package-release.mjs";
import { verifyReleaseTarball } from "../packages/testing-runner/scripts/verify-release-tarball.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const COMPILER_ROOT = path.join(REPO_ROOT, "packages", "testing-contract-compiler");

async function trackedCompilerHashes() {
  const files = execFileSync(
    "git",
    ["ls-files", "packages/testing-contract-compiler"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim().split(/\r?\n/).filter(Boolean);
  return new Map(await Promise.all(files.map(async (relative) => [
    relative,
    createHash("sha256").update(await readFile(path.join(REPO_ROOT, relative))).digest("hex"),
  ])));
}

test("release packaging consumes a committed exact dependency lock", async () => {
  const runnerPackage = JSON.parse(await readFile(
    path.join(REPO_ROOT, "packages", "testing-runner", "package.json"),
    "utf8",
  ));
  const releaseLock = JSON.parse(await readFile(
    path.join(REPO_ROOT, "packages", "testing-runner", "release", "package-lock.json"),
    "utf8",
  ));
  const releaseScript = await readFile(
    path.join(REPO_ROOT, "packages", "testing-runner", "scripts", "package-release.mjs"),
    "utf8",
  );
  const bundledWorkspaces = JSON.parse(await readFile(
    path.join(
      REPO_ROOT,
      "packages",
      "testing-runner",
      "release",
      "bundled-workspaces.json",
    ),
    "utf8",
  ));
  const publicReleasePackage = JSON.parse(await readFile(
    path.join(REPO_ROOT, "packages", "testing-runner", "release", "package.json"),
    "utf8",
  ));
  const publicDependencies = { ...runnerPackage.dependencies };
  delete publicDependencies["@saitamasans/testing-contract-compiler"];

  assert.equal(releaseLock.lockfileVersion, 3);
  assert.equal(releaseLock.packages[""].name, runnerPackage.name);
  assert.equal(releaseLock.packages[""].version, runnerPackage.version);
  assert.deepEqual(releaseLock.packages[""].dependencies, publicDependencies);
  assert.deepEqual(publicReleasePackage.dependencies, publicDependencies);
  assert.deepEqual(
    new Set(publicReleasePackage.bundledDependencies),
    new Set(Object.keys(publicDependencies)),
  );
  assert.deepEqual(bundledWorkspaces, {
    schema_version: 1,
    packages: [{
      name: "@saitamasans/testing-contract-compiler",
      version: "1.0.0",
      source: "../../testing-contract-compiler",
      content_sha256: bundledWorkspaces.packages[0].content_sha256,
    }],
  });
  assert.match(bundledWorkspaces.packages[0].content_sha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(releaseScript, /package-lock-only/);
  assert.doesNotMatch(releaseScript, /pnpm/);
  assert.match(releaseScript, /release[\\/]+package-lock\.json/);
});

test("release CLI resolves a relative output directory from the repository root", () => {
  const repoRoot = fileURLToPath(new URL("..", import.meta.url));
  assert.equal(resolveReleaseOutputDir("build/releases"), path.join(repoRoot, "build", "releases"));
});

test("release staging normalizes owned text resources to LF", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "runner-release-text-"));
  const nested = path.join(root, "dist", "schemas");
  await mkdir(nested, { recursive: true });
  const textFile = path.join(nested, "fixture.json");
  const binaryFile = path.join(nested, "fixture.bin");
  await writeFile(textFile, "{\r\n  \"ok\": true\r\n}\r\n", "utf8");
  await writeFile(binaryFile, Buffer.from([0, 13, 10, 255]));

  await normalizeReleaseTextTree(root);

  assert.equal(await readFile(textFile, "utf8"), "{\n  \"ok\": true\n}\n");
  assert.deepEqual(await readFile(binaryFile), Buffer.from([0, 13, 10, 255]));
});

test("release tarball contains runner and bundled production dependencies", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-release-"));
  const manifestPath = path.join(outputDir, "runner-release.json");
  const release = await buildReleaseTarball(outputDir, manifestPath);
  const entries = await listTarEntries(release.archivePath);

  for (const required of [
    "package/dist/cli.js",
    "package/vendor/test-case-renderer.mjs",
    "package/node_modules/playwright/package.json",
    "package/node_modules/ajv/package.json",
    "package/node_modules/commander/package.json",
    "package/node_modules/exceljs/package.json",
    "package/node_modules/node-sql-parser/package.json",
    "package/node_modules/@saitamasans/testing-contract-compiler/package.json",
    "package/node_modules/@saitamasans/testing-contract-compiler/dist/index.js",
    "package/node_modules/jszip/package.json",
  ]) {
    assert.ok(entries.includes(required), required);
  }

  assert.equal(await sha256File(release.archivePath), release.sha256);
  assert.equal(release.fileName, "saitamasans-testing-runner-1.1.3.tgz");
  assert.ok(release.sizeBytes > 100_000);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest, {
    schema_version: 1,
    runner: {
      name: "@saitamasans/testing-runner",
      version: "1.1.3",
      download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.1.3/saitamasans-testing-runner-1.1.3.tgz",
      sha256: release.sha256,
      size_bytes: release.sizeBytes,
      minimum_node: 20,
    },
    browser: {
      provider: "playwright",
      name: "chromium",
      estimated_size_bytes: 180_000_000,
    },
  });
  assert.equal(release.manifestPath, manifestPath);
});

test("release packaging builds bundled Compiler only in a temporary copy without changing tracked source files", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-release-source-immutable-"));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const before = await trackedCompilerHashes();

  await buildReleaseTarball(outputDir, path.join(outputDir, "runner-release.json"));

  assert.deepEqual(await trackedCompilerHashes(), before);
  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "--", "packages/testing-contract-compiler"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim();
  assert.equal(changed, "");
  assert.equal(COMPILER_ROOT.endsWith(path.join("packages", "testing-contract-compiler")), true);
});

test("release tarball verification rejects workspace execution and succeeds outside checkout", async (t) => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-release-isolation-"));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "runner-workspace-"));
  const outsideWorkDir = await mkdtemp(path.join(os.tmpdir(), "runner-outside-workspace-"));
  const previousWorkspace = process.env.GITHUB_WORKSPACE;
  const previousNodePath = process.env.NODE_PATH;
  const previousNodeOptions = process.env.NODE_OPTIONS;
  t.after(async () => {
    if (previousWorkspace === undefined) delete process.env.GITHUB_WORKSPACE;
    else process.env.GITHUB_WORKSPACE = previousWorkspace;
    if (previousNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = previousNodePath;
    if (previousNodeOptions === undefined) delete process.env.NODE_OPTIONS;
    else process.env.NODE_OPTIONS = previousNodeOptions;
    await Promise.all([outputDir, workspace, outsideWorkDir].map(
      (directory) => rm(directory, { recursive: true, force: true }),
    ));
  });

  const release = await buildReleaseTarball(outputDir, path.join(outputDir, "runner-release.json"));
  process.env.GITHUB_WORKSPACE = workspace;
  process.env.NODE_PATH = path.join(REPO_ROOT, "node_modules");
  process.env.NODE_OPTIONS = `--require=${path.join(REPO_ROOT, "package.json")}`;
  await assert.rejects(
    verifyReleaseTarball(release.archivePath, path.join(workspace, "build", "packaged-tar")),
    /package root must be outside GITHUB_WORKSPACE/,
  );

  const evidence = await verifyReleaseTarball(release.archivePath, outsideWorkDir);
  assert.equal(evidence.workspace_realpath, await realpath(workspace));
  assert.equal(
    evidence.package_root_realpath,
    await realpath(path.join(outsideWorkDir, "extracted", "package")),
  );
  assert.equal(evidence.package_outside_workspace, true);
  assert.equal(evidence.NODE_PATH, null);
  assert.equal(evidence.NODE_OPTIONS, null);
  assert.deepEqual(evidence.commands, [
    "--version",
    "compiler compile",
    "plan",
    "approve",
    "run",
    "verify-report",
  ]);
});

test("bundled workspace hashes normalize owned text line endings", async (t) => {
  const lfRoot = await mkdtemp(path.join(os.tmpdir(), "runner-workspace-lf-"));
  const crlfRoot = await mkdtemp(path.join(os.tmpdir(), "runner-workspace-crlf-"));
  t.after(async () => {
    await Promise.all([
      rm(lfRoot, { recursive: true, force: true }),
      rm(crlfRoot, { recursive: true, force: true }),
    ]);
  });
  for (const root of [lfRoot, crlfRoot]) {
    await mkdir(path.join(root, "dist"), { recursive: true });
    await mkdir(path.join(root, "schemas"), { recursive: true });
  }
  await writeFile(path.join(lfRoot, "package.json"), "{\n  \"name\": \"fixture\"\n}\n");
  await writeFile(path.join(lfRoot, "dist", "index.js"), "export const ok = true;\n");
  await writeFile(path.join(lfRoot, "dist", "index.js.map"), "{\n  \"version\": 3\n}\n");
  await writeFile(path.join(lfRoot, "schemas", "schema.json"), "{\n  \"type\": \"object\"\n}\n");
  await writeFile(path.join(crlfRoot, "package.json"), "{\r\n  \"name\": \"fixture\"\r\n}\r\n");
  await writeFile(path.join(crlfRoot, "dist", "index.js"), "export const ok = true;\r\n");
  await writeFile(path.join(crlfRoot, "dist", "index.js.map"), "{\r\n  \"version\": 3\r\n}\r\n");
  await writeFile(path.join(crlfRoot, "schemas", "schema.json"), "{\r\n  \"type\": \"object\"\r\n}\r\n");

  assert.equal(await hashBundledWorkspace(lfRoot), await hashBundledWorkspace(crlfRoot));
});
