import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const CASE_ID = "BUNDLE-SMOKE-001";
const ASSERTION_ID = "BUNDLE-SMOKE-001-visible-text";
const EXPECTED_TEXT = "Bundle Smoke Ready";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_BUNDLE_ROOT = path.resolve(SCRIPT_DIR, "..");
const COLUMNS = [
  "用例 ID",
  "所属模块",
  "用例标题",
  "验证功能点",
  "前置条件",
  "测试步骤",
  "预期结果",
  "优先级",
  "执行结果",
  "备注",
];

function smokeError(message) {
  const error = new Error(`installation_smoke_failed: ${message}`);
  error.name = "InstallationSmokeError";
  return error;
}

export function assertRunnerVersionMatchesManifest(cliVersion, manifestVersion) {
  if (cliVersion !== manifestVersion) {
    throw smokeError("Runner CLI version does not match payload manifest");
  }
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, canonicalValue(item)]));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function sha256File(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

function safeOutputPath(outputDir, relative) {
  if (
    typeof relative !== "string"
    || relative.length === 0
    || relative.includes("\\")
    || path.posix.isAbsolute(relative)
    || relative.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw smokeError(`unsafe evidence path: ${relative}`);
  }
  const resolved = path.resolve(outputDir, ...relative.split("/"));
  const prefix = `${path.resolve(outputDir)}${path.sep}`;
  if (!resolved.toLocaleLowerCase("en-US").startsWith(prefix.toLocaleLowerCase("en-US"))) {
    throw smokeError(`evidence path escapes output directory: ${relative}`);
  }
  return resolved;
}

function reportSource() {
  const values = [
    CASE_ID,
    "installation",
    "complete Windows bundle smoke",
    "visible Chromium execution",
    "bundled runtime is staged",
    "open local fixture and assert visible text",
    EXPECTED_TEXT,
    "P0",
    "未执行",
    "",
  ];
  return {
    title: "Bundle installation smoke",
    generated_at: "2026-07-18T00:00:00.000Z",
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [{
      name: "Cases",
      kind: "test_cases",
      columns: COLUMNS,
      rows: [{ values }],
    }],
  };
}

export function createSmokeDocuments({ origin }) {
  const sourceReport = reportSource();
  const sourceText = `${JSON.stringify(sourceReport, null, 2)}\n`;
  const original = Object.fromEntries(COLUMNS.map((column, index) => [
    column,
    sourceReport.sheets[0].rows[0].values[index],
  ]));
  const manifest = {
    protocol_version: "1.0.0",
    manifest_id: "bundle-smoke",
    runner: { version: "1.0.0" },
    source: { path: "smoke-source-report.json", sha256: sha256(sourceText) },
    targets: [origin],
    rule_versions: ["bundle-smoke-1.0.0"],
    cases: [{
      case_id: CASE_ID,
      original,
      steps: [
        {
          type: "web.goto",
          action_id: "BUNDLE-SMOKE-001-open-fixture",
          target_alias: "fixture",
          url: `${origin}/`,
          risk: "R0",
        },
        {
          type: "web.assert",
          action_id: ASSERTION_ID,
          target_alias: "fixture",
          assertion: `text=${EXPECTED_TEXT}`,
          risk: "R0",
        },
      ],
    }],
  };
  const manifestHash = sha256(JSON.stringify(canonicalValue(manifest)));
  const approval = {
    protocol_version: "1.0.0",
    approval_id: "approval-bundle-smoke",
    manifest_hash: manifestHash,
    source_hash: manifest.source.sha256,
    runner: { version: "1.0.0" },
    rule_versions: [...manifest.rule_versions],
    targets: [origin],
    approved_risks: ["R0"],
    approved_r3_action_ids: [],
    issued_by: "installation-smoke-test",
    issued_at: "2026-07-18T00:00:00.000Z",
    expires_at: "2999-01-01T00:00:00.000Z",
  };
  const profile = {
    protocol_version: "1.0.0",
    profile_id: "bundle-smoke",
    targets: { fixture: { kind: "web", origin } },
    credentials: {},
  };
  return { sourceReport, sourceText, manifest, approval, profile };
}

async function verifyReference(outputDir, reference, label) {
  const file = safeOutputPath(outputDir, reference.path);
  const metadata = await lstat(file).catch(() => undefined);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw smokeError(`${label} is missing or is a reparse point: ${reference.path}`);
  }
  const actual = await sha256File(file);
  if (actual !== reference.sha256) {
    throw smokeError(`${label} SHA-256 mismatch: ${reference.path}`);
  }
  return { path: reference.path, sha256: reference.sha256, size_bytes: metadata.size };
}

