#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const skillRoot = fileURLToPath(new URL("..", import.meta.url));
const lockPath = path.join(skillRoot, "runtime", "runtime-lock.json");
const keyFiles = ["bin/js-test-mapper.mjs", "src/collector.mjs", "src/stage5-integration.mjs", "schemas/run-data.schema.json"];
const packageRoot = (root) => path.join(root, "node_modules", "@saitamasans", "js-test-mapper-runtime");
const hashFile = async (file) => createHash("sha256").update(await readFile(file)).digest("hex");

export async function checkInstalledRuntime(root, lock) {
  const receiptPath = path.join(root, "runtime-receipt.json");
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const pkgRoot = packageRoot(root);
  const pkg = JSON.parse(await readFile(path.join(pkgRoot, "package.json"), "utf8"));
  if (pkg.name !== lock.runtime_name || pkg.version !== lock.runtime_version || receipt.bundle_sha256 !== lock.bundle_sha256) throw new Error("runtime_receipt_version_mismatch");
  for (const relative of keyFiles) if (!receipt.key_files?.[relative] || await hashFile(path.join(pkgRoot, relative)) !== receipt.key_files[relative]) throw new Error(`runtime_integrity_failed:${relative}`);
  return { status: "reused", runtime_root: root, runtime_version: pkg.version, receipt_path: receiptPath };
}

async function downloadBundle(url, destination, expected) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !parsed.pathname.endsWith(".tgz")) throw new Error("runtime_download_not_allowlisted");
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok || !response.url.startsWith("https://")) throw new Error(`runtime_download_failed:${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1000 || bytes.length > 250_000_000) throw new Error("runtime_bundle_size_invalid");
  if (createHash("sha256").update(bytes).digest("hex") !== expected) throw new Error("runtime_bundle_sha256_mismatch");
  await writeFile(destination, bytes);
}

async function runNpm(staging, bundle) {
  const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!/[\\/]npm(?:-cli)?\.(?:js|cjs)$/i.test(npmCli)) throw new Error("runtime_install_requires_npm_cli");
  const args = [npmCli, "install", "--offline", "--ignore-scripts", "--omit=dev", "--no-audit", "--no-fund", "--prefix", staging, bundle];
  await new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { stdio: "inherit", shell: false }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`npm_offline_install_failed:${code}`))); });
}

export async function bootstrapRuntime({ repair = false, runtimeRoot, bundlePath = process.env.JS_TEST_MAPPER_RUNTIME_BUNDLE_PATH } = {}) {
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("node_20_or_newer_required");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  const root = path.resolve(runtimeRoot || process.env.JS_TEST_MAPPER_RUNTIME_ROOT || path.join(os.homedir(), lock.install_root));
  try { return await checkInstalledRuntime(root, lock); } catch (error) { if (!repair && await access(root).then(() => true, () => false)) throw new Error(`runtime_install_requires_repair:${error.message}`); }
  const parent = path.dirname(root); await mkdir(parent, { recursive: true });
  const tempRoot = path.join(parent, `.js-test-mapper-bootstrap-${randomUUID()}`); const staging = path.join(tempRoot, "staging"); const bundle = bundlePath ? path.resolve(bundlePath) : path.join(tempRoot, lock.bundle_name);
  await mkdir(staging, { recursive: true });
  try {
    if (bundlePath) { if (await hashFile(bundle) !== lock.bundle_sha256) throw new Error("runtime_bundle_sha256_mismatch"); } else await downloadBundle(lock.bundle_url, bundle, lock.bundle_sha256);
    await writeFile(path.join(staging, "package.json"), "{\"private\":true}\n", "utf8"); await runNpm(staging, bundle);
    const pkgRoot = packageRoot(staging); const pkg = JSON.parse(await readFile(path.join(pkgRoot, "package.json"), "utf8"));
    if (pkg.name !== lock.runtime_name || pkg.version !== lock.runtime_version) throw new Error("installed_runtime_identity_mismatch");
    const hashes = {}; for (const relative of keyFiles) hashes[relative] = await hashFile(path.join(pkgRoot, relative));
    await writeFile(path.join(staging, "runtime-receipt.json"), `${JSON.stringify({ schema_version: 1, runtime_name: pkg.name, runtime_version: pkg.version, bundle_sha256: lock.bundle_sha256, key_files: hashes }, null, 2)}\n`, "utf8");
    if (await access(root).then(() => true, () => false)) await rm(root, { recursive: true, force: true }); await rename(staging, root);
    return { status: repair ? "repaired" : "installed", runtime_root: root, runtime_version: pkg.version, receipt_path: path.join(root, "runtime-receipt.json") };
  } finally { await rm(tempRoot, { recursive: true, force: true }); }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) bootstrapRuntime({ repair: process.argv.includes("--repair") }).then((result) => console.log(JSON.stringify(result))).catch((error) => { console.error(`js-test-mapper Runtime setup failed: ${error.message}`); process.exitCode = 1; });
