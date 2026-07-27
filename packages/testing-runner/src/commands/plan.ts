import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { compileManifest, type ExecutionProfileWithPlans } from "../compiler/manifest-compiler.js";
import { sha256Canonical } from "../compiler/canonical-json.js";
import { assessReadiness, type RuntimeProbeReport } from "../readiness.js";
import { validateDocument } from "../schema-registry.js";
import { readStandardExcel } from "../input/excel-reader.js";
import { detectInputKind } from "../input/detect-input.js";
import { readNativeReport } from "../input/report-reader.js";
import {
  applyConfirmedMapping,
} from "../input/nonstandard-excel.js";
import {
  inspectNonstandardWorkbook,
  proposeMapping,
  type MappingProposal,
} from "../input/mapping-proposal.js";
import type { DiscoveryReceiptReference, ExecutionProfile, NormalizedCaseSet, RunManifest, SourceSnapshot } from "../types.js";
import { readExecutionPackage } from "../input/execution-package.js";
import type { ContractCase } from "@saitamasans/testing-contract-compiler";
import type { Page } from "playwright";
import { verifyDiscoveryReceipts, type ActiveRuntimeSession } from "../security/discovery-receipt.js";
import { planDiscoveryTasks, type DiscoveryTask } from "../discovery/discovery-task.js";

export interface PlanCommandOptions {
  input: string;
  profile: string;
  outputDir: string;
  mappingApproval?: string;
  legacyInput?: boolean;
  discoveryReceipts?: string[];
  discoveryApproval?: string;
  discoveryApprovals?: string[];
  runtimeSession?: ActiveRuntimeSession;
  livePage?: Page;
  livePages?: Page[];
  now?: Date;
  clock?: () => Date;
}

export interface PlanCommandResult {
  case_set?: NormalizedCaseSet;
  mapping_proposal?: MappingProposal;
  manifest: RunManifest;
  readiness: ReturnType<typeof assessReadiness>;
}

type ReadCasesResult =
  | {
      state: "ready";
      caseSet: NormalizedCaseSet;
      mappingProposal?: MappingProposal;
    }
  | {
      state: "mapping-approval-required";
      mappingProposal: MappingProposal;
    };

const MAPPING_APPROVAL_REQUIRED_MESSAGE = "Nonstandard Excel requires --mapping-approval before manifest planning";

async function outputDirMatchesRuntimeSession(outputDir: string, runtimeSession: ActiveRuntimeSession): Promise<boolean> {
  try {
    return (await realpath(outputDir)).toLowerCase() === runtimeSession.runRoot.toLowerCase();
  } catch {
    return false;
  }
}

export async function runPlanCommand(options: PlanCommandOptions): Promise<PlanCommandResult> {
  if (options.runtimeSession && !(await outputDirMatchesRuntimeSession(options.outputDir, options.runtimeSession))) {
    throw new Error("runtime_session_output_dir_mismatch");
  }
  await mkdir(options.outputDir, { recursive: true });
  const profile = await readProfile(options.profile);
  if (!options.input.toLowerCase().endsWith(".execution-package.zip") && options.legacyInput !== true) {
    throw new Error("code=execution_contract_required\n请先调用 test-case-execution-compiler 生成 Execution Package。");
  }
  if (options.input.toLowerCase().endsWith(".execution-package.zip")) return runPackagePlan(options, profile);
  const cases = await readCases(options);
  if (cases.state === "mapping-approval-required") {
    await writeInputInspection(options.outputDir, cases.mappingProposal.source_snapshot);
    await writeJson(options.outputDir, "mapping-proposal.json", cases.mappingProposal);
    throw new Error(MAPPING_APPROVAL_REQUIRED_MESSAGE);
  }

  const { caseSet } = cases;
  const mappingProposal = "mappingProposal" in cases ? cases.mappingProposal : undefined;
  const manifest = compileManifest(caseSet, profile);
  const readiness = assessReadiness({
    case_set: caseSet,
    manifest,
    profile,
    runtime_probe: defaultRuntimeProbe(),
  });

  await writeInputInspection(options.outputDir, caseSet.source_snapshot);
  if (mappingProposal) await writeJson(options.outputDir, "mapping-proposal.json", mappingProposal);
  await writeJson(options.outputDir, "readiness.json", readiness);
  await writeJson(options.outputDir, "execution-profile.normalized.json", profile);
  await writeJson(options.outputDir, "run-manifest.json", manifest);
  await writeFile(path.join(options.outputDir, "execution-preview.md"), renderPreview(manifest), "utf8");

  const result: PlanCommandResult = { case_set: caseSet, manifest, readiness };
  if (mappingProposal) result.mapping_proposal = mappingProposal;
  return result;
}

