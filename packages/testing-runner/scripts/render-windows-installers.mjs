import { createHash } from "node:crypto";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import unzipper from "unzipper";
import { validateInventoryEntries, validateRuntimeLock } from "./windows-bundle-lib.mjs";

const SHA256 = /^[a-f0-9]{64}$/;
const PLACEHOLDER = /__[A-Z0-9_]+__/g;
const OWNER = "Saitamasans";
const REPOSITORY = "testing-skills";
const SKILL = "web-api-test-execution-evidence";

function fail(message) {
  throw new Error(`render_windows_installers_failed: ${message}`);
}

function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || !value || value.startsWith("--")) {
      fail(`invalid argument near ${flag ?? "end of command"}`);
    }
    if (values.has(flag)) fail(`duplicate argument: ${flag}`);
    values.set(flag, value);
  }
  const required = [
    "--lock",
    "--x64-manifest",
    "--x64-bundle",
    "--arm64-manifest",
    "--arm64-bundle",
    "--complete-template",
    "--cmd-template",
    "--generic-template",
    "--all-template",
    "--output",
  ];
  for (const flag of required) {
    if (!values.has(flag)) fail(`missing required argument: ${flag}`);
  }
  if (values.size !== required.length) fail("unknown argument supplied");
  return Object.fromEntries(required.map((flag) => [flag.slice(2), values.get(flag)]));
}

function sha256Bytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function sha256File(file) {
  return sha256Bytes(await readFile(file));
}

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label} must be an object`);
  }
  return value;
}

function exact(value, expected, label) {
  if (value !== expected) fail(`${label} must be exactly ${expected}`);
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fail(`${label} must be a positive integer`);
}

function hash(value, label) {
  if (typeof value !== "string" || !SHA256.test(value)) {
    fail(`${label} must be a lowercase SHA-256`);
  }
}

async function readJson(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    fail(`${label} is not valid UTF-8 JSON`);
  }
}

function releaseUrl(tag, fileName) {
  return `https://github.com/${OWNER}/${REPOSITORY}/releases/download/${tag}/${fileName}`;
}

