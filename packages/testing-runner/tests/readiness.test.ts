import assert from "node:assert/strict";
import test from "node:test";

import { TEN_COLUMNS } from "../src/input/detect-input.js";
import { renderPreparationGuide } from "../src/preparation-guide.js";
import {
  assessReadiness,
  type ExecutionProfileDraft,
  type ReadinessInput,
  type RuntimeProbeReport,
} from "../src/readiness.js";
import type {
  Approval,
  CaseStatus,
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

function original(overrides: Partial<Record<TenColumnName, string>> = {}): RunManifest["cases"][number]["original"] {
  const values = Object.fromEntries(TEN_COLUMNS.map((column) => [column, ""])) as Record<TenColumnName, string>;
  values[CASE_ID] = "API-001";
  values[MODULE] = "orders";
  values[TITLE] = "query order";
  values[FEATURE] = "return order detail";
  values[PRECONDITION] = "order exists";
  values[STEPS] = "send GET /orders/1";
  values[EXPECTED] = "return 200";
  values[PRIORITY] = "P0";
  values[STATUS] = "";
  values[REMARK] = "";
  return { ...values, ...overrides };
}

function normalizedCase(
  id: string,
  overrides: Partial<Record<TenColumnName, string>> = {},
): NormalizedCase {
  const values = original({ [CASE_ID]: id, ...overrides }) as Record<TenColumnName, string>;
  return {
    id,
    values,
    raw_values: TEN_COLUMNS.map((column) => values[column]),
    source: "Cases!2",
    source_sheet: "Cases",
    source_row: 2,
    divider: false,
    extensions: {},
    original_status: values[STATUS],
    status: values[STATUS] as CaseStatus,
  };
}

function caseSet(cases: NormalizedCase[]): NormalizedCaseSet {
  return {
    columns: [...TEN_COLUMNS],
    cases,
    source_snapshot: {
      absolute_path: "C:/safe/report.json",
      sha256: "a".repeat(64),
      size: 128,
      modified_at: "2026-07-15T00:00:00.000Z",
      input_kind: "native-report",
      sheet_names: ["Cases"],
    },
    skill_invocation: "single-api-test-full",
  };
}

function apiManifest(): RunManifest {
  return {
    protocol_version: "1.0.0",
    manifest_id: "manifest-api",
    runner: { version: "1.0.0" },
    source: { path: "report.json", sha256: "a".repeat(64) },
    cases: [
      {
        case_id: "API-001",
        original: original(),
        steps: [
          {
            type: "api.request",
            action_id: "API-001-request",
            target_alias: "api",
            method: "GET",
            path: "/orders/1",
            input_ref: { source: "fixture", name: "order_payload" },
            risk: "R0",
          },
          {
            type: "api.assert",
            action_id: "API-001-assert",
            target_alias: "api",
            assertion: "status is 200",
            risk: "R0",
          },
          {
            type: "cleanup.api",
            action_id: "API-001-cleanup",
            target_alias: "api",
            method: "DELETE",
            path: "/orders/1",
            risk: "R1",
          },
        ],
      },
    ],
  };
}

function publicWebManifest(): RunManifest {
  return {
    ...apiManifest(),
    manifest_id: "manifest-public-web",
    cases: [
      {
        case_id: "WEB-001",
        original: original({ [CASE_ID]: "WEB-001" }),
        steps: [
          {
            type: "web.goto",
            action_id: "WEB-001-open",
            target_alias: "public_web",
            url: "https://docs.example.test",
            risk: "R0",
          },
          {
            type: "web.assert",
            action_id: "WEB-001-assert",
            target_alias: "public_web",
            assertion: "page title is visible",
            risk: "R0",
          },
        ],
      },
    ],
  };
}

function completeProfile(overrides: Partial<ExecutionProfileDraft> = {}): ExecutionProfileDraft {
  return {
    profile_id: "local",
    targets: {
      api: { kind: "api", origin: "https://api.example.test" },
      public_web: { kind: "web", origin: "https://docs.example.test" },
    },
    credentials: {
      api_admin: { source: "env", name: "TESTING_API_ADMIN_TOKEN" },
    },
    data: {
      order_payload: { source: "fixture", name: "order_payload" },
    },
    cleanup_strategies: {
      "API-001": "api",
    },
    public_targets: ["public_web"],
    ...overrides,
  };
}

function approval(): Approval {
  return {
    protocol_version: "1.0.0",
    approval_id: "approval-001",
    manifest_hash: "b".repeat(64),
    source_hash: "a".repeat(64),
    targets: ["https://api.example.test"],
    approved_risks: ["R0", "R1"],
    approved_r3_action_ids: [],
    issued_by: "qa-owner",
    issued_at: "2026-07-15T00:00:00.000Z",
    expires_at: "2026-07-15T01:00:00.000Z",
  };
}

function healthyRuntimeProbe(): RuntimeProbeReport {
  return {
    runner: {
      package: "@saitamasans/testing-runner",
      source: "package.json",
      version: "1.0.0",
      required_version: "1.0.0",
      compatible: true,
      impact: "runner protocol can build the preview",
    },
    node: {
      package: "node",
      source: "process.version",
      version: "v22.15.0",
      required_version: ">=20",
      compatible: true,
      impact: "TypeScript runner can execute",
    },
    browsers: [],
    target_connectivity: [
      {
        target_alias: "api",
        reachable: true,
        impact: "API target can be reached",
      },
    ],
    optional_db_drivers: [],
  };
}

const readyCaseSet = caseSet([normalizedCase("API-001")]);
const readyManifest = apiManifest();
const readyProfile = completeProfile();

test("classifies E0-E4 readiness with runner execution gated until locked approval", () => {
  const cases: Array<{
    name: string;
    input: ReadinessInput;
    level: "E0" | "E1" | "E2" | "E3" | "E4";
    runnerAllowed: boolean;
    blocking: string[];
  }> = [
    {
      name: "E0 has no formal normalized cases",
      input: { case_set: caseSet([]), runtime_probe: healthyRuntimeProbe() },
      level: "E0",
      runnerAllowed: false,
      blocking: ["No normalized formal cases are available."],
    },
    {
      name: "E1 is missing a used target and required auth reference",
      input: {
        case_set: readyCaseSet,
        manifest: readyManifest,
        profile: completeProfile({ targets: {}, credentials: {} }),
        required_targets: [{ alias: "api", kind: "api", example_origin: "https://api.example.test" }],
        required_credentials: [
          {
            alias: "api_admin",
            target_alias: "api",
            kind: "api",
            env: "TESTING_API_ADMIN_TOKEN",
          },
        ],
        runtime_probe: healthyRuntimeProbe(),
      },
      level: "E1",
      runnerAllowed: false,
      blocking: ["Missing target: api", "Missing credential reference: api_admin"],
    },
    {
      name: "E2 has incomplete compile inputs",
      input: {
        case_set: caseSet([
          normalizedCase("API-001", {
            [STEPS]: "",
            [EXPECTED]: "",
          }),
        ]),
        profile: readyProfile,
        compilation_gaps: [
          { case_id: "API-001", kind: "missing_data", name: "order_payload" },
          { case_id: "API-001", kind: "missing_assertion" },
          { case_id: "API-001", kind: "missing_cleanup" },
        ],
        runtime_probe: healthyRuntimeProbe(),
      },
      level: "E2",
      runnerAllowed: false,
      blocking: [
        "API-001: test steps are empty.",
        "API-001: expected result is empty.",
        "API-001: required data fixture order_payload is missing.",
        "API-001: mandatory assertion is missing.",
        "API-001: cleanup strategy is missing.",
      ],
    },
    {
      name: "E3 can show a complete preview but waits for approval",
      input: {
        case_set: readyCaseSet,
        manifest: readyManifest,
        profile: readyProfile,
        required_credentials: [
          {
            alias: "api_admin",
            target_alias: "api",
            kind: "api",
            env: "TESTING_API_ADMIN_TOKEN",
          },
        ],
        runtime_probe: healthyRuntimeProbe(),
      },
      level: "E3",
      runnerAllowed: false,
      blocking: ["Awaiting execution approval for the manifest preview."],
    },
    {
      name: "E4 has locked approval validation",
      input: {
        case_set: readyCaseSet,
        manifest: readyManifest,
        profile: readyProfile,
        approval: approval(),
        approval_validation: { valid: true },
        runtime_probe: healthyRuntimeProbe(),
      },
      level: "E4",
      runnerAllowed: true,
      blocking: [],
    },
  ];

  for (const item of cases) {
    const assessment = assessReadiness(item.input);
    assert.equal(assessment.level, item.level, item.name);
    assert.equal(assessment.runner_allowed, item.runnerAllowed, item.name);
    assert.deepEqual(assessment.blocking, item.blocking, item.name);
  }
});

test("E3 exposes all available preparation categories before approval", () => {
  const assessment = assessReadiness({
    case_set: readyCaseSet,
    manifest: readyManifest,
    profile: readyProfile,
    runtime_probe: healthyRuntimeProbe(),
  });

  assert.deepEqual(
    assessment.available.sort(),
    [
      "assertions",
      "cleanup_strategy",
      "credentials",
      "formal_cases",
      "manifest_preview",
      "runtime_probe",
      "targets",
      "test_data",
    ].sort(),
  );
});

test("copyable guidance is context-aware and never embeds secret values", () => {
  const assessment = assessReadiness({
    case_set: readyCaseSet,
    manifest: readyManifest,
    profile: completeProfile({ targets: {}, credentials: {} }),
    required_targets: [{ alias: "api", kind: "api", example_origin: "https://api.example.test" }],
    required_credentials: [
      {
        alias: "api_admin",
        target_alias: "api",
        kind: "api",
        env: "TESTING_API_ADMIN_TOKEN",
      },
    ],
    runtime_probe: healthyRuntimeProbe(),
  });

  assert.deepEqual(assessment.copyable_examples.targets, {
    targets: {
      api: { kind: "api", origin: "https://api.example.test" },
    },
  });
  assert.deepEqual(assessment.copyable_examples.credentials, {
    credentials: {
      api_admin: { source: "env", name: "TESTING_API_ADMIN_TOKEN" },
    },
  });
  assert.doesNotMatch(JSON.stringify(assessment.copyable_examples), /literal-secret|Bearer\s+\S+/i);

  const guide = renderPreparationGuide(assessment);
  assert.match(guide, /```json/);
  assert.match(guide, /TESTING_API_ADMIN_TOKEN/);
  assert.doesNotMatch(guide, /literal-secret|Bearer\s+\S+/i);
});

test("public pages, API-only cases and non-database cases do not request unrelated credentials", () => {
  const publicPage = assessReadiness({
    case_set: caseSet([normalizedCase("WEB-001")]),
    manifest: publicWebManifest(),
    profile: completeProfile({ credentials: {}, public_targets: ["public_web"] }),
    required_credentials: [
      {
        alias: "web_user",
        target_alias: "public_web",
        kind: "web",
        env: "TESTING_WEB_USER",
      },
    ],
    runtime_probe: healthyRuntimeProbe(),
  });
  assert.deepEqual(publicPage.blocking, ["Awaiting execution approval for the manifest preview."]);
  assert.equal(publicPage.copyable_examples.credentials, undefined);

  const apiOnly = assessReadiness({
    case_set: readyCaseSet,
    manifest: readyManifest,
    profile: readyProfile,
    required_credentials: [
      {
        alias: "api_admin",
        target_alias: "api",
        kind: "api",
        env: "TESTING_API_ADMIN_TOKEN",
      },
      {
        alias: "web_user",
        target_alias: "web",
        kind: "web",
        env: "TESTING_WEB_USER",
      },
      {
        alias: "db_reader",
        target_alias: "database",
        kind: "database",
        env: "TESTING_DB_READER",
      },
    ],
    runtime_probe: healthyRuntimeProbe(),
  });
  assert.deepEqual(apiOnly.blocking, ["Awaiting execution approval for the manifest preview."]);
  assert.equal(JSON.stringify(apiOnly.copyable_examples).includes("TESTING_WEB_USER"), false);
  assert.equal(JSON.stringify(apiOnly.copyable_examples).includes("TESTING_DB_READER"), false);
});

test("runtime probe reports missing software without install instructions", () => {
  const runtimeProbe: RuntimeProbeReport = {
    ...healthyRuntimeProbe(),
    browsers: [
      {
        package: "chromium",
        source: "playwright",
        version: "not installed",
        installed: false,
        impact: "web actions cannot run",
      },
    ],
    optional_db_drivers: [
      {
        package: "pg",
        source: "node resolution",
        version: "not installed",
        installed: false,
        impact: "database assertions are unavailable",
      },
    ],
  };

  const assessment = assessReadiness({
    case_set: caseSet([normalizedCase("WEB-001")]),
    manifest: publicWebManifest(),
    profile: completeProfile({ credentials: {}, public_targets: ["public_web"] }),
    runtime_probe: runtimeProbe,
  });

  assert.deepEqual(assessment.runtime_probe.missing_software, [
    {
      package: "chromium",
      source: "playwright",
      version: "not installed",
      impact: "web actions cannot run",
    },
    {
      package: "pg",
      source: "node resolution",
      version: "not installed",
      impact: "database assertions are unavailable",
    },
  ]);
  assert.equal("install_command" in assessment.runtime_probe.missing_software[0]!, false);
  assert.equal(assessment.level, "E2");
  assert.deepEqual(assessment.blocking, ["Missing runtime software: chromium"]);
});
