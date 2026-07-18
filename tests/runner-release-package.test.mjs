import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
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
  assert.equal(release.fileName, "saitamasans-testing-runner-1.1.1.tgz");
  assert.ok(release.sizeBytes > 100_000);

  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.deepEqual(manifest, {
    schema_version: 1,
    runner: {
      name: "@saitamasans/testing-runner",
      version: "1.1.1",
      download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.1.1/saitamasans-testing-runner-1.1.1.tgz",
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