function parseJsonBytes(bytes, label) {
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid UTF-8 JSON`);
  }
}

function validatePayloadManifest(value, lock, arch) {
  const manifest = object(value, `${arch} payload manifest`);
  exact(manifest.schema_version, 1, "payload manifest schema_version");

  const bundle = object(manifest.bundle, "payload manifest bundle");
  exact(bundle.name, SKILL, "payload manifest bundle.name");
  exact(bundle.version, lock.bundle_version, "payload manifest bundle.version");
  exact(bundle.release_tag, lock.release_tag, "payload manifest bundle.release_tag");
  exact(bundle.os, "windows", "payload manifest bundle.os");
  exact(bundle.arch, arch, "payload manifest bundle.arch");

  const components = object(manifest.components, "payload manifest components");
  const node = object(components.node, "payload manifest node");
  exact(node.version, lock.node.version, "payload manifest node.version");

  const runner = object(components.runner, "payload manifest runner");
  exact(runner.name, lock.runner.name, "payload manifest runner.name");
  exact(runner.version, lock.runner.version, "payload manifest runner.version");
  exact(runner.download_url, lock.runner.download_url, "payload manifest runner.download_url");
  exact(runner.sha256, lock.runner.sha256, "payload manifest runner.sha256");
  exact(runner.size_bytes, lock.runner.size_bytes, "payload manifest runner.size_bytes");

  const playwright = object(components.playwright, "payload manifest playwright");
  exact(playwright.version, lock.playwright.version, "payload manifest playwright.version");
  exact(
    playwright.chromium_revision,
    lock.playwright.chromium_revision,
    "payload manifest playwright.chromium_revision",
  );
  exact(
    playwright.chromium_headless_shell_revision,
    lock.playwright.chromium_headless_shell_revision,
    "payload manifest playwright.chromium_headless_shell_revision",
  );
  exact(
    playwright.ffmpeg_revision,
    lock.playwright.ffmpeg_revision,
    "payload manifest playwright.ffmpeg_revision",
  );
  const skill = object(components.skill, "payload manifest skill");
  exact(skill.name, SKILL, "payload manifest skill.name");

  validateInventoryEntries(manifest.files);
  if (manifest.files.length === 0) fail("payload manifest inventory must not be empty");
  if (manifest.files.some(({ path: relative }) =>
    relative.toLocaleLowerCase("en-US") === "bundle-manifest.json")) {
    fail("payload manifest must not inventory itself");
  }
  const installedSize = manifest.files.reduce((total, entry) => total + entry.size_bytes, 0);
  if (!Number.isSafeInteger(installedSize)) fail("payload manifest installed size is unsafe");
  exact(manifest.installed_size_bytes, installedSize, "payload manifest installed_size_bytes");
  return manifest;
}

async function readPayloadManifest(input, payload) {
  let directory;
  try {
    directory = await unzipper.Open.file(input.bundlePath);
  } catch {
    fail(`${input.arch} bundle is not a readable ZIP archive`);
  }
  const entries = directory.files.filter((entry) =>
    entry.type !== "Directory"
    && entry.path.toLocaleLowerCase("en-US") === "bundle-manifest.json");
  if (entries.length !== 1 || entries[0].path !== "bundle-manifest.json") {
    fail(`${input.arch} bundle must contain exactly one bundle-manifest.json at the archive root`);
  }

  let bytes;
  try {
    bytes = await entries[0].buffer();
  } catch {
    fail(`${input.arch} payload manifest could not be read from the ZIP archive`);
  }
  exact(bytes.length, payload.size_bytes, `${input.arch} payload manifest size`);
  if (sha256Bytes(bytes) !== payload.sha256) {
    fail(`${input.arch} payload manifest SHA-256 does not match its companion manifest`);
  }
  return {
    bytes,
    value: validatePayloadManifest(
      parseJsonBytes(bytes, `${input.arch} payload manifest`),
      input.lock,
      input.arch,
    ),
  };
}

async function validateCompanion(input) {
  const value = object(await readJson(input.manifestPath, `${input.arch} companion manifest`), "companion manifest");
  exact(value.schema_version, 1, "companion manifest schema_version");
  const bundle = object(value.bundle, "companion manifest bundle");
  exact(bundle.name, SKILL, "companion manifest bundle.name");
  exact(bundle.version, input.lock.bundle_version, "companion manifest bundle.version");
  exact(bundle.release_tag, input.lock.release_tag, "companion manifest release_tag");
  exact(bundle.os, "windows", "companion manifest operating system");
  if (bundle.arch !== input.arch) {
    fail(`${input.arch} companion manifest architecture must be exactly ${input.arch}`);
  }

  const expectedArchive = `${SKILL}-${input.lock.bundle_version}-windows-${input.arch}.zip`;
  const expectedManifest = expectedArchive.replace(/\.zip$/, ".manifest.json");
  exact(path.basename(input.manifestPath), expectedManifest, `${input.arch} manifest file name`);
  exact(path.basename(input.bundlePath), expectedArchive, `${input.arch} bundle file name`);

  const archive = object(value.archive, "companion manifest archive");
  exact(archive.file_name, expectedArchive, "companion manifest archive.file_name");
  exact(
    archive.download_url,
    releaseUrl(input.lock.release_tag, expectedArchive),
    "companion manifest archive.download_url",
  );
  positiveInteger(archive.size_bytes, "companion manifest archive.size_bytes");
  hash(archive.sha256, "companion manifest archive.sha256");

  const metadata = await stat(input.bundlePath).catch(() => undefined);
  if (!metadata?.isFile()) fail(`${input.arch} bundle is missing`);
  exact(metadata.size, archive.size_bytes, `${input.arch} bundle size`);
  const actualArchiveSha256 = await sha256File(input.bundlePath);
  if (actualArchiveSha256 !== archive.sha256) {
    fail(`${input.arch} bundle SHA-256 does not match its companion manifest`);
  }

  const payload = object(value.payload_manifest, "companion payload_manifest");
  exact(payload.path, "bundle-manifest.json", "payload manifest path");
  positiveInteger(payload.size_bytes, "payload manifest size_bytes");
  hash(payload.sha256, "payload manifest SHA-256");
  positiveInteger(value.installed_size_bytes, "companion installed_size_bytes");
  const inner = await readPayloadManifest(input, payload);
  exact(
    value.installed_size_bytes,
    inner.value.installed_size_bytes + inner.bytes.length,
    "companion installed_size_bytes",
  );

  return {
    arch: input.arch,
    bundlePath: input.bundlePath,
    bundleName: expectedArchive,
    manifestPath: input.manifestPath,
    manifestName: expectedManifest,
    manifestSha256: await sha256File(input.manifestPath),
  };
}

function replaceExactly(text, token, value, label) {
  const occurrences = text.split(token).length - 1;
  if (occurrences !== 1) fail(`${label} must contain exactly one ${token}`);
  return text.replace(token, value);
}

function replaceSetting(text, name, value) {
  const expression = new RegExp(`^set "${name}=[^"\\r\\n]*"$`, "gm");
  const matches = text.match(expression) ?? [];
  if (matches.length !== 1) fail(`all-Skills template must contain exactly one ${name} setting`);
  return text.replace(expression, `set "${name}=${value}"`);
}

function rejectPlaceholders(text, label) {
  const matches = [...text.matchAll(PLACEHOLDER)].map((match) => match[0]);
  if (matches.length > 0) fail(`unresolved placeholder in ${label}: ${matches.join(", ")}`);
}

