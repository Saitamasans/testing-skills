import {
  InstallationError,
  defaultRunProcess,
  forwardInstalledRunnerCommand,
  resolveCanonicalReceipt,
  sanitizedRuntimeEnv,
  verifyInstalledRuntime,
} from "./installed-runtime-lib.mjs";

export {
  InstallationError,
  defaultRunProcess,
  forwardInstalledRunnerCommand,
  resolveCanonicalReceipt,
  sanitizedRuntimeEnv,
  verifyInstalledRuntime,
};

export class BootstrapError extends InstallationError {
  constructor() {
    super("installation_incomplete", "runtime bootstrap was removed; no downloads are permitted during execution");
    this.name = "BootstrapError";
  }
}

// Kept solely for callers of the former bootstrap API. Execution must be repaired by the installer.
export async function ensureRunnerRuntime() {
  throw new BootstrapError();
}

export async function prepareBrowserForCommand() {
  throw new BootstrapError();
}

export async function forwardRunnerCommand(options) {
  const runtime = await verifyInstalledRuntime({ env: options.env });
  return await forwardInstalledRunnerCommand({ ...options, runtime });
}
