import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { checkRuntime, installBundle, installedPackageRoot } from "../src/runtime-install.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("Runtime and Skill release schemas are one semantic contract", async () => {
  for (const name of ["run-data.schema.json", "cognition.schema.json"]) {
    const runtime = JSON.parse(await readFile(path.join(packageRoot, "schemas", name), "utf8"));
    const source = JSON.parse(await readFile(path.join(repoRoot, "skill-sources", "js-test-mapper", "schemas", name), "utf8"));
    const generated = JSON.parse(await readFile(path.join(repoRoot, "skills", "js-test-mapper", "schemas", name), "utf8"));
    const plugin = JSON.parse(await readFile(path.join(repoRoot, "plugins", "js-test-mapper", "skills", "js-test-mapper", "schemas", name), "utf8"));
    assert.deepEqual(source, runtime, `${name}: source drift`);
    assert.deepEqual(generated, runtime, `${name}: generated Skill drift`);
    assert.deepEqual(plugin, runtime, `${name}: Plugin drift`);
  }
});

test("Public release installer forwards the complete user argument vector", async () => {
  const installer = await readFile(path.join(repoRoot, "release", "install-js-test-mapper-runtime.cmd"), "utf8");
  assert.match(installer, /install-bundle\.mjs" --release-dir "%RELEASE_DIR%" %\*/);
  assert.doesNotMatch(installer, /set "INSTALL_ROOT=%~1"/);
});

test("Fresh acceptance is wired to the public release installer", async () => {
  const source = await readFile(path.join(repoRoot, "tooling", "run-release-comprehensive-fresh-acceptance.mjs"), "utf8");
  assert.match(source, /install-js-test-mapper-runtime\.cmd/);
  assert.match(source, /public_installer_invoked: true/);
  assert.match(source, /dev_install_api_used: false/);
  assert.doesNotMatch(source, /import \{ installBundle/);
});

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(Object.assign(new Error(`${path.basename(executable)} exited ${code}\n${stdout}\n${stderr}`), { code, stdout, stderr })));
  });
}

test("Runtime package has exact locked dependencies and Node 20 contract", async () => {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const lock = JSON.parse(await readFile(path.join(packageRoot, "package-lock.json"), "utf8"));
  assert.equal(packageJson.engines.node, ">=20");
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages[""].version, packageJson.version);
  assert.deepEqual(lock.packages[""].dependencies, packageJson.dependencies);
  for (const version of Object.values(packageJson.dependencies)) assert.match(version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
  assert.equal(packageJson.dependencies.playwright, "1.61.1");
});

test("bundle, offline install, receipt, discovery, integrity, and repair form a clean-room closure", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-distribution-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = path.join(root, "bundle");
  const packed = await run(process.execPath, [path.join(packageRoot, "scripts", "build-bundle.mjs"), outputDir], packageRoot);
  const bundle = JSON.parse(packed.stdout.trim().split(/\r?\n/).at(-1));
  const manifest = JSON.parse(await readFile(bundle.manifestPath, "utf8"));
  assert.equal(manifest.runtime.version, "0.1.0");
  assert.equal(manifest.runtime.minimum_node, 20);
  assert.equal(manifest.browser.normal_scan_downloads, false);
  assert.ok(manifest.files.some((file) => file.path === "bin/js-test-mapper.mjs"));
  assert.ok(manifest.files.some((file) => file.path.endsWith("node_modules/playwright/package.json")));
  assert.ok(manifest.files.some((file) => file.path.endsWith("node_modules/@vue/compiler-sfc/package.json")));
  assert.ok(manifest.files.some((file) => file.path.endsWith("node_modules/docx/package.json")));
  assert.ok(manifest.files.some((file) => file.path === "scripts/build-artifacts.mjs"));
  assert.match(manifest.bundle.sha256, /^[a-f0-9]{64}$/);

  const installRoot = path.join(root, "installed");
  const installed = await installBundle({ bundlePath: bundle.bundlePath, manifestPath: bundle.manifestPath, installRoot });
  assert.equal(installed.ok, true);
  const receipt = JSON.parse(await readFile(path.join(installRoot, "runtime-receipt.json"), "utf8"));
  assert.equal(receipt.runtime_version, "0.1.0");
  assert.match(receipt.bundle_sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.manifest_sha256, /^[a-f0-9]{64}$/);
  assert.equal((await checkRuntime(installRoot)).ok, true);

  const cli = path.join(installedPackageRoot(installRoot), "bin", "js-test-mapper.mjs");
  assert.match((await run(process.execPath, [cli, "--version"], root)).stdout, /0\.1\.0/);
  const launcher = path.join(repoRoot, "skills", "js-test-mapper", "scripts", "runtime-launcher.mjs");
  const discovered = JSON.parse((await run(process.execPath, [launcher, "--runtime-root", installRoot, "--runtime-info"], root)).stdout);
  assert.equal(discovered.runtime_version, "0.1.0");

  await writeFile(cli, `${await readFile(cli, "utf8")}\n// corruption\n`, "utf8");
  await assert.rejects(checkRuntime(installRoot), /runtime_integrity_failed/);
  await assert.rejects(run(process.execPath, [launcher, "--runtime-root", installRoot, "--runtime-info"], root), /runtime integrity mismatch/);
  const repaired = await installBundle({ bundlePath: bundle.bundlePath, manifestPath: bundle.manifestPath, installRoot, repair: true });
  assert.equal(repaired.repaired, true);
  assert.equal((await checkRuntime(installRoot)).ok, true);
});
