import { spawn } from "node:child_process";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const PACKAGED_DEPENDENCY_LAYOUT = "package/node_modules";

function fail(message) {
  throw new Error(`verify_release_tarball_failed: ${message}`);
}

function tarPath(value) {
  return process.platform === "win32" ? value.replaceAll("\\", "/") : value;
}

function pathIsWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function run(executable, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal || code !== 0) {
        reject(new Error(`${path.basename(executable)} ${args.join(" ")} exited with ${signal ?? code}\n${stdout}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function guardedEnvironment(emptyPath, guardPath, guardLog) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    const normalizedKey = key.toLocaleLowerCase("en-US");
    if (!["path", "node_path", "node_options"].includes(normalizedKey) && value !== undefined) {
      env[key] = value;
    }
  }
  return {
    ...env,
    PATH: emptyPath,
    TESTING_RUNNER_NETWORK_GUARD_LOG: guardLog,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
    npm_config_offline: "true",
  };
}

async function startApiFixture() {
  const requests = [];
  const server = http.createServer((request, response) => {
    requests.push({ method: request.method, url: request.url, host: request.headers.host });
    if (request.url !== "/health") {
      response.writeHead(404).end("not found");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function networkGuardSource() {
  return String.raw`
const fs = require("node:fs");
const childProcess = require("node:child_process");
const log = process.env.TESTING_RUNNER_NETWORK_GUARD_LOG;
const record = (value) => fs.appendFileSync(log, JSON.stringify(value) + "\n");
const allowed = (value) => {
  const url = new URL(typeof value === "string" || value instanceof URL ? value : value.url);
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(url.hostname);
  record({ type: "network", url: url.href, allowed: loopback });
  if (!loopback) throw new Error("blocked external network request: " + url.href);
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => { allowed(input); return originalFetch(input, init); };
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync"]) {
  const original = childProcess[name];
  childProcess[name] = function(command, ...args) {
    const base = require("node:path").basename(String(command)).toLowerCase();
    if (["npm", "npm.cmd", "npx", "npx.cmd"].includes(base)) {
      record({ type: "package-manager", command: String(command), allowed: false });
      throw new Error("blocked package manager invocation: " + command);
    }
    return original.call(this, command, ...args);
  };
}
`;
}

export async function verifyReleaseTarball(archive, workDir) {
  archive = path.resolve(archive);
  workDir = path.resolve(workDir);
  const extractDir = path.join(workDir, "extracted");
  const fixtureDir = path.join(workDir, "fixture");
  const planDir = path.join(workDir, "plan");
  const resultDir = path.join(workDir, "result");
  const emptyPath = path.join(workDir, "empty-path");
  const guardPath = path.join(workDir, "network-guard.cjs");
  const guardLog = path.join(workDir, "execution-network.jsonl");
  await rm(workDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  await mkdir(fixtureDir, { recursive: true });
  await mkdir(emptyPath, { recursive: true });
  await writeFile(guardPath, networkGuardSource(), "utf8");
  await writeFile(guardLog, "", "utf8");
  await run("tar", ["-xzf", path.basename(archive), "-C", tarPath(extractDir)], {
    cwd: path.dirname(archive),
  });

  const packageRoot = path.join(extractDir, "package");
  const packageRootRealpath = await realpath(packageRoot);
  const workspaceRealpath = process.env.GITHUB_WORKSPACE
    ? await realpath(process.env.GITHUB_WORKSPACE)
    : null;
  if (workspaceRealpath && pathIsWithin(workspaceRealpath, packageRootRealpath)) {
    fail("package root must be outside GITHUB_WORKSPACE");
  }
  const packageOutsideWorkspace = workspaceRealpath ? true : null;
  const packageNodeModules = path.join(packageRoot, "node_modules");
  const cli = path.join(packageRoot, "dist", "cli.js");
  const compilerCli = path.join(
    packageRoot,
    "node_modules",
    "@saitamasans",
    "testing-contract-compiler",
    "dist",
    "cli.js",
  );
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  const requireFromTar = createRequire(path.join(packageRoot, "package.json"));
  const dependencyCheck = [
    "const {createRequire}=require('node:module');",
    "const fs=require('node:fs');",
    `const root=${JSON.stringify(await realpath(packageNodeModules))};`,
    `const requireFromTar=createRequire(${JSON.stringify(path.join(packageRoot, "package.json"))});`,
    `const names=${JSON.stringify(Object.keys(packageJson.dependencies ?? {}))};`,
    "const resolved=names.map((name)=>({name,path:fs.realpathSync(requireFromTar.resolve(name))}));",
    "for(const item of resolved){if(!item.path.toLowerCase().startsWith((root+require('node:path').sep).toLowerCase()))throw new Error('dependency resolved outside packaged node_modules: '+item.name+' -> '+item.path);}",
    "const playwright=requireFromTar('playwright'); if(!playwright.chromium)throw new Error('packaged Playwright is not executable');",
    "console.log(JSON.stringify(resolved));",
  ].join("");
  const environment = guardedEnvironment(emptyPath, guardPath, guardLog);
  const nodeArgs = (args) => ["--require", guardPath, cli, ...args];
  const dependencyResult = await run(process.execPath, ["--require", guardPath, "-e", dependencyCheck], {
    cwd: packageRoot,
    env: environment,
  });
  const dependencies = JSON.parse(dependencyResult.stdout.trim());
  const version = await run(process.execPath, nodeArgs(["--version"]), { cwd: packageRoot, env: environment });
  if (version.stdout.trim() !== packageJson.version) fail("packaged CLI version mismatch");

  const server = await startApiFixture();
  try {
    const columns = [
      "\u7528\u4f8b ID", "\u6240\u5c5e\u6a21\u5757", "\u7528\u4f8b\u6807\u9898", "\u9a8c\u8bc1\u529f\u80fd\u70b9", "\u524d\u7f6e\u6761\u4ef6",
      "\u6d4b\u8bd5\u6b65\u9aa4", "\u9884\u671f\u7ed3\u679c", "\u4f18\u5148\u7ea7", "\u5b9e\u9645\u7ed3\u679c", "\u6267\u884c\u7ed3\u679c",
    ];
    const ExcelJS = requireFromTar("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Cases");
    sheet.addRow(columns);
    sheet.addRow(["TAR-API-001", "api", "local health", "status", "local API available", "GET /health", "status is 200", "P0", "", "\u672a\u6267\u884c"]);
    const profile = {
      protocol_version: "1.0.0",
      profile_id: "packaged-tar-smoke",
      targets: { api: { kind: "api", origin: server.origin } },
      credentials: {},
      case_plans: {
        "TAR-API-001": [
          { type: "api.request", action_id: "TAR-API-001-request", target_alias: "api", method: "GET", path: "/health", risk: "R0", source_step: "TAR-API-001-A1" },
          { type: "api.assert", action_id: "TAR-API-001-assert", target_alias: "api", assertion: "status is 200", risk: "R0", source_step: "TAR-API-001-E1" },
        ],
      },
      rule_versions: ["1.0.0"],
    };
    const workbookPath = path.join(fixtureDir, "cases.xlsx");
    const executionPackagePath = path.join(fixtureDir, "cases.execution-package.zip");
    const profilePath = path.join(fixtureDir, "execution-profile.json");
    await workbook.xlsx.writeFile(workbookPath);
    await writeJson(profilePath, profile);
    await run(process.execPath, ["--require", guardPath, compilerCli, "compile", "--input", workbookPath, "--output", executionPackagePath], { cwd: packageRoot, env: environment });
    await run(process.execPath, nodeArgs(["plan", "--input", executionPackagePath, "--profile", profilePath, "--output-dir", planDir]), { cwd: packageRoot, env: environment });
    const manifestPath = path.join(planDir, "run-manifest.json");
    const approvalPath = path.join(planDir, "approval.json");
    await run(process.execPath, nodeArgs(["approve", "--manifest", manifestPath, "--out", approvalPath, "--expires-at", "2999-01-01T00:00:00.000Z", "--confirmed-by", "packaged-tar-smoke"]), { cwd: packageRoot, env: environment });
    await run(process.execPath, nodeArgs(["run", "--manifest", manifestPath, "--approval", approvalPath, "--output-dir", resultDir, "--mode", "ci", "--browser", "headless", "--progress", "off", "--slow-mo", "0"]), { cwd: packageRoot, env: environment });
    await run(process.execPath, nodeArgs(["verify-report", "--report", path.join(resultDir, "projected-report.json"), "--run-result", path.join(resultDir, "run-result.json")]), { cwd: packageRoot, env: environment });
    const runResult = JSON.parse(await readFile(path.join(resultDir, "run-result.json"), "utf8"));
    if (runResult.run_status !== "completed" || runResult.cases?.length !== 1) fail("packaged API smoke did not complete exactly one case");
  } finally {
    await server.close();
  }

  const events = (await readFile(guardLog, "utf8")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const networkEvents = events.filter(({ type }) => type === "network");
  const packageManagerInvocations = events.filter(({ type }) => type === "package-manager");
  if (networkEvents.length === 0 || networkEvents.some(({ allowed }) => allowed !== true)) {
    fail("execution network log must contain loopback-only requests");
  }
  if (packageManagerInvocations.length !== 0) fail("execution invoked a package manager");
  const evidence = {
    schema_version: 1,
    archive,
    package_root: packageRoot,
    workspace_realpath: workspaceRealpath,
    package_root_realpath: packageRootRealpath,
    package_outside_workspace: packageOutsideWorkspace,
    packaged_node_modules: packageNodeModules,
    packaged_dependency_layout: PACKAGED_DEPENDENCY_LAYOUT,
    node_executable: process.execPath,
    cli,
    path_during_execution: emptyPath,
    NODE_PATH: environment.NODE_PATH ?? null,
    NODE_OPTIONS: environment.NODE_OPTIONS ?? null,
    dependencies,
    commands: ["--version", "compiler compile", "plan", "approve", "run", "verify-report"],
    network_policy: {
      mode: "loopback-only",
      denied_origins: [
        "https://github.com/Saitamasans/testing-skills/releases/download/",
        "https://cdn.playwright.dev/",
        "https://playwright.azureedge.net/",
        "https://storage.googleapis.com/chrome-for-testing-public/",
      ],
    },
    network_events: networkEvents,
    package_manager_invocations: packageManagerInvocations,
    run_result: path.join(resultDir, "run-result.json"),
  };
  await writeJson(path.join(workDir, "packaged-tar-evidence.json"), evidence);
  return evidence;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyReleaseTarball(process.argv[2], process.argv[3]).then(
    (value) => console.log(JSON.stringify(value, null, 2)),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
