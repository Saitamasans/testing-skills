import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureRunnerRuntime,
  prepareBrowserForCommand,
  renderBootstrapNotice,
  resolveRuntimePaths,
  validateReleaseManifest,
} from "../skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs";

const ASSET = Buffer.from("runner archive fixture");

function manifest(overrides = {}) {
  return {
    schema_version: 1,
    runner: {
      name: "@saitamasans/testing-runner",
      version: "1.0.0",
      download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.0.0/saitamasans-testing-runner-1.0.0.tgz",
      sha256: "7f9dd89333da866ba6dba0a0bcff749c5e70d0558753811259f179ea9db74071",
      size_bytes: ASSET.length,
      minimum_node: 20,
      ...overrides,
    },
    browser: {
      provider: "playwright",
      name: "chromium",
      estimated_size_bytes: 180_000_000,
    },
  };
}

async function fixture(overrides = {}) {
  const home = await mkdtemp(path.join(os.tmpdir(), "runner-bootstrap-"));
  const logs = [];
  let downloads = 0;
  let installs = 0;
  let installEnv = {};
  const fetchImpl = async () => {
    downloads += 1;
    return new Response(ASSET, { status: 200 });
  };
  const runProcess = async (_command, args, options) => {
    installs += 1;
    installEnv = options.env;
    const prefix = args[args.indexOf("--prefix") + 1];
    const cli = path.join(
      prefix,
      "node_modules",
      "@saitamasans",
      "testing-runner",
      "dist",
      "cli.js",
    );
    await mkdir(path.dirname(cli), { recursive: true });
    await writeFile(cli, "#!/usr/bin/env node\n", "utf8");
    return 0;
  };
  return {
    options: {
      manifest: manifest(),
      env: {
        TESTING_SKILLS_HOME: home,
        NPM_TOKEN: "must-not-propagate",
        NODE_AUTH_TOKEN: "must-not-propagate",
      },
      fetchImpl,
      runProcess,
      log: (line) => logs.push(String(line)),
      lockRetryMs: 5,
      ...overrides,
    },
    home,
    logs,
    counters: {
      downloads: () => downloads,
      installs: () => installs,
      installEnv: () => installEnv,
    },
  };
}

test("validates only the fixed project GitHub Release", () => {
  assert.equal(validateReleaseManifest(manifest()).runner.version, "1.0.0");
  assert.throws(
    () => validateReleaseManifest(manifest({ download_url: "https://example.com/runner.tgz" })),
    /bootstrap_manifest_invalid/,
  );
  assert.throws(
    () => validateReleaseManifest(manifest({ sha256: "abc" })),
    /bootstrap_manifest_invalid/,
  );
});

test("resolves a versioned user cache and renders the required notice", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "runner-paths-"));
  const value = manifest();
  const paths = resolveRuntimePaths(value, { TESTING_SKILLS_HOME: home });
  assert.equal(
    paths.runtimeDir,
    path.join(home, "runtime", "testing-runner", "1.0.0"),
  );
  const notice = renderBootstrapNotice(value, paths);
  assert.match(notice, /首次运行/);
  assert.match(notice, /GitHub Release/);
  assert.match(notice, /Runner 1\.0\.0/);
  assert.match(notice, /Chromium/);
  assert.ok(notice.includes(home));
});

test("first bootstrap announces, downloads, verifies, and installs once", async () => {
  const state = await fixture();
  const result = await ensureRunnerRuntime(state.options);
  assert.equal(result.cacheHit, false);
  assert.equal(state.counters.downloads(), 1);
  assert.equal(state.counters.installs(), 1);
  assert.match(state.logs.join("\n"), /Runner 1\.0\.0/);
  assert.ok(await readFile(result.cliPath));
  assert.equal(state.counters.installEnv().NPM_TOKEN, undefined);
  assert.equal(state.counters.installEnv().NODE_AUTH_TOKEN, undefined);
});

