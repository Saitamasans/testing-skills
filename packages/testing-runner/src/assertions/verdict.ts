import type { AssertionOutcome } from "./assertion-engine.js";
import type { CaseStatus, RunStatus } from "../types.js";

export interface RuntimeCondition {
  run_status: RunStatus;
  error_type?: string;
}

export interface VerdictInput {
  case_id: string;
  assertions: readonly AssertionOutcome[];
  runtime?: RuntimeCondition;
}

export interface CaseVerdict {
  case_id: string;
  case_status: CaseStatus;
  run_status: RunStatus;
  automatic: boolean;
  needs_human_review: boolean;
  reasons: string[];
}

const NOT_EXECUTED = "未执行" as CaseStatus;
const PASSED = "通过" as CaseStatus;
const FAILED = "不通过" as CaseStatus;
const PENDING = "待定" as CaseStatus;

export function deriveCaseVerdict(input: VerdictInput): CaseVerdict {
  if (input.runtime && input.runtime.run_status !== "completed") {
    return {
      case_id: input.case_id,
      case_status: NOT_EXECUTED,
      run_status: input.runtime.run_status,
      automatic: true,
      needs_human_review: true,
      reasons: [`Runtime condition prevented a business verdict: ${input.runtime.error_type ?? input.runtime.run_status}`],
    };
  }

  const pending = input.assertions.find((assertion) =>
    !assertion.passed && assertion.verdict_policy === "pending_only",
  );
  if (pending) {
    return {
      case_id: input.case_id,
      case_status: PENDING,
      run_status: "completed",
      automatic: false,
      needs_human_review: true,
      reasons: [pending.reason],
    };
  }

  const failed = input.assertions.find((assertion) =>
    assertion.mandatory && !assertion.passed && assertion.verdict_policy === "auto",
  );
  if (failed) {
    return {
      case_id: input.case_id,
      case_status: FAILED,
      run_status: "completed",
      automatic: true,
      needs_human_review: failed.needs_human_review,
      reasons: [failed.reason],
    };
  }

  const mandatory = input.assertions.filter((assertion) => assertion.mandatory);
  if (mandatory.length > 0 && mandatory.every((assertion) => assertion.passed)) {
    return {
      case_id: input.case_id,
      case_status: PASSED,
      run_status: "completed",
      automatic: true,
      needs_human_review: input.assertions.some((assertion) => assertion.needs_human_review),
      reasons: ["All mandatory assertions passed."],
    };
  }

  return {
    case_id: input.case_id,
    case_status: NOT_EXECUTED,
    run_status: "blocked",
    automatic: true,
    needs_human_review: true,
    reasons: ["No mandatory assertion produced a business verdict."],
  };
}
