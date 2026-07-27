import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { afterEach } from "node:test";
import { fileURLToPath } from "node:url";

import {
  forwardInstalledRunnerCommand,
  verifyInstalledRuntime,
} from "../skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs";

const windowsRuntimeTest = process.platform === "win32" ? test : test.skip;
const skillName = "web-api-test-execution-evidence";
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const passStatus = "\u901a\u8fc7";
const runId = "run-bundle-smoke";
const caseId = "BUNDLE-SMOKE-001";
const assertionId = "BUNDLE-SMOKE-001-visible-text";
const pngPath = `evidence/${caseId}/attempt-1/${assertionId}/web-page.png`;
const pngStoragePath = `${runId}/${pngPath}`;
const tracePath = `evidence/${caseId}/playwright-trace.zip`;
const smokeArtifactPaths = [
  "run-result.json",
  "projected-report.json",
  "result.html",
  "result.xlsx",
  `${runId}/run-events.jsonl`,
];
const sourceScripts = path.join(repoRoot, "skill-sources", skillName, "scripts");
const windowsLauncherTimeoutMs = 15_000;
const fixtureHomes = new Set();

afterEach(async () => {
  const homes = [...fixtureHomes];
  fixtureHomes.clear();
  for (const home of homes) {
    await rm(home, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
});

async function write(root, relative, contents) {
  const target = path.join(root, ...relative.split("/"));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
  return target;
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

async function installedFixture(options = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "installed-runtime-"));
  fixtureHomes.add(home);
  const stateRoot = path.join(home, ".testing-skills");
  const installRoot = path.join(home, ".agents", "skills");
  const runtime = path.join(stateRoot, "runtime", skillName, "bundle-1");
  const skillPath = path.join(installRoot, skillName);
  const diagnosticsPath = path.join(stateRoot, "diagnostics", skillName, "bundle-1");
  const bundledLauncher = options.runtimeLauncherContents ?? await readFile(path.join(sourceScripts, "testing-runner.mjs"), "utf8");
  const bundledRuntimeLibrary = await readFile(path.join(sourceScripts, "installed-runtime-lib.mjs"), "utf8");
  const files = {
    "node/node.exe": options.nodeContents ?? "bundled node",
    "runner/dist/cli.js": options.runnerContents ?? "process.exit(0);\n",
    "runner/package.json": JSON.stringify({
      name: "@saitamasans/testing-runner",
      version: "1.1.2",
      dependencies: { playwright: "1.61.1" },
    }),
    "runner/node_modules/playwright/cli.js": "playwright cli",
    "runner/node_modules/playwright/package.json": JSON.stringify({ version: "1.61.1" }),
    "runner/node_modules/playwright-core/package.json": JSON.stringify({
      name: "playwright-core", version: "1.61.1",
    }),
    "runner/node_modules/playwright-core/browsers.json": JSON.stringify({ browsers: [
      { name: "chromium", revision: "1228", installByDefault: true, browserVersion: "149.0" },
      { name: "chromium-headless-shell", revision: "1228", installByDefault: true, browserVersion: "149.0" },
      { name: "ffmpeg", revision: "1011", installByDefault: true },
    ] }),
    "skill/web-api-test-execution-evidence/SKILL.md": "# installed skill\n",
    "skill/web-api-test-execution-evidence/scripts/testing-runner.mjs": bundledLauncher,
    "skill/web-api-test-execution-evidence/scripts/installed-runtime-lib.mjs": bundledRuntimeLibrary,
    "smoke/installation-smoke-test.mjs": "export {};\n",
    "smoke/installation-smoke-fixture.html": "Bundle Smoke Ready",
    "browser-cache/chromium-1228/chrome-win64/chrome.exe": "chromium",
    "browser-cache/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe": "headless",
    "browser-cache/ffmpeg-1011/ffmpeg-win64.exe": "ffmpeg",
    ...(options.additionalFiles ?? {}),
  };
  for (const [relative, contents] of Object.entries(files)) await write(runtime, relative, contents);
  for (const [relative, contents] of Object.entries(files)) {
    const prefix = `skill/${skillName}/`;
    if (relative.startsWith(prefix)) await write(skillPath, relative.slice(prefix.length), contents);
  }
  const png = "smoke png";
  const trace = "smoke trace";
  await write(diagnosticsPath, pngStoragePath, png);
  await write(diagnosticsPath, tracePath, trace);
  for (const relative of smokeArtifactPaths) await write(diagnosticsPath, relative, `smoke ${relative}`);
  await write(diagnosticsPath, "smoke-result.json", JSON.stringify({
    schema_version: 1,
    ok: true,
    node: { version: "22.23.1", arch: options.architecture ?? "x64" },
    runner: { version: "1.1.2" },
    browser: { visible: true },
    run_id: runId,
    case_id: caseId,
    case_status: passStatus,
    assertion_id: assertionId,
    assertion_passed: true,
    png: { path: pngPath, sha256: hash(png), size_bytes: Buffer.byteLength(png) },
    trace: { path: tracePath, sha256: hash(trace), size_bytes: Buffer.byteLength(trace) },
    artifacts: smokeArtifactPaths.map((relative) => ({
      path: relative,
      sha256: hash(`smoke ${relative}`),
      size_bytes: Buffer.byteLength(`smoke ${relative}`),
    })),
  }));
  const manifest = {
    schema_version: 1,
    bundle: { name: skillName, version: "1.0.2", release_tag: "web-api-test-execution-evidence-v1.0.2", os: "windows", arch: options.architecture ?? "x64" },
    components: {
      node: { version: "22.23.1" },
      runner: { name: "@saitamasans/testing-runner", version: "1.1.2" },
      playwright: { version: "1.61.1", chromium_revision: "1228", chromium_headless_shell_revision: "1228", ffmpeg_revision: "1011" },
      skill: { name: skillName },
    },
    files: Object.entries(files).map(([relative, contents]) => ({ path: relative, size_bytes: Buffer.byteLength(contents), sha256: hash(contents) })),
  };
  manifest.installed_size_bytes = manifest.files.reduce((size, entry) => size + entry.size_bytes, 0);
  const manifestContents = `${JSON.stringify(manifest)}\n`;
  await write(runtime, "bundle-manifest.json", manifestContents);
  const receiptPath = path.join(stateRoot, "installations", `${skillName}.json`);
  await write(path.dirname(receiptPath), path.basename(receiptPath), JSON.stringify({
    schema_version: 1,
    skill: skillName,
    bundle_version: "1.0.2",
    release_tag: "web-api-test-execution-evidence-v1.0.2",
    architecture: options.architecture ?? "x64",
    installed_at_utc: "2026-07-18T00:00:00.000Z",
    archive_sha256: "a".repeat(64),
    payload_manifest_sha256: hash(manifestContents),
    runtime_path: runtime,
    skill_path: skillPath,
    diagnostics_path: diagnosticsPath,
  }));
  return { home, stateRoot, installRoot, runtime, skillPath, diagnosticsPath, receiptPath };
}

function fixtureEnv(state) {
  return {
    USERPROFILE: state.home,
    TESTING_SKILLS_STATE_ROOT: state.stateRoot,
    TESTING_SKILLS_INSTALL_ROOT: state.installRoot,
  };
}

test("valid complete receipt resolves only bundled absolute executable paths", async () => {
  const state = await installedFixture();
  const runtime = await verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" });
  assert.equal(runtime.nodePath.toLowerCase(), path.join(state.runtime, "node", "node.exe").toLowerCase());
  assert.equal(runtime.cliPath.toLowerCase(), path.join(state.runtime, "runner", "dist", "cli.js").toLowerCase());
  assert.equal(runtime.browserCachePath.toLowerCase(), path.join(state.runtime, "browser-cache").toLowerCase());
});

test("Windows AMD64 environment architecture resolves to the x64 receipt", async () => {
  const state = await installedFixture();
  const runtime = await verifyInstalledRuntime({
    env: { ...fixtureEnv(state), PROCESSOR_ARCHITECTURE: "AMD64" },
  });
  assert.equal(runtime.runtimePath.toLowerCase(), state.runtime.toLowerCase());
});

test("bundled Node architecture overrides Windows architecture environment variables", async () => {
  const state = await installedFixture({ architecture: "arm64" });
  const runtime = await verifyInstalledRuntime({
    architecture: "arm64",
    env: {
      ...fixtureEnv(state),
      PROCESSOR_ARCHITECTURE: "AMD64",
      PROCESSOR_ARCHITEW6432: "ARM64",
    },
  });
  assert.equal(runtime.runtimePath.toLowerCase(), state.runtime.toLowerCase());
});

test("missing canonical receipt fails closed with repair guidance", async () => {
  const state = await installedFixture();
  await writeFile(state.receiptPath, "");
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_incomplete:.*-Repair/s,
  );
});