export function bindLoginErrorFinalUrls(
  manifest: RunManifest,
  discoveryReceipts: readonly DiscoveryReceiptReference[],
  discoveryTasks: readonly DiscoveryTask[],
  contractCases: readonly ContractCase[],
): void {
  for (const receipt of discoveryReceipts.filter(({ page_state_id }) => page_state_id === "login_error")) {
    if (!receipt.final_url) throw new Error(`contract_incomplete: login_error final URL missing: ${receipt.case_id}`);
    const task = discoveryTasks.find(({ discovery_task_id }) => discovery_task_id === receipt.discovery_task_id);
    if (!task) throw new Error(`contract_incomplete: discovery task missing: ${receipt.discovery_task_id}`);
    for (const sourceCaseId of task.source_case_ids) {
      const contract = contractCases.find(({ source_case_id }) => source_case_id === sourceCaseId);
      if (!contract) throw new Error(`contract_incomplete: discovery source case missing: ${sourceCaseId}`);
      const item = manifest.cases.find(({ case_id }) => case_id === contract.case_id);
      if (!item) throw new Error(`contract_incomplete: discovery case missing: ${contract.case_id}`);
      const urlAssertions = item.steps.filter((action) => action.type === "web.assert" && action.assertion.startsWith("url="));
      if (urlAssertions.length === 0) continue;
      if (urlAssertions.length !== 1) throw new Error(`contract_incomplete: ${contract.case_id} must have exactly one login-page URL assertion`);
      const targetActionId = urlAssertions[0]!.action_id;
      item.steps = item.steps.map((action) => action.action_id === targetActionId && action.type === "web.assert"
        ? { ...action, assertion: `url=${receipt.final_url}` }
        : action);
    }
  }
}

async function runPackagePlan(options: PlanCommandOptions, profile: ExecutionProfileWithPlans): Promise<PlanCommandResult> {
  const loaded = await readExecutionPackage(options.input);
  const bindingStarted = performance.now();
  validateContractBindings(loaded.contract.cases, profile);
  const binding_ms = performance.now() - bindingStarted;
  const transitionStarted = performance.now();
  const discoveryReceipts = await verifyDiscoveryReceipts({
    ...(options.runtimeSession ? { session: options.runtimeSession } : {}),
    receiptPaths: options.discoveryReceipts ?? [],
    packageSha256: loaded.package_sha256,
    sourceCaseIds: loaded.contract.cases.map(({ source_case_id }) => source_case_id),
    contractCases: loaded.contract.cases,
    profile,
    ...(options.discoveryApproval ? { approvalPath: options.discoveryApproval } : {}),
    ...(options.discoveryApprovals ? { approvalPaths: options.discoveryApprovals } : {}),
    ...(options.livePage ? { livePage: options.livePage } : {}),
    ...(options.livePages ? { livePages: options.livePages } : {}),
    ...(options.now ? { now: options.now } : {}),
    ...(options.clock ? { clock: options.clock } : {}),
  });
  const transition_discovery_ms = performance.now() - transitionStarted;
  const doctorStarted = performance.now();
  const runtimeProbe = defaultRuntimeProbe();
  const runtime_doctor_ms = performance.now() - doctorStarted;
  const assemblyStarted = performance.now();
  const manifest = compileManifest(loaded.caseSet, profile);
  manifest.contract_version = loaded.contract.contract_version;
  manifest.package_id = loaded.manifest.package_id;
  manifest.package_sha256 = loaded.package_sha256;
  if (discoveryReceipts.length > 0) manifest.discovery_receipts = discoveryReceipts;
  bindLoginErrorFinalUrls(
    manifest,
    discoveryReceipts,
    planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 }),
    loaded.contract.cases,
  );
  manifest.cases = manifest.cases.map((item) => {
    const contract = loaded.contract.cases.find(({ case_id }) => case_id === item.case_id)!;
    return {
      ...item,
      isolation_scope: contract.isolation_scope,
      flow_group: contract.flow_group,
      execution_contract: structuredClone(contract),
    };
  });
  validateDocument<RunManifest>("run-manifest", manifest);
  const manifest_assembly_ms = performance.now() - assemblyStarted;
  const readiness = assessReadiness({ case_set: loaded.caseSet, manifest, profile, runtime_probe: runtimeProbe });
  await writeInputInspection(options.outputDir, loaded.caseSet.source_snapshot);
  await writeJson(options.outputDir, "readiness.json", readiness);
  await writeJson(options.outputDir, "execution-profile.normalized.json", profile);
  await writeJson(options.outputDir, "run-manifest.json", manifest);
  await writeFile(path.join(options.outputDir, "execution-preview.md"), renderPreview(manifest), "utf8");
  await writeJson(options.outputDir, "package-fast-path.json", {
    semantic_compilation: "skipped", semantic_compiler: "test-case-execution-compiler", contract_version: loaded.contract.contract_version, package_id: loaded.manifest.package_id, package_sha256: loaded.package_sha256,
    review: packageReviewMetadata(loaded, manifest),
    timings: { ...loaded.timings, runtime_doctor_ms, web_discovery_ms: null, binding_ms, transition_discovery_ms, manifest_assembly_ms, approval_wait_ms: null, execution_ms: null, report_ms: null },
  });
  return { case_set: loaded.caseSet, manifest, readiness };
}

