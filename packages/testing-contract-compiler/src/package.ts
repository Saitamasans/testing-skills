import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInflateRaw } from "node:zlib";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import Ajv2020 from "ajv/dist/2020.js";
import { buildContract } from "./contract.js";
import { sha256, stableJson } from "./crypto.js";
import { inspectWorkbook, inspectWorkbookBytes } from "./excel.js";
import { assertNoInlineSecret } from "./security.js";
import type { CompileOptions, PackageManifest, ValidationResult } from "./types.js";

const REQUIRED_INTERNAL = ["execution-contract.json", "execution-readiness.md", "unresolved-items.xlsx", "source-mapping.json"];
const FIXED_DATE = new Date("2000-01-01T00:00:00.000Z");
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const MAX_ENTRIES = 128;
const MAX_COMPRESSION_RATIO = 200;
const SCRIPT_EXTENSIONS = new Set([".bat", ".cmd", ".com", ".cpl", ".exe", ".js", ".jse", ".mjs", ".cjs", ".msi", ".ps1", ".psm1", ".scr", ".sh", ".vbs", ".wsf"]);
const CRITICAL_FILES = new Set(["package-manifest.json", ...REQUIRED_INTERNAL].map((name) => name.toLowerCase()));

interface ZipEntryMetadata {
  name: string;
  compressedSize: number;
  uncompressedSize: number;
  directory: boolean;
  method: number;
  dataStart: number;
  dataEnd: number;
}

export function validateZipEntries(entries: string[]): void {
  const folded = new Set<string>();
  for (const entry of entries) {
    const normalized = entry.replaceAll("\\", "/");
    if (!normalized || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) throw new Error(`zip_path_unsafe: ${entry}`);
    const key = normalized.toLowerCase();
    if (folded.has(key)) throw new Error(`zip_path_case_duplicate: ${entry}`);
    folded.add(key);
  }
}

function findEndOfCentralDirectory(bytes: Buffer): number {
  const minimum = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("zip_central_directory_missing");
}

function validateZipStructure(bytes: Buffer): ZipEntryMetadata[] {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error("zip_archive_too_large");
  const eocd = findEndOfCentralDirectory(bytes);
  const disk = bytes.readUInt16LE(eocd + 4);
  const centralDisk = bytes.readUInt16LE(eocd + 6);
  const entriesOnDisk = bytes.readUInt16LE(eocd + 8);
  const entryCount = bytes.readUInt16LE(eocd + 10);
  const centralSize = bytes.readUInt32LE(eocd + 12);
  const centralOffset = bytes.readUInt32LE(eocd + 16);
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) throw new Error("zip_multidisk_forbidden");
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("zip_declared_size_invalid");
  if (entryCount > MAX_ENTRIES) throw new Error("zip_entry_count_exceeded");
  if (centralOffset + centralSize > eocd) throw new Error("zip_central_directory_invalid");

  const entries: ZipEntryMetadata[] = [];
  let offset = centralOffset;
  let totalUncompressed = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.length || bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error("zip_central_directory_invalid");
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const uncompressedSize = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const diskStart = bytes.readUInt16LE(offset + 34);
    const externalAttributes = bytes.readUInt32LE(offset + 38);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const entryEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (entryEnd > bytes.length || nameLength === 0 || nameLength > 240) throw new Error("zip_central_directory_invalid");
    if (diskStart !== 0 || compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) throw new Error("zip_declared_size_invalid");
    if ((flags & 0x1) !== 0) throw new Error("zip_encrypted_entry_forbidden");
    if (method !== 0 && method !== 8) throw new Error("zip_compression_method_forbidden");
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const directory = name.endsWith("/");
    const unixMode = (externalAttributes >>> 16) & 0xffff;
    if ((unixMode & 0xf000) === 0xa000) throw new Error("zip_link_forbidden");
    if ((externalAttributes & 0x400) !== 0 || (unixMode & 0x400) !== 0) throw new Error("zip_reparse_forbidden");
    if (!directory && SCRIPT_EXTENSIONS.has(path.posix.extname(name).toLowerCase())) throw new Error("zip_script_forbidden");
    if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("zip_entry_too_large");
    totalUncompressed += uncompressedSize;
    if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("zip_total_size_exceeded");
    if (!directory && uncompressedSize > 1024 * 1024 && (compressedSize === 0 || uncompressedSize / compressedSize > MAX_COMPRESSION_RATIO)) {
      throw new Error("zip_compression_ratio_exceeded");
    }
    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("zip_local_header_invalid");
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const localNameEnd = localOffset + 30 + localNameLength;
    const dataStart = localNameEnd + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataStart > bytes.length || dataEnd > centralOffset) throw new Error("zip_local_header_invalid");
    const localName = bytes.subarray(localOffset + 30, localNameEnd).toString("utf8");
    if (localName !== name) throw new Error("zip_local_name_mismatch");
    const localFlags = bytes.readUInt16LE(localOffset + 6);
    const localMethod = bytes.readUInt16LE(localOffset + 8);
    if ((localFlags & 0x1) !== 0) throw new Error("zip_encrypted_entry_forbidden");
    if (localMethod !== method) throw new Error("zip_local_header_invalid");
    entries.push({ name, compressedSize, uncompressedSize, directory, method, dataStart, dataEnd });
    offset = entryEnd;
  }
  if (offset !== centralOffset + centralSize) throw new Error("zip_central_directory_invalid");

  const fileNames = entries.filter(({ directory }) => !directory).map(({ name }) => name);
  const criticalCounts = new Map<string, number>();
  for (const name of fileNames) {
    const folded = name.toLowerCase();
    if (CRITICAL_FILES.has(folded)) criticalCounts.set(folded, (criticalCounts.get(folded) ?? 0) + 1);
  }
  if ([...criticalCounts.values()].some((count) => count > 1)) throw new Error("zip_critical_file_duplicate");
  validateZipEntries(entries.map(({ name }) => name));
  return entries;
}