async function assertAbsent(file) {
  try {
    await lstat(file);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  fail(`output already exists; release assets are never overwritten: ${file}`);
}

export async function renderWindowsInstallers(rawInput) {
  const input = Object.fromEntries(
    Object.entries(rawInput).map(([key, value]) => [key, path.resolve(value)]),
  );
  const lock = validateRuntimeLock(await readJson(input.lock, "runtime lock"));
  exact(lock.release_tag, `${SKILL}-v${lock.bundle_version}`, "runtime lock release_tag");

  const [x64, arm64] = await Promise.all([
    validateCompanion({
      arch: "x64",
      manifestPath: input["x64-manifest"],
      bundlePath: input["x64-bundle"],
      lock,
    }),
    validateCompanion({
      arch: "arm64",
      manifestPath: input["arm64-manifest"],
      bundlePath: input["arm64-bundle"],
      lock,
    }),
  ]);
  if (x64.manifestSha256 === arm64.manifestSha256) {
    fail("x64 and arm64 companion manifests must be distinct");
  }

  const completeTemplate = await readFile(input["complete-template"]);
  if (!completeTemplate.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail("complete PowerShell template must retain its UTF-8 BOM for Windows PowerShell 5.1");
  }
  let completeText = completeTemplate.toString("utf8");
  completeText = replaceExactly(
    completeText,
    "__X64_COMPANION_MANIFEST_SHA256__",
    x64.manifestSha256,
    "complete PowerShell template",
  );
  completeText = replaceExactly(
    completeText,
    "__ARM64_COMPANION_MANIFEST_SHA256__",
    arm64.manifestSha256,
    "complete PowerShell template",
  );
  rejectPlaceholders(completeText, "complete PowerShell installer");
  const completeBytes = Buffer.from(completeText, "utf8");
  const completeSha256 = sha256Bytes(completeBytes);
  const completeName = `install-${SKILL}.ps1`;
  const completeUrl = releaseUrl(lock.release_tag, completeName);

  let cmdText = await readFile(input["cmd-template"], "utf8");
  cmdText = replaceExactly(cmdText, "__COMPLETE_INSTALLER_URL__", completeUrl, "public CMD template");
  cmdText = replaceExactly(
    cmdText,
    "__COMPLETE_INSTALLER_SHA256__",
    completeSha256,
    "public CMD template",
  );
  rejectPlaceholders(cmdText, "public CMD installer");

  const genericTemplate = await readFile(input["generic-template"]);
  if (!genericTemplate.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) {
    fail("generic PowerShell template must retain its UTF-8 BOM for Windows PowerShell 5.1");
  }
  let genericText = genericTemplate.toString("utf8");
  genericText = replaceExactly(
    genericText,
    "__COMPLETE_INSTALLER_SHA256__",
    completeSha256,
    "generic PowerShell template",
  );
  rejectPlaceholders(genericText, "generic PowerShell installer");
  const genericBytes = Buffer.from(genericText, "utf8");
  const genericSha256 = sha256Bytes(genericBytes);
  const genericUrl = releaseUrl(lock.release_tag, "install.ps1");

  let allText = await readFile(input["all-template"], "utf8");
  allText = replaceSetting(allText, "GENERIC_INSTALLER_URL", genericUrl);
  allText = replaceSetting(allText, "GENERIC_INSTALLER_SHA256", genericSha256);
  allText = replaceSetting(allText, "COMPLETE_INSTALLER_URL", completeUrl);
  allText = replaceSetting(allText, "COMPLETE_INSTALLER_SHA256", completeSha256);
  rejectPlaceholders(allText, "all-Skills CMD installer");

  await assertAbsent(input.output);
  const staging = `${input.output}.tmp-${process.pid}-${Date.now()}`;
  await assertAbsent(staging);
  await mkdir(staging, { recursive: true });
  let completed = false;
  try {
    for (const item of [x64, arm64]) {
      await copyFile(item.bundlePath, path.join(staging, item.bundleName));
      await copyFile(item.manifestPath, path.join(staging, item.manifestName));
    }
    await writeFile(path.join(staging, completeName), completeBytes);
    await writeFile(path.join(staging, `install-${SKILL}.cmd`), cmdText, "utf8");
    await writeFile(path.join(staging, "install.ps1"), genericBytes);
    await writeFile(path.join(staging, "install-all.cmd"), allText, "utf8");

    const names = [
      x64.bundleName,
      x64.manifestName,
      arm64.bundleName,
      arm64.manifestName,
      completeName,
      `install-${SKILL}.cmd`,
      "install.ps1",
      "install-all.cmd",
    ].sort();
    if (new Set(names).size !== names.length) fail("duplicate release asset name");
    const checksumLines = [];
    for (const name of names) {
      checksumLines.push(`${await sha256File(path.join(staging, name))}  ${name}`);
    }
    await writeFile(path.join(staging, "SHA256SUMS.txt"), `${checksumLines.join("\n")}\n`, "utf8");
    await rename(staging, input.output);
    completed = true;
  } finally {
    if (!completed) await rm(staging, { recursive: true, force: true });
  }

  return {
    output: input.output,
    release_tag: lock.release_tag,
    x64_companion_sha256: x64.manifestSha256,
    arm64_companion_sha256: arm64.manifestSha256,
    complete_installer_sha256: completeSha256,
    generic_installer_sha256: genericSha256,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  renderWindowsInstallers(parseArguments(process.argv.slice(2))).then(
    (result) => console.log(JSON.stringify(result, null, 2)),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    },
  );
}