function packageReviewMetadata(
  loaded: Awaited<ReturnType<typeof readExecutionPackage>>,
  manifest: RunManifest,
) {
  const riskRank = { R0: 0, R1: 1, R2: 2, R3: 3 } as const;
  const reviewCases = loaded.contract.cases.map((contractCase) => {
    const manifestCase = manifest.cases.find(({ case_id }) => case_id === contractCase.case_id)!;
    const riskLevels = [...new Set(manifestCase.steps.map(({ risk }) => risk))]
      .sort((left, right) => riskRank[left] - riskRank[right]);
    const actionIds = contractCase.actions.map((entry) => String((entry as { action_id?: unknown }).action_id ?? ""));
    const assertionIds = contractCase.assertions.map((entry) => String((entry as { assertion_id?: unknown }).assertion_id ?? ""));
    return {
      case_id: contractCase.case_id,
      source_case_id: contractCase.source_case_id,
      action_ids: actionIds,
      assertion_ids: assertionIds,
      action_count: actionIds.length,
      assertion_count: assertionIds.length,
      risk_levels: riskLevels,
      highest_risk: riskLevels.at(-1) ?? "R0",
      setup: structuredClone(contractCase.setup),
      cleanup: structuredClone(contractCase.cleanup),
      resource_locks: structuredClone(contractCase.resource_locks),
    };
  });
  const primarySourceName = path.posix.basename(loaded.manifest.source_files[0]!);
  return {
    package_sha256: loaded.package_sha256,
    source_sha256: loaded.manifest.source_sha256[primarySourceName],
    source_files_sha256: structuredClone(loaded.manifest.source_sha256),
    final_manifest_sha256: sha256Canonical(manifest),
    case_count: reviewCases.length,
    action_count: reviewCases.reduce((count, item) => count + item.action_count, 0),
    assertion_count: reviewCases.reduce((count, item) => count + item.assertion_count, 0),
    case_ids: reviewCases.map(({ case_id }) => case_id),
    cases: reviewCases,
  };
}

function semanticIds(item: ContractCase): string[] {
  const businessCleanup = Array.isArray(item.cleanup.business_cleanup) ? item.cleanup.business_cleanup : [];
  const ids = [...item.setup, ...item.actions, ...item.assertions, ...businessCleanup].map((entry) => {
    if (!entry || typeof entry !== "object") return undefined;
    const value = entry as { action_id?: unknown; assertion_id?: unknown; setup_id?: unknown; cleanup_id?: unknown };
    return [value.action_id, value.assertion_id, value.setup_id, value.cleanup_id].find((candidate) => typeof candidate === "string") as string | undefined;
  });
  if (ids.some((id) => !id)) throw new Error(`contract_incomplete: ${item.case_id} semantic action id missing`);
  return ids as string[];
}

