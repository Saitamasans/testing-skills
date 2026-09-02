#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { collectTarget } from "../src/collector.mjs";

const packageJson = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function usage() {
  console.error("Usage: js-test-mapper scan --url <url> --output-dir <dir> [--previous-run <file>] [--environment test|production] [--confirm-production] [--headed]");
}

const args = process.argv.slice(2);
if (args[0] === "finalize") {
  await import("./finalize.mjs");
  process.exit(0);
}
if (args[0] === "--version" || args[0] === "-v") {
  console.log(`${packageJson.name} ${packageJson.version}`);
  process.exit(0);
}
if (args[0] !== "scan") {
  usage();
  process.exit(2);
}

const url = valueAfter(args, "--url");
const outputDir = valueAfter(args, "--output-dir");
if (!url || !outputDir) {
  usage();
  process.exit(2);
}

try {
  const result = await collectTarget({
    url,
    outputDir: path.resolve(outputDir),
    previousRunPath: valueAfter(args, "--previous-run"),
    environment: valueAfter(args, "--environment") || "test",
    confirmProduction: args.includes("--confirm-production"),
    headed: args.includes("--headed"),
    interactive: args.includes("--interactive"),
  });
  console.log(JSON.stringify({ output_path: result.outputPath, cognition_input: path.join(path.resolve(outputDir), "evidence", "cognition-input.json"), run_id: result.runData.run.run_id, assets: result.runData.assets.length, facts: result.runData.technical_facts.length, technical_resource_gets: result.runData.technical_resource_gets, active_business_api_calls: result.runData.active_business_api_calls, status: "technical_only_draft" }));
} catch (error) {
  console.error(JSON.stringify({ error: String(error.message || error) }));
  process.exit(1);
}
