import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildReleaseTarball,
  listTarEntries,
  sha256File,
} from "../packages/testing-runner/scripts/package-release.mjs";

test("release tarball contains runner and bundled production dependencies", async () => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), "runner-release-"));
  const release = await buildReleaseTarball(outputDir);
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
  assert.equal(release.fileName, "saitamasans-testing-runner-1.0.0.tgz");
  assert.ok(release.sizeBytes > 100_000);
});

