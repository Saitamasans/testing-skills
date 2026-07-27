#!/usr/bin/env node
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const cli = process.env.TESTING_CONTRACT_COMPILER_CLI
  || path.join(homedir(), ".testing-skills", "runtimes", "current", "compiler", "dist", "cli.js");

if (!existsSync(cli)) {
  process.stderr.write("installation_incomplete: test-case-execution-compiler runtime is missing; run the complete installer with -Repair.\n");
  process.exit(50);
}

await import(new URL(`file:///${cli.replaceAll("\\", "/")}`));