function sheetByKind(projected, kind) {
  const found = projected.sheets?.find((item) => item.kind === kind);
  if (!found) throw smokeError(`projected report is missing ${kind} sheet`);
  return found;
}

function sheetByName(projected, name) {
  const matching = projected.sheets?.filter((item) => item.name === name) ?? [];
  if (matching.length !== 1) throw smokeError(`projected report is missing or duplicates ${name} sheet`);
  return matching[0];
}

function jsonCell(value) {
  return value === undefined ? "" : JSON.stringify(value);
}

function valuesForRows(rows) {
  return (rows ?? []).map((row) => row.values?.map((value) => String(value ?? "")) ?? []);
}

function requireExactRows(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw smokeError(`${label} rows do not match run-result`);
  }
}

function parseHtmlReport(html) {
  if (!/^<!doctype html>\s*<html\b/i.test(html)) {
    throw smokeError("HTML report does not contain a valid document structure");
  }
  const prefix = "<script>const report=";
  const suffix = ";const statuses=";
  const start = html.indexOf(prefix);
  const end = start === -1 ? -1 : html.indexOf(suffix, start + prefix.length);
  if (start === -1 || end === -1) throw smokeError("HTML report data structure is missing");
  try {
    return JSON.parse(html.slice(start + prefix.length, end));
  } catch {
    throw smokeError("HTML report data structure is invalid JSON");
  }
}

async function readWorkbookProjection(file, runnerRoot) {
  if (!runnerRoot) throw smokeError("runnerRoot is required to inspect the Excel projection");
  const require = createRequire(path.join(runnerRoot, "package.json"));
  const ExcelJS = require("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(file);
  const sheets = new Map();
  workbook.eachSheet((worksheet) => {
    const rows = [];
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      rows.push(row.values.slice(1).map((value) => String(value ?? "")));
    });
    sheets.set(worksheet.name, rows);
  });
  return sheets;
}

