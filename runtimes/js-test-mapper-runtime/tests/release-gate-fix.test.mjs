import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { bootstrapRuntime } from "../../../skill-sources/js-test-mapper/scripts/runtime-bootstrap.mjs";

test("bootstrap and public installer enforce Node 20 and immutable tracked inputs", async () => {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 20);
  const bootstrap = await readFile(new URL("../../../skill-sources/js-test-mapper/scripts/runtime-bootstrap.mjs", import.meta.url), "utf8");
  const installer = await readFile(new URL("../../../installers/install-js-test-mapper.cmd", import.meta.url), "utf8");
  assert.match(bootstrap, /node_20_or_newer_required/); assert.match(installer, /Node\.js 20 or newer/); assert.match(installer, /testing-skills@v0\.1\.1-rc\.6/);
  assert.doesNotMatch(bootstrap + installer, /testing-skills-src|review[\\/]|[A-Z]:\\Users\\/i);
});

test("bootstrap rejects a mismatched TGZ hash before npm install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-bootstrap-hash-"));
  try { const bundle = path.join(root, "runtime.tgz"); await writeFile(bundle, "tampered", "utf8"); await assert.rejects(bootstrapRuntime({ runtimeRoot: path.join(root, "runtime"), bundlePath: bundle }), /runtime_bundle_sha256_mismatch/); }
  finally { await rm(root, { recursive: true, force: true }); }
});
