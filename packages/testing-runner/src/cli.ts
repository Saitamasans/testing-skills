#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { Command } from "commander";

import { runApproveCommand } from "./commands/approve.js";
import { runDiscoverWebCommand } from "./commands/discover-web.js";
import { runPlanCommand } from "./commands/plan.js";
import {
  runRunCommand,
  runCommandErrorExitCode,
  type RunCommandOptions,
} from "./commands/run.js";
import { reportVerificationErrorExitCode, runVerifyReportCommand } from "./commands/verify-report.js";
import type { BrowserVisibility } from "./runtime/browser-session.js";
import type { ProgressVisibility } from "./runtime/visual-progress.js";

interface RunCliOptions {
  manifest: string;
  approval: string;
  outputDir: string;
  mode: string;
  browser: string;
  slowMo: string;
  progress?: string;
}

function browserConfigurationError(message: string): Error {
  return new Error(`browser_configuration_invalid: ${message}`);
}

function runConfigurationError(message: string): Error {
  return new Error(`run_configuration_invalid: ${message}`);
}

function progressConfigurationError(message: string): Error {
  return new Error(`progress_configuration_invalid: ${message}`);
}

export function normalizeRunCliOptions(options: RunCliOptions): RunCommandOptions {
  if (!["interactive", "ci"].includes(options.mode)) {
    throw runConfigurationError("mode must be interactive or ci");
  }
  if (!["auto", "visible", "headless"].includes(options.browser)) {
    throw browserConfigurationError("browser must be auto, visible, or headless");
  }
  const progress = options.progress ?? "auto";
  if (!["auto", "off"].includes(progress)) {
    throw progressConfigurationError("progress must be auto or off");
  }
  const slowMo = Number(options.slowMo);
  if (!Number.isSafeInteger(slowMo) || slowMo < 0 || slowMo > 5000) {
    throw browserConfigurationError("slow-mo must be an integer from 0 to 5000");
  }
  return {
    manifest: options.manifest,
    approval: options.approval,
    outputDir: options.outputDir,
    mode: options.mode as "interactive" | "ci",
    browser: options.browser as BrowserVisibility,
    slowMo,
    progress: progress as ProgressVisibility,
  };
}

export async function runCli(argv = process.argv): Promise<void> {
  const program = new Command();
  program
    .name("testing-runner")
    .description("Plan and approve locked Web/API test execution manifests")
    .version("1.1.0");

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

  program.command("discover-web")
    .requiredOption("--url <url>")
    .requiredOption("--output-dir <dir>")
    .option("--browser <visibility>", "visible or headless", "headless")
    .action(async (options: { url: string; outputDir: string; browser: string }) => {
      if (options.browser !== "visible" && options.browser !== "headless") {
        throw browserConfigurationError("discover-web browser must be visible or headless");
      }
      await runDiscoverWebCommand({
        url: options.url,
        outputDir: options.outputDir,
        browser: options.browser,
      });
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
    .option("--browser <visibility>", "auto, visible, or headless", "auto")
    .option("--slow-mo <milliseconds>", "visible browser delay from 0 to 5000", "200")
    .option("--progress <mode>", "auto or off", "auto")
    .action(async (options: RunCliOptions) => {
      try {
        process.exitCode = await runRunCommand(normalizeRunCliOptions(options));
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
