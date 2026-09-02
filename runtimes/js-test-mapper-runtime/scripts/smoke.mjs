import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installBundle, installedPackageRoot } from "../src/runtime-install.mjs";
import { startFixture } from "../tests/fixtures/app-server.mjs";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const outputDir = path.resolve(repoRoot, process.argv[2] || "build/js-test-mapper-runtime");

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
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${path.basename(executable)} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

const packed = await run(process.execPath, [path.join(packageRoot, "scripts", "build-bundle.mjs"), outputDir], packageRoot);
const bundle = JSON.parse(packed.stdout.trim().split(/\r?\n/).at(-1));
const cleanRoot = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-smoke-"));
const installRoot = path.join(cleanRoot, "installed-runtime");
const scanRoot = path.join(cleanRoot, "scan");
const fixture = await startFixture();
try {
  const installation = await installBundle({ bundlePath: bundle.bundlePath, manifestPath: bundle.manifestPath, installRoot });
  const cli = path.join(installedPackageRoot(installRoot), "bin", "js-test-mapper.mjs");
  const version = await run(process.execPath, [cli, "--version"], cleanRoot);
  await run(process.execPath, [cli, "scan", "--url", fixture.url, "--output-dir", scanRoot], cleanRoot);
  const runData = JSON.parse(await readFile(path.join(scanRoot, "evidence", "run-data.json"), "utf8"));
  if (runData.active_business_api_calls !== 0 || !runData.assets.some((asset) => asset.canonical_url.endsWith("/assets/chunk.js"))) throw new Error("clean_room_scan_contract_failed");
  console.log(JSON.stringify({ bundle, installation, runtime_version: version.stdout.trim(), smoke: "passed", assets: runData.assets.length, technical_resource_gets: runData.technical_resource_gets, active_business_api_calls: runData.active_business_api_calls }));
} finally {
  await fixture.close();
  await rm(cleanRoot, { recursive: true, force: true });
}