export async function validateSmokeArtifacts(input) {
  const outputDir = path.resolve(input.outputDir);
  const result = JSON.parse(await readFile(path.join(outputDir, "run-result.json"), "utf8"));
  const projected = JSON.parse(await readFile(path.join(outputDir, "projected-report.json"), "utf8"));
  const html = await readFile(path.join(outputDir, "result.html"), "utf8");
  const htmlReport = parseHtmlReport(html);
  const xlsxPath = path.join(outputDir, "result.xlsx");
  const xlsxMetadata = await lstat(xlsxPath).catch(() => undefined);
  if (!xlsxMetadata?.isFile() || xlsxMetadata.size === 0) throw smokeError("Excel report is missing");
  const workbookSheets = await readWorkbookProjection(xlsxPath, input.runnerRoot);

  if (result.run_status !== "completed") throw smokeError("Runner did not complete");
  if (!Array.isArray(result.cases) || result.cases.length !== 1) {
    throw smokeError("run-result must contain exactly one case");
  }
  const item = result.cases[0];
  if (item.case_id !== CASE_ID || item.case_status !== "通过" || item.run_status !== "completed") {
    throw smokeError("case ID or status does not match the locked smoke case");
  }
  if (
    item.assertions?.length !== 1
    || item.assertions[0].assertion_id !== ASSERTION_ID
    || item.assertions[0].passed !== true
  ) {
    throw smokeError("visible-text assertion did not pass exactly once");
  }
  const pngReference = item.evidence?.find((entry) =>
    entry.path.endsWith(`/${ASSERTION_ID}/web-page.png`));
  const traceReference = item.evidence?.find((entry) => entry.path === "evidence/playwright-trace.zip");
  if (!pngReference) throw smokeError("PNG evidence reference is missing");
  if (!traceReference) throw smokeError("Trace evidence reference is missing");
  const png = await verifyReference(outputDir, pngReference, "PNG evidence");
  const trace = await verifyReference(outputDir, traceReference, "Trace evidence");

  const expectedAssertionRows = item.assertions.map((assertion) => [
    item.case_id,
    assertion.assertion_id,
    String(assertion.passed),
    jsonCell(assertion.actual),
    jsonCell(assertion.expected),
  ]);
  const expectedEvidenceRows = item.evidence.map((reference) => [
    item.case_id,
    item.run_status,
    item.case_status,
    reference.path,
    reference.sha256,
  ]);

  const caseRows = sheetByKind(projected, "test_cases").rows ?? [];
  if (!caseRows.some((row) => row.values?.[0] === CASE_ID && row.values?.[8] === "通过")) {
    throw smokeError("projected case status does not match run-result");
  }
  const assertionRows = sheetByName(projected, "Assertion outcomes").rows ?? [];
  requireExactRows("projected assertion", valuesForRows(assertionRows), expectedAssertionRows);
  const evidenceRows = sheetByName(projected, "Evidence references").rows ?? [];
  requireExactRows("projected evidence", valuesForRows(evidenceRows), expectedEvidenceRows);

  const htmlCaseRows = sheetByKind(htmlReport, "test_cases").rows ?? [];
  if (!htmlCaseRows.some((row) => row.values?.[0] === CASE_ID && row.values?.[8] === "通过")) {
    throw smokeError("HTML case status does not match run-result");
  }
  requireExactRows(
    "HTML assertion",
    valuesForRows(sheetByName(htmlReport, "Assertion outcomes").rows),
    expectedAssertionRows,
  );
  requireExactRows(
    "HTML evidence",
    valuesForRows(sheetByName(htmlReport, "Evidence references").rows),
    expectedEvidenceRows,
  );

  const excelCaseRows = workbookSheets.get("Cases") ?? [];
  if (!excelCaseRows.some((row) => row[0] === CASE_ID && row[8] === "通过")) {
    throw smokeError("Excel case status does not match run-result");
  }
  requireExactRows(
    "Excel assertion",
    workbookSheets.get("Assertion outcomes") ?? [],
    expectedAssertionRows,
  );
  requireExactRows(
    "Excel evidence",
    workbookSheets.get("Evidence references") ?? [],
    expectedEvidenceRows,
  );
  return {
    case_id: CASE_ID,
    case_status: "通过",
    assertion_id: ASSERTION_ID,
    assertion_passed: true,
    png,
    trace,
  };
}

