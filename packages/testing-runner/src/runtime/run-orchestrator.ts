import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ContractFieldStatus } from "../types.js";
import type { AssertionResult, EvidenceReference, JsonValue, RunManifest, RunResult } from "../types.js";
import { sha256Canonical } from "../compiler/canonical-json.js";
import type { ActionOutcome } from "./execution-context.js";
import { EventWriter } from "./event-writer.js";
import { storeEvidence } from "./evidence-store.js";
import { retryDecision } from "./retry-policy.js";

type ManifestCase = RunManifest["cases"][number];
type ManifestAction = ManifestCase["steps"][number];
type CaseResult = RunResult["cases"][number];
type ObserverHook<T> = (event: T) => void | Promise<void>;

interface RunLifecycleBase {
  run_id: string;
  manifest_hash: string;
  case_total: number;
}

export interface RunStartedEvent extends RunLifecycleBase {
  manifest: RunManifest;
  action_total: number;
}

export interface CaseStartedEvent extends RunLifecycleBase {
  case_index: number;
  item: ManifestCase;
  action_total: number;
}

export interface ActionStartedEvent extends CaseStartedEvent {
  action_index: number;
  action: ManifestAction;
  attempt: number;
}

export interface ActionCompletedEvent extends ActionStartedEvent {
  outcome: ActionOutcome;
}

export interface CaseCompletedEvent extends CaseStartedEvent {
  result: CaseResult;
}

export interface RunCompletedEvent extends RunLifecycleBase {
  result: RunResult;
}

export interface RunObserver {
  runStarted?: ObserverHook<RunStartedEvent>;
  caseStarted?: ObserverHook<CaseStartedEvent>;
  actionStarted?: ObserverHook<ActionStartedEvent>;
  actionCompleted?: ObserverHook<ActionCompletedEvent>;
  caseCompleted?: ObserverHook<CaseCompletedEvent>;
  runCompleted?: ObserverHook<RunCompletedEvent>;
}

export interface RunInput {
  manifest: RunManifest;
  outputDir: string;
  run_id?: string;
  observer?: RunObserver;
  beforeCase?(item: ManifestCase): void | Promise<void>;
  afterCase?(item: ManifestCase): void | Promise<void>;
  executeAction(action: RunManifest["cases"][number]["steps"][number], attempt: number): Promise<ActionOutcome>;
}

const PASSED = "通过" as const;
const FAILED = "不通过" as const;
const PENDING = "待定" as const;
const NOT_EXECUTED = "未执行" as const;

function runId(manifest: RunManifest): string {
  return `run-${manifest.manifest_id}`;
}

function evidenceReference(entry: Awaited<ReturnType<typeof storeEvidence>>): EvidenceReference {
  return { path: entry.path, sha256: entry.sha256 };
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function isBusinessAssertion(action: ManifestAction): boolean {
  return action.type === "api.assert" || action.type === "web.assert" || action.type === "db.assert";
}

function hasVerdictRoute(item: ManifestCase): boolean {
  return item.steps.some((action) => isBusinessAssertion(action) || action.type === "execution.blocked");
}

function isCleanupAction(action: ManifestAction): boolean {
  return action.type === "cleanup.api" || action.type === "cleanup.web";
}

type ContractCase = NonNullable<ManifestCase["execution_contract"]>;
type ContractFieldStatusMap = Record<keyof ContractCase, ContractFieldStatus>;
type ExecutableContractField = "setup" | "actions" | "assertions" | "cleanup";

const CONTRACT_FIELDS = [
  "case_id", "source_case_id", "source_sheet", "title", "module", "priority", "execution_type",
  "automation_status", "isolation_scope", "flow_group", "start_state", "auth_profile", "setup", "actions",
  "assertions", "effects", "cleanup", "dependencies", "resource_locks", "evidence_policy", "unresolved",
] as const satisfies readonly (keyof ContractCase)[];

function contractFieldStatus(contract: ContractCase): ContractFieldStatusMap {
  const result = Object.fromEntries(CONTRACT_FIELDS.map((field) => [field, "skipped"])) as ContractFieldStatusMap;
  for (const field of ["case_id", "source_case_id", "source_sheet", "title", "module", "priority", "execution_type", "isolation_scope", "flow_group"] as const) {
    result[field] = "executed";
  }
  result.automation_status = contract.automation_status === "auto_ready" ? "executed" : "blocked";
  result.unresolved = contract.unresolved.length === 0 ? "skipped" : "blocked";
  result.dependencies = contract.dependencies.length === 0 ? "skipped" : "executed";
  result.resource_locks = contract.resource_locks.length === 0 ? "skipped" : "blocked";
  result.setup = contract.setup.length === 0 ? "skipped" : "blocked";
  result.actions = contract.actions.length === 0 ? "skipped" : "blocked";
  result.assertions = contract.assertions.length === 0 ? "skipped" : "blocked";
  result.cleanup = contract.cleanup.technical_cleanup.length === 0 && contract.cleanup.business_cleanup.length === 0 ? "skipped" : "blocked";
  return result;
}

function semanticId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const value = entry as { action_id?: unknown; assertion_id?: unknown; setup_id?: unknown; cleanup_id?: unknown };
  return [value.action_id, value.assertion_id, value.setup_id, value.cleanup_id]
    .find((candidate): candidate is string => typeof candidate === "string");
}