test("tampered runtime inventory fails closed as corrupt", async () => {
  const state = await installedFixture();
  await writeFile(path.join(state.runtime, "runner", "dist", "cli.js"), "tampered");
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*-Repair/s,
  );
});

test("normal execution hashes selected critical markers instead of the full runtime payload", async () => {
  const state = await installedFixture({
    additionalFiles: { "runner/docs/operator-guide.md": "installed documentation\n" },
  });
  await writeFile(
    path.join(state.runtime, "runner", "docs", "operator-guide.md"),
    "changed documentation that is never executed",
  );

  const runtime = await verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" });

  assert.equal(runtime.runtimePath.toLowerCase(), state.runtime.toLowerCase());
});

test("receipt architecture must match the executing Windows architecture", async () => {
  const state = await installedFixture({ architecture: "arm64" });
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_incomplete:.*architecture/s,
  );
});

test("receipt schema rejects an invalid archive digest before execution", async () => {
  const state = await installedFixture();
  const receipt = JSON.parse(await readFile(state.receiptPath, "utf8"));
  receipt.archive_sha256 = "not-a-digest";
  await writeFile(state.receiptPath, JSON.stringify(receipt));
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*archive SHA-256/s,
  );
});

test("forged smoke results cannot authorize execution", async () => {
  const state = await installedFixture();
  const smokePath = path.join(state.stateRoot, "diagnostics", skillName, "bundle-1", "smoke-result.json");
  const smoke = JSON.parse(await readFile(smokePath, "utf8"));
  smoke.assertion_passed = false;
  await writeFile(smokePath, JSON.stringify(smoke));
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*smoke/s,
  );
});

