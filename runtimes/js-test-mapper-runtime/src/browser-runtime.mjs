import { access } from "node:fs/promises";

export function browserCandidates({ env = process.env, browserType } = {}) {
  const candidates = [];
  if (env.JS_TEST_MAPPER_BROWSER_EXECUTABLE) candidates.push({ kind: "executable", label: "explicit executable", launchOptions: { executablePath: env.JS_TEST_MAPPER_BROWSER_EXECUTABLE } });
  candidates.push({ kind: "channel", label: "system Chrome", launchOptions: { channel: "chrome" } });
  candidates.push({ kind: "channel", label: "system Edge", launchOptions: { channel: "msedge" } });
  const managedPath = browserType?.executablePath?.();
  if (managedPath) candidates.push({ kind: "managed", label: "Playwright managed Chromium", launchOptions: { executablePath: managedPath } });
  return candidates;
}

export async function launchBrowserRuntime({ browserType, headless = true, env = process.env, fileAccess = access } = {}) {
  if (!browserType?.launch) throw new Error("browser_runtime_invalid_browser_type");
  const failures = [];
  for (const candidate of browserCandidates({ env, browserType })) {
    if (candidate.launchOptions.executablePath) {
      try { await fileAccess(candidate.launchOptions.executablePath); } catch { failures.push(`${candidate.label}: executable unavailable`); continue; }
    }
    try { return { browser: await browserType.launch({ headless, ...candidate.launchOptions }), candidate: candidate.kind, label: candidate.label }; }
    catch (error) { failures.push(`${candidate.label}: ${String(error?.message || error).split("\n")[0]}`); }
  }
  throw new Error(`browser_runtime_unavailable: ${failures.join("; ")}`);
}
