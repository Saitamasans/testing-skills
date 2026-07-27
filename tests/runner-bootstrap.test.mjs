import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  BootstrapError,
  ensureRunnerRuntime,
  prepareBrowserForCommand,
} from "../skill-sources/web-api-test-execution-evidence/scripts/runner-bootstrap-lib.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const sourceScripts = path.join(repoRoot, "skill-sources", "web-api-test-execution-evidence", "scripts");
const generatedScripts = path.join(repoRoot, "skills", "web-api-test-execution-evidence", "scripts");

test("former bootstrap entry points fail closed and require installer repair", async () => {
  for (const legacyCall of [ensureRunnerRuntime, prepareBrowserForCommand]) {
    await assert.rejects(legacyCall({}), (error) => {
      assert.ok(error instanceof BootstrapError);
      assert.equal(error.code, "installation_incomplete");
      assert.match(error.message, /-Repair/);
      return true;
    });
  }
});

test("launcher scripts contain no execution-time downloader or browser installer", async () => {
  for (const name of ["installed-runtime-lib.mjs", "runner-bootstrap-lib.mjs", "testing-runner.mjs", "testing-runner.ps1"]) {
    const source = await readFile(path.join(sourceScripts, name), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(/i);
    assert.doesNotMatch(source, /\bcurl\b/i);
    assert.doesNotMatch(source, /playwright[^\n]*\binstall\b/i);
    assert.doesNotMatch(source, /\b(?:npm|pnpm|npx)\b/i);
  }
});

test("CMD launcher uses Windows PowerShell to find receipt-bundled Node without host dependencies", async () => {
  const cmd = await readFile(path.join(sourceScripts, "testing-runner.cmd"), "utf8");
  const preflight = await readFile(path.join(sourceScripts, "testing-runner.ps1"), "utf8");
  assert.match(cmd, /System32\\WindowsPowerShell\\v1\.0\\powershell\.exe/i);
  assert.match(cmd, /Sysnative\\WindowsPowerShell\\v1\.0\\powershell\.exe/i);
  assert.match(cmd, /testing-runner\.ps1/i);
  assert.match(cmd, /-File/i);
  assert.doesNotMatch(cmd, /-Command/i);
  assert.match(preflight, /installations\\\$skillName\.json/i);
  assert.match(preflight, /runtime_path/i);
  assert.doesNotMatch(cmd, /codex|admin|HOST_NODE/i);
  assert.doesNotMatch(cmd, /%PATH%/i);
  assert.doesNotMatch(cmd, /%~1|%\*/i);
  assert.doesNotMatch(cmd, /%\*/);
  assert.doesNotMatch(cmd, /\bshift\b/i);
  assert.match(preflight, /TESTING_RUNNER_ARGS_B64/i);
  assert.match(preflight, /skill\/web-api-test-execution-evidence\/scripts\/testing-runner\.mjs/i);
  for (const name of ["installed-runtime-lib.mjs", "runner-bootstrap-lib.mjs", "testing-runner.mjs", "testing-runner.cmd", "testing-runner.ps1"]) {
    const generated = (await readFile(path.join(generatedScripts, name), "utf8")).replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
    const source = (await readFile(path.join(sourceScripts, name), "utf8")).replace(/\r\n/g, "\n").replace(/\n+$/, "\n");
    assert.equal(generated, source);
  }
});