async function inflateEntryBounded(
  archive: Buffer,
  entry: ZipEntryMetadata,
  total: { value: number },
): Promise<Buffer> {
  const compressed = archive.subarray(entry.dataStart, entry.dataEnd);
  if (entry.method === 0) {
    const actualSize = compressed.length;
    if (actualSize > MAX_ENTRY_BYTES) throw new Error("zip_entry_too_large");
    if (total.value + actualSize > MAX_TOTAL_UNCOMPRESSED_BYTES) throw new Error("zip_total_size_exceeded");
    if (actualSize !== entry.uncompressedSize) throw new Error("zip_declared_size_mismatch");
    total.value += actualSize;
    return Buffer.from(compressed);
  }

  return new Promise<Buffer>((resolve, reject) => {
    const inflater = createInflateRaw();
    const chunks: Buffer[] = [];
    let actualSize = 0;
    let settled = false;
    const fail = (code: string): void => {
      if (settled) return;
      settled = true;
      inflater.destroy();
      reject(new Error(code));
    };
    inflater.on("data", (chunk: Buffer) => {
      if (settled) return;
      actualSize += chunk.length;
      if (actualSize > MAX_ENTRY_BYTES) return fail("zip_entry_too_large");
      if (total.value + actualSize > MAX_TOTAL_UNCOMPRESSED_BYTES) return fail("zip_total_size_exceeded");
      const actualCompressedSize = inflater.bytesWritten;
      if (actualSize > 1024 * 1024 && (actualCompressedSize === 0 || actualSize / actualCompressedSize > MAX_COMPRESSION_RATIO)) {
        return fail("zip_compression_ratio_exceeded");
      }
      chunks.push(Buffer.from(chunk));
    });
    inflater.on("error", () => fail("zip_decompression_failed"));
    inflater.on("end", () => {
      if (settled) return;
      if (inflater.bytesWritten !== entry.compressedSize) return fail("zip_compressed_size_mismatch");
      if (actualSize !== entry.uncompressedSize) return fail("zip_declared_size_mismatch");
      settled = true;
      total.value += actualSize;
      resolve(Buffer.concat(chunks, actualSize));
    });
    inflater.end(compressed);
  });
}

async function extractZipEntriesBounded(bytes: Buffer): Promise<{ metadata: ZipEntryMetadata[]; entries: Map<string, Buffer> }> {
  const metadata = validateZipStructure(bytes);
  const entries = new Map<string, Buffer>();
  const total = { value: 0 };
  for (const item of metadata) {
    if (item.directory) continue;
    entries.set(item.name, await inflateEntryBounded(bytes, item, total));
  }
  return { metadata, entries };
}

async function assertEntryContainsNoSecrets(name: string, bytes: Buffer): Promise<void> {
  if (path.posix.extname(name).toLowerCase() === ".xlsx") {
    await extractZipEntriesBounded(bytes);
    await inspectWorkbookBytes(bytes);
    return;
  }
  assertNoInlineSecret(bytes.toString("utf8"));
}