test("missing installation report evidence cannot authorize execution", async () => {
  const state = await installedFixture();
  await unlink(path.join(state.diagnosticsPath, "result.xlsx"));
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_incomplete:.*report result\.xlsx smoke evidence is missing/s,
  );
});

test("stale smoke Node identity cannot authorize a replaced runtime", async () => {
  const state = await installedFixture();
  const smokePath = path.join(state.stateRoot, "diagnostics", skillName, "bundle-1", "smoke-result.json");
  const smoke = JSON.parse(await readFile(smokePath, "utf8"));
  smoke.node.version = "22.22.0";
  await writeFile(smokePath, JSON.stringify(smoke));
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*smoke Node version/s,
  );
});

test("installed Skill inventory must match the verified bundled Skill copy", async () => {
  const state = await installedFixture();
  await writeFile(path.join(state.installRoot, skillName, "SKILL.md"), "tampered skill\n");
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*installed Skill inventory/s,
  );
});

test("runtime root junctions are rejected before inventory verification", async () => {
  const state = await installedFixture();
  const runtimeParent = path.dirname(state.runtime);
  const outside = `${runtimeParent}-outside`;
  await rename(runtimeParent, outside);
  await symlink(outside, runtimeParent, "junction");
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*real directory/s,
  );
});

test("installed Skill parent junctions are rejected before inventory comparison", async () => {
  const state = await installedFixture();
  const outside = `${state.installRoot}-outside`;
  await rename(state.installRoot, outside);
  await symlink(outside, state.installRoot, "junction");
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*real directory/s,
  );
});

