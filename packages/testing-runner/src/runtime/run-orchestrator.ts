import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AssertionResult, EvidenceReference, JsonValue, RunManifest, RunResult } from "../types.js";
import { sha256Canonical } from "../compiler/canonical-json.js";
import type { ActionOutcome } from "./execution-context.js";
import { EventWriter } from "./event-writer.js";
import { storeEvidence } from "./evidence-store.js";
import { retryDecision } from "./retry-policy.js";

export interface RunInput {
  manifest: RunManifest;
  outputDir: string;
  run_id?: string;
  executeAction(action: RunManifest["cases"][number]["steps"][number], attempt: number): Promise<ActionOutcome>;
}

const PASSED = "通过" as const;
const FAILED = "不通过" as const;
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

export async function runApprovedManifest(input: RunInput): Promise<RunResult> {
  const run_id = input.run_id ?? runId(input.manifest);
  const runDir = path.join(input.outputDir, run_id);
  await mkdir(runDir, { recursive: true });
  const writer = new EventWriter(path.join(runDir, "run-events.jsonl"));
  const cases: RunResult["cases"] = [];
  let runStatus: RunResult["run_status"] = "completed";

  for (const item of input.manifest.cases) {
    const assertions: AssertionResult[] = [];
    const evidence: EvidenceReference[] = [];
    let caseStatus: RunResult["cases"][number]["case_status"] = PASSED;
    let caseRunStatus: RunResult["cases"][number]["run_status"] = "completed";
    let attempt = 1;
    let completed = false;

    while (!completed && attempt <= 2) {
      let retryCase = false;
      for (const action of item.steps) {
        await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.started" });
        const outcome = await input.executeAction(action, attempt);
        if (outcome.status === "passed") {
          await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.passed", data: outcome.actual });
          continue;
        }

        await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "action.failed", data: outcome.error });
        const entry = await storeEvidence({
          runDir,
          case_id: item.case_id,
          attempt,
          relativePath: "failure.json",
          content: JSON.stringify(outcome, null, 2),
        });
        evidence.push(evidenceReference(entry));

        const decision = retryDecision({ kind: outcome.error?.type ?? outcome.status }, attempt);
        if (decision.retry) {
          await writer.appendEvent({ run_id, case_id: item.case_id, action_id: action.action_id, attempt, type: "retry.scheduled", data: { next_attempt: attempt + 1 } });
          retryCase = true;
          break;
        }

        if (outcome.status === "failed") {
          caseStatus = FAILED;
          assertions.push({ assertion_id: action.action_id, passed: false, actual: jsonValue(outcome.actual) });
        } else {
          caseStatus = NOT_EXECUTED;
          caseRunStatus = outcome.status === "manual_required" ? "manual_required" : "executor_error";
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

    if (caseStatus === PASSED) assertions.push({ assertion_id: `${item.case_id}-actions`, passed: true });
    cases.push({
      case_id: item.case_id,
      case_status: caseStatus,
      run_status: caseRunStatus,
      assertions,
      evidence,
    });
  }

  const result: RunResult = {
    protocol_version: "1.0.0",
    run_id,
    manifest_hash: sha256Canonical(input.manifest),
    run_status: runStatus,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    cases,
  };
  await writeFile(path.join(runDir, "run-result.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}