async function unresolvedWorkbook(contract: ReturnType<typeof buildContract>): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.created = FIXED_DATE;
  workbook.modified = FIXED_DATE;
  const sheet = workbook.addWorksheet("待确认项");
  sheet.addRow(["用例 ID", "字段", "原因"]);
  for (const item of contract.cases) for (const unresolved of item.unresolved) sheet.addRow([item.case_id, unresolved.field, unresolved.reason]);
  const generated = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const normalized = new JSZip();
  for (const name of Object.keys(generated.files).sort()) {
    const entry = generated.files[name]!;
    if (entry.dir) normalized.file(name, null, { dir: true, date: FIXED_DATE, createFolders: false });
    else normalized.file(name, await entry.async("uint8array"), { date: FIXED_DATE, createFolders: false });
  }
  return normalized.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
}

export async function compilePackage(options: CompileOptions) {
  const stagingParent = options.stagingParent ?? tmpdir();
  await mkdir(stagingParent, { recursive: true });
  const staging = await mkdtemp(path.join(stagingParent, "testing-contract-compiler-"));
  try {
    const inspected = await inspectWorkbook(options.input, options.fieldMapping);
    if (inspected.requires_confirmation || (options.fieldMapping && options.mappingConfirmed !== true)) throw new Error("field_mapping_confirmation_required");
    const contract = buildContract(inspected.cases, options.overrides);
    const unresolvedCount = contract.cases.reduce((count, item) => count + item.unresolved.length, 0);
    const packageStatus = unresolvedCount ? "NOT_READY" as const : "READY" as const;
    const sourceName = path.basename(options.input);
    const sourceBytes = await readFile(options.input);
    const mapping = { schema_version: "1.0.0", source_file: sourceName, sheets: inspected.source_sheet_names, cases: inspected.cases.map((item) => ({ source_case_id: item.case_id, case_id: item.case_id, source_sheet: item.source_sheet, source_row: item.source_row })) };
    const files = new Map<string, Buffer>([
      ["execution-contract.json", Buffer.from(stableJson(contract))],
      ["execution-readiness.md", Buffer.from(`# Execution Readiness\n\npackage_status=${packageStatus}\nunresolved_count=${unresolvedCount}\n`)],
      ["unresolved-items.xlsx", await unresolvedWorkbook(contract)],
      ["source-mapping.json", Buffer.from(stableJson(mapping))],
    ]);
    const requirementFiles = [
      ...(options.requirementFiles ?? []),
      ...(options.projectConfigFile ? [options.projectConfigFile] : []),
    ];
    const sources = [{ name: sourceName, bytes: sourceBytes }];
    for (const requirement of requirementFiles) {
      const bytes = await readFile(requirement);
      assertNoInlineSecret(bytes.toString("utf8"));
      sources.push({ name: path.basename(requirement), bytes });
    }
    if (new Set(sources.map(({ name }) => name.toLowerCase())).size !== sources.length) throw new Error("source_basename_duplicate");
    const internalHashes = Object.fromEntries([...files].map(([name, bytes]) => [name, sha256(bytes)]));
    const sourceHashes = Object.fromEntries(sources.map(({ name, bytes }) => [name, sha256(bytes)]));
    const packageId = sha256(stableJson(sourceHashes) + stableJson(contract)).slice(0, 32);
    const manifest: PackageManifest = {
      schema_version: "1.0.0", package_status: packageStatus, package_id: packageId,
      compiler_name: "@saitamasans/testing-contract-compiler", compiler_version: "1.0.0", contract_version: "1.0.0",
      compiled_at: FIXED_DATE.toISOString(), source_files: sources.map(({ name }) => `source/${name}`), source_sha256: sourceHashes,
      source_sheet_names: inspected.source_sheet_names, source_case_count: contract.cases.length,
      source_case_ids: contract.cases.map((item) => item.source_case_id), internal_files: REQUIRED_INTERNAL,
      internal_file_sha256: internalHashes, unresolved_count: unresolvedCount, secret_values_included: false,
    };
    const zip = new JSZip();
    zip.file("source/", null, { dir: true, date: FIXED_DATE, createFolders: false });
    for (const { name, bytes } of sources.sort((a, b) => a.name.localeCompare(b.name))) zip.file(`source/${name}`, bytes, { date: FIXED_DATE });
    for (const [name, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) zip.file(name, bytes, { date: FIXED_DATE });
    zip.file("package-manifest.json", stableJson(manifest), { date: FIXED_DATE });
    const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 }, platform: "UNIX" });
    const stagedOutput = path.join(staging, "package.zip");
    await writeFile(stagedOutput, archive);
    await mkdir(path.dirname(path.resolve(options.output)), { recursive: true });
    await copyFile(stagedOutput, options.output);
    return { output: path.resolve(options.output), package_status: packageStatus, package_id: packageId, source_case_count: contract.cases.length, unresolved_count: unresolvedCount };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function validatePackage(packagePath: string): Promise<ValidationResult> {
  const errors: string[] = [];
  let manifest: PackageManifest | null = null;
  try {
    const packageBytes = await readFile(packagePath);
    const { metadata, entries } = await extractZipEntriesBounded(packageBytes);
    const originalNames = metadata.filter(({ directory }) => !directory).map(({ name }) => name);
    for (const item of metadata) {
      if (item.directory) continue;
      const entryBytes = entries.get(item.name);
      if (!entryBytes) throw new Error("zip_entry_missing_after_load");
      await assertEntryContainsNoSecrets(item.name, entryBytes);
    }
    const manifestEntry = entries.get("package-manifest.json");
    if (!manifestEntry) throw new Error("package_manifest_missing");
    manifest = JSON.parse(manifestEntry.toString("utf8")) as PackageManifest;
    const exactIdentity = manifest.schema_version === "1.0.0"
      && manifest.compiler_name === "@saitamasans/testing-contract-compiler"
      && manifest.compiler_version === "1.0.0"
      && manifest.contract_version === "1.0.0"
      && ["READY", "NOT_READY"].includes(manifest.package_status)
      && /^[a-f0-9]{32}$/.test(manifest.package_id ?? "")
      && typeof manifest.compiled_at === "string"
      && Array.isArray(manifest.source_files)
      && manifest.source_files.length > 0
      && Array.isArray(manifest.internal_files)
      && manifest.source_sha256 && typeof manifest.source_sha256 === "object"
      && manifest.internal_file_sha256 && typeof manifest.internal_file_sha256 === "object";
    if (!exactIdentity) errors.push("package_manifest_invalid");
    const internalNames = [...(manifest.internal_files ?? [])];
    const sourcePaths = [...(manifest.source_files ?? [])];
    const sourceNames = sourcePaths.map((name) => path.posix.basename(name));
    const exactInternal = JSON.stringify([...internalNames].sort()) === JSON.stringify([...REQUIRED_INTERNAL].sort())
      && JSON.stringify(Object.keys(manifest.internal_file_sha256 ?? {}).sort()) === JSON.stringify([...REQUIRED_INTERNAL].sort());
    const exactSources = sourcePaths.every((name) => name === `source/${path.posix.basename(name)}`)
      && new Set(sourceNames.map((name) => name.toLowerCase())).size === sourceNames.length
      && JSON.stringify(Object.keys(manifest.source_sha256 ?? {}).sort()) === JSON.stringify([...sourceNames].sort());
    const expectedEntries = new Set(["package-manifest.json", ...REQUIRED_INTERNAL, ...sourcePaths]);
    const exactEntries = originalNames.length === expectedEntries.size && originalNames.every((name) => expectedEntries.has(name));
    if (!exactInternal || !exactSources || !exactEntries) errors.push("package_inventory_mismatch");
    for (const sourcePath of manifest.source_files ?? []) {
      const entry = entries.get(sourcePath);
      if (!entry) { errors.push("source_file_missing"); continue; }
      const sourceName = path.posix.basename(sourcePath);
      if (sha256(entry) !== manifest.source_sha256[sourceName]) errors.push("source_sha_mismatch");
    }
    for (const name of manifest.internal_files ?? []) {
      const entry = entries.get(name);
      if (!entry) { errors.push("internal_file_missing"); continue; }
      if (sha256(entry) !== manifest.internal_file_sha256[name]) errors.push("internal_sha_mismatch");
    }
    const contractEntry = entries.get("execution-contract.json");
    if (!contractEntry) errors.push("contract_missing");
    else {
      const contract = JSON.parse(contractEntry.toString("utf8"));
      const schema = JSON.parse(await readFile(new URL("../schemas/execution-contract.schema.json", import.meta.url), "utf8"));
      const Ajv2020Constructor = Ajv2020 as unknown as new (options: Record<string, unknown>) => { compile(schema: unknown): (value: unknown) => boolean };
      const validate = new Ajv2020Constructor({ allErrors: true, strict: true }).compile(schema);
      if (!validate(contract)) errors.push("contract_schema_invalid");
      else {
        if (contract.cases.length !== manifest.source_case_count) errors.push("case_count_mismatch");
        const ids = contract.cases.map((item: { source_case_id: string }) => item.source_case_id);
        if (JSON.stringify(ids) !== JSON.stringify(manifest.source_case_ids)) errors.push("case_ids_mismatch");
        const unresolvedCount = contract.cases.reduce((count: number, item: { unresolved: unknown[] }) => count + item.unresolved.length, 0);
        const expectedStatus = unresolvedCount === 0 ? "READY" : "NOT_READY";
        if (manifest.unresolved_count !== unresolvedCount || manifest.package_status !== expectedStatus) errors.push("package_status_mismatch");
        const expectedPackageId = sha256(stableJson(manifest.source_sha256) + stableJson(contract)).slice(0, 32);
        if (manifest.package_id !== expectedPackageId) errors.push("package_id_mismatch");
        const primarySourcePath = manifest.source_files[0];
        const primarySource = primarySourcePath ? entries.get(primarySourcePath) : null;
        if (!primarySource) errors.push("source_file_missing");
        else {
          const inspectedSource = await inspectWorkbookBytes(primarySource);
          const sourceIds = inspectedSource.case_ids;
          const contractCaseIds = contract.cases.map((item: { case_id: string }) => item.case_id);
          if (sourceIds.length !== contract.cases.length) errors.push("source_contract_case_count_mismatch");
          if (JSON.stringify(sourceIds) !== JSON.stringify(ids) || JSON.stringify(sourceIds) !== JSON.stringify(contractCaseIds)) {
            errors.push("source_contract_case_ids_mismatch");
          }
          const mappingEntry = entries.get("source-mapping.json");
          if (!mappingEntry) errors.push("source_mapping_mismatch");
          else {
            const sourceMapping = JSON.parse(mappingEntry.toString("utf8")) as { cases?: Array<Record<string, unknown>> };
            const mappingMatches = Array.isArray(sourceMapping.cases)
              && sourceMapping.cases.length === inspectedSource.cases.length
              && sourceMapping.cases.every((mapping, index) => {
                const source = inspectedSource.cases[index];
                const contractCase = contract.cases[index] as { case_id: string; source_case_id: string; source_sheet: string } | undefined;
                return source !== undefined && contractCase !== undefined
                  && mapping.source_case_id === source.case_id
                  && mapping.case_id === source.case_id
                  && mapping.source_sheet === source.source_sheet
                  && mapping.source_row === source.source_row
                  && contractCase.source_case_id === source.case_id
                  && contractCase.case_id === source.case_id
                  && contractCase.source_sheet === source.source_sheet;
              });
            if (!mappingMatches) errors.push("source_mapping_mismatch");
          }
        }
      }
    }
    if (manifest.secret_values_included !== false) errors.push("secret_flag_invalid");
  } catch (error) {
    errors.push(error instanceof Error ? error.message.split(":", 1)[0]! : "package_invalid");
  }
  return {
    valid: errors.length === 0,
    package_status: manifest?.package_status ?? null,
    manifest,
    errors: [...new Set(errors)],
    trust_status: "untrusted",
    publisher_authenticated: false,
    execution_authorized: false,
  };
}

