import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function runNpm(args: string[], cwd: string): string {
  const npmCli = process.env.npm_execpath;
  assert.ok(npmCli, "npm_execpath is required for the packed-install smoke test");
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("packed Runner loads its bundled schemas outside the monorepo", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "testing-runner-pack-"));
  const consumerRoot = path.join(temporaryRoot, "consumer");

  try {
    await mkdir(consumerRoot);
    const packOutput = runNpm(
      ["pack", packageRoot, "--pack-destination", temporaryRoot, "--json"],
      temporaryRoot,
    );
    const [{ filename }] = JSON.parse(packOutput) as [{ filename: string }];
    runNpm(["install", "--ignore-scripts", path.join(temporaryRoot, filename)], consumerRoot);

    const registryPath = path.join(
      consumerRoot,
      "node_modules",
      "@saitamasans",
      "testing-runner",
      "dist",
      "schema-registry.js",
    );
    const registry = (await import(pathToFileURL(registryPath).href)) as {
      validateDocument<T>(schemaId: string, value: unknown): T;
    };
    const profile = {
      protocol_version: "1.0.0",
      profile_id: "packed-smoke",
      targets: { api: { kind: "api", origin: "https://api.example.test" } },
      credentials: { api: { source: "env", name: "TESTING_API_TOKEN" } },
    };

    assert.equal(registry.validateDocument("execution-profile", profile), profile);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(path.join(packageRoot, "dist"), { recursive: true, force: true });
  }
});
