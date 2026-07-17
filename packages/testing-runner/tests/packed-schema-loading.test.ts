import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

function resolvePackageManager(): { kind: "npm" | "pnpm"; cli: string } {
  if (process.env.npm_execpath) {
    return {
      kind: /pnpm/i.test(process.env.npm_execpath) ? "pnpm" : "npm",
      cli: process.env.npm_execpath,
    };
  }
  const candidates: Array<{ kind: "npm" | "pnpm"; cli: string }> = [
    {
      kind: "npm",
      cli: path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
    },
    {
      kind: "pnpm",
      cli: path.resolve(path.dirname(process.execPath), "..", "node_modules", "pnpm", "bin", "pnpm.mjs"),
    },
    {
      kind: "pnpm",
      cli: path.resolve(path.dirname(process.execPath), "..", "node_modules", "pnpm", "bin", "pnpm.cjs"),
    },
  ];
  const manager = candidates.find((candidate) => existsSync(candidate.cli));
  assert.ok(manager, "npm or pnpm is required for the packed-install smoke test");
  return manager;
}

function runPackageManager(
  manager: { kind: "npm" | "pnpm"; cli: string },
  args: string[],
  cwd: string,
): string {
  const env = { ...process.env, npm_config_audit: "false", npm_config_fund: "false" };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || "");
  const result = spawnSync(process.execPath, [manager.cli, ...args], {
    cwd,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

test("packed Runner loads its bundled schemas and rules outside the monorepo", async () => {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "testing-runner-pack-"));
  const consumerRoot = path.join(temporaryRoot, "consumer");
  const originalCwd = process.cwd();

  try {
    await mkdir(consumerRoot);
    const manager = resolvePackageManager();
    const packArgs = manager.kind === "npm"
      ? ["pack", packageRoot, "--pack-destination", temporaryRoot, "--json"]
      : ["pack", "--pack-destination", temporaryRoot, "--json"];
    const packOutput = runPackageManager(
      manager,
      packArgs,
      packageRoot,
    );
    const packed = JSON.parse(packOutput) as { filename: string } | Array<{ filename: string }>;
    const filename = Array.isArray(packed) ? packed[0]?.filename : packed.filename;
    assert.ok(filename, "package manager did not return a packed archive filename");
    const archivePath = path.isAbsolute(filename) ? filename : path.join(temporaryRoot, filename);
    runPackageManager(
      manager,
      manager.kind === "npm"
        ? ["install", "--ignore-scripts", archivePath]
        : ["add", "--ignore-scripts", archivePath],
      consumerRoot,
    );

    const registryPath = path.join(
      consumerRoot,
      "node_modules",
      "@saitamasans",
      "testing-runner",
      "dist",
      "schema-registry.js",
    );
    const knowledgePath = path.join(
      consumerRoot,
      "node_modules",
      "@saitamasans",
      "testing-runner",
      "dist",
      "assertions",
      "knowledge-registry.js",
    );
    process.chdir(consumerRoot);
    const registry = (await import(pathToFileURL(registryPath).href)) as {
      validateDocument<T>(schemaId: string, value: unknown): T;
    };
    const knowledge = (await import(pathToFileURL(knowledgePath).href)) as {
      loadKnowledgeRules(): Promise<unknown[]>;
    };
    const profile = {
      protocol_version: "1.0.0",
      profile_id: "packed-smoke",
      targets: { api: { kind: "api", origin: "https://api.example.test" } },
      credentials: { api: { source: "env", name: "TESTING_API_TOKEN" } },
    };

    assert.equal(registry.validateDocument("execution-profile", profile), profile);
    assert.ok((await knowledge.loadKnowledgeRules()).length > 0);
  } finally {
    process.chdir(originalCwd);
    await rm(temporaryRoot, { recursive: true, force: true });
    await rm(path.join(packageRoot, "dist"), { recursive: true, force: true });
  }
});
