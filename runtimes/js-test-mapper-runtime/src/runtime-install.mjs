import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function hashFile(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function npmCommand() {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!/[\\/]npm(?:-cli)?\.(?:js|cjs)$/i.test(npmCli)) throw new Error("runtime_install_requires_npm_cli");
  return { executable: process.execPath, prefix: [npmCli] };
}

async function run(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) reject(new Error(`${path.basename(executable)} failed (${signal || code})\n${stdout}\n${stderr}`));
      else resolve({ stdout, stderr });
    });
  });
}

function assertInstallRoot(installRoot) {
  const resolved = path.resolve(installRoot);
  const parsed = path.parse(resolved);
  if (resolved === parsed.root || resolved === os.homedir() || resolved === process.cwd()) throw new Error("unsafe_runtime_install_root");
  return resolved;
}

export function installedPackageRoot(installRoot) {
  return path.join(path.resolve(installRoot), "node_modules", "@saitamasans", "js-test-mapper-runtime");
}

export async function createReceipt({ installRoot, bundlePath, manifestPath }) {
  const packageRoot = installedPackageRoot(installRoot);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const keyPaths = ["bin/js-test-mapper.mjs", "src/collector.mjs", "src/stage5-integration.mjs", "schemas/run-data.schema.json"];
  const keyFiles = {};
  for (const relative of keyPaths) keyFiles[relative] = await hashFile(path.join(packageRoot, relative));
  return {
    schema_version: 1,
    runtime_name: packageJson.name,
    runtime_version: packageJson.version,
    installed_at: new Date().toISOString(),
    bundle_sha256: await hashFile(bundlePath),
    manifest_sha256: manifestPath ? await hashFile(manifestPath) : null,
    package_root: packageRoot,
    key_files: keyFiles,
  };
}

export async function checkRuntime(installRoot) {
  installRoot = assertInstallRoot(installRoot);
  const receiptPath = path.join(installRoot, "runtime-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const packageRoot = installedPackageRoot(installRoot);
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (packageJson.name !== receipt.runtime_name || packageJson.version !== receipt.runtime_version) throw new Error("runtime_receipt_version_mismatch");
  for (const relative of ["bin/js-test-mapper.mjs", "src/collector.mjs", "src/stage5-integration.mjs", "schemas/run-data.schema.json"]) {
    const expected = receipt.key_files?.[relative];
    if (!expected) throw new Error(`runtime_receipt_key_missing: ${relative}`);
    if (await hashFile(path.join(packageRoot, relative)) !== expected) throw new Error(`runtime_integrity_failed: ${relative}`);
  }
  return { ok: true, receipt_path: receiptPath, package_root: packageRoot, runtime_version: packageJson.version };
}

export async function installBundle({ bundlePath, manifestPath, installRoot, repair = false }) {
  installRoot = assertInstallRoot(installRoot);
  bundlePath = path.resolve(bundlePath);
  const manifest = JSON.parse(await readFile(path.resolve(manifestPath), "utf8"));
  const actualBundleHash = await hashFile(bundlePath);
  if (manifest.bundle.sha256 !== actualBundleHash) throw new Error("runtime_bundle_sha256_mismatch");
  try {
    const current = await checkRuntime(installRoot);
    if (!repair && current.runtime_version === manifest.runtime.version) return { ...current, reused: true };
  } catch (error) {
    if (!repair && await access(installRoot).then(() => true, () => false)) throw new Error(`runtime_install_requires_repair: ${error.message}`);
  }
  const parent = path.dirname(installRoot);
  await mkdir(parent, { recursive: true });
  const staging = path.join(parent, `.js-test-mapper-install-${randomUUID()}`);
  await mkdir(staging, { recursive: true });
  try {
    await writeFile(path.join(staging, "package.json"), "{\n  \"private\": true\n}\n", "utf8");
    const npm = npmCommand();
    await run(npm.executable, [...npm.prefix, "install", "--offline", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--prefix", staging, bundlePath], { cwd: staging, env: { ...process.env, npm_config_update_notifier: "false" } });
    if (await access(installRoot).then(() => true, () => false)) await rm(installRoot, { recursive: true, force: true });
    await rename(staging, installRoot);
    const receipt = await createReceipt({ installRoot, bundlePath, manifestPath });
    await writeFile(path.join(installRoot, "runtime-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
  const checked = await checkRuntime(installRoot);
  return { ...checked, repaired: repair };
}

export async function assertBundleExists(bundlePath) {
  const info = await stat(bundlePath);
  if (!info.isFile() || info.size < 1_000) throw new Error("runtime_bundle_missing_or_empty");
}
