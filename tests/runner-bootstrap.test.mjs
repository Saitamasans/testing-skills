import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ensureRunnerRuntime,
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
