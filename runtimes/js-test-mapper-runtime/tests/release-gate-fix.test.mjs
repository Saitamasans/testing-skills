import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assertNodeVersion, installRuntime, locateReleaseFiles } from "../../../release/install-bundle.mjs";

test("standalone installer enforces Node >=20 and locates only RC-local files", async () => {
  assert.doesNotThrow(() => assertNodeVersion("20.19.0"));
  assert.doesNotThrow(() => assertNodeVersion("22.23.1"));
  assert.throws(() => assertNodeVersion("18.20.4"), />=20/);
  const root = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-release-gate-phase2-"));
  try {
    await writeFile(path.join(root, "runtime.tgz"), "bundle", "utf8");
    await writeFile(path.join(root, "runtime.manifest.json"), "{}", "utf8");
    const files = await locateReleaseFiles(root);
    assert.equal(files.bundlePath, path.join(root, "runtime.tgz"));
    assert.equal(files.manifestPath, path.join(root, "runtime.manifest.json"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("standalone installer source has no development-repository launcher dependency", async () => {
  const source = await readFile(new URL("../../../release/install-bundle.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /testing-skills-src|\.\.\\runtimes|\.\.\/tooling/);
});

test("standalone installer rejects a mismatched TGZ hash before install", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-release-gate-hash-"));
  try {
    const bundlePath = path.join(root, "runtime.tgz");
    const manifestPath = path.join(root, "runtime.manifest.json");
    await writeFile(bundlePath, "tampered", "utf8");
    await writeFile(manifestPath, JSON.stringify({ runtime: { name: "x", version: "0" }, bundle: { sha256: "0".repeat(64) } }), "utf8");
    await assert.rejects(installRuntime({ bundlePath, manifestPath, installRoot: path.join(root, "install"), browserPath: path.join(root, "browser"), repair: false }), /runtime_bundle_sha256_mismatch/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