test("verified launch fixes browser cache and invokes bundled Node with absolute Runner CLI", async () => {
  const state = await installedFixture();
  const runtime = await verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" });
  let command;
  let args;
  let env;
  const code = await forwardInstalledRunnerCommand({
    runtime,
    args: ["plan", "--input", "report.json"],
    env: {
      ...fixtureEnv(state),
      TEST_API_TOKEN: "secret",
      HTTPS_PROXY: "https://proxy.test",
      NODE_OPTIONS: "--require injected.js",
      PATH: "ignored",
    },
    runProcess: async (actualCommand, actualArgs, options) => {
      command = actualCommand;
      args = actualArgs;
      env = options.env;
      return 0;
    },
  });
  assert.equal(code, 0);
  assert.equal(command, runtime.nodePath);
  assert.deepEqual(args, [runtime.cliPath, "plan", "--input", "report.json"]);
  assert.equal(env.PLAYWRIGHT_BROWSERS_PATH, runtime.browserCachePath);
  assert.equal(env.TEST_API_TOKEN, "secret");
  assert.equal(env.HTTPS_PROXY, "https://proxy.test");
  assert.equal(env.NODE_OPTIONS, undefined);
});

function run(command, args, env, options = {}) {
  return new Promise((resolve, reject) => {
    const { timeoutMs, ...spawnOptions } = options;
    const child = spawn(command, args, { env, windowsHide: true, ...spawnOptions });
    let stdout = "";
    let stderr = "";
    const timeout = timeoutMs ? setTimeout(() => child.kill(), timeoutMs) : undefined;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (timeout) clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
  });
}

function quoteForCmd(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function runCmd(script, args, env) {
  const commandLine = `""${script}" ${args.map(quoteForCmd).join(" ")}"`;
  return run(
    env.ComSpec ?? process.env.ComSpec,
    ["/d", "/s", "/c", commandLine],
    env,
    { windowsVerbatimArguments: true },
  );
}

function runPowerShell(script, args, env, options = {}) {
  const powershell = path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return run(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args], env, options);
}

async function exists(file) {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

windowsRuntimeTest("CMD launches the receipt-bundled Node with an empty PATH", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const cmd = path.join(repoRoot, "skill-sources", skillName, "scripts", "testing-runner.cmd");
  const result = await runCmd(cmd, ["plan"], {
    ...fixtureEnv(state),
    PATH: "",
    ComSpec: process.env.ComSpec,
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
  });
  assert.equal(result.code, 0, result.stderr);
});

windowsRuntimeTest("CMD preflight rejects a node inventory hash mismatch without executing that Node", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const manifestPath = path.join(state.runtime, "bundle-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === "node/node.exe").sha256 = "0".repeat(64);
  const manifestText = `${JSON.stringify(manifest)}\n`;
  await writeFile(manifestPath, manifestText);
  const receipt = JSON.parse(await readFile(state.receiptPath, "utf8"));
  receipt.payload_manifest_sha256 = hash(manifestText);
  await writeFile(state.receiptPath, JSON.stringify(receipt));
  const marker = path.join(state.home, "unverified-node-ran.txt");
  const markerScript = path.join(state.home, "marker.cjs");
  await writeFile(markerScript, "require('node:fs').writeFileSync(process.env.CMD_MARKER, 'ran');\n");
  const cmd = path.join(repoRoot, "skill-sources", skillName, "scripts", "testing-runner.cmd");
  const result = await runCmd(cmd, ["plan"], {
    ...fixtureEnv(state), PATH: "", ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    NODE_OPTIONS: `--require "${markerScript}"`, CMD_MARKER: marker,
  });
  assert.equal(result.code, 20, result.stderr);
  assert.equal(await exists(marker), false);
});

