import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import ExcelJS from "exceljs";
import { compilePackage, loadExecutionPackage } from "../../testing-contract-compiler/src/index.js";
import { sha256Canonical } from "../src/compiler/canonical-json.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const compilerPackageRoot = fileURLToPath(new URL("../../testing-contract-compiler", import.meta.url));

function packedFilename(output: string): string {
  const packed = JSON.parse(output) as { filename: string } | Array<{ filename: string }>;
  const filename = Array.isArray(packed) ? packed[0]?.filename : packed.filename;
  assert.ok(filename, "package manager did not return a packed archive filename");
  return filename;
}

function resolvePackageManager(): { kind: "npm" | "pnpm"; cli: string } {
  if (process.env.npm_execpath) {
    return {
      kind: /pnpm/i.test(process.env.npm_execpath) ? "pnpm" : "npm",
      cli: process.env.npm_execpath,
    };
  }
  const candidates: Array<{ kind: "npm" | "pnpm"; cli: string }> = [
    {
      kind: "npm",
      cli: path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    },
    {
      kind: "pnpm",
      cli: path.resolve(path.dirname(process.execPath), "..", "node_modules", "pnpm", "bin", "pnpm.mjs"),
    },
    {
      kind: "pnpm",
      cli: path.resolve(path.dirname(process.execPath), "..", "node_modules", "pnpm", "bin", "pnpm.cjs"),
    },
  ];
  const manager = candidates.find((candidate) => existsSync(candidate.cli));
  assert.ok(manager, "npm or pnpm is required for the packed-install smoke test");
  return manager;
}