export async function loadExecutionPackage(packagePath: string, options: { requireReady?: boolean } = {}) {
  const validationStarted = performance.now();
  const validation = await validatePackage(packagePath);
  const package_validation_ms = performance.now() - validationStarted;
  if (!validation.valid || !validation.manifest) throw new Error(`package_invalid: ${validation.errors.join(",")}`);
  if (options.requireReady !== false && validation.package_status !== "READY") throw new Error("package_not_ready");
  const loadingStarted = performance.now();
  const bytes = await readFile(packagePath);
  const { entries } = await extractZipEntriesBounded(bytes);
  const contract = JSON.parse(entries.get("execution-contract.json")!.toString("utf8")) as { contract_version: "1.0.0"; cases: import("./types.js").ContractCase[] };
  const sourceMapping = JSON.parse(entries.get("source-mapping.json")!.toString("utf8")) as { cases: Array<{ source_case_id: string; case_id: string; source_sheet: string; source_row: number }> };
  const sourceFiles = new Map<string, Buffer>();
  for (const sourcePath of validation.manifest.source_files) sourceFiles.set(sourcePath, Buffer.from(entries.get(sourcePath)!));
  return {
    manifest: validation.manifest,
    contract,
    sourceMapping,
    sourceFiles,
    package_sha256: sha256(bytes),
    timings: { package_validation_ms, contract_loading_ms: performance.now() - loadingStarted },
  };
}

export async function diffPackage(input: string, packagePath: string) {
  const validation = await validatePackage(packagePath);
  if (!validation.manifest) return { stale: true, valid: false, errors: validation.errors };
  const name = path.basename(input);
  const actual = sha256(await readFile(input));
  const expected = validation.manifest.source_sha256[name];
  return { stale: !expected || actual !== expected, valid: validation.valid, expected_sha256: expected ?? null, actual_sha256: actual, errors: validation.errors };
}
