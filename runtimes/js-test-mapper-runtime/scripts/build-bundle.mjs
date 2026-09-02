import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));
const outputDir = path.resolve(repoRoot, process.argv[2] || "build/js-test-mapper-runtime");
const npmCli = process.env.npm_execpath || path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
if (!/[\\/]npm(?:-cli)?\.(?:js|cjs)$/i.test(npmCli)) throw new Error("bundle_build_requires_npm_cli");

function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${executable} exited ${code}\n${stdout}\n${stderr}`)));
  });
}

await mkdir(outputDir, { recursive: true });
const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
const lock = JSON.parse(await readFile(path.join(packageRoot, "package-lock.json"), "utf8"));
if (lock.lockfileVersion !== 3 || lock.packages[""].version !== packageJson.version) throw new Error("committed_runtime_lock_is_not_current");
for (const [name, version] of Object.entries(packageJson.dependencies)) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`runtime_dependency_not_exact: ${name}`);
  const installed = JSON.parse(await readFile(path.join(packageRoot, "node_modules", ...name.split("/"), "package.json"), "utf8"));
  if (installed.version !== version) throw new Error(`runtime_dependency_install_mismatch: ${name} ${installed.version} != ${version}`);
}
const packed = await run(process.execPath, [npmCli, "pack", "--json", "--pack-destination", outputDir, "--workspaces=false"], packageRoot);
const result = JSON.parse(packed.stdout)[0];
const bundlePath = path.join(outputDir, result.filename);
const bytes = await readFile(bundlePath);
const digest = createHash("sha256").update(bytes).digest("hex");
const manifest = {
  schema_version: 1,
  runtime: { name: packageJson.name, version: packageJson.version, minimum_node: 20 },
  bundle: { file_name: result.filename, sha256: digest, size_bytes: bytes.length, integrity: result.integrity },
  files: result.files.map((file) => ({ path: file.path, size: file.size })).sort((left, right) => left.path.localeCompare(right.path)),
  browser: { provider: "playwright", version: packageJson.dependencies.playwright, name: "chromium", revision: "1228", bundled: false, normal_scan_downloads: false },
};
const manifestPath = path.join(outputDir, `js-test-mapper-runtime-${packageJson.version}.manifest.json`);
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(`${bundlePath}.sha256`, `${digest}  ${result.filename}\n`, "utf8");
console.log(JSON.stringify({ bundlePath, manifestPath, sha256: digest, sizeBytes: bytes.length }));
