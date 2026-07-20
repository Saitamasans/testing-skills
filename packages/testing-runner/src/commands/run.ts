import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { executeAction as executeRegisteredAction } from "../actions/action-registry.js";
import { sha256Canonical } from "../compiler/canonical-json.js";
import { ELEVEN_COLUMNS, TEN_COLUMNS, type NativeReportDocument } from "../input/detect-input.js";
import {
  projectExecutionReport,
  renderExecutionReports,
  verifyExecutionDetailProjection,
} from "../reporting/report-projector.js";
import { verifyReportConsistency } from "../reporting/consistency-gate.js";
import { runApprovedManifest } from "../runtime/run-orchestrator.js";
import { createExecutionContext, type CreateExecutionContextInput } from "../runtime/execution-context.js";
import {
  openBrowserSession,
  type BrowserSessionOptions,
  type BrowserVisibility,
} from "../runtime/browser-session.js";
import type { ProgressVisibility } from "../runtime/visual-progress.js";
import type { DeliveryArtifact } from "../runtime/visual-progress-model.js";
import {
  EXIT_BLOCKED_OR_MANUAL,
  EXIT_UNSAFE_OR_INVALID,
  exitCodeForRunResult,
} from "../runtime/exit-codes.js";
import { validateDocument } from "../schema-registry.js";
import { verifyApproval } from "../security/approval.js";
import { resolveCredentials, type CredentialRef } from "../security/credential-resolver.js";
import { normalizeTargetOrigins } from "../security/target-scope.js";
import type {
  Approval,
  CaseStatus,
  ExecutionProfile,
  HttpUrl,
  RunCaseResult,
  RunManifest,
  RunResult,
  RunStatus,
} from "../types.js";

export interface RunCommandOptions {
  manifest: string;
  approval: string;
  outputDir: string;
  mode?: "interactive" | "ci";
  browser?: BrowserVisibility;
  slowMo?: number;
  progress?: ProgressVisibility;
}

type RuntimeExecutionProfile = ExecutionProfile & {
  data?: Record<string, unknown>;
};

const NOT_EXECUTED = "未执行" as CaseStatus;

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function profilePathForManifest(manifestPath: string): string {
  return path.join(path.dirname(manifestPath), "execution-profile.normalized.json");
}

async function readRuntimeProfile(manifestPath: string): Promise<RuntimeExecutionProfile> {
  const raw = await readJson<RuntimeExecutionProfile>(profilePathForManifest(manifestPath));
  validateDocument<ExecutionProfile>("execution-profile", raw);
  return raw;
}

function assertProfileTargetsLocked(profile: RuntimeExecutionProfile, approval: Approval): void {
  const profileOrigins = normalizeTargetOrigins(profile.targets).sort();
  const approvedOrigins = [...approval.targets].sort();
  if (JSON.stringify(profileOrigins) !== JSON.stringify(approvedOrigins)) {
    throw new Error("execution profile target origins do not match approval");
  }
}

function credentialRefs(profile: RuntimeExecutionProfile): CredentialRef[] {
  return Object.entries(profile.credentials).map(([alias, ref]) => ({
    alias,
    source: "configured_env",
    name: ref.name,
  }));
}

function reportFromManifest(manifest: RunManifest): NativeReportDocument {
  const columns = manifest.cases.some((item) => Object.hasOwn(item.original, "实际结果"))
    ? [...ELEVEN_COLUMNS]
    : [...TEN_COLUMNS];
  return {
    title: "Execution result",
    generated_at: new Date().toISOString(),
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns,
        rows: manifest.cases.map((item) => ({
          values: columns.map((column) => String(item.original[column] ?? "")),
        })),
      },
    ],
  };
}

async function sourceReport(manifest: RunManifest): Promise<NativeReportDocument> {
  if (path.extname(manifest.source.path).toLowerCase() === ".json") {
    try {
      return validateDocument<NativeReportDocument>("report", await readJson<unknown>(manifest.source.path));
    } catch {
      return reportFromManifest(manifest);
    }
  }
  return reportFromManifest(manifest);
}

