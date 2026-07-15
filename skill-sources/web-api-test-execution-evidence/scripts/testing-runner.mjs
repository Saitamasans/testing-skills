#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BootstrapError,
  ensureRunnerRuntime,
  forwardRunnerCommand,
  prepareBrowserForCommand,
} from "./runner-bootstrap-lib.mjs";

async function main() {
  const skillRoot = fileURLToPath(new URL("..", import.meta.url));
  const manifestPath = process.env.TESTING_RUNNER_RELEASE_MANIFEST
    || path.join(skillRoot, "assets", "runner-release.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const runtime = await ensureRunnerRuntime({
    manifest,
    env: process.env,
    log: (line) => console.error(line),
  });
  await prepareBrowserForCommand({
    cliPath: runtime.cliPath,
    args: process.argv.slice(2),
    env: process.env,
    log: (line) => console.error(line),
  });
  process.exitCode = await forwardRunnerCommand({
    cliPath: runtime.cliPath,
    args: process.argv.slice(2),
    env: process.env,
  });
}

main().catch((error) => {
  if (error instanceof BootstrapError) {
    console.error(error.message);
    process.exitCode = 20;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 30;
});
