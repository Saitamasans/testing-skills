import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import {
  access,
  cp,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const PACKAGE_NAME = "@saitamasans/testing-runner";
const VERSION = "1.1.2";
const FILE_NAME = "saitamasans-testing-runner-1.1.2.tgz";
const RELEASE_TAG = "testing-runner-v1.1.2";
const RELEASE_URL = "https://github.com/Saitamasans/testing-skills/releases/download/"
  + RELEASE_TAG + "/" + FILE_NAME;
const CHROMIUM_ESTIMATED_SIZE_BYTES = 180_000_000;
const BUNDLED_DEPENDENCIES = [
  "ajv",
  "commander",
  "exceljs",
  "mysql2",
  "node-sql-parser",
  "pg",
  "playwright",
];
const OWNED_TEXT_EXTENSIONS = new Set([
  ".css",
  ".html",
  ".js",
  ".json",
  ".md",
  ".mjs",
  ".txt",
  ".yaml",
  ".yml",
]);
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const RELEASE_DEPENDENCY_LOCK_PATH = fileURLToPath(
  new URL("../release/package-lock.json", import.meta.url),
);
const DEFAULT_MANIFEST_PATH = path.join(
  REPO_ROOT,
  "skill-sources",
  "web-api-test-execution-evidence",
  "assets",
  "runner-release.json",
);

export function resolveReleaseOutputDir(outputDir = path.join(REPO_ROOT, "build", "releases")) {
  return path.resolve(REPO_ROOT, outputDir);
}

async function packageManager() {
  if (process.env.npm_execpath) {
    if (!/[\\/]npm(?:-cli)?\.(?:js|cjs)$/i.test(process.env.npm_execpath)) {
      throw new Error("release packaging requires npm with the committed dependency lock");
    }
    return {
      kind: "npm",
      cli: process.env.npm_execpath,
    };
  }
  const candidate = {
    kind: "npm",
    cli: path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
  };
  try {
    await access(candidate.cli);
    return candidate;
  } catch {
    throw new Error("release packaging requires npm with the committed dependency lock");
  }
}

async function runPackageManager(manager, args, cwd = REPO_ROOT) {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") || "PATH";
  env[pathKey] = path.dirname(process.execPath) + path.delimiter + (env[pathKey] || "");
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [manager.cli, ...args], {
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
        reject(new Error(manager.kind + " terminated by " + signal));
      } else if (code !== 0) {
        reject(new Error(manager.kind + " exited with " + code + "\n" + stdout + "\n" + stderr));
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

export async function normalizeReleaseTextTree(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await normalizeReleaseTextTree(absolute);
    } else if (entry.isFile() && OWNED_TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      const text = await readFile(absolute, "utf8");
      const normalized = text.replace(/\r\n?/g, "\n");
      if (normalized !== text) {
        await writeFile(absolute, normalized, "utf8");
      }
    }
  }
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

export async function buildReleaseTarball(
  outputDir = path.join(REPO_ROOT, "build", "releases"),
  manifestPath = DEFAULT_MANIFEST_PATH,
) {
  outputDir = resolveReleaseOutputDir(outputDir);
  await mkdir(outputDir, { recursive: true });
  const archivePath = path.join(outputDir, FILE_NAME);
  const checksumPath = archivePath + ".sha256";
  await rm(archivePath, { force: true });
  await rm(checksumPath, { force: true });

  const manager = await packageManager();
  await runPackageManager(manager, ["run", "build"], PACKAGE_ROOT);
  const stageDir = path.join(outputDir, ".stage-" + randomUUID());
  try {
    await mkdir(stageDir, { recursive: true });
    for (const directory of ["dist", "vendor", "examples"]) {
      await cp(path.join(PACKAGE_ROOT, directory), path.join(stageDir, directory), {
        recursive: true,
      });
    }
    await normalizeReleaseTextTree(stageDir);
    const packageJson = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8"));
    packageJson.scripts = {};
    packageJson.bundledDependencies = BUNDLED_DEPENDENCIES;
    delete packageJson.devDependencies;
    await writeFile(
      path.join(stageDir, "package.json"),
      JSON.stringify(packageJson, null, 2) + "\n",
      "utf8",
    );
    const releaseLock = JSON.parse(await readFile(RELEASE_DEPENDENCY_LOCK_PATH, "utf8"));
    const lockedRoot = releaseLock.packages?.[""];
    if (releaseLock.lockfileVersion !== 3
        || lockedRoot?.name !== packageJson.name
        || lockedRoot?.version !== packageJson.version
        || JSON.stringify(lockedRoot?.dependencies) !== JSON.stringify(packageJson.dependencies)) {
      throw new Error("committed Runner release dependency lock does not match package.json");
    }
    await copyFile(RELEASE_DEPENDENCY_LOCK_PATH, path.join(stageDir, "package-lock.json"));
    await runPackageManager(manager, [
      "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
    ], stageDir);
    const packArgs = ["pack", "--pack-destination", outputDir, "--json", "--ignore-scripts"];
    const packed = await runPackageManager(manager, packArgs, stageDir);
    const parsed = JSON.parse(packed.stdout.trim());
    const result = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!result?.filename) {
      throw new Error(manager.kind + " pack did not return an archive filename");
    }
    const producedPath = path.isAbsolute(result.filename)
      ? result.filename
      : path.join(outputDir, result.filename);
    if (path.resolve(producedPath) !== path.resolve(archivePath)) {
      await rename(producedPath, archivePath);
    }
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }

  const sha256 = await sha256File(archivePath);
  const sizeBytes = (await stat(archivePath)).size;
  await writeFile(checksumPath, sha256 + "  " + FILE_NAME + "\n", "utf8");
  const manifest = {
    schema_version: 1,
    runner: {
      name: PACKAGE_NAME,
      version: VERSION,
      download_url: RELEASE_URL,
      sha256,
      size_bytes: sizeBytes,
      minimum_node: 20,
    },
    browser: {
      provider: "playwright",
      name: "chromium",
      estimated_size_bytes: CHROMIUM_ESTIMATED_SIZE_BYTES,
    },
  };
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return {
    packageName: PACKAGE_NAME,
    version: VERSION,
    fileName: FILE_NAME,
    archivePath,
    checksumPath,
    sha256,
    sizeBytes,
    manifestPath,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await buildReleaseTarball(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
}
