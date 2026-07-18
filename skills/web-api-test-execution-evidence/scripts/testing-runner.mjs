#!/usr/bin/env node
import {
  InstallationError,
  forwardInstalledRunnerCommand,
  verifyInstalledRuntime,
} from "./installed-runtime-lib.mjs";

function resolveRunnerArgs() {
  const encoded = process.env.TESTING_RUNNER_ARGS_B64;
  if (encoded === undefined) return process.argv.slice(2);
  if (process.argv.length !== 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
    throw new InstallationError("installation_corrupt", "TESTING_RUNNER_ARGS_B64 is invalid");
  }
  let decoded;
  try { decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")); } catch {
    throw new InstallationError("installation_corrupt", "TESTING_RUNNER_ARGS_B64 is not valid JSON");
  }
  if (!Array.isArray(decoded) || decoded.some((value) => typeof value !== "string")) {
    throw new InstallationError("installation_corrupt", "TESTING_RUNNER_ARGS_B64 must encode a string argument array");
  }
  delete process.env.TESTING_RUNNER_ARGS_B64;
  return decoded;
}

async function main() {
  const runtime = await verifyInstalledRuntime({ env: process.env });
  process.exitCode = await forwardInstalledRunnerCommand({
    runtime,
    args: resolveRunnerArgs(),
    env: process.env,
  });
}

main().catch((error) => {
  if (error instanceof InstallationError) {
    console.error(error.message);
    process.exitCode = 20;
    return;
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 30;
});
