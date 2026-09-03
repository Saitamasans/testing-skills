#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const input = process.argv.slice(2);
const explicitRoot = valueAfter(input, "--runtime-root");
const runtimeRoot = path.resolve(explicitRoot || process.env.JS_TEST_MAPPER_RUNTIME_ROOT || path.join(os.homedir(), ".codex", "runtimes", "js-test-mapper"));
const packageRoot = path.join(runtimeRoot, "node_modules", "@saitamasans", "js-test-mapper-runtime");
const cli = path.join(packageRoot, "bin", "js-test-mapper.mjs");
const receiptPath = path.join(runtimeRoot, "runtime-receipt.json");

async function bootstrapOnce() {
  const bootstrap = fileURLToPath(new URL("./runtime-bootstrap.mjs", import.meta.url));
  await new Promise((resolve, reject) => { const child = spawn(process.execPath, [bootstrap, "--repair"], { stdio: "inherit", env: { ...process.env, JS_TEST_MAPPER_RUNTIME_ROOT: runtimeRoot } }); child.once("error", reject); child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`runtime bootstrap failed (${code})`))); });
}

async function verifyRuntime() {
  await Promise.all([access(cli), access(receiptPath)]);
  const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (receipt.runtime_version !== packageJson.version) throw new Error("runtime receipt version mismatch");
  for (const [relative, expected] of Object.entries(receipt.key_files || {})) { const actual = createHash("sha256").update(await readFile(path.join(packageRoot, relative))).digest("hex"); if (actual !== expected) throw new Error(`runtime integrity mismatch: ${relative}`); }
  return { receipt, packageJson };
}

try {
  let verified;
  try { verified = await verifyRuntime(); } catch { await bootstrapOnce(); verified = await verifyRuntime(); }
  const { receipt, packageJson } = verified;
  if (input.includes("--runtime-info")) {
    console.log(JSON.stringify({ runtime_root: runtimeRoot, runtime_version: packageJson.version, receipt_path: receiptPath }));
    process.exit(0);
  }
  const forwarded = input.filter((value, index) => value !== "--runtime-root" && input[index - 1] !== "--runtime-root");
  const child = spawn(process.execPath, [cli, ...forwarded], { stdio: "inherit", env: { ...process.env, JS_TEST_MAPPER_RUNTIME_ROOT: runtimeRoot, ...(receipt.browser_path ? { PLAYWRIGHT_BROWSERS_PATH: receipt.browser_path } : {}) } });
  child.once("exit", (code, signal) => process.exit(signal ? 1 : code ?? 1));
  child.once("error", (error) => { console.error(error.message); process.exit(1); });
} catch (error) {
  console.error(`js-test-mapper runtime unavailable: ${error.message}. Install or repair the verified Runtime bundle, then retry.`);
  process.exit(1);
}
