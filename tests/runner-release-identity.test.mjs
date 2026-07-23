import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RUNNER_ROOT = path.join(REPO_ROOT, "packages", "testing-runner");

async function json(relative) {
  return JSON.parse(await readFile(path.join(REPO_ROOT, relative), "utf8"));
}

const HISTORICAL_RUNNER_1_1_2 = {
  name: "@saitamasans/testing-runner",
  version: "1.1.2",
  download_url: "https://github.com/Saitamasans/testing-skills/releases/download/testing-runner-v1.1.2/saitamasans-testing-runner-1.1.2.tgz",
  sha256: "0db2c917eaf786fa9c03bacc9f33a058ef8a9b429bc111772c7833f82c664a07",
  size_bytes: 22_769_464,
};

test("changed Runner bytes use the new 1.1.3 package, CLI, receipt, and release identity", async () => {
  const runnerPackage = await json("packages/testing-runner/package.json");
  const rootLock = await json("package-lock.json");
  const releasePackage = await json("packages/testing-runner/release/package.json");
  const releaseDependencyLock = await json("packages/testing-runner/release/package-lock.json");
  const receiptSchema = await json("schemas/discovery-receipt.schema.json");
  const source = await readFile(path.join(RUNNER_ROOT, "src", "version.ts"), "utf8");
  const releaseScript = await readFile(path.join(RUNNER_ROOT, "scripts", "package-release.mjs"), "utf8");
  const workflow = await readFile(path.join(REPO_ROOT, ".github", "workflows", "publish-testing-runner.yml"), "utf8");
  const validationWorkflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "validate-runner-windows-release.yml"),
    "utf8",
  );
  const mainValidationWorkflow = await readFile(
    path.join(REPO_ROOT, ".github", "workflows", "validate-runner.yml"),
    "utf8",
  );

  assert.equal(runnerPackage.version, "1.1.3");
  assert.equal(rootLock.packages["packages/testing-runner"].version, "1.1.3");
  assert.equal(releasePackage.version, "1.1.3");
  assert.equal(releaseDependencyLock.version, "1.1.3");
  assert.equal(releaseDependencyLock.packages[""].version, "1.1.3");
  assert.equal(receiptSchema.properties.runtime_version.const, "1.0.3-dev");
  assert.equal(receiptSchema.properties.runner_version.const, "1.1.3");
  assert.match(source, /TESTING_RUNNER_VERSION = "1\.1\.3"/);
  assert.match(releaseScript, /runner-1\.1\.3-release-lock\.json/);
  assert.match(releaseScript, /const VERSION = RELEASE_PREPARATION\.runner\.version/);
  assert.match(releaseScript, /const RELEASE_TAG = RELEASE_PREPARATION\.runner\.release_tag/);
  assert.doesNotMatch(releaseScript, /skill-sources[\s\S]+runner-release\.json/);
  assert.match(workflow, /EXPECTED_VERSION: 1\.1\.3/);
  assert.match(workflow, /EXPECTED_TAG: testing-runner-v1\.1\.3/);
  assert.match(workflow, /RUNNER_ASSET: saitamasans-testing-runner-1\.1\.3\.tgz/);
  assert.match(workflow, /runner-1\.1\.3-release-lock\.json/);
  assert.match(workflow, /locked-not-published/);
  assert.match(workflow, /public release already exists/);
  assert.doesNotMatch(workflow, /--clobber/);
  assert.match(validationWorkflow, /saitamasans-testing-runner-1\.1\.3\.tgz/);
  assert.match(validationWorkflow, /runner-1\.1\.3-release-lock\.json/);
  assert.match(validationWorkflow, /locked-not-published/);
  assert.doesNotMatch(validationWorkflow, /release-a\/saitamasans-testing-runner-1\.1\.2\.tgz/);
  assert.doesNotMatch(validationWorkflow, /Runner build differs from windows-runtime-lock\.json/);
  assert.match(mainValidationWorkflow, /fetch-depth: 0/);

  const changed = execFileSync(
    "git",
    ["diff", "--name-only", "testing-runner-v1.1.2", "--", "packages/testing-runner/src"],
    { cwd: REPO_ROOT, encoding: "utf8" },
  ).trim().split(/\r?\n/);
  assert.ok(changed.includes("packages/testing-runner/src/commands/plan.ts"));
  assert.ok(changed.includes("packages/testing-runner/src/runtime/browser-session.ts"));
  assert.notEqual(runnerPackage.version, HISTORICAL_RUNNER_1_1_2.version);
});

test("Runtime 1.0.3 compatibility binds Runner 1.1.3, Compiler 1.0.0, and backward-compatible Contract 1.0.0", async () => {
  const matrix = await json("packages/testing-runner/release/compatibility-matrix.json");
  assert.deepEqual(matrix.targets["1.0.3"], {
    status: "preparation",
    node: "22.23.1",
    runner: "1.1.3",
    compiler: "1.0.0",
    contract: "1.0.0",
    playwright: "1.61.1",
  });
  assert.deepEqual(matrix.contract_decisions["1.0.0"], {
    compatibility: "backward-compatible",
    rationale: "Runner 1.1.3 adds package-first validation, discovery binding, action handling, context isolation, and result fields without removing or reinterpreting Contract 1.0.0 fields.",
  });

  const compilerPackage = await json("packages/testing-contract-compiler/package.json");
  const contractSchema = await json("packages/testing-contract-compiler/schemas/execution-contract.schema.json");
  assert.equal(compilerPackage.version, "1.0.0");
  assert.equal(contractSchema.properties.contract_version.const, "1.0.0");
});

test("Runner 1.1.3 lock is unpublished, byte-bound, and preserves immutable 1.1.2 metadata", async () => {
  const preparation = await json("packages/testing-runner/release/runner-1.1.3-release-lock.json");
  assert.deepEqual(preparation.runner, {
    name: "@saitamasans/testing-runner",
    version: "1.1.3",
    release_tag: "testing-runner-v1.1.3",
    file_name: "saitamasans-testing-runner-1.1.3.tgz",
  });
  assert.equal(preparation.status, "locked-not-published");
  assert.equal(preparation.publication.tag_created, false);
  assert.equal(preparation.publication.release_created, false);
  assert.equal(preparation.publication.assets_uploaded, false);
  assert.equal(preparation.artifact.size_bytes, 22_826_699);
  assert.equal(preparation.artifact.sha256, "22b7ed732f6e79c20c910ee1aafdb9b81871e28d65d5dafe5a09b83ad8847b78");
  assert.deepEqual(preparation.previous_release, HISTORICAL_RUNNER_1_1_2);
  assert.deepEqual(preparation.runtime_target, {
    version: "1.0.3",
    compiler: "1.0.0",
    contract: "1.0.0",
  });
  assert.deepEqual(preparation.rules, {
    reject_previous_version_label: "1.1.2",
    require_reproducible_artifact_before_locking: true,
    forbid_overwrite_of_previous_release: true,
  });

  const historicalRuntime = await json("packages/testing-runner/release/windows-runtime-lock.json");
  const sourceAsset = await json("skill-sources/web-api-test-execution-evidence/assets/runner-release.json");
  const generatedAsset = await json("skills/web-api-test-execution-evidence/assets/runner-release.json");
  assert.equal(historicalRuntime.bundle_version, "1.0.2");
  assert.deepEqual(historicalRuntime.runner, HISTORICAL_RUNNER_1_1_2);
  assert.deepEqual(sourceAsset.runner, { ...HISTORICAL_RUNNER_1_1_2, minimum_node: 20 });
  assert.deepEqual(generatedAsset, sourceAsset);
});
