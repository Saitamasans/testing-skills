import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildReleaseTarball,
  listTarEntries,
  normalizeReleaseTextTree,
  resolveReleaseOutputDir,
  sha256File,
} from "../packages/testing-runner/scripts/package-release.mjs";
import { verifyReleaseTarball } from "../packages/testing-runner/scripts/verify-release-tarball.mjs";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

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

  assert.equal(releaseLock.lockfileVersion, 3);
  assert.equal(releaseLock.packages[""].name, runnerPackage.name);
  assert.equal(releaseLock.packages[""].version, runnerPackage.version);
  assert.deepEqual(releaseLock.packages[""].dependencies, runnerPackage.dependencies);
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
  ]) {
    assert.ok(entries.includes(required), required);
  }

  assert.equal(await sha256File(release.archivePath), release.sha256);
  assert.equal(release.fileName, "saitamasans-testing-runner-1.1.2.tgz");
  assert.ok(release.sizeBytes > 100_000);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest, {
    schema_version: 1,
    runner: {
      name: "@saitamasans/testing-runner",
      version: "1.1.2",
      download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.1.2/saitamasans-testing-runner-1.1.2.tgz",
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
  assert.deepEqual(evidence.commands, ["--version", "plan", "approve", "run", "verify-report"]);
});
