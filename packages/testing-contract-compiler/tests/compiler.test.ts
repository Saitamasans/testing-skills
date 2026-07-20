import assert from "node:assert/strict";
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import {
  compilePackage,
  diffPackage,
  inspectWorkbook,
  validatePackage,
  validateZipEntries,
} from "../src/index.js";
import { sha256, stableJson } from "../src/crypto.js";

const TEN_COLUMNS = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果"];
const ELEVEN_COLUMNS = ["序号", ...TEN_COLUMNS];

async function fixture(headers = TEN_COLUMNS, rows: unknown[][] = [[
  "LOGIN-001", "登录", "登录页控件", "登录页", "匿名登录页", "查看用户名、密码和登录按钮", "控件可见", "P0", "尚未执行", "未执行",
]]) {
  const root = await mkdtemp(path.join(tmpdir(), "compiler-test-"));
  const input = path.join(root, "cases.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("测试用例");
  sheet.addRow(headers);
  for (const row of rows) sheet.addRow(row);
  await workbook.xlsx.writeFile(input);
  return { root, input, output: path.join(root, "cases.execution-package.zip") };
}

function replaceEntryName(bytes: Buffer, from: string, to: string): Buffer {
  assert.equal(Buffer.byteLength(from), Buffer.byteLength(to));
  const result = Buffer.from(bytes);
  const source = Buffer.from(from);
  const replacement = Buffer.from(to);
  let offset = 0;
  let replacements = 0;
  while ((offset = result.indexOf(source, offset)) >= 0) {
    replacement.copy(result, offset);
    offset += source.length;
    replacements += 1;
  }
  assert.ok(replacements >= 2, "local and central ZIP names were both replaced");
  return result;
}

function patchCentralDeclaredSize(bytes: Buffer, entryName: string, size: number): Buffer {
  const result = Buffer.from(bytes);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  while ((offset = result.indexOf(signature, offset)) >= 0) {
    const nameLength = result.readUInt16LE(offset + 28);
    const name = result.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === entryName) {
      result.writeUInt32LE(size, offset + 24);
      return result;
    }
    offset += 46 + nameLength + result.readUInt16LE(offset + 30) + result.readUInt16LE(offset + 32);
  }
  throw new Error(`central entry not found: ${entryName}`);
}

function patchCentralExternalAttributes(bytes: Buffer, entryName: string, attributes: number): Buffer {
  const result = Buffer.from(bytes);
  const signature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = 0;
  while ((offset = result.indexOf(signature, offset)) >= 0) {
    const nameLength = result.readUInt16LE(offset + 28);
    const name = result.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (name === entryName) {
      result.writeUInt32LE(attributes, offset + 38);
      return result;
    }
    offset += 46 + nameLength + result.readUInt16LE(offset + 30) + result.readUInt16LE(offset + 32);
  }
  throw new Error(`central entry not found: ${entryName}`);
}

async function replaceContractAndSelfHashes(packagePath: string, change: (contract: any) => void): Promise<void> {
  const zip = await JSZip.loadAsync(await readFile(packagePath));
  const contract = JSON.parse(await zip.file("execution-contract.json")!.async("string"));
  const manifest = JSON.parse(await zip.file("package-manifest.json")!.async("string"));
  change(contract);
  const contractBytes = Buffer.from(stableJson(contract));
  zip.file("execution-contract.json", contractBytes);
  manifest.internal_file_sha256["execution-contract.json"] = sha256(contractBytes);
  manifest.source_case_count = contract.cases.length;
  manifest.source_case_ids = contract.cases.map((item: { source_case_id: string }) => item.source_case_id);
  manifest.package_id = sha256(stableJson(manifest.source_sha256) + stableJson(contract)).slice(0, 32);
  zip.file("package-manifest.json", stableJson(manifest));
  await writeFile(packagePath, await zip.generateAsync({ type: "nodebuffer", platform: "UNIX" }));
}

test("inspect parses standard ten-column workbook", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const result = await inspectWorkbook(f.input);
  assert.equal(result.format, "standard_10");
  assert.equal(result.requires_confirmation, false);
  assert.deepEqual(result.case_ids, ["LOGIN-001"]);
});

