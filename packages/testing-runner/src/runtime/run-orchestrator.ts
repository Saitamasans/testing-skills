import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

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
    const caseEvent = {
      run_id,
      manifest_hash,
      case_total,
      case_index: caseOffset + 1,
      item,
      action_total: item.steps.length,
    };
    await input.observer?.caseStarted?.(caseEvent);
    const assertions: AssertionResult[] = [];
    const evidence: EvidenceReference[] = [];
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
    };
    cases.push(caseResult);
    await input.observer?.caseCompleted?.({ ...caseEvent, result: caseResult });
  }

  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id,
    manifest_hash,
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
