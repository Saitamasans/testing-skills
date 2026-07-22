import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import ExcelJS from "exceljs";

import { runApproveCommand } from "../src/commands/approve.js";
import { runPlanCommand } from "../src/commands/plan.js";
import { TEN_COLUMNS } from "../src/input/detect-input.js";
import { createApproval, verifyApproval } from "../src/security/approval.js";
import { normalizeTargetOrigins } from "../src/security/target-scope.js";
import { canonicalize, sha256Canonical } from "../src/compiler/canonical-json.js";
import { classifyRisk } from "../src/compiler/risk-classifier.js";
import { compileManifest } from "../src/compiler/manifest-compiler.js";
import { validateDocument } from "../src/schema-registry.js";
import type {
  ExecutionProfile,
  ManifestAction,
  NormalizedCase,
  NormalizedCaseSet,
  RunManifest,
  TenColumnName,
} from "../src/types.js";

const CASE_ID = TEN_COLUMNS[0];
const MODULE = TEN_COLUMNS[1];
const TITLE = TEN_COLUMNS[2];
const FEATURE = TEN_COLUMNS[3];
const PRECONDITION = TEN_COLUMNS[4];
const STEPS = TEN_COLUMNS[5];
const EXPECTED = TEN_COLUMNS[6];
const PRIORITY = TEN_COLUMNS[7];
const STATUS = TEN_COLUMNS[8];
const REMARK = TEN_COLUMNS[9];

type ProfileWithPlans = ExecutionProfile & {
  case_plans: Record<string, ManifestAction[]>;
  rule_versions?: string[];
  risk_contexts?: Record<string, {
    effect?: "business_write" | "asset_deduction" | "award_issuance" | "configuration_change" | "external_notification" | "irreversible";
    data_sensitivity?: "normal" | "sensitive";
    shared_data?: boolean;
    high_privilege?: boolean;
    mixed_target?: boolean;
    environment_label?: string;
  }>;
};

type CompiledManifest = RunManifest & {
  targets: string[];
  rule_versions: string[];
};

async function writeNativeReportFixture(directory: string): Promise<string> {
  const file = path.join(directory, "report.json");
  const rowValues = TEN_COLUMNS.map((column) => values("API-001")[column]);
  rowValues[8] = "未执行";
  await writeFile(file, JSON.stringify({
    title: "runner plan",
    generated_at: "2026-07-15T00:00:00.000Z",
    skill_invocation: "single-api-test-full",
    sheets: [
      {
        name: "Cases",
        kind: "test_cases",
        columns: TEN_COLUMNS,
        rows: [
          { values: rowValues },
        ],
      },
    ],
  }, null, 2), "utf8");
  return file;
}

async function writeProfileFixture(directory: string, actionRisk: "R1" | "R3" = "R1"): Promise<string> {
  const file = path.join(directory, "profile.json");
  await writeFile(file, JSON.stringify({
    protocol_version: "1.0.0",
    profile_id: "local",
    targets: {
      api: { kind: "api", origin: "https://api.example.test/" },
    },
    credentials: {
      api_admin: { source: "env", name: "TESTING_API_ADMIN_TOKEN" },
    },
    rule_versions: ["1.0.0"],
    case_plans: {
      "API-001": [
        {
          type: "api.request",
          action_id: actionRisk === "R3" ? "API-001-award" : "API-001-request",
          target_alias: "api",
          method: "POST",
          path: actionRisk === "R3" ? "/award-points" : "/orders",
          input_ref: { source: "fixture", name: "order_payload" },
          risk: actionRisk,
        },
        {
          type: "api.assert",
          action_id: "API-001-assert",
          target_alias: "api",
          assertion: "status is 201",
          risk: "R0",
        },
      ],
    },
  }, null, 2), "utf8");
  return file;
}

async function writeNonstandardExcelFixture(directory: string): Promise<string> {
  const file = path.join(directory, "nonstandard.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Cases");
  sheet.addRow(["编号", "模块", "标题", "步骤", "预期", "优先级", "执行状态"]);
  sheet.addRow(["API-001", "orders", "create order", "POST /orders", "201 created", "P0", "未执行"]);
  await workbook.xlsx.writeFile(file);
  return file;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8")) as unknown;
}

function values(id: string): Record<TenColumnName, string> {
  return {
    [CASE_ID]: id,
    [MODULE]: "orders",
    [TITLE]: `case ${id}`,
    [FEATURE]: "order flow",
    [PRECONDITION]: "fixture order exists",
    [STEPS]: "execute declared manifest actions",
    [EXPECTED]: "expected assertions pass",
    [PRIORITY]: "P0",
    [STATUS]: "",
    [REMARK]: "",
  };
}

