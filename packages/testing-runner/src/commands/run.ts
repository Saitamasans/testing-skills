import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { executeAction as executeRegisteredAction } from "../actions/action-registry.js";
import { sha256Canonical } from "../compiler/canonical-json.js";
import { TEN_COLUMNS, type NativeReportDocument } from "../input/detect-input.js";
import { projectExecutionReport, renderExecutionReports } from "../reporting/report-projector.js";
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
  return {
    title: "Execution result",
    generated_at: new Date().toISOString(),
    skill_invocation: "web-api-test-execution-evidence",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns: [...TEN_COLUMNS],
        rows: manifest.cases.map((item) => ({
          values: TEN_COLUMNS.map((column) => String(item.original[column] ?? "")),
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
    run_status: runStatus,
    started_at: now,
    completed_at: now,
    cases: manifest.cases.map((item) => ({
      case_id: item.case_id,
      case_status: NOT_EXECUTED,
      run_status: "blocked",
      assertions: [{ assertion_id: "preflight", passed: false, actual: reason }],
      evidence: [],
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

export async function writeReports(
  outputDir: string,
  manifest: RunManifest,
  result: RunResult,
): Promise<DeliveryArtifact[]> {
  const report = await sourceReport(manifest);
  const projected = projectExecutionReport({ report, result });
  const consistency = verifyReportConsistency({ report: projected, result });
  if (!consistency.valid) {
    throw new Error(`report consistency failed: ${consistency.errors.join("; ")}`);
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
): Promise<RunResult> {
  const result = validateDocument<RunResult>("run-result", blockedResult(manifest, runStatus, reason));
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
  if (verification.status !== "approved") {
    await persistBlockedResult(options.outputDir, manifest, "blocked", verification.reasons.join("; "));
    return EXIT_UNSAFE_OR_INVALID;
  }

  const profile = await readRuntimeProfile(options.manifest);
  assertProfileTargetsLocked(profile, approval);
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
    const context = createExecutionContext(contextInput);
    const result = validateDocument<RunResult>("run-result", await runApprovedManifest({
      manifest,
      outputDir: options.outputDir,
      ...(browserSession?.observer ? { observer: browserSession.observer } : {}),
      executeAction: (action) => executeRegisteredAction(action, context),
    }));

    await writeJson(path.join(options.outputDir, "run-result.json"), result);
    const artifacts = await writeReports(options.outputDir, manifest, result);
    const tracePath = await browserSession?.finalizeTrace();
    if (tracePath) {
      artifacts.push(await deliveryArtifact(
        options.outputDir,
        "trace",
        "Playwright Trace",
        tracePath,
      ));
    }
    await browserSession?.showDeliveryResult({ result, artifacts });
    await browserSession?.completionPause();
    return exitCodeForRunResult(result);
  } catch (error) {
    if (error instanceof Error && error.name === "ManualCredentialRequiredError") {
      const result = await persistBlockedResult(options.outputDir, manifest, "manual_required", error.message);
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
