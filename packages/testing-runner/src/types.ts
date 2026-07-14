export type SchemaId =
  | "report"
  | "execution-profile"
  | "run-manifest"
  | "approval"
  | "run-result";

export type ProtocolVersion = "1.0";

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

export interface WebTarget {
  kind: "web";
  origin: string;
}

export interface ApiTarget {
  kind: "api";
  origin: string;
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
  url: string;
}

export interface WebFillAction extends BaseAction {
  type: "web.fill";
  locator: string;
  value_ref: string;
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
  input_ref?: string;
}

export interface ApiExtractAction extends BaseAction {
  type: "api.extract";
  from: string;
  as: string;
}

export interface ApiAssertAction extends BaseAction {
  type: "api.assert";
  assertion: string;
}

export interface DatabaseSelectAction extends BaseAction {
  type: "db.select";
  query: string;
  params_ref?: string;
  limit?: number;
}

export interface CleanupApiAction extends BaseAction {
  type: "cleanup.api";
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  input_ref?: string;
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
  | ApiExtractAction
  | ApiAssertAction
  | DatabaseSelectAction
  | CleanupApiAction
  | CleanupWebAction;

export interface RunManifestCase {
  case_id: string;
  original: Record<string, string>;
  steps: ManifestAction[];
}

export interface RunManifest {
  protocol_version: ProtocolVersion;
  manifest_id: string;
  runner: { version: string };
  source: { path: string; sha256: string };
  cases: RunManifestCase[];
}

export interface Approval {
  protocol_version: ProtocolVersion;
  approval_id: string;
  manifest_hash: string;
  source_hash: string;
  targets: string[];
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

export interface RunResult {
  protocol_version: ProtocolVersion;
  run_id: string;
  manifest_hash: string;
  run_status: RunStatus;
  started_at: string;
  completed_at?: string;
  cases: RunCaseResult[];
}