windowsRuntimeTest("CMD preflight rejects a runtime junction without executing that Node", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const runtimeParent = path.dirname(state.runtime);
  const outside = `${runtimeParent}-outside`;
  await rename(runtimeParent, outside);
  await symlink(outside, runtimeParent, "junction");
  const marker = path.join(state.home, "junction-node-ran.txt");
  const markerScript = path.join(state.home, "junction-marker.cjs");
  await writeFile(markerScript, "require('node:fs').writeFileSync(process.env.CMD_MARKER, 'ran');\n");
  const cmd = path.join(repoRoot, "skill-sources", skillName, "scripts", "testing-runner.cmd");
  const result = await runCmd(cmd, ["plan"], {
    ...fixtureEnv(state), PATH: "", ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    NODE_OPTIONS: `--require "${markerScript}"`, CMD_MARKER: marker,
  });
  assert.equal(result.code, 20, result.stderr);
  assert.equal(await exists(marker), false);
});

windowsRuntimeTest("CMD forwards ordinary Runner arguments from the Base64 JSON environment contract", async () => {
  const argsOutput = path.join(await mkdtemp(path.join(os.tmpdir(), "cmd-args-")), "args.json");
  const state = await installedFixture({
    nodeContents: await readFile(process.execPath),
    runnerContents: "require('node:fs').writeFileSync(process.env.TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n",
  });
  const cmd = path.join(repoRoot, "skill-sources", skillName, "scripts", "testing-runner.cmd");
  const args = ["plan", "--input", "with space", 'quoted "value"'];
  const result = await runCmd(cmd, [], {
    ...fixtureEnv(state), PATH: "", ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEST_ARGS_FILE: argsOutput,
    TESTING_RUNNER_ARGS_B64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(argsOutput, "utf8")), args);
});

windowsRuntimeTest("PowerShell starts the verified runtime bundle launcher before the installed Skill inventory", async () => {
  const marker = path.join(await mkdtemp(path.join(os.tmpdir(), "runtime-launcher-")), "ran.txt");
  const launcher = "import { writeFileSync } from \"node:fs\"; writeFileSync(process.env.RUNTIME_LAUNCHER_MARKER, \"ran\");\n";
  const state = await installedFixture({ nodeContents: await readFile(process.execPath), runtimeLauncherContents: launcher });
  const ps1 = path.join(sourceScripts, "testing-runner.ps1");
  const result = await runPowerShell(ps1, ["plan"], {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    RUNTIME_LAUNCHER_MARKER: marker,
  }, { timeoutMs: windowsLauncherTimeoutMs });
  assert.equal(result.code, 0, result.stderr);
  assert.equal(await exists(marker), true);
});

windowsRuntimeTest("PowerShell rejects a tampered runtime bundle launcher before Node executes it", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const marker = path.join(state.home, "runtime-launcher-tampered.txt");
  await writeFile(
    path.join(state.runtime, "skill", skillName, "scripts", "testing-runner.mjs"),
    `require(\"node:fs\").writeFileSync(${JSON.stringify(marker)}, \"ran\");\n`,
  );
  const result = await runPowerShell(path.join(sourceScripts, "testing-runner.ps1"), ["plan"], {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  });
  assert.equal(result.code, 20, result.stderr);
  assert.match(result.stderr, /installation_corrupt/);
  assert.equal(await exists(marker), false);
});

windowsRuntimeTest("PowerShell does not execute a tampered installed launcher", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const marker = path.join(state.home, "installed-launcher-tampered.txt");
  await writeFile(
    path.join(state.skillPath, "scripts", "testing-runner.mjs"),
    `require(\"node:fs\").writeFileSync(${JSON.stringify(marker)}, \"ran\");\n`,
  );
  const result = await runPowerShell(path.join(sourceScripts, "testing-runner.ps1"), ["plan"], {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  });
  assert.equal(result.code, 20, result.stderr);
  assert.match(result.stderr, /installation_corrupt/);
  assert.equal(await exists(marker), false);
});