function blockedResult(manifest: RunManifest, runStatus: RunStatus, reason: string): RunResult {
  const now = new Date().toISOString();
  return {
    protocol_version: "1.0.0",
    run_id: `run-${manifest.manifest_id}`,
    manifest_hash: sha256Canonical(manifest),
    ...(manifest.contract_version ? { contract_version: manifest.contract_version } : {}),
    ...(manifest.package_sha256 ? { package_sha256: manifest.package_sha256 } : {}),
    run_status: runStatus,
    started_at: now,
    completed_at: now,
    cases: manifest.cases.map((item) => ({
      case_id: item.case_id,
      case_status: NOT_EXECUTED,
      run_status: "blocked",
      assertions: [{ assertion_id: "preflight", passed: false, actual: reason }],
      evidence: [],
      ...(item.execution_contract ? {
        execution_contract: structuredClone(item.execution_contract),
        contract_field_status: Object.fromEntries(
          Object.keys(item.execution_contract).map((field) => [field, "blocked"]),
        ) as NonNullable<RunCaseResult["contract_field_status"]>,
      } : {}),
    })),
  };
}

async function deliveryArtifact(
  outputDir: string,
  kind: DeliveryArtifact["kind"],
  label: string,
  file: string,
): Promise<DeliveryArtifact> {
  const exists = await stat(file).then(() => true).catch(() => false);
  return {
    kind,
    label,
    fileName: path.relative(outputDir, file).replaceAll("\\", "/"),
    href: pathToFileURL(file).href,
    exists,
  };
}

export function resolveSmokeNetworkOrigin(
  manifest: RunManifest,
  profile: ExecutionProfile,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = env.TESTING_RUNNER_SMOKE_ALLOWED_ORIGIN;
  if (raw === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("smoke network origin must be a valid loopback URL");
  }
  if (
    parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.port === ""
    || parsed.origin !== raw
  ) {
    throw new Error("smoke network origin must be exactly http://127.0.0.1:<port>");
  }
  const manifestTargets = [...(manifest.targets ?? [])];
  const profileTargets = normalizeTargetOrigins(profile.targets);
  if (
    manifestTargets.length !== 1
    || profileTargets.length !== 1
    || manifestTargets[0] !== raw
    || profileTargets[0] !== raw
  ) {
    throw new Error("smoke network origin target mismatch with manifest and profile");
  }
  return raw;
}

async function sha256File(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}

export async function attachTraceEvidence(input: {
  result: RunResult;
  manifest: RunManifest;
  outputDir: string;
  tracePath?: string | undefined;
  tracePaths?: string[] | undefined;
}): Promise<RunResult> {
  const absolutePaths = [...new Set([
    ...(input.tracePaths ?? []),
    ...(input.tracePath ? [input.tracePath] : []),
  ])];
  if (absolutePaths.length === 0) return input.result;

  const references = await Promise.all(absolutePaths.map(async (tracePath) => {
    const relative = path.relative(input.outputDir, tracePath).replaceAll("\\", "/");
    if (relative === "" || relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
      throw new Error("Playwright Trace must be inside the run output directory");
    }
    return { path: relative, sha256: await sha256File(tracePath) };
  }));
  const matched = new Set<string>();
  const cases = input.result.cases.map((item) => {
    const applicable = references.filter((reference) =>
      reference.path === "evidence/playwright-trace.zip"
      || reference.path === `evidence/${item.case_id}/playwright-trace.zip`
    );
    for (const reference of applicable) matched.add(reference.path);
    const evidence = [...item.evidence];
    for (const reference of applicable) {
      const existing = evidence.find(({ path: evidencePath }) => evidencePath === reference.path);
      if (existing && existing.sha256 !== reference.sha256) {
        throw new Error(`Playwright Trace evidence hash drift for ${item.case_id}`);
      }
      if (!existing) evidence.push(reference);
    }
    return { ...item, assertions: [...item.assertions], evidence };
  });
  const orphan = references.find((reference) => !matched.has(reference.path));
  if (orphan) throw new Error(`Playwright Trace has no matching Test Case: ${orphan.path}`);
  return { ...input.result, cases };
}