test("hash mismatch removes the archive and blocks installation", async () => {
  const state = await fixture({
    manifest: manifest({ sha256: "0".repeat(64) }),
  });
  await assert.rejects(
    ensureRunnerRuntime(state.options),
    /bootstrap_integrity_failed/,
  );
  assert.equal(state.counters.installs(), 0);
});

test("second bootstrap reuses the verified cache", async () => {
  const state = await fixture();
  await ensureRunnerRuntime(state.options);
  const second = await ensureRunnerRuntime(state.options);
  assert.equal(second.cacheHit, true);
  assert.equal(state.counters.downloads(), 1);
  assert.equal(state.counters.installs(), 1);
});

test("concurrent bootstrap performs one download and one install", async () => {
  const state = await fixture();
  const [first, second] = await Promise.all([
    ensureRunnerRuntime(state.options),
    ensureRunnerRuntime(state.options),
  ]);
  assert.equal(state.counters.downloads(), 1);
  assert.equal(state.counters.installs(), 1);
  assert.equal(first.runtimeDir, second.runtimeDir);
  assert.equal([first.cacheHit, second.cacheHit].filter(Boolean).length, 1);
});

async function browserFixture(actionType) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-browser-bootstrap-"));
  const manifestPath = path.join(directory, "run-manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    cases: [{ steps: [{ type: actionType }] }],
  }), "utf8");

  const packageRoot = path.join(
    directory,
    "runtime",
    "node_modules",
    "@saitamasans",
    "testing-runner",
  );
  const cliPath = path.join(packageRoot, "dist", "cli.js");
  const playwrightCli = path.join(packageRoot, "node_modules", "playwright", "cli.js");
  const executablePath = path.join(directory, "browsers", "chromium", "chrome.exe");
  await mkdir(path.dirname(cliPath), { recursive: true });
  await mkdir(path.dirname(playwrightCli), { recursive: true });
  await writeFile(cliPath, "", "utf8");
  await writeFile(playwrightCli, "", "utf8");

  let installs = 0;
  const logs = [];
  const options = {
    cliPath,
    args: ["run", "--manifest", manifestPath],
    env: {
      TEST_API_TOKEN: "must-not-propagate",
      TEST_API_KEY: "must-not-propagate",
      TEST_DATABASE_URL: "must-not-propagate",
      NODE_AUTH_TOKEN: "must-not-propagate",
    },
    browserExecutablePath: async () => executablePath,
    runProcess: async (command, args, processOptions) => {
      installs += 1;
      assert.equal(command, process.execPath);
      assert.deepEqual(args, [playwrightCli, "install", "chromium"]);
      assert.equal(processOptions.env.TEST_API_TOKEN, undefined);
      assert.equal(processOptions.env.TEST_API_KEY, undefined);
      assert.equal(processOptions.env.TEST_DATABASE_URL, undefined);
      assert.equal(processOptions.env.NODE_AUTH_TOKEN, undefined);
      await mkdir(path.dirname(executablePath), { recursive: true });
      await writeFile(executablePath, "browser", "utf8");
      return 0;
    },
    log: (line) => logs.push(String(line)),
  };
  return { options, logs, installs: () => installs };
}

test("API-only run does not prepare Chromium", async () => {
  const state = await browserFixture("api.request");
  const result = await prepareBrowserForCommand(state.options);
  assert.deepEqual(result, { required: false, cacheHit: true });
  assert.equal(state.installs(), 0);
});

test("Web run installs Chromium once and reuses the verified executable", async () => {
  const state = await browserFixture("web.goto");
  const first = await prepareBrowserForCommand(state.options);
  const second = await prepareBrowserForCommand(state.options);
  assert.equal(first.required, true);
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(state.installs(), 1);
  assert.match(state.logs.join("\n"), /Chromium/);
  assert.match(state.logs.join("\n"), /自动下载/);
});