windowsRuntimeTest("PowerShell forwards direct argument arrays without CMD interpolation", async () => {
  const argsOutput = path.join(await mkdtemp(path.join(os.tmpdir(), "ps-args-")), "args.json");
  const state = await installedFixture({
    nodeContents: await readFile(process.execPath),
    runnerContents: "require('node:fs').writeFileSync(process.env.TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n",
  });
  const args = ["plan", "with space", '&|<>^%!"'];
  const result = await runPowerShell(path.join(sourceScripts, "testing-runner.ps1"), args, {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEST_ARGS_FILE: argsOutput,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(argsOutput, "utf8")), args);
});

windowsRuntimeTest("PowerShell forwards Runner option names that prefix PowerShell common parameters", async () => {
  const argsOutput = path.join(await mkdtemp(path.join(os.tmpdir(), "ps-common-args-")), "args.json");
  const state = await installedFixture({
    nodeContents: await readFile(process.execPath),
    runnerContents: "require('node:fs').writeFileSync(process.env.TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n",
  });
  const args = [
    "approve",
    "--manifest",
    "run-manifest.json",
    "--out",
    "approval.json",
    "--confirmed-by",
    "reviewer",
  ];
  const result = await runPowerShell(path.join(sourceScripts, "testing-runner.ps1"), args, {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEST_ARGS_FILE: argsOutput,
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(argsOutput, "utf8")), args);
});

windowsRuntimeTest("CMD reads normal Runner arguments only from the Base64 JSON environment contract", async () => {
  const argsOutput = path.join(await mkdtemp(path.join(os.tmpdir(), "cmd-b64-args-")), "args.json");
  const state = await installedFixture({
    nodeContents: await readFile(process.execPath),
    runnerContents: "require('node:fs').writeFileSync(process.env.TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));\n",
  });
  const args = ["plan", "with space", '&|<>^%!"'];
  const result = await runCmd(path.join(sourceScripts, "testing-runner.cmd"), [], {
    ...fixtureEnv(state), PATH: "", ComSpec: process.env.ComSpec, SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
    TEST_ARGS_FILE: argsOutput,
    TESTING_RUNNER_ARGS_B64: Buffer.from(JSON.stringify(args), "utf8").toString("base64"),
  });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(argsOutput, "utf8")), args);
});

windowsRuntimeTest("PowerShell classifies a verified-manifest Node mismatch as corrupt", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const manifestPath = path.join(state.runtime, "bundle-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.files.find((entry) => entry.path === "node/node.exe").sha256 = "0".repeat(64);
  const contents = `${JSON.stringify(manifest)}\n`;
  await writeFile(manifestPath, contents);
  const receipt = JSON.parse(await readFile(state.receiptPath, "utf8"));
  receipt.payload_manifest_sha256 = hash(contents);
  await writeFile(state.receiptPath, JSON.stringify(receipt));
  const result = await runPowerShell(path.join(sourceScripts, "testing-runner.ps1"), ["plan"], {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  });
  assert.equal(result.code, 20, result.stderr);
  assert.match(result.stderr, /installation_corrupt/);
});

windowsRuntimeTest("PowerShell handles case-variant canonical receipt paths without looping", async () => {
  const state = await installedFixture({ nodeContents: await readFile(process.execPath) });
  const receipt = JSON.parse(await readFile(state.receiptPath, "utf8"));
  receipt.runtime_path = state.runtime.toUpperCase();
  await writeFile(state.receiptPath, JSON.stringify(receipt));
  const result = await runPowerShell(path.join(sourceScripts, "testing-runner.ps1"), ["plan"], {
    ...fixtureEnv(state), PATH: "", SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR,
  }, { timeoutMs: windowsLauncherTimeoutMs });
  assert.equal(result.code, 0, result.stderr);
});

test("nested diagnostics junctions are rejected while validating smoke evidence", async () => {
  const state = await installedFixture();
  const evidence = path.join(state.diagnosticsPath, "run-bundle-smoke", "evidence");
  const outside = `${evidence}-outside`;
  await rename(evidence, outside);
  await symlink(outside, evidence, "junction");
  await assert.rejects(
    verifyInstalledRuntime({ env: fixtureEnv(state), architecture: "x64" }),
    /installation_corrupt:.*smoke evidence/s,
  );
});
