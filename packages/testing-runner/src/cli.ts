#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { runApproveCommand } from "./commands/approve.js";
import { runPlanCommand } from "./commands/plan.js";
import { runRunCommand, runCommandErrorExitCode } from "./commands/run.js";
import { reportVerificationErrorExitCode, runVerifyReportCommand } from "./commands/verify-report.js";

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("testing-runner")
    .description("Plan and approve locked Web/API test execution manifests")
    .version("1.0.0");

  program.command("plan")
    .requiredOption("--input <file>")
    .requiredOption("--profile <file>")
    .requiredOption("--output-dir <dir>")
    .option("--mapping-approval <file>")
    .action(async (options: {
      input: string;
      profile: string;
      outputDir: string;
      mappingApproval?: string;
    }) => {
      await runPlanCommand(options);
    });

  program.command("approve")
    .requiredOption("--manifest <file>")
    .requiredOption("--out <file>")
    .requiredOption("--expires-at <iso>")
    .option("--approve-r3 <action-id>", "approve one explicit R3 action", collect, [] as string[])
    .option("--confirmed-by <name>", "trusted wrapper or interactive prompt identity")
    .action(async (options: {
      manifest: string;
      out: string;
      expiresAt: string;
      approveR3: string[];
      confirmedBy?: string;
    }) => {
      await runApproveCommand(options);
    });

  program.command("run")
    .requiredOption("--manifest <file>")
    .requiredOption("--approval <file>")
    .requiredOption("--output-dir <dir>")
    .option("--mode <mode>", "interactive or ci", "interactive")
    .action(async (options: {
      manifest: string;
      approval: string;
      outputDir: string;
      mode: "interactive" | "ci";
    }) => {
      try {
        process.exitCode = await runRunCommand(options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = runCommandErrorExitCode(error);
      }
    });

  program.command("verify-report")
    .requiredOption("--report <file>")
    .requiredOption("--run-result <file>")
    .action(async (options: {
      report: string;
      runResult: string;
    }) => {
      try {
        process.exitCode = await runVerifyReportCommand(options);
      } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = reportVerificationErrorExitCode();
      }
    });

  await program.parseAsync(argv);
}

function collect(value: string, previous: string[]): string[] {
  return [...previous, value];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