async function runProcess({ executable, args, cwd, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env: { ...process.env, ...env },
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
        reject(smokeError(`${path.basename(executable)} exited with ${signal ?? code}\n${stdout}\n${stderr}`));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

function loopbackAddress(address) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

async function startFixtureServer(fixture) {
  const requests = [];
  let expectedHost;
  const server = http.createServer((request, response) => {
    const remote = request.socket.remoteAddress;
    if (!loopbackAddress(remote) || request.headers.host !== expectedHost) {
      response.writeHead(403).end("forbidden");
      requests.push({ external: true, remote, host: request.headers.host, url: request.url });
      return;
    }
    requests.push({ external: false, remote, host: request.headers.host, url: request.url });
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
    });
    response.end(fixture);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  expectedHost = `127.0.0.1:${address.port}`;
  return {
    origin: `http://${expectedHost}`,
    requests,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function verifyBundleInventory(bundleRoot, manifest) {
  for (const entry of manifest.files ?? []) {
    const file = safeOutputPath(bundleRoot, entry.path);
    const metadata = await lstat(file).catch(() => undefined);
    if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size !== entry.size_bytes) {
      throw smokeError(`bundle inventory mismatch: ${entry.path}`);
    }
    if (await sha256File(file) !== entry.sha256) throw smokeError(`bundle SHA-256 mismatch: ${entry.path}`);
  }
}

export async function runInstallationSmokeTest(input = {}) {
  const bundleRoot = path.resolve(input.bundleRoot ?? DEFAULT_BUNDLE_ROOT);
  const outputDir = path.resolve(input.outputDir ?? path.join(bundleRoot, "diagnostics", "installation-smoke"));
  await mkdir(outputDir, { recursive: true });
  const smokeResultPath = path.join(outputDir, "smoke-result.json");
  try {
    const payload = JSON.parse(await readFile(path.join(bundleRoot, "bundle-manifest.json"), "utf8"));
    await verifyBundleInventory(bundleRoot, payload);
    const expectedNode = path.join(bundleRoot, "node", "node.exe");
    if (path.resolve(process.execPath).toLocaleLowerCase("en-US") !== expectedNode.toLocaleLowerCase("en-US")) {
      throw smokeError("smoke test must run with bundled Node");
    }
    if (process.version !== `v${payload.components.node.version}` || process.arch !== payload.bundle.arch) {
      throw smokeError("bundled Node version or architecture does not match payload manifest");
    }
    const runnerRoot = path.join(bundleRoot, "runner");
    const runnerCli = path.join(runnerRoot, "dist", "cli.js");
    const version = await runProcess({ executable: expectedNode, args: [runnerCli, "--version"], cwd: runnerRoot });
    assertRunnerVersionMatchesManifest(version.stdout.trim(), payload.components.runner.version);
    const dependencyNames = Object.keys(JSON.parse(await readFile(path.join(runnerRoot, "package.json"), "utf8")).dependencies ?? {});
    const dependencyCheck = [
      "const {createRequire}=require('node:module');",
      `const requireFromRunner=createRequire(${JSON.stringify(path.join(runnerRoot, "package.json"))});`,
      `for (const name of ${JSON.stringify(dependencyNames)}) requireFromRunner(name);`,
    ].join("");
    await runProcess({ executable: expectedNode, args: ["-e", dependencyCheck], cwd: runnerRoot });

    const fixture = await readFile(path.join(bundleRoot, "smoke", "installation-smoke-fixture.html"), "utf8");
    const server = await startFixtureServer(fixture);
    try {
      const documents = createSmokeDocuments({ origin: server.origin });
      await writeFile(path.join(outputDir, "smoke-source-report.json"), documents.sourceText, "utf8");
      await writeJson(path.join(outputDir, "run-manifest.json"), documents.manifest);
      await writeJson(path.join(outputDir, "approval.json"), documents.approval);
      await writeJson(path.join(outputDir, "execution-profile.normalized.json"), documents.profile);
      await runProcess({
        executable: expectedNode,
        args: [
          runnerCli,
          "run",
          "--manifest", path.join(outputDir, "run-manifest.json"),
          "--approval", path.join(outputDir, "approval.json"),
          "--output-dir", outputDir,
          "--mode", "interactive",
          "--browser", "visible",
          "--progress", "off",
          "--slow-mo", "0",
        ],
        cwd: outputDir,
        env: {
          PLAYWRIGHT_BROWSERS_PATH: path.join(bundleRoot, "browser-cache"),
          TESTING_RUNNER_SMOKE_ALLOWED_ORIGIN: server.origin,
        },
      });
      if (server.requests.length === 0 || server.requests.some((request) => request.external)) {
        throw smokeError("fixture received no valid loopback request or received an external request");
      }
      const validated = await validateSmokeArtifacts({ outputDir, runnerRoot });
      const artifacts = [];
      for (const relative of [
        "run-result.json",
        "projected-report.json",
        "result.html",
        "result.xlsx",
        "run-events.jsonl",
      ]) {
        const absolute = safeOutputPath(outputDir, relative);
        const metadata = await lstat(absolute).catch(() => undefined);
        if (!metadata?.isFile() || metadata.isSymbolicLink() || metadata.size === 0) {
          throw smokeError(`required diagnostic artifact is missing: ${relative}`);
        }
        artifacts.push({ path: relative, size_bytes: metadata.size, sha256: await sha256File(absolute) });
      }
      const smokeResult = {
        schema_version: 1,
        ok: true,
        node: { version: process.version.slice(1), arch: process.arch },
        runner: { version: version.stdout.trim() },
        browser: { visible: true },
        artifacts,
        ...validated,
      };
      await writeJson(smokeResultPath, smokeResult);
      return smokeResult;
    } finally {
      await server.close();
    }
  } catch (error) {
    await writeJson(smokeResultPath, {
      schema_version: 1,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInstallationSmokeTest({ outputDir: process.argv[2] }).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
