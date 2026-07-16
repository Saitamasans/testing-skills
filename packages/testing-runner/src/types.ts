export type SchemaId =
  | "report"
  | "execution-profile"
  | "run-manifest"
  | "approval"
  | "run-result";

export type ProtocolVersion = "1.0.0";

export type ActionType =
  | "web.goto"
  | "web.fill"
  | "web.click"
  | "web.select"
  | "web.wait"
  | "web.assert"
  | "api.request"
  | "api.extract"
  | "api.assert"
  | "db.select"
  | "cleanup.api"
  | "cleanup.web";

export type CaseStatus = "未执行" | "通过" | "不通过" | "待定";
export type InputKind = "native-report" | "standard-excel" | "nonstandard-excel";
export type TenColumnName =
  | "用例 ID"
  | "所属模块"
  | "用例标题"
  | "验证功能点"
  | "前置条件"
  | "测试步骤"
  | "预期结果"
  | "优先级"
  | "执行结果"
  | "备注";

export type SkillInvocation =
  | string
  | {
      primary: string;
      secondary?: string;
      roles?: string;
      confirmation?: string;
    };

export interface SourceSnapshot {
  absolute_path: string;
  sha256: string;
  size: number;
  modified_at: string;
  input_kind: InputKind;
  sheet_names: string[];
  rows?: OriginalSourceRow[];
}

export interface OriginalSourceRow {
  source: string;
  source_sheet: string;
  source_row: number;
  columns: string[];
  raw_values: unknown[];
}

export interface NormalizedCase {
  id: string;
  values: Record<TenColumnName, string>;
  raw_values: unknown[];
  source: string;
  source_sheet: string;
  source_row: number;
  divider: boolean;
  extensions: Record<string, string>;
  original_status: string;
  status: CaseStatus | "-";
}

export interface NormalizedCaseSet {
  columns: TenColumnName[];
  cases: NormalizedCase[];
  source_snapshot: SourceSnapshot;
  skill_invocation?: SkillInvocation;
  normalization_metadata?: {
    mapping: {
      source_sha256: string;
      proposal_sha256: string;
      confirmed_at: string;
      confirmed_by: string;
      column_rules: unknown[];
      split_rule_versions: string[];
    };
  };
}
export type RunStatus =
  | "planned"
  | "running"
  | "completed"
  | "blocked"
  | "executor_error"
  | "infrastructure_error"
  | "manual_required";
export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type ReadinessLevel = "E0" | "E1" | "E2" | "E3" | "E4";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface CredentialReference {
  source: "env";
  name: string;
}

export interface DataReference {
  source: "env" | "fixture" | "output";
  name: string;
}

export type HttpUrl = `http://${string}` | `https://${string}`;

export interface WebTarget {
  kind: "web";
  origin: HttpUrl;
}

export interface ApiTarget {
  kind: "api";
  origin: HttpUrl;
}

export interface DatabaseTarget {
  kind: "database";
  dialect: "mysql" | "postgresql";
  host: string;
  port?: number;
  database: string;
}

export type ExecutionTarget = WebTarget | ApiTarget | DatabaseTarget;

export interface ExecutionProfile {
  protocol_version: ProtocolVersion;
  profile_id: string;
  targets: Record<string, ExecutionTarget>;
  credentials: Record<string, CredentialReference>;
}

interface BaseAction {
  action_id: string;
  target_alias: string;
  risk: RiskLevel;
  source_step?: string;
  timeout_ms?: number;
  retry_eligible?: boolean;
}

export interface WebGotoAction extends BaseAction {
  type: "web.goto";
  url: HttpUrl;
}

export interface WebFillAction extends BaseAction {
  type: "web.fill";
  locator: string;
  value_ref: DataReference;
}

export interface WebClickAction extends BaseAction {
  type: "web.click";
  locator: string;
}

export interface WebSelectAction extends BaseAction {
  type: "web.select";
  locator: string;
  option: string;
}