test("inspect parses standard eleven-column workbook", async (t) => {
  const f = await fixture(ELEVEN_COLUMNS, [[1, "LOGIN-001", "登录", "登录页控件", "登录页", "匿名登录页", "查看控件", "控件可见", "P0", "尚未执行", "未执行"]]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  assert.equal((await inspectWorkbook(f.input)).format, "standard_11");
});

test("non-standard workbook requires confirmed mapping", async (t) => {
  const f = await fixture(["编号", "名称", "步骤说明", "结果说明"], [["A-1", "示例", "打开页面", "页面可见"]]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const inspected = await inspectWorkbook(f.input);
  assert.equal(inspected.requires_confirmation, true);
  await assert.rejects(() => compilePackage({ input: f.input, output: f.output }), /field_mapping_confirmation_required/);
});

test("duplicate case ids are rejected", async (t) => {
  const row = ["DUP-1", "模块", "标题", "功能", "起始页", "动作", "预期", "P1", "", "未执行"];
  const f = await fixture(TEN_COLUMNS, [row, row]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(() => inspectWorkbook(f.input), /duplicate_case_id/);
});

test("missing expectation produces one NOT_READY package without loose files", async (t) => {
  const f = await fixture(TEN_COLUMNS, [["A-1", "模块", "标题", "功能", "起始页", "动作", "", "P1", "", "未执行"]]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const result = await compilePackage({ input: f.input, output: f.output });
  assert.equal(result.package_status, "NOT_READY");
  assert.deepEqual((await readdir(f.root)).sort(), ["cases.execution-package.zip", "cases.xlsx"]);
  const zip = await JSZip.loadAsync(await readFile(f.output));
  assert.ok(zip.file("unresolved-items.xlsx"));
});

test("flow groups are never inferred from case order or ids", async (t) => {
  const f = await fixture(TEN_COLUMNS, [
    ["FLOW-001", "模块", "相似标题一", "功能", "起始页", "动作", "预期", "P1", "", "未执行"],
    ["FLOW-002", "模块", "相似标题二", "功能", "起始页", "动作", "预期", "P1", "", "未执行"],
  ]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  const zip = await JSZip.loadAsync(await readFile(f.output));
  const contract = JSON.parse(await zip.file("execution-contract.json")!.async("string"));
  assert.deepEqual(contract.cases.map((item: { priority: string }) => item.priority), ["P1", "P1"]);
  assert.deepEqual(contract.cases.map((item: { flow_group: string | null }) => item.flow_group), [null, null]);
  assert.deepEqual(contract.cases.map((item: { isolation_scope: string }) => item.isolation_scope), ["case", "case"]);
});

test("cyclic explicit dependencies are rejected", async (t) => {
  const f = await fixture(TEN_COLUMNS, [
    ["A", "模块", "A", "功能", "起始页", "动作", "预期", "P1", "", "未执行"],
    ["B", "模块", "B", "功能", "起始页", "动作", "预期", "P1", "", "未执行"],
  ]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(() => compilePackage({
    input: f.input,
    output: f.output,
    overrides: { A: { dependencies: ["B"] }, B: { dependencies: ["A"] } },
  }), /dependency_cycle/);
});

test("unknown dependencies, inconsistent flow groups and exclusive lock conflicts are rejected", async (t) => {
  const rows = [
    ["A", "模块", "A", "功能", "起始页", "动作", "预期", "P1", "", "未执行"],
    ["B", "模块", "B", "功能", "起始页", "动作", "预期", "P1", "", "未执行"],
  ];
  const f = await fixture(TEN_COLUMNS, rows);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(() => compilePackage({ input: f.input, output: f.output, overrides: { A: { dependencies: ["MISSING"] } } }), /dependency_unknown/);
  await assert.rejects(() => compilePackage({ input: f.input, output: f.output, overrides: { A: { isolation_scope: "flow_group", flow_group: null } } }), /flow_group_inconsistent/);
  await assert.rejects(() => compilePackage({ input: f.input, output: f.output, overrides: {
    A: { resource_locks: [{ resource: "account:shared", mode: "exclusive" }] },
    B: { resource_locks: [{ resource: "account:shared", mode: "exclusive" }] },
  } }), /resource_lock_conflict/);
});

test("ZIP traversal and case-insensitive duplicate names are rejected", async () => {
  assert.throws(() => validateZipEntries(["../escape.json"]), /zip_path_unsafe/);
  assert.throws(() => validateZipEntries(["/absolute.json"]), /zip_path_unsafe/);
  assert.throws(() => validateZipEntries(["C:/absolute.json"]), /zip_path_unsafe/);
  assert.throws(() => validateZipEntries(["A.json", "a.JSON"]), /zip_path_case_duplicate/);
});

test("tampered internal hash is rejected", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  const zip = await JSZip.loadAsync(await readFile(f.output));
  zip.file("execution-contract.json", "{}");
  await writeFile(f.output, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await validatePackage(f.output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("internal_sha_mismatch"));
});

test("self-consistent replacement of contract, internal hash and manifest remains untrusted", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  await replaceContractAndSelfHashes(f.output, (contract) => {
    contract.cases[0].title = "attacker-controlled title";
  });

  const result = await validatePackage(f.output);
  assert.equal(result.valid, true, "internal consistency can still validate after coordinated replacement");
  assert.equal(result.trust_status, "untrusted");
  assert.equal(result.publisher_authenticated, false);
  assert.equal(result.execution_authorized, false);
});

test("source and contract case IDs are compared against independently parsed source content", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  await replaceContractAndSelfHashes(f.output, (contract) => {
    contract.cases[0].case_id = "REPLACED-001";
    contract.cases[0].source_case_id = "REPLACED-001";
  });

  const result = await validatePackage(f.output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("source_contract_case_ids_mismatch"));
});

test("source and contract counts are compared against independently parsed source content", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  await replaceContractAndSelfHashes(f.output, (contract) => {
    const extra = structuredClone(contract.cases[0]);
    extra.case_id = "EXTRA-001";
    extra.source_case_id = "EXTRA-001";
    extra.actions[0].action_id = "EXTRA-001-A1";
    extra.assertions[0].assertion_id = "EXTRA-001-E1";
    contract.cases.push(extra);
  });

  const result = await validatePackage(f.output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("source_contract_case_count_mismatch"));
});

test("ZIP metadata rejects links, reparse indicators, bombs, oversized declarations and duplicate critical files", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  const original = await readFile(f.output);

  const linked = await JSZip.loadAsync(original);
  linked.file("link-to-contract", "execution-contract.json", { unixPermissions: 0o120777 });
  await writeFile(f.output, await linked.generateAsync({ type: "nodebuffer", platform: "UNIX" }));
  assert.ok((await validatePackage(f.output)).errors.includes("zip_link_forbidden"));

  const reparse = await JSZip.loadAsync(original);
  reparse.file("reparse-entry", "target");
  const reparseBytes = await reparse.generateAsync({ type: "nodebuffer", platform: "DOS" });
  await writeFile(f.output, patchCentralExternalAttributes(reparseBytes, "reparse-entry", 0x400));
  assert.ok((await validatePackage(f.output)).errors.includes("zip_reparse_forbidden"));

  const bomb = await JSZip.loadAsync(original);
  bomb.file("bomb.txt", Buffer.alloc(2 * 1024 * 1024, 0));
  await writeFile(f.output, await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
  assert.ok((await validatePackage(f.output)).errors.includes("zip_compression_ratio_exceeded"));

  await writeFile(f.output, patchCentralDeclaredSize(original, "execution-contract.json", 32 * 1024 * 1024 + 1));
  assert.ok((await validatePackage(f.output)).errors.includes("zip_entry_too_large"));

  await writeFile(f.output, patchCentralDeclaredSize(original, "execution-contract.json", 0xffffffff));
  assert.ok((await validatePackage(f.output)).errors.includes("zip_declared_size_invalid"));

  const duplicate = await JSZip.loadAsync(original);
  duplicate.file("aaaaaaaaaaaaaaaa.json", "duplicate manifest");
  const duplicateBytes = await duplicate.generateAsync({ type: "nodebuffer" });
  await writeFile(f.output, replaceEntryName(duplicateBytes, "aaaaaaaaaaaaaaaa.json", "package-manifest.json"));
  assert.ok((await validatePackage(f.output)).errors.includes("zip_critical_file_duplicate"));
});

test("package content scan rejects credentials and private material without logging values", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  const zip = await JSZip.loadAsync(await readFile(f.output));
  zip.file("notes.txt", "token=DO-NOT-LOG-THIS\n-----BEGIN PRIVATE KEY-----\nmaterial");
  await writeFile(f.output, await zip.generateAsync({ type: "nodebuffer" }));

  const result = await validatePackage(f.output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("secret_value_forbidden"));
  assert.doesNotMatch(result.errors.join("\n"), /DO-NOT-LOG-THIS|PRIVATE KEY/);
});

test("script entries are inert and rejected without execution", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  const marker = path.join(f.root, "script-executed.txt");
  const zip = await JSZip.loadAsync(await readFile(f.output));
  zip.file("postinstall.js", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`);
  await writeFile(f.output, await zip.generateAsync({ type: "nodebuffer" }));

  const result = await validatePackage(f.output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("zip_script_forbidden"));
  await assert.rejects(() => access(marker), /ENOENT/);
});

test("manifest cannot flip NOT_READY to READY or omit fixed inventory", async (t) => {
  const f = await fixture(TEN_COLUMNS, [["A-1", "模块", "标题", "功能", "起始页", "动作", "", "P1", "", "未执行"]]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  const zip = await JSZip.loadAsync(await readFile(f.output));
  const manifest = JSON.parse(await zip.file("package-manifest.json")!.async("string"));
  manifest.package_status = "READY";
  manifest.internal_files = manifest.internal_files.filter((name: string) => name !== "unresolved-items.xlsx");
  delete manifest.internal_file_sha256["unresolved-items.xlsx"];
  zip.file("package-manifest.json", JSON.stringify(manifest));
  await writeFile(f.output, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await validatePackage(f.output);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("package_inventory_mismatch"));
  assert.ok(result.errors.includes("package_status_mismatch"));
});

test("identical inputs produce byte-identical packages", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const second = path.join(f.root, "second.execution-package.zip");
  await compilePackage({ input: f.input, output: f.output });
  await compilePackage({ input: f.input, output: second });
  assert.deepEqual(await readFile(f.output), await readFile(second));
});

test("source changes make the package stale", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({ input: f.input, output: f.output });
  await writeFile(f.input, Buffer.concat([await readFile(f.input), Buffer.from("changed")]));
  const result = await diffPackage(f.input, f.output);
  assert.equal(result.stale, true);
});

test("credential references keep env names and reject secret values", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await compilePackage({
    input: f.input,
    output: f.output,
    overrides: { "LOGIN-001": { auth_profile: { id: "normal_user", strategy: "environment", credential_refs: { username_env: "SAITAMA_TEST_USERNAME", password_env: "SAITAMA_TEST_PASSWORD" } } } },
  });
  const zip = await JSZip.loadAsync(await readFile(f.output));
  const contract = await zip.file("execution-contract.json")!.async("string");
  assert.match(contract, /SAITAMA_TEST_PASSWORD/);
  assert.doesNotMatch(contract, /actual-secret-value/);
  await assert.rejects(() => compilePackage({
    input: f.input,
    output: path.join(f.root, "leak.execution-package.zip"),
    overrides: { "LOGIN-001": { auth_profile: { id: "normal_user", strategy: "inline", credential_refs: { password: "actual-secret-value" } } } },
  }), /secret_value_forbidden/);
});

test("inline credential values in source cases are rejected without echoing values", async (t) => {
  const f = await fixture(TEN_COLUMNS, [["LEAK-1", "模块", "标题", "功能", "password=do-not-persist", "动作", "预期", "P1", "", "未执行"]]);
  t.after(() => rm(f.root, { recursive: true, force: true }));
  await assert.rejects(
    () => compilePackage({ input: f.input, output: f.output }),
    (error: unknown) => error instanceof Error && error.message === "secret_value_forbidden" && !error.message.includes("do-not-persist"),
  );
});

test("compiler temp directories are cleaned after success and failure", async (t) => {
  const f = await fixture();
  t.after(() => rm(f.root, { recursive: true, force: true }));
  const stagingParent = path.join(f.root, "staging");
  await compilePackage({ input: f.input, output: f.output, stagingParent });
  assert.deepEqual(await readdir(stagingParent), []);
  await assert.rejects(() => compilePackage({ input: path.join(f.root, "missing.xlsx"), output: path.join(f.root, "failed.zip"), stagingParent }));
  assert.deepEqual(await readdir(stagingParent), []);
});