export async function finalizeResultForReporting(input: {
  result: RunResult;
  manifest: RunManifest;
  outputDir: string;
  finalizeTrace?: () => Promise<string | undefined>;
  finalizeTraces?: () => Promise<string[]>;
}): Promise<RunResult> {
  const tracePaths = input.finalizeTraces
    ? await input.finalizeTraces()
    : input.finalizeTrace
      ? [await input.finalizeTrace()].filter((value): value is string => value !== undefined)
      : [];
  return attachTraceEvidence({
    result: input.result,
    manifest: input.manifest,
    outputDir: input.outputDir,
    tracePaths,
  });
}

export async function writeReports(
  outputDir: string,
  manifest: RunManifest,
  result: RunResult,
): Promise<DeliveryArtifact[]> {
  const report = await sourceReport(manifest);
  const projected = projectExecutionReport({ report, result });
  const consistency = verifyReportConsistency({ report: projected, result });
  const detailConsistency = verifyExecutionDetailProjection({ report: projected, result });
  if (!consistency.valid || !detailConsistency.valid) {
    throw new Error(`report consistency failed: ${[
      ...consistency.errors,
      ...detailConsistency.errors,
    ].join("; ")}`);
  }
  await writeJson(path.join(outputDir, "projected-report.json"), projected);
  await renderExecutionReports(projected, outputDir, "result");
  return Promise.all([
    deliveryArtifact(outputDir, "excel", "Excel 执行报告", path.join(outputDir, "result.xlsx")),
    deliveryArtifact(outputDir, "html", "HTML 交互报告", path.join(outputDir, "result.html")),
    deliveryArtifact(outputDir, "json", "运行结果 JSON", path.join(outputDir, "run-result.json")),
    deliveryArtifact(outputDir, "json", "报告投影 JSON", path.join(outputDir, "projected-report.json")),
    deliveryArtifact(outputDir, "screenshots", "执行证据目录", path.join(outputDir, result.run_id, "evidence")),
    deliveryArtifact(outputDir, "logs", "执行事件日志", path.join(outputDir, result.run_id, "run-events.jsonl")),
  ]);
}

async function persistBlockedResult(
  outputDir: string,
  manifest: RunManifest,
  runStatus: RunStatus,
  reason: string,
  finalizeTraces?: () => Promise<string[]>,
): Promise<RunResult> {
  const result = validateDocument<RunResult>("run-result", await finalizeResultForReporting({
    result: blockedResult(manifest, runStatus, reason),
    manifest,
    outputDir,
    ...(finalizeTraces ? { finalizeTraces } : {}),
  }));
  await writeJson(path.join(outputDir, "run-result.json"), result);
  await writeReports(outputDir, manifest, result);
  return result;
}