export interface WebWaitAction extends BaseAction {
  type: "web.wait";
  condition: string;
}

export interface WebAssertAction extends BaseAction {
  type: "web.assert";
  assertion: string;
}

export interface ApiRequestAction extends BaseAction {
  type: "api.request";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  input_ref?: DataReference;
  raw_body_ref?: DataReference;
  header_refs?: Record<string, DataReference>;
  query_refs?: Record<string, DataReference>;
  json_body_refs?: Record<string, DataReference>;
}

export interface ApiConcurrentAction extends BaseAction {
  type: "api.concurrent";
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  concurrency: number;
  input_ref?: DataReference;
  raw_body_ref?: DataReference;
  header_refs?: Record<string, DataReference>;
  query_refs?: Record<string, DataReference>;
  json_body_refs?: Record<string, DataReference>;
}

export interface ApiExtractAction extends BaseAction {
  type: "api.extract";
  from: string;
  as: string;
}

export interface ApiAssertAction extends BaseAction {
  type: "api.assert";
  assertion: string;
  verdict_policy?: "auto" | "pending_only";
  root_cause_key?: string;
}

export interface ExecutionBlockedAction extends BaseAction {
  type: "execution.blocked";
  reason: string;
}

export interface DatabaseSelectAction extends BaseAction {
  type: "db.select";
  query: string;
  params_ref?: DataReference;
  limit?: number;
}

export interface CleanupApiAction extends BaseAction {
  type: "cleanup.api";
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  input_ref?: DataReference;
}

export interface CleanupWebAction extends BaseAction {
  type: "cleanup.web";
  locator: string;
}

export type ManifestAction =
  | WebGotoAction
  | WebFillAction
  | WebClickAction
  | WebSelectAction
  | WebWaitAction
  | WebAssertAction
  | ApiRequestAction
  | ApiConcurrentAction
  | ApiExtractAction
  | ApiAssertAction
  | ExecutionBlockedAction
  | DatabaseSelectAction
  | CleanupApiAction
  | CleanupWebAction;

export interface RunManifestCase {
  case_id: string;
  original: {
    "用例 ID": string;
    "所属模块": string;
    "用例标题": string;
    "验证功能点": string;
    "前置条件": string;
    "测试步骤": string;
    "预期结果": string;
    "优先级": string;
    "执行结果": "" | CaseStatus;
    "备注": string;
  };
  steps: ManifestAction[];
}

export interface RunManifest {
  protocol_version: ProtocolVersion;
  manifest_id: string;
  runner: { version: ProtocolVersion };
  source: { path: string; sha256: string };
  targets?: HttpUrl[];
  rule_versions?: string[];
  cases: RunManifestCase[];
}

export interface Approval {
  protocol_version: ProtocolVersion;
  approval_id: string;
  manifest_hash: string;
  source_hash: string;
  runner?: { version: ProtocolVersion };
  rule_versions?: string[];
  targets: HttpUrl[];
  approved_risks: RiskLevel[];
  approved_r3_action_ids: string[];
  issued_by: string;
  issued_at: string;
  expires_at: string;
}

export interface AssertionResult {
  assertion_id: string;
  passed: boolean;
  actual?: JsonValue;
  expected?: JsonValue;
}

export interface EvidenceReference {
  path: string;
  sha256: string;
}

export interface RunCaseResult {
  case_id: string;
  case_status: CaseStatus;
  run_status: RunStatus;
  assertions: AssertionResult[];
  evidence: EvidenceReference[];
}

export interface RootDefectSummary {
  defect_id: string;
  root_cause_key: string;
  case_ids: string[];
  evidence: EvidenceReference[];
}

export interface RunResult {
  protocol_version: ProtocolVersion;
  run_id: string;
  manifest_hash: string;
  run_status: RunStatus;
  started_at: string;
  completed_at?: string;
  cases: RunCaseResult[];
  defects?: RootDefectSummary[];
}
