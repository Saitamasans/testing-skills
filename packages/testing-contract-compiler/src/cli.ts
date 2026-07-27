#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { Command } from "commander";
import { compilePackage, diffPackage, inspectWorkbook, validatePackage } from "./index.js";
import type { CaseOverride } from "./types.js";

const program = new Command().name("testing-contract-compiler").version("1.0.0");

program.command("inspect").requiredOption("--input <path>").action(async ({ input }) => {
  process.stdout.write(JSON.stringify(await inspectWorkbook(input), null, 2) + "\n");
});

program.command("compile").requiredOption("--input <path>").requiredOption("--output <path>")
  .option("--mapping <path>").option("--mapping-confirmed").option("--overrides <path>")
  .option("--requirement <path>", "optional requirement document; repeatable", (value, previous: string[]) => [...previous, value], [])
  .option("--project-config <path>", "optional JSON project execution configuration")
  .action(async ({ input, output, mapping, mappingConfirmed, overrides, requirement, projectConfig }) => {
    const project = projectConfig ? JSON.parse(await readFile(projectConfig, "utf8")) as { field_mapping?: Record<string, string>; mapping_confirmed?: boolean; overrides?: Record<string, CaseOverride> } : undefined;
    const fieldMapping = mapping ? JSON.parse(await readFile(mapping, "utf8")) as Record<string, string> : project?.field_mapping;
    const contractOverrides = overrides ? JSON.parse(await readFile(overrides, "utf8")) as Record<string, CaseOverride> : project?.overrides;
    const result = await compilePackage({ input, output, requirementFiles: requirement, ...(projectConfig ? { projectConfigFile: projectConfig } : {}), ...(fieldMapping ? { fieldMapping } : {}), ...((mappingConfirmed || project?.mapping_confirmed) ? { mappingConfirmed: true } : {}), ...(contractOverrides ? { overrides: contractOverrides } : {}) });
    process.stdout.write(result.output + "\n");
  });

program.command("validate").requiredOption("--package <path>").action(async (options) => {
  const result = await validatePackage(options.package);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.valid) process.exitCode = 50;
});

program.command("diff").requiredOption("--input <path>").requiredOption("--package <path>").action(async (options) => {
  const result = await diffPackage(options.input, options.package);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (result.stale || !result.valid) process.exitCode = 50;
});

program.parseAsync().catch((error: unknown) => {
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = 50;
});