function normalizedCase(id: string, row: number): NormalizedCase {
  const caseValues = values(id);
  return {
    id,
    values: caseValues,
    raw_values: TEN_COLUMNS.map((column) => caseValues[column]),
    source: `Cases!${row}`,
    source_sheet: "Cases",
    source_row: row,
    divider: false,
    extensions: {},
    original_status: "",
    status: caseValues[STATUS] as never,
  };
}

function caseSet(): NormalizedCaseSet {
  return {
    columns: [...TEN_COLUMNS],
    cases: [normalizedCase("API-001", 2), normalizedCase("API-002", 3)],
    source_snapshot: {
      absolute_path: "C:/safe/report.json",
      sha256: "a".repeat(64),
      size: 256,
      modified_at: "2026-07-15T00:00:00.000Z",
      input_kind: "native-report",
      sheet_names: ["Cases"],
    },
  };
}

function profile(): ProfileWithPlans {
  return {
    protocol_version: "1.0.0",
    profile_id: "local",
    targets: {
      api: { kind: "api", origin: "https://api.example.test/" },
      shared_db: {
        kind: "database",
        dialect: "postgresql",
        host: "prod-db.example.test",
        database: "customer_prod",
      },
    },
    credentials: {
      api_admin: { source: "env", name: "TESTING_API_ADMIN_TOKEN" },
    },
    rule_versions: ["1.0.0"],
    case_plans: {
      "API-001": [
        {
          type: "api.request",
          action_id: "API-001-request",
          target_alias: "api",
          method: "POST",
          path: "/orders",
          input_ref: { source: "fixture", name: "order_payload" },
          risk: "R1",
          retry_eligible: false,
        },
        {
          type: "api.assert",
          action_id: "API-001-assert",
          target_alias: "api",
          assertion: "status is 201",
          risk: "R0",
        },
        {
          type: "cleanup.api",
          action_id: "API-001-cleanup",
          target_alias: "api",
          method: "DELETE",
          path: "/orders/created",
          risk: "R1",
        },
      ],
      "API-002": [
        {
          type: "db.select",
          action_id: "API-002-db",
          target_alias: "shared_db",
          query: "SELECT id FROM customers WHERE id = $1",
          params_ref: { source: "fixture", name: "customer_query" },
          limit: 1,
          risk: "R2",
        },
      ],
    },
  };
}

test("canonical JSON sorts object keys recursively and preserves array order", () => {
  assert.equal(
    canonicalize({ b: 1, a: [{ z: 2, y: 1 }, "x"] }),
    '{"a":[{"y":1,"z":2},"x"],"b":1}',
  );
  assert.match(sha256Canonical({ b: 1, a: 2 }), /^[a-f0-9]{64}$/);
});

test("manifest compilation is deterministic and preserves source row order", () => {
  const manifest = compileManifest(caseSet(), profile()) as CompiledManifest;
  const cloned = compileManifest(structuredClone(caseSet()), structuredClone(profile())) as CompiledManifest;

  assert.equal(sha256Canonical(manifest), sha256Canonical(cloned));
  assert.deepEqual(manifest.cases.map(({ case_id }) => case_id), ["API-001", "API-002"]);
  assert.deepEqual(manifest.targets, ["https://api.example.test"]);
  assert.deepEqual(manifest.rule_versions, ["1.0.0"]);
  assert.equal(validateDocument("run-manifest", manifest), manifest);
});

test("manifest compiler rejects undeclared actions instead of compiling free text", () => {
  const unsafeProfile = profile();
  delete unsafeProfile.case_plans["API-002"];
  assert.throws(() => compileManifest(caseSet(), unsafeProfile), /No declared actions for case API-002/);
});

test("risk classification uses actual effects and cannot be lowered by test-like labels", () => {
  const read = classifyRisk(
    { type: "api.request", action_id: "read", target_alias: "api", method: "GET", path: "/orders", risk: "R0" },
    { target: { kind: "api", origin: "https://api.example.test" }, environment_label: "production" },
  );
  assert.equal(read.level, "R0");

  const readConfig = classifyRisk(
    { type: "api.request", action_id: "read-config", target_alias: "api", method: "GET", path: "/config/public", risk: "R0" },
    { target: { kind: "api", origin: "https://api.example.test" }, environment_label: "production" },
  );
  assert.equal(readConfig.level, "R0");

  const assertConfig = classifyRisk(
    { type: "api.assert", action_id: "assert-config", target_alias: "api", assertion: "status is 200", risk: "R0" },
    { target: { kind: "api", origin: "https://api.example.test" }, environment_label: "production" },
  );
  assert.equal(assertConfig.level, "R0");

  const testDomainSensitiveDb = classifyRisk(
    {
      type: "db.select",
      action_id: "db",
      target_alias: "shared_db",
      query: "SELECT id FROM customers",
      risk: "R0",
    },
    {
      target: {
        kind: "database",
        dialect: "postgresql",
        host: "db.test.example",
        database: "customer_prod",
      },
      environment_label: "test",
      data_sensitivity: "sensitive",
      shared_data: true,
    },
  );
  assert.equal(testDomainSensitiveDb.level, "R2");

  const irreversible = classifyRisk(
    {
      type: "api.request",
      action_id: "award",
      target_alias: "api",
      method: "POST",
      path: "/award-points",
      risk: "R0",
    },
    { target: { kind: "api", origin: "https://api.example.test" }, effect: "asset_deduction" },
  );
  assert.equal(irreversible.level, "R3");
});

