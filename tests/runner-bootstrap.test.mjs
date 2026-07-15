import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";

import {
  ensureRunnerRuntime,
  prepareBrowserForCommand,
  renderBootstrapNotice,
  resolveRuntimePaths,
  validateReleaseManifest,
} from "../skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs";

function tarHeader(name, size, type = "0") {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 100, "utf8");
  header.write("0000777\0", 100, 8, "ascii");
  header.write("0000000\0", 108, 8, "ascii");
  header.write("0000000\0", 116, 8, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "ascii");
  header.write("00000000000\0", 136, 12, "ascii");
  header.fill(" ", 148, 156, "ascii");
  header.write(type, 156, 1, "ascii");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  let checksum = 0;
  for (const byte of header) checksum += byte;
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "ascii");
  return header;
}

function tarEntry(name, content) {
  const body = Buffer.isBuffer(content) ? content : Buffer.from(content, "utf8");
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512, 0);
  return Buffer.concat([tarHeader(name, body.length), body, padding]);
}

function runnerArchiveFixture() {
  const archive = gzipSync(Buffer.concat([
    tarHeader("package/", 0, "5"),
    tarHeader("package/dist/", 0, "5"),
    tarEntry("package/dist/cli.js", "#!/usr/bin/env node\nconsole.log('runner');\n"),
    Buffer.alloc(1024, 0),
  ]));
  return {
    archive,
    sha256: createHash("sha256").update(archive).digest("hex"),
  };
}

const RUNNER_ARCHIVE = runnerArchiveFixture();
const ASSET = RUNNER_ARCHIVE.archive;

function manifest(overrides = {}) {
  return {
    schema_version: 1,
    runner: {
      name: "@saitamasans/testing-runner",
      version: "1.0.1",
      download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.0.1/saitamasans-testing-runner-1.0.1.tgz",
      sha256: RUNNER_ARCHIVE.sha256,
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
  const npmCli = path.join(home, "npm-cli.js");
  await writeFile(npmCli, "", "utf8");
  const logs = [];
  let downloads = 0;
  let installs = 0;
  let fetchSignal;
  const fetchImpl = async (_url, init) => {
    downloads += 1;
    fetchSignal = init?.signal;
    return new Response(ASSET, { status: 200 });
  };
  const runProcess = async () => {
    installs += 1;
    throw new Error("bootstrap must not call npm/pnpm/npx");
  };
  return {
    options: {
      manifest: manifest(),
      env: {
        TESTING_SKILLS_HOME: home,
        TESTING_SKILLS_NPM_CLI: npmCli,
        TEST_API_KEY: "must-not-propagate",
        TEST_DATABASE_URL: "must-not-propagate",
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
      fetchSignal: () => fetchSignal,
      npmCli: () => npmCli,
    },
  };
}

test("validates only the fixed project GitHub Release", () => {
  assert.equal(validateReleaseManifest(manifest()).runner.version, "1.0.1");
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
    path.join(home, "runtime", "testing-runner", "1.0.1"),
  );
  const notice = renderBootstrapNotice(value, paths);
  assert.match(notice, /首次运行/);
  assert.match(notice, /GitHub Release/);
  assert.match(notice, /Runner 1\.0\.1/);
  assert.match(notice, /Chromium/);
  assert.ok(notice.includes(home));
});

test("first bootstrap announces, downloads, verifies, and extracts once", async () => {
  const state = await fixture();
  const result = await ensureRunnerRuntime(state.options);
  assert.equal(result.cacheHit, false);
  assert.equal(state.counters.downloads(), 1);
  assert.equal(state.counters.installs(), 0);
  assert.match(state.logs.join("\n"), /Runner 1\.0\.1/);
  assert.match(state.logs.join("\n"), /Runner 下载进度：0%/);
  assert.match(state.logs.join("\n"), /Runner 下载进度：100%/);
  assert.ok(state.counters.fetchSignal());
  assert.match(await readFile(result.cliPath, "utf8"), /console\.log\('runner'\)/);
});

test("bootstrap extracts the locked archive without any npm command", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "runner-bootstrap-no-npm-"));
  const { archive, sha256 } = runnerArchiveFixture();
  const result = await ensureRunnerRuntime({
    manifest: manifest({ sha256, size_bytes: archive.length }),
    env: { TESTING_SKILLS_HOME: home },
    fetchImpl: async () => new Response(archive, { status: 200 }),
    runProcess: async () => {
      throw new Error("npm/pnpm/npx must not be called by bootstrap extraction");
    },
    log: () => {},
    lockRetryMs: 5,
    preferCurl: false,
  });

  assert.equal(result.cacheHit, false);
  assert.match(await readFile(result.cliPath, "utf8"), /console\.log\('runner'\)/);
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

test("oversized Runner response is cancelled before reading more data", async () => {
  const state = await fixture();
  let reads = 0;
  let cancelled = false;
  state.options.fetchImpl = async () => ({
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          reads += 1;
          if (reads === 1) return { done: false, value: Buffer.alloc(ASSET.length + 1) };
          throw new Error("read continued past declared size");
        },
        cancel: async () => { cancelled = true; },
        releaseLock: () => {},
      }),
    },
  });
  await assert.rejects(
    ensureRunnerRuntime(state.options),
    /bootstrap_integrity_failed: downloaded Runner exceeds release manifest size/,
  );
  assert.equal(reads, 1);
  assert.equal(cancelled, true);
  assert.equal(state.counters.installs(), 0);
});

test("production bootstrap prefers curl with visible progress before fetch fallback", async () => {
  const state = await fixture();
  let curlCommand;
  let curlArgs = [];
  state.options.preferCurl = true;
  state.options.curlCommand = "curl-fixture";
  state.options.fetchImpl = async () => {
    throw new Error("fetch fallback must not run when curl succeeds");
  };
  state.options.downloadProcess = async (command, args) => {
    curlCommand = command;
    curlArgs = args;
    const output = args[args.indexOf("--output") + 1];
    await writeFile(output, ASSET);
    return 0;
  };

  const result = await ensureRunnerRuntime(state.options);

  assert.equal(result.cacheHit, false);
  assert.equal(curlCommand, "curl-fixture");
  assert.ok(curlArgs.includes("--progress-bar"));
  assert.ok(curlArgs.includes(manifest().runner.download_url));
  assert.match(state.logs.join("\n"), /curl/);
  assert.equal(state.counters.installs(), 0);
});

test("second bootstrap reuses the verified cache", async () => {
  const state = await fixture();
  await ensureRunnerRuntime(state.options);
  const second = await ensureRunnerRuntime(state.options);
  assert.equal(second.cacheHit, true);
  assert.equal(state.counters.downloads(), 1);
  assert.equal(state.counters.installs(), 0);
});

test("concurrent bootstrap performs one download and one extraction", async () => {
  const state = await fixture();
  const [first, second] = await Promise.all([
    ensureRunnerRuntime(state.options),
    ensureRunnerRuntime(state.options),
  ]);
  assert.equal(state.counters.downloads(), 1);
  assert.equal(state.counters.installs(), 0);
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