function contractFieldForAction(contract: ContractCase, action: ManifestAction): ExecutableContractField | undefined {
  const sourceStep = action.source_step;
  if (!sourceStep) return undefined;
  if (contract.setup.some((entry) => semanticId(entry) === sourceStep)) return "setup";
  if (contract.actions.some((entry) => semanticId(entry) === sourceStep)) return "actions";
  if (contract.assertions.some((entry) => semanticId(entry) === sourceStep)) return "assertions";
  if (contract.cleanup.business_cleanup.some((entry) => semanticId(entry) === sourceStep)) return "cleanup";
  return undefined;
}

function mergeContractFieldStatus(current: ContractFieldStatus | undefined, next: ContractFieldStatus): ContractFieldStatus {
  if (current === "failed" || next === "failed") return "failed";
  if (current === "blocked" || next === "blocked") return "blocked";
  if (current === "executed" || next === "executed") return "executed";
  return "skipped";
}

function recordContractActionOutcome(
  contract: ContractCase,
  action: ManifestAction,
  outcome: ActionOutcome,
  fieldStatus: ContractFieldStatusMap,
  observedStatus: Map<ExecutableContractField, ContractFieldStatus>,
): void {
  const field = contractFieldForAction(contract, action);
  if (!field) return;
  const outcomeStatus: ContractFieldStatus = outcome.status === "passed"
    ? "executed"
    : outcome.status === "failed" || outcome.status === "executor_error"
      ? "failed"
      : "blocked";
  const aggregate = mergeContractFieldStatus(observedStatus.get(field), outcomeStatus);
  observedStatus.set(field, aggregate);
  fieldStatus[field] = field === "cleanup" && contract.cleanup.technical_cleanup.length > 0 && aggregate !== "failed"
    ? "blocked"
    : aggregate;
}

function contractProjection(item: ManifestCase, status: ContractFieldStatusMap | undefined): Pick<CaseResult, "execution_contract" | "contract_field_status"> | Record<string, never> {
  if (!item.execution_contract || !status) return {};
  return { execution_contract: structuredClone(item.execution_contract), contract_field_status: { ...status } };
}

async function storeOutcomeAttachments(
  runDir: string,
  caseId: string,
  attempt: number,
  outcome: ActionOutcome,
): Promise<EvidenceReference[]> {
  const references: EvidenceReference[] = [];
  for (const attachment of outcome.attachments) {
    const entry = await storeEvidence({
      runDir,
      case_id: caseId,
      attempt,
      relativePath: attachment.relativePath,
      content: attachment.content,
    });
    references.push(evidenceReference(entry));
  }
  return references;
}