test("approval locks manifest, source, target, runner and rule versions", () => {
  const manifest = compileManifest(caseSet(), profile()) as CompiledManifest;
  manifest.contract_version = "1.0.0";
  manifest.package_id = "package-001";
  manifest.package_sha256 = "b".repeat(64);
  const approval = createApproval({
    manifest,
    issued_by: "qa-owner",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2999-07-15T01:00:00.000Z",
    approved_risks: ["R0", "R1", "R2"],
    approved_r3_action_ids: [],
  });

  assert.equal(validateDocument("approval", approval), approval);
  assert.equal(approval.manifest_sha256, sha256Canonical(manifest));
  assert.equal(approval.package_sha256, manifest.package_sha256);
  assert.equal(verifyApproval(manifest, approval, "interactive").status, "approved");

  const changedAction = structuredClone(manifest);
  changedAction.cases[0]!.steps[0]!.risk = "R2";
  assert.match(verifyApproval(changedAction, approval, "interactive").reasons.join("\n"), /manifest changed/i);

  const changedTarget = structuredClone(manifest) as CompiledManifest;
  changedTarget.targets[0] = "https://other.example.test";
  assert.match(verifyApproval(changedTarget, approval, "interactive").reasons.join("\n"), /target/i);

  const changedRunner = structuredClone(manifest);
  changedRunner.runner.version = "1.0.1" as never;
  assert.match(verifyApproval(changedRunner, approval, "interactive").reasons.join("\n"), /runner/i);

  const changedRuleVersion = structuredClone(manifest) as CompiledManifest;
  changedRuleVersion.rule_versions[0] = "2.0.0";
  assert.match(verifyApproval(changedRuleVersion, approval, "interactive").reasons.join("\n"), /rule/i);

  const stalePackage = structuredClone(manifest);
  stalePackage.package_sha256 = "c".repeat(64);
  assert.match(verifyApproval(stalePackage, approval, "interactive").reasons.join("\n"), /package SHA-256 mismatch/i);

  const downgradedManifest = structuredClone(manifest);
  delete downgradedManifest.package_sha256;
  const downgradedApproval = structuredClone(approval);
  delete downgradedApproval.package_sha256;
  downgradedApproval.manifest_hash = sha256Canonical(downgradedManifest);
  downgradedApproval.manifest_sha256 = downgradedApproval.manifest_hash;
  assert.throws(() => validateDocument("run-manifest", downgradedManifest), /package_sha256/);
  assert.throws(() => createApproval({
    manifest: downgradedManifest,
    issued_by: "qa-owner",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2999-07-15T01:00:00.000Z",
    approved_risks: ["R0", "R1", "R2"],
    approved_r3_action_ids: [],
  }), /package SHA-256 required/i);
  assert.match(verifyApproval(downgradedManifest, downgradedApproval, "interactive").reasons.join("\n"), /package SHA-256 required/i);
});

test("CI approval accepts only locked R0/R1 and R3 requires explicit action approval", () => {
  const manifest = compileManifest(caseSet(), profile()) as CompiledManifest;
  const r2Approval = createApproval({
    manifest,
    issued_by: "qa-owner",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2999-07-15T01:00:00.000Z",
    approved_risks: ["R0", "R1", "R2"],
    approved_r3_action_ids: [],
  });
  assert.equal(verifyApproval(manifest, r2Approval, "ci").status, "blocked");

  const r3Manifest = structuredClone(manifest) as CompiledManifest;
  r3Manifest.cases[0]!.steps.push({
    type: "api.request",
    action_id: "API-001-award",
    target_alias: "api",
    method: "POST",
    path: "/award-points",
    risk: "R3",
  });
  const missingR3 = createApproval({
    manifest: r3Manifest,
    issued_by: "qa-owner",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2999-07-15T01:00:00.000Z",
    approved_risks: ["R0", "R1", "R2", "R3"],
    approved_r3_action_ids: [],
  });
  assert.match(verifyApproval(r3Manifest, missingR3, "interactive").reasons.join("\n"), /R3 action/i);

  const namedR3 = createApproval({
    manifest: r3Manifest,
    issued_by: "qa-owner",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2999-07-15T01:00:00.000Z",
    approved_risks: ["R0", "R1", "R2", "R3"],
    approved_r3_action_ids: ["API-001-award"],
  });
  assert.equal(verifyApproval(r3Manifest, namedR3, "interactive").status, "approved");
});