export async function runRunCommand(options: RunCommandOptions): Promise<number> {
  const mode = options.mode ?? "interactive";
  await mkdir(options.outputDir, { recursive: true });

  const manifest = validateDocument<RunManifest>("run-manifest", await readJson<unknown>(options.manifest));
  const approval = validateDocument<Approval>("approval", await readJson<unknown>(options.approval));
  const verification = verifyApproval(manifest, approval, mode);
  if (verification.status === "approved" && manifest.package_sha256) {
    const currentPackageSha256 = await sha256File(manifest.source.path).catch(() => null);
    if (currentPackageSha256 !== manifest.package_sha256 || currentPackageSha256 !== approval.package_sha256) {
      verification.status = "blocked";
      verification.reasons.push("package changed after approval");
    }
  }
  if (verification.status !== "approved") {
    await persistBlockedResult(options.outputDir, manifest, "blocked", verification.reasons.join("; "));
    return EXIT_UNSAFE_OR_INVALID;
  }

  const profile = await readRuntimeProfile(options.manifest);
  assertProfileTargetsLocked(profile, approval);
  const allowedNetworkOrigin = resolveSmokeNetworkOrigin(manifest, profile);
  let secrets: ReturnType<typeof resolveCredentials>;
  try {
    secrets = resolveCredentials(credentialRefs(profile), process.env);
  } catch (error) {
    if (error instanceof Error && error.name === "CredentialResolutionError") {
      const result = await persistBlockedResult(options.outputDir, manifest, "blocked", error.message);
      return exitCodeForRunResult(result);
    }
    throw error;
  }

  const browserOptions: BrowserSessionOptions = {
    manifest,
    mode,
    outputDir: options.outputDir,
  };
  if (allowedNetworkOrigin !== undefined) browserOptions.allowedNetworkOrigin = allowedNetworkOrigin;
  if (options.browser !== undefined) browserOptions.visibility = options.browser;
  if (options.slowMo !== undefined) browserOptions.slowMo = options.slowMo;
  if (options.progress !== undefined) browserOptions.progress = options.progress;
  const browserSession = await openBrowserSession(browserOptions);
  try {
    const contextInput: CreateExecutionContextInput = {
      targets: profile.targets,
      approvedOrigins: approval.targets as HttpUrl[],
      data: profile.data ?? {},
      secrets,
      mode,
    };
    if (browserSession?.page) contextInput.page = browserSession.page;
    let context = createExecutionContext(contextInput);
    let result = validateDocument<RunResult>("run-result", await runApprovedManifest({
      manifest,
      outputDir: options.outputDir,
      ...(browserSession?.observer ? { observer: browserSession.observer } : {}),
      beforeCase: async (item) => {
        if (!browserSession || !item.steps.some((action) => action.type.startsWith("web.") || action.type === "cleanup.web")) return;
        const page = await browserSession.prepareCase(item.case_id);
        context = createExecutionContext({ ...contextInput, page });
      },
      executeAction: (action) => executeRegisteredAction(action, context),
    }));

    result = validateDocument<RunResult>("run-result", await finalizeResultForReporting({
      result,
      manifest,
      outputDir: options.outputDir,
      ...(browserSession ? { finalizeTraces: browserSession.finalizeTraces } : {}),
    }));
    await writeJson(path.join(options.outputDir, "run-result.json"), result);
    const artifacts = await writeReports(options.outputDir, manifest, result);
    const traceReferences = [...new Set(result.cases.flatMap((item) => item.evidence
      .map(({ path: evidencePath }) => evidencePath)
      .filter((evidencePath) => evidencePath.endsWith("/playwright-trace.zip"))))];
    for (const traceReference of traceReferences) {
      artifacts.push(await deliveryArtifact(
        options.outputDir,
        "trace",
        `Playwright Trace：${traceReference}`,
        path.join(options.outputDir, ...traceReference.split("/")),
      ));
    }
    await browserSession?.showDeliveryResult({ result, artifacts });
    await browserSession?.completionPause();
    return exitCodeForRunResult(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ManualCredentialRequiredError") {
      const result = await persistBlockedResult(
        options.outputDir,
        manifest,
        "manual_required",
        error.message,
        browserSession?.finalizeTraces,
      );
      return exitCodeForRunResult(result);
    }
    throw error;
  } finally {
    await browserSession?.close();
  }
}

export function runCommandErrorExitCode(error: unknown): number {
  if (error instanceof Error && error.name === "CredentialResolutionError") return EXIT_BLOCKED_OR_MANUAL;
  return EXIT_UNSAFE_OR_INVALID;
}