export async function runApprovedManifest(input: RunInput): Promise<RunResult> {
  const run_id = input.run_id ?? runId(input.manifest);
  const runDir = path.join(input.outputDir, run_id);
  const manifest_hash = sha256Canonical(input.manifest);
  const case_total = input.manifest.cases.length;
  const startedAt = new Date().toISOString();
  await mkdir(runDir, { recursive: true });
  const writer = new EventWriter(path.join(runDir, "run-events.jsonl"));
  const cases: RunResult["cases"] = [];
  const defects = new Map<string, { case_ids: string[]; evidence: EvidenceReference[] }>();
  let runStatus: RunResult["run_status"] = "completed";

  await input.observer?.runStarted?.({
    run_id,
    manifest_hash,
    case_total,
    manifest: input.manifest,
    action_total: input.manifest.cases.reduce((total, item) => total + item.steps.length, 0),
  });

  for (const [caseOffset, item] of input.manifest.cases.entries()) {
    const fieldStatus = item.execution_contract ? contractFieldStatus(item.execution_contract) : undefined;
    const observedContractStatus = new Map<ExecutableContractField, ContractFieldStatus>();
    const caseEvent = {
      run_id,
      manifest_hash,
      case_total,
      case_index: caseOffset + 1,
      item,
      action_total: item.steps.length,
    };
    await input.beforeCase?.(item);
    try {
    await input.observer?.caseStarted?.(caseEvent);
    const assertions: AssertionResult[] = [];
    const evidence: EvidenceReference[] = [];
    let contractBlockReason: string | undefined;
    if (item.execution_contract?.automation_status !== undefined && item.execution_contract.automation_status !== "auto_ready") {
      contractBlockReason = `Execution Contract automation_status is ${item.execution_contract.automation_status}.`;
    } else if ((item.execution_contract?.unresolved.length ?? 0) > 0) {
      contractBlockReason = `Execution Contract has unresolved fields: ${item.execution_contract!.unresolved.map(({ field }) => field).join(", ")}.`;
    } else {
      const failedDependency = item.execution_contract?.dependencies.find((dependency) => {
        const dependencyResult = cases.find(({ case_id }) => case_id === dependency);
        return dependencyResult?.case_status !== PASSED;
      });
      if (failedDependency) contractBlockReason = `Execution Contract dependency did not pass: ${failedDependency}.`;
    }
    if (contractBlockReason) {
      if (fieldStatus) {
        if (item.execution_contract?.automation_status !== "auto_ready") fieldStatus.automation_status = "blocked";
        else if ((item.execution_contract?.unresolved.length ?? 0) > 0) fieldStatus.unresolved = "blocked";
        else fieldStatus.dependencies = "blocked";
      }
      const caseResult: CaseResult = {
        case_id: item.case_id,
        case_status: NOT_EXECUTED,
        run_status: "blocked",
        assertions: [{ assertion_id: `${item.case_id}-contract-preflight`, passed: false, actual: contractBlockReason }],
        evidence: [],
        ...contractProjection(item, fieldStatus),
      };
      cases.push(caseResult);
      runStatus = "blocked";
      await input.observer?.caseCompleted?.({ ...caseEvent, result: caseResult });
      continue;
    }
    if (!hasVerdictRoute(item)) {
      const reason = "Case has no explicit business assertion; execution is blocked to prevent a false passing verdict.";
      const entry = await storeEvidence({
        runDir,
        case_id: item.case_id,
        attempt: 1,
        relativePath: "missing-business-assertion.json",
        content: `${JSON.stringify({ case_id: item.case_id, reason }, null, 2)}\n`,
      });
      const caseResult: CaseResult = {
        case_id: item.case_id,
        case_status: NOT_EXECUTED,
        run_status: "blocked",
        assertions: [{ assertion_id: `${item.case_id}-business-assertion`, passed: false, actual: reason }],
        evidence: [evidenceReference(entry)],
        ...contractProjection(item, fieldStatus),
      };
      cases.push(caseResult);
      runStatus = "blocked";
      await writer.appendEvent({
        run_id,
        case_id: item.case_id,
        action_id: `${item.case_id}-preflight`,
        attempt: 1,
        type: "case.blocked",
        data: { reason },
      });
      await input.observer?.caseCompleted?.({ ...caseEvent, result: caseResult });
      continue;
    }
    let caseStatus: RunResult["cases"][number]["case_status"] = PASSED;
    let caseRunStatus: RunResult["cases"][number]["run_status"] = "completed";
    let attempt = 1;
    let completed = false;
    const executionSteps = item.steps.filter((action) => !isCleanupAction(action));
    const cleanupSteps = item.steps.filter(isCleanupAction);

    while (!completed && attempt <= 2) {
      let retryCase = false;
      for (const action of executionSteps) {
        const actionEvent = {
          ...caseEvent,
          action_index: item.steps.indexOf(action) + 1,
          action,
          attempt,
        };
        await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.started" });
        await input.observer?.actionStarted?.(actionEvent);
        const outcome = await input.executeAction(action, attempt);
        if (fieldStatus && item.execution_contract) recordContractActionOutcome(item.execution_contract, action, outcome, fieldStatus, observedContractStatus);
        evidence.push(...await storeOutcomeAttachments(runDir, item.case_id, attempt, outcome));
        if (outcome.status === "passed") {
          await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.passed", data: outcome.actual });
          await input.observer?.actionCompleted?.({ ...actionEvent, outcome });
          if (isBusinessAssertion(action)) {
            assertions.push({ assertion_id: action.action_id, passed: true, actual: jsonValue(outcome.actual) });
          }
          continue;
        }

        if (outcome.status === "pending") {
          await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.pending", data: outcome.actual });
          await input.observer?.actionCompleted?.({ ...actionEvent, outcome });
          const entry = await storeEvidence({
            runDir,
            case_id: item.case_id,
            attempt,
            relativePath: "pending.json",
            content: JSON.stringify(outcome, null, 2),
          });
          evidence.push(evidenceReference(entry));
          caseStatus = PENDING;
          assertions.push({ assertion_id: action.action_id, passed: false, actual: jsonValue(outcome.actual) });
          completed = true;
          break;
        }

        await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.failed", data: outcome.error });
        await input.observer?.actionCompleted?.({ ...actionEvent, outcome });
        const entry = await storeEvidence({
          runDir,
          case_id: item.case_id,
          attempt,
          relativePath: "failure.json",
          content: JSON.stringify(outcome, null, 2),
        });
        const failureEvidence = evidenceReference(entry);
        evidence.push(failureEvidence);

        const decision = retryDecision({ kind: outcome.error?.type ?? outcome.status }, attempt);
        if (decision.retry) {
          await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "retry.scheduled", data: { next_attempt: attempt + 1 } });
          retryCase = true;
          break;
        }

        if (outcome.status === "failed") {
          caseStatus = FAILED;
          assertions.push({ assertion_id: action.action_id, passed: false, actual: jsonValue(outcome.actual) });
          if (outcome.root_cause_key) {
            const summary = defects.get(outcome.root_cause_key) ?? { case_ids: [], evidence: [] };
            if (!summary.case_ids.includes(item.case_id)) summary.case_ids.push(item.case_id);
            summary.evidence.push(failureEvidence);
            defects.set(outcome.root_cause_key, summary);
          }
        } else {
          caseStatus = NOT_EXECUTED;
          caseRunStatus = outcome.status === "manual_required"
            ? "manual_required"
            : outcome.status === "blocked"
              ? "blocked"
              : "executor_error";
          runStatus = caseRunStatus;
        }
        completed = true;
        break;
      }

      if (retryCase) {
        attempt += 1;
        continue;
      }
      completed = true;
    }

    for (const action of cleanupSteps) {
      const actionEvent = {
        ...caseEvent,
        action_index: item.steps.indexOf(action) + 1,
        action,
        attempt,
      };
      await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "cleanup.started" });
      await input.observer?.actionStarted?.(actionEvent);
      const outcome = await input.executeAction(action, attempt);
      if (fieldStatus && item.execution_contract) recordContractActionOutcome(item.execution_contract, action, outcome, fieldStatus, observedContractStatus);
      evidence.push(...await storeOutcomeAttachments(runDir, item.case_id, attempt, outcome));
      await input.observer?.actionCompleted?.({ ...actionEvent, outcome });
      if (outcome.status === "passed") {
        await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "cleanup.passed", data: outcome.actual });
        continue;
      }
      await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "cleanup.manual_required", data: outcome.error });
      const entry = await storeEvidence({
        runDir,
        case_id: item.case_id,
        attempt,
        relativePath: `${action.action_id}/manual-cleanup.json`,
        content: `${JSON.stringify(outcome, null, 2)}\n`,
      });
      evidence.push(evidenceReference(entry));
      caseRunStatus = "manual_required";
      runStatus = "manual_required";
      if (caseStatus === PASSED) caseStatus = NOT_EXECUTED;
    }

    const caseResult: CaseResult = {
      case_id: item.case_id,
      case_status: caseStatus,
      run_status: caseRunStatus,
      assertions,
      evidence,
      ...contractProjection(item, fieldStatus),
    };
    cases.push(caseResult);
    await input.observer?.caseCompleted?.({ ...caseEvent, result: caseResult });
    } finally {
      await input.afterCase?.(item);
    }
  }

  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id,
    manifest_hash,
    ...(input.manifest.contract_version ? { contract_version: input.manifest.contract_version } : {}),
    ...(input.manifest.package_sha256 ? { package_sha256: input.manifest.package_sha256 } : {}),
    run_status: runStatus,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    cases,
  };
  if (defects.size > 0) {
    result.defects = [...defects.entries()].map(([root_cause_key, summary], index) => ({
      defect_id: `DEFECT-${String(index + 1).padStart(3, "0")}`,
      root_cause_key,
      case_ids: summary.case_ids,
      evidence: summary.evidence,
    }));
  }
  await writeFile(path.join(runDir, "run-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  await input.observer?.runCompleted?.({ run_id, manifest_hash, case_total, result });
  return result;
}
