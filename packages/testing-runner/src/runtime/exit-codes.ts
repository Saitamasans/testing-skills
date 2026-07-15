import type { RunResult } from "../types.js";

export const EXIT_SUCCESS = 0;
export const EXIT_BUSINESS_FAILURE = 10;
export const EXIT_BLOCKED_OR_MANUAL = 20;
export const EXIT_EXECUTOR_ERROR = 30;
export const EXIT_INFRASTRUCTURE_ERROR = 40;
export const EXIT_UNSAFE_OR_INVALID = 50;

const PASSED = "通过";

export function exitCodeForRunResult(result: RunResult): number {
  if (result.run_status === "infrastructure_error") return EXIT_INFRASTRUCTURE_ERROR;
  if (result.run_status === "executor_error") return EXIT_EXECUTOR_ERROR;
  if (result.run_status === "blocked" || result.run_status === "manual_required") return EXIT_BLOCKED_OR_MANUAL;
  if (result.cases.some((item) => item.case_status !== PASSED)) return EXIT_BUSINESS_FAILURE;
  return EXIT_SUCCESS;
}
