import { readFile } from "node:fs/promises";

import { verifyReportConsistency } from "../reporting/consistency-gate.js";
import { validateDocument } from "../schema-registry.js";
import { EXIT_SUCCESS, EXIT_UNSAFE_OR_INVALID } from "../runtime/exit-codes.js";
import type { NativeReportDocument } from "../input/detect-input.js";
import type { RunResult } from "../types.js";

export interface VerifyReportCommandOptions {
  report: string;
  runResult: string;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await readFile(file, "utf8")) as T;
}

export async function runVerifyReportCommand(options: VerifyReportCommandOptions): Promise<number> {
  const report = validateDocument<NativeReportDocument>("report", await readJson<unknown>(options.report));
  const result = validateDocument<RunResult>("run-result", await readJson<unknown>(options.runResult));
  const consistency = verifyReportConsistency({ report, result });
  if (!consistency.valid) {
    throw new Error(`report consistency failed: ${consistency.errors.join("; ")}`);
  }
  return EXIT_SUCCESS;
}

export function reportVerificationErrorExitCode(): number {
  return EXIT_UNSAFE_OR_INVALID;
}