test("approval verification blocks expired approvals", () => {
  const manifest = compileManifest(caseSet(), profile()) as CompiledManifest;
  const expired = createApproval({
    manifest,
    issued_by: "qa-owner",
    issued_at: "2000-01-01T00:00:00.000Z",
    expires_at: "2000-01-01T01:00:00.000Z",
    approved_risks: ["R0", "R1", "R2"],
    approved_r3_action_ids: [],
  });
  assert.match(verifyApproval(manifest, expired, "interactive").reasons.join("\n"), /expired/i);
});

test("manifest compiler passes actual-effect risk context into classification", () => {
  const contextualProfile = profile();
  contextualProfile.risk_contexts = {
    "API-001-request": {
      environment_label: "test",
      effect: "award_issuance",
    },
    "API-002-db": {
      environment_label: "test",
      data_sensitivity: "sensitive",
      shared_data: true,
    },
  };

  const manifest = compileManifest(caseSet(), contextualProfile);
  assert.equal(manifest.cases[0]?.steps[0]?.risk, "R3");
  assert.equal(manifest.cases[1]?.steps[0]?.risk, "R2");
});

test("target origin normalization is deterministic and excludes database hosts from URL approval scope", () => {
  assert.deepEqual(normalizeTargetOrigins(profile().targets), ["https://api.example.test"]);
});

test("plan command writes inspection, readiness, normalized profile, manifest and preview", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-plan-"));
  const input = await writeNativeReportFixture(directory);
  const profileFile = await writeProfileFixture(directory);
  const outputDir = path.join(directory, "out");

  const result = await runPlanCommand({ input, profile: profileFile, outputDir, legacyInput: true });

  assert.equal(result.manifest.cases[0]?.case_id, "API-001");
  for (const fileName of [
    "input-inspection.json",
    "readiness.json",
    "execution-profile.normalized.json",
    "run-manifest.json",
    "execution-preview.md",
  ]) {
    assert.ok(await readJsonOrText(path.join(outputDir, fileName)), fileName);
  }
  const manifestJson = await readJson(path.join(outputDir, "run-manifest.json"));
  assert.equal(validateDocument("run-manifest", manifestJson), manifestJson);
});

test("plan command writes a mapping proposal before blocking nonstandard Excel without approval", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-plan-mapping-"));
  const input = await writeNonstandardExcelFixture(directory);
  const profileFile = await writeProfileFixture(directory);
  const outputDir = path.join(directory, "out");

  await assert.rejects(
    () => runPlanCommand({ input, profile: profileFile, outputDir, legacyInput: true }),
    /mapping-approval/,
  );

  const inspection = await readJson(path.join(outputDir, "input-inspection.json")) as { input_kind?: string };
  assert.equal(inspection.input_kind, "nonstandard-excel");
  const proposal = await readJson(path.join(outputDir, "mapping-proposal.json")) as { proposal_sha256?: string };
  assert.equal(proposal.proposal_sha256?.length, 64);
  await assert.rejects(
    () => readFile(path.join(outputDir, "run-manifest.json"), "utf8"),
    /ENOENT/,
  );
});

test("approve command writes scoped approval and requires explicit R3 action ids", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-approve-"));
  const input = await writeNativeReportFixture(directory);
  const r3Profile = await writeProfileFixture(directory, "R3");
  const outputDir = path.join(directory, "out");
  await runPlanCommand({ input, profile: r3Profile, outputDir, legacyInput: true });
  const manifestFile = path.join(outputDir, "run-manifest.json");
  const approvalFile = path.join(directory, "approval.json");

  await assert.rejects(
    () => runApproveCommand({
      manifest: manifestFile,
      out: approvalFile,
      expiresAt: "2999-07-15T01:00:00.000Z",
      confirmedBy: "trusted-wrapper",
    }),
    /R3 action/,
  );

  const approval = await runApproveCommand({
    manifest: manifestFile,
    out: approvalFile,
    expiresAt: "2999-07-15T01:00:00.000Z",
    approveR3: ["API-001-award"],
    confirmedBy: "trusted-wrapper",
  });
  const approvalJson = await readJson(approvalFile);
  assert.equal(validateDocument("approval", approvalJson), approvalJson);
  assert.deepEqual(approval.approved_r3_action_ids, ["API-001-award"]);
});

async function readJsonOrText(file: string): Promise<unknown> {
  if (file.endsWith(".json")) return readJson(file);
  return readFile(file, "utf8");
}
