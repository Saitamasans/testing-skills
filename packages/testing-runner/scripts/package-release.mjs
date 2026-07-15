import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const PACKAGE_NAME = "@saitamasans/testing-runner";
const VERSION = "1.0.0";
const FILE_NAME = "saitamasans-testing-runner-1.0.0.tgz";
const BUNDLED_DEPENDENCIES = [
  "ajv",
  "commander",
  "exceljs",
  "node-sql-parser",
  "playwright",
];
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

async function npmCliPath() {
  if (process.env.npm_execpath) return process.env.npm_execpath;
  const candidate = path.join(
    path.dirname(process.execPath),
    "node_modules",
    "npm",
    "bin",
    "npm-cli.js",
  );
  await access(candidate);
  return candidate;
}

async function runNpm(args, cwd = REPO_ROOT) {
  const cli = await npmCliPath();
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || "");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error("npm terminated by " + signal));
      } else if (code !== 0) {
        reject(new Error("npm exited with " + code + "\n" + stdout + "\n" + stderr));
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

export async function sha256File(file) {
  const bytes = await readFile(file);
  return createHash("sha256").update(bytes).digest("hex");
}

function readTarString(buffer, start, length) {
  return buffer
    .subarray(start, start + length)
    .toString("utf8")
    .replace(/\0.*$/, "")
    .trim();
}

export async function listTarEntries(archivePath) {
  const tar = gunzipSync(await readFile(archivePath));
  const entries = [];
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? prefix + "/" + name : name;
    const sizeText = readTarString(header, 124, 12);
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isFinite(size) || size < 0) {
      throw new Error("invalid tar entry size for " + fullName);
    }
    entries.push(fullName.replace(/\/$/, ""));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

export async function buildReleaseTarball(outputDir = path.join(REPO_ROOT, "build", "releases")) {
  await mkdir(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, FILE_NAME);
  const checksumPath = archivePath + ".sha256";
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });

  await runNpm(["run", "build", "--workspace", PACKAGE_NAME]);
  const stageDir = path.join(outputDir, ".stage-" + randomUUID());
  try {
    await mkdir(stageDir, { recursive: true });
    for (const directory of ["dist", "vendor", "examples"]) {
      await cp(path.join(PACKAGE_ROOT, directory), path.join(stageDir, directory), {
        recursive: true,
      });
    }
    const packageJson = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    packageJson.scripts = {};
    packageJson.bundledDependencies = BUNDLED_DEPENDENCIES;
    delete packageJson.devDependencies;
    await writeFile(
      path.join(stageDir, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n",
      "utf8",
    );
    await runNpm([
      "install",
      "--package-lock-only",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ], stageDir);
    await runNpm([
      "ci",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
    ], stageDir);
    const packed = await runNpm([
      "pack",
      "--pack-destination",
      outputDir,
      "--json",
    ], stageDir);
    const result = JSON.parse(packed.stdout.trim());
    if (!Array.isArray(result) || result.length !== 1 || !result[0]?.filename) {
      throw new Error("npm pack did not return exactly one archive");
    }
    const producedPath = path.join(outputDir, result[0].filename);
    if (path.resolve(producedPath) !== path.resolve(archivePath)) {
      await rename(producedPath, archivePath);
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }

  const sha256 = await sha256File(archivePath);
  const sizeBytes = (await stat(archivePath)).size;
  await writeFile(checksumPath, sha256 + "  " + FILE_NAME + "\n", "utf8");
  return {
    packageName: PACKAGE_NAME,
    version: VERSION,
    fileName: FILE_NAME,
    archivePath,
    checksumPath,
    sha256,
    sizeBytes,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildReleaseTarball(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
}