function validateContractBindings(cases: ContractCase[], profile: ExecutionProfileWithPlans): void {
  for (const item of cases) {
    const actions = profile.case_plans?.[item.case_id];
    if (!actions?.length) throw new Error(`contract_incomplete: ${item.case_id} actions missing`);
    const expected = semanticIds(item);
    const mapped = actions.map(({ source_step }) => source_step).filter((value): value is string => Boolean(value));
    if (JSON.stringify(mapped) !== JSON.stringify(expected)) {
      const missing = expected.filter((id) => !mapped.includes(id));
      const unexpected = mapped.filter((id) => !expected.includes(id));
      const details = [
        missing.length > 0 ? `missing source-step IDs: ${missing.join(", ")}` : "",
        unexpected.length > 0 ? `unexpected source-step IDs: ${unexpected.join(", ")}` : "",
      ].filter(Boolean).join("; ");
      throw new Error(`contract_incomplete: ${item.case_id} source-step order or cardinality mismatch${details ? `; ${details}` : ""}`);
    }
  }
}

export async function readProfile(file: string): Promise<ExecutionProfileWithPlans> {
  const raw = JSON.parse(await readFile(file, "utf8")) as ExecutionProfileWithPlans;
  validateDocument<ExecutionProfile>("execution-profile", raw);
  if (!raw.case_plans || Object.keys(raw.case_plans).length === 0) {
    throw new Error("Execution profile must include case_plans for planning");
  }
  return raw;
}

async function readCases(options: PlanCommandOptions): Promise<ReadCasesResult> {
  const kind = await detectInputKind(options.input);
  if (kind === "native-report") return { state: "ready", caseSet: await readNativeReport(options.input) };
  if (kind === "standard-excel") return { state: "ready", caseSet: await readStandardExcel(options.input) };

  const inspection = await inspectNonstandardWorkbook(options.input);
  const mappingProposal = proposeMapping(inspection);
  if (!options.mappingApproval) {
    return { state: "mapping-approval-required", mappingProposal };
  }
  const approval = JSON.parse(await readFile(options.mappingApproval, "utf8")) as Parameters<typeof applyConfirmedMapping>[1];
  return {
    state: "ready",
    caseSet: await applyConfirmedMapping(mappingProposal, approval),
    mappingProposal,
  };
}

async function writeInputInspection(directory: string, snapshot: SourceSnapshot): Promise<void> {
  const { rows: _rows, ...sourceSnapshot } = snapshot;
  await writeJson(directory, "input-inspection.json", {
    input_kind: sourceSnapshot.input_kind,
    source_snapshot: sourceSnapshot,
  });
}

async function writeJson(directory: string, fileName: string, value: unknown): Promise<void> {
  await writeFile(path.join(directory, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderPreview(manifest: RunManifest): string {
  const lines = [
    `# Execution preview`,
    ``,
    `Manifest: ${manifest.manifest_id}`,
    `Runner: ${manifest.runner.version}`,
    `Source: ${manifest.source.path}`,
    ``,
  ];
  for (const item of manifest.cases) {
    lines.push(`## ${item.case_id}`);
    for (const action of item.steps) {
      lines.push(`- ${action.action_id}: ${action.type} ${action.target_alias} ${action.risk}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function defaultRuntimeProbe(): RuntimeProbeReport {
  return {
    runner: {
      package: "@saitamasans/testing-runner",
      source: "package.json",
      version: "1.0.0",
      required_version: "1.0.0",
      compatible: true,
      impact: "planner is available",
    },
    node: {
      package: "node",
      source: "process.version",
      version: process.version,
      required_version: ">=20",
      compatible: true,
      impact: "Node runtime is available",
    },
    browsers: [],
    target_connectivity: [],
    optional_db_drivers: [],
  };
}