function runPackageManager(
  manager: { kind: "npm" | "pnpm"; cli: string },
  args: string[],
  cwd: string,
): string {
  const env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || "");
  const result = spawnSync(process.execPath, [manager.cli, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("packed Runner and independent Compiler load schemas and rules outside the monorepo", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "testing-runner-pack-"));
  const consumerRoot = path.join(temporaryRoot, "consumer");
  const originalCwd = process.cwd();
  let demoServer: ChildProcessWithoutNullStreams | undefined;

  try {
    await mkdir(consumerRoot);
    const manager = resolvePackageManager();
    const packArgs = manager.kind === "npm"
      ? ["pack", packageRoot, "--pack-destination", temporaryRoot, "--json"]
      : ["pack", "--config.node-linker=hoisted", "--pack-destination", temporaryRoot, "--json"];
    const compilerPackArgs = manager.kind === "npm"
      ? ["pack", compilerPackageRoot, "--pack-destination", temporaryRoot, "--json"]
      : ["pack", "--config.node-linker=hoisted", "--pack-destination", temporaryRoot, "--json"];
    const compilerPackOutput = runPackageManager(
      manager,
      compilerPackArgs,
      compilerPackageRoot,
    );
    const packOutput = runPackageManager(
      manager,
      packArgs,
      packageRoot,
    );
    const compilerFilename = packedFilename(compilerPackOutput);
    const filename = packedFilename(packOutput);
    const compilerArchivePath = path.isAbsolute(compilerFilename)
      ? compilerFilename
      : path.join(temporaryRoot, compilerFilename);
    const archivePath = path.isAbsolute(filename) ? filename : path.join(temporaryRoot, filename);
    runPackageManager(
      manager,
      manager.kind === "npm"
        ? ["install", "--ignore-scripts", compilerArchivePath, archivePath]
        : ["add", "--ignore-scripts", compilerArchivePath, archivePath],
      consumerRoot,
    );

    const registryPath = path.join(
      consumerRoot,
      "node_modules",
      "@saitamasans",
      "testing-runner",
      "dist",
      "schema-registry.js",
    );
    const knowledgePath = path.join(
      consumerRoot,
      "node_modules",
      "@saitamasans",
      "testing-runner",
      "dist",
      "assertions",
      "knowledge-registry.js",
    );
    process.chdir(consumerRoot);
    const registry = (await import(pathToFileURL(registryPath).href)) as {
      validateDocument<T>(schemaId: string, value: unknown): T;
    };
    const knowledge = (await import(pathToFileURL(knowledgePath).href)) as {
      loadKnowledgeRules(): Promise<unknown[]>;
    };
    const profile = {
      protocol_version: "1.0.0",
      profile_id: "packed-smoke",
      targets: { api: { kind: "api", origin: "https://api.example.test" } },
      credentials: { api: { source: "env", name: "TESTING_API_TOKEN" } },
    };

    assert.equal(registry.validateDocument("execution-profile", profile), profile);
    assert.ok((await knowledge.loadKnowledgeRules()).length > 0);

    demoServer = spawn(process.execPath, ["-e", `
      const http = require("node:http");
      const server = http.createServer((_request, response) => {
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        response.end("<!doctype html><html><body><main>workspace</main></body></html>");
      });
      server.listen(0, "127.0.0.1", () => process.stdout.write(String(server.address().port) + "\\n"));
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
    `], { stdio: ["ignore", "pipe", "pipe"] });
    const port = await new Promise<string>((resolve, reject) => {
      demoServer!.once("error", reject);
      demoServer!.stdout.once("data", (chunk) => resolve(String(chunk).trim()));
    });
    const targetUrl = `http://127.0.0.1:${port}/login`;
    const workbookPath = path.join(consumerRoot, "cases.xlsx");
    const packagePath = path.join(consumerRoot, "cases.execution-package.zip");
    const profilePath = path.join(consumerRoot, "profile.json");
    const runRoot = path.join(consumerRoot, ".testing-run");
    const approvalPath = path.join(runRoot, "discovery-approval.json");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("测试用例");
    sheet.addRow(["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"]);
    sheet.addRow(["LOGIN-001", "登录", "登录", "登录", "匿名页", "打开登录页", "工作台可见", "P0", "", "未执行"]);
    await workbook.xlsx.writeFile(workbookPath);
    await compilePackage({
      input: workbookPath,
      output: packagePath,
      overrides: { "LOGIN-001": { effects: { browser_state: { target_state: "workspace" }, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null } } },
    });
    const transitionActions = [{ type: "web.goto", action_id: "goto-login", target_alias: "web", url: targetUrl, risk: "R0", source_step: "LOGIN-001-A1" }];
    const casePlanActions = [...transitionActions, { type: "web.assert", action_id: "assert-workspace", target_alias: "web", assertion: "text includes workspace", risk: "R0", source_step: "LOGIN-001-E1" }];
    await writeFile(profilePath, JSON.stringify({
      protocol_version: "1.0.0",
      profile_id: "packed-discovery",
      targets: { web: { kind: "web", origin: `http://127.0.0.1:${port}` } },
      credentials: {},
      case_plans: { "LOGIN-001": casePlanActions },
    }, null, 2));
    await mkdir(runRoot);
    const loaded = await loadExecutionPackage(packagePath);
    const now = new Date();
    await writeFile(approvalPath, `${JSON.stringify({
      approval_schema_version: "1.0.0",
      approval_id: "packed-discovery-approval",
      source_package_sha256: loaded.package_sha256,
      source_case_ids: ["LOGIN-001"],
      transition_case_id: "LOGIN-001",
      transition_actions_sha256: sha256Canonical(transitionActions),
      target_origin: `http://127.0.0.1:${port}`,
      requested_url: targetUrl,
      page_state_id: "workspace",
      approved_risks: ["R0"],
      approved_r3_action_ids: [],
      issued_by: "packed-smoke-reviewer",
      issued_at: now.toISOString(),
      expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    }, null, 2)}\n`);
    const cliPath = path.join(consumerRoot, "node_modules", "@saitamasans", "testing-runner", "dist", "cli.js");
    const cliArguments = ["node", "testing-runner", "discover-plan", "--input", packagePath, "--profile", profilePath, "--output-dir", runRoot, "--discovery-approval", approvalPath, "--transition-case-id", "LOGIN-001", "--browser", "headless"];
    const planned = spawnSync(process.execPath, ["--input-type=module", "-e", `const { runCli } = await import(${JSON.stringify(pathToFileURL(cliPath).href)}); await runCli(${JSON.stringify(cliArguments)});`], { encoding: "utf8", cwd: consumerRoot });
    assert.equal(planned.status, 0, `${planned.stdout}\n${planned.stderr}`);
    const manifest = JSON.parse(await readFile(path.join(runRoot, "run-manifest.json"), "utf8"));
    assert.equal(manifest.discovery_receipts?.[0]?.case_id, "LOGIN-001");
  } finally {
    if (demoServer && demoServer.exitCode === null) {
      const exited = new Promise<void>((resolve) => demoServer!.once("exit", () => resolve()));
      demoServer.kill();
      await exited;
    }
    process.chdir(originalCwd);
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(path.join(packageRoot, "dist"), { recursive: true, force: true });
  }
});
