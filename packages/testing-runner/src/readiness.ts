import { TEN_COLUMNS } from "./input/detect-input.js";
import type {
  Approval,
  CredentialReference,
  DataReference,
  JsonValue,
  ManifestAction,
  NormalizedCase,
  NormalizedCaseSet,
  ReadinessLevel,
  RunManifest,
} from "./types.js";

export type PreparationCategory =
  | "formal_cases"
  | "targets"
  | "credentials"
  | "test_data"
  | "assertions"
  | "cleanup_strategy"
  | "manifest_preview"
  | "runtime_probe";

export type RuntimeKind = "web" | "api" | "database";

export interface TargetDraft {
  kind?: RuntimeKind;
  origin?: string;
  dialect?: "mysql" | "postgresql";
  host?: string;
  port?: number;
  database?: string;
  username_credential?: string;
  password_credential?: string;
  ssl_ca_credential?: string;
}

export interface ExecutionProfileDraft {
  profile_id?: string;
  targets?: Record<string, TargetDraft | undefined>;
  credentials?: Record<string, CredentialReference | undefined>;
  data?: Record<string, JsonValue | undefined>;
  cleanup_strategies?: Record<string, string | undefined>;
  public_targets?: string[];
}

export interface TargetRequirement {
  alias: string;
  kind: RuntimeKind;
  example_origin?: string;
  example_host?: string;
  example_database?: string;
  dialect?: "mysql" | "postgresql";
}

export interface CredentialRequirement {
  alias: string;
  target_alias: string;
  kind: RuntimeKind;
  env: string;
}

export type CompilationGap =
  | { case_id: string; kind: "missing_data"; name: string }
  | { case_id: string; kind: "missing_assertion" }
  | { case_id: string; kind: "missing_cleanup" };

export interface ApprovalValidation {
  valid: boolean;
  errors?: string[];
}

export interface RuntimeSoftwareStatus {
  package: string;
  source: string;
  version: string;
  impact: string;
}

export interface RuntimeCompatibilityStatus extends RuntimeSoftwareStatus {
  compatible: boolean;
  required_version?: string;
}

export interface RuntimeBrowserStatus extends RuntimeSoftwareStatus {
  installed: boolean;
}

export interface RuntimeDbDriverStatus extends RuntimeSoftwareStatus {
  installed: boolean;
}

export interface RuntimeConnectivityStatus {
  target_alias: string;
  reachable: boolean;
  impact: string;
}

export interface RuntimeProbeReport {
  runner: RuntimeCompatibilityStatus;
  node: RuntimeCompatibilityStatus;
  browsers: RuntimeBrowserStatus[];
  target_connectivity: RuntimeConnectivityStatus[];
  optional_db_drivers: RuntimeDbDriverStatus[];
}

export interface MissingSoftware {
  package: string;
  source: string;
  version: string;
  impact: string;
}

export interface RuntimeProbeAssessment {
  runner?: RuntimeCompatibilityStatus;
  node?: RuntimeCompatibilityStatus;
  browsers: RuntimeBrowserStatus[];
  target_connectivity: RuntimeConnectivityStatus[];
  optional_db_drivers: RuntimeDbDriverStatus[];
  missing_software: MissingSoftware[];
}

export interface ReadinessInput {
  case_set?: NormalizedCaseSet;
  manifest?: RunManifest;
  profile?: ExecutionProfileDraft;
  approval?: Approval;
  approval_validation?: ApprovalValidation;
  required_targets?: TargetRequirement[];
  required_credentials?: CredentialRequirement[];
  compilation_gaps?: CompilationGap[];
  runtime_probe?: RuntimeProbeReport;
}

export type CopyableJson = Record<string, unknown>;

export interface CopyableExamples {
  targets?: CopyableJson;
  credentials?: CopyableJson;
  data?: CopyableJson;
  cleanup?: CopyableJson;
  runtime?: CopyableJson;
}

export interface ReadinessAssessment {
  level: ReadinessLevel;
  available: PreparationCategory[];
  blocking: string[];
  optional: string[];
  reasons: string[];
  copyable_examples: CopyableExamples;
  runtime_probe: RuntimeProbeAssessment;
  runner_allowed: boolean;
}

interface TargetUsage {
  aliases: Set<string>;
  kindsByAlias: Map<string, Set<RuntimeKind>>;
  hasWebAction: boolean;
  hasDatabaseAction: boolean;
}

interface CompileState {
  blockers: string[];
  missingData: Map<string, string[]>;
  missingAssertion: boolean;
  missingCleanup: boolean;
}

const STEP_COLUMN = TEN_COLUMNS[5]!;
const EXPECTED_COLUMN = TEN_COLUMNS[6]!;

function formalCases(caseSet?: NormalizedCaseSet): NormalizedCase[] {
  return (caseSet?.cases ?? []).filter((item) => !item.divider);
}

function actionKind(action: ManifestAction): RuntimeKind {
  if (action.type.startsWith("web.") || action.type === "cleanup.web") return "web";
  if (action.type === "db.select" || action.type === "db.assert") return "database";
  return "api";
}

function addUsage(usage: TargetUsage, alias: string, kind: RuntimeKind): void {
  usage.aliases.add(alias);
  const kinds = usage.kindsByAlias.get(alias) ?? new Set<RuntimeKind>();
  kinds.add(kind);
  usage.kindsByAlias.set(alias, kinds);
  usage.hasWebAction ||= kind === "web";
  usage.hasDatabaseAction ||= kind === "database";
}

function collectTargetUsage(manifest?: RunManifest, requirements: readonly TargetRequirement[] = []): TargetUsage {
  const usage: TargetUsage = {
    aliases: new Set<string>(),
    kindsByAlias: new Map<string, Set<RuntimeKind>>(),
    hasWebAction: false,
    hasDatabaseAction: false,
  };

  for (const item of manifest?.cases ?? []) {
    for (const action of item.steps) addUsage(usage, action.target_alias, actionKind(action));
  }

  if (!manifest) {
    for (const requirement of requirements) addUsage(usage, requirement.alias, requirement.kind);
  }

  return usage;
}

function isTargetComplete(target: TargetDraft | undefined): boolean {
  if (!target?.kind) return false;
  if (target.kind === "web" || target.kind === "api") {
    return typeof target.origin === "string" && target.origin.trim() !== "";
  }
  return (
    typeof target.dialect === "string" &&
    typeof target.host === "string" &&
    target.host.trim() !== "" &&
    typeof target.database === "string" &&
    target.database.trim() !== "" &&
    typeof target.username_credential === "string" &&
    target.username_credential.trim() !== "" &&
    typeof target.password_credential === "string" &&
    target.password_credential.trim() !== ""
  );
}

function targetExample(requirement: TargetRequirement | undefined, alias: string, kind: RuntimeKind): Record<string, unknown> {
  if (kind === "database") {
    return {
      kind: "database",
      dialect: requirement?.dialect ?? "postgresql",
      host: requirement?.example_host ?? `${alias}.example.test`,
      database: requirement?.example_database ?? "app_test",
      username_credential: `${alias}_user`,
      password_credential: `${alias}_password`,
    };
  }
  return {
    kind,
    origin: requirement?.example_origin ?? `https://${alias}.example.test`,
  };
}

function assessTargets(
  profile: ExecutionProfileDraft | undefined,
  usage: TargetUsage,
  requirements: readonly TargetRequirement[],
  copyable: CopyableExamples,
): string[] {
  const blockers: string[] = [];
  const examples: Record<string, unknown> = {};
  for (const alias of usage.aliases) {
    if (isTargetComplete(profile?.targets?.[alias])) continue;
    blockers.push(`Missing target: ${alias}`);
    const requirement = requirements.find((item) => item.alias === alias);
    const kind = requirement?.kind ?? usage.kindsByAlias.get(alias)?.values().next().value ?? "api";
    examples[alias] = targetExample(requirement, alias, kind);
  }
  if (Object.keys(examples).length > 0) copyable.targets = { targets: examples };
  return blockers;
}

function credentialApplies(
  requirement: CredentialRequirement,
  profile: ExecutionProfileDraft | undefined,
  usage: TargetUsage,
): boolean {
  if (!usage.aliases.has(requirement.target_alias)) return false;
  if (requirement.kind === "web" && profile?.public_targets?.includes(requirement.target_alias)) return false;
  const targetKinds = usage.kindsByAlias.get(requirement.target_alias);
  return targetKinds === undefined || targetKinds.has(requirement.kind);
}

function assessCredentials(
  profile: ExecutionProfileDraft | undefined,
  usage: TargetUsage,
  requirements: readonly CredentialRequirement[],
  copyable: CopyableExamples,
): string[] {
  const blockers: string[] = [];
  const examples: Record<string, CredentialReference> = {};
  for (const requirement of requirements) {
    if (!credentialApplies(requirement, profile, usage)) continue;
    if (profile?.credentials?.[requirement.alias]?.name) continue;
    blockers.push(`Missing credential reference: ${requirement.alias}`);
    examples[requirement.alias] = { source: "env", name: requirement.env };
  }
  if (Object.keys(examples).length > 0) copyable.credentials = { credentials: examples };
  return blockers;
}

function dataRefNames(manifest?: RunManifest): Array<{ caseId: string; name: string }> {
  const refs: Array<{ caseId: string; name: string }> = [];
  for (const item of manifest?.cases ?? []) {
    for (const action of item.steps) {
      if ("input_ref" in action && action.input_ref) refs.push({ caseId: item.case_id, name: action.input_ref.name });
      if ("params_ref" in action && action.params_ref) refs.push({ caseId: item.case_id, name: action.params_ref.name });
      if ("value_ref" in action && action.value_ref) refs.push({ caseId: item.case_id, name: action.value_ref.name });
    }
  }
  return refs;
}

function hasVerdictRoute(item: RunManifest["cases"][number]): boolean {
  return item.steps.some((action) =>
    action.type === "api.assert" ||
    action.type === "web.assert" ||
    action.type === "db.assert" ||
    action.type === "execution.blocked"
  );
}

function gapMessage(gap: CompilationGap): string {
  if (gap.kind === "missing_data") return `${gap.case_id}: required data fixture ${gap.name} is missing.`;
  if (gap.kind === "missing_assertion") return `${gap.case_id}: mandatory assertion is missing.`;
  return `${gap.case_id}: cleanup strategy is missing.`;
}

function assessCompilation(cases: readonly NormalizedCase[], input: ReadinessInput, copyable: CopyableExamples): CompileState {
  const state: CompileState = {
    blockers: [],
    missingData: new Map<string, string[]>(),
    missingAssertion: false,
    missingCleanup: false,
  };

  for (const item of cases) {
    if ((item.values[STEP_COLUMN] ?? "").trim() === "") state.blockers.push(`${item.id}: test steps are empty.`);
    if ((item.values[EXPECTED_COLUMN] ?? "").trim() === "") state.blockers.push(`${item.id}: expected result is empty.`);
  }

  for (const ref of dataRefNames(input.manifest)) {
    if (input.profile?.data?.[ref.name]) continue;
    const names = state.missingData.get(ref.caseId) ?? [];
    names.push(ref.name);
    state.missingData.set(ref.caseId, names);
    state.blockers.push(`${ref.caseId}: required data fixture ${ref.name} is missing.`);
  }

  for (const item of input.manifest?.cases ?? []) {
    if (hasVerdictRoute(item)) continue;
    state.missingAssertion = true;
    state.blockers.push(`${item.case_id}: mandatory assertion is missing.`);
  }

  for (const item of input.manifest?.cases ?? []) {
    const hasCleanupAction = item.steps.some((action) =>
      action.type === "cleanup.api" || action.type === "cleanup.web"
    );
    if (!hasCleanupAction) continue;
    if (input.profile?.cleanup_strategies?.[item.case_id]) continue;
    state.missingCleanup = true;
    state.blockers.push(`${item.case_id}: cleanup strategy is missing.`);
  }

  for (const gap of input.compilation_gaps ?? []) {
    state.blockers.push(gapMessage(gap));
    if (gap.kind === "missing_data") {
      const names = state.missingData.get(gap.case_id) ?? [];
      names.push(gap.name);
      state.missingData.set(gap.case_id, names);
    }
    state.missingAssertion ||= gap.kind === "missing_assertion";
    state.missingCleanup ||= gap.kind === "missing_cleanup";
  }

  if (!input.manifest && state.blockers.length === 0) state.blockers.push("Manifest preview has not been generated.");

  const dataExamples: Record<string, DataReference> = {};
  for (const names of state.missingData.values()) {
    for (const name of names) dataExamples[name] = { source: "fixture", name };
  }
  if (Object.keys(dataExamples).length > 0) copyable.data = { data: dataExamples };
  if (state.missingCleanup) {
    const cleanupExamples: Record<string, string> = {};
    for (const item of input.manifest?.cases ?? []) {
      const hasCleanupAction = item.steps.some((action) =>
        action.type === "cleanup.api" || action.type === "cleanup.web"
      );
      if (hasCleanupAction && !input.profile?.cleanup_strategies?.[item.case_id]) {
        cleanupExamples[item.case_id] = "api";
      }
    }
    if (Object.keys(cleanupExamples).length === 0) cleanupExamples["CASE-ID"] = "api";
    copyable.cleanup = { cleanup_strategies: cleanupExamples };
  }

  return state;
}

function missingSoftware(item: RuntimeSoftwareStatus): MissingSoftware {
  return {
    package: item.package,
    source: item.source,
    version: item.version,
    impact: item.impact,
  };
}

function assessRuntime(
  probe: RuntimeProbeReport | undefined,
  usage: TargetUsage,
  copyable: CopyableExamples,
): { probe: RuntimeProbeAssessment; blockers: string[]; optional: string[] } {
  const missing: MissingSoftware[] = [];
  const blockers: string[] = [];
  const optional: string[] = [];
  if (!probe) {
    return {
      probe: {
        browsers: [],
        target_connectivity: [],
        optional_db_drivers: [],
        missing_software: [],
      },
      blockers,
      optional,
    };
  }

  for (const item of [probe.runner, probe.node]) {
    if (item.compatible) continue;
    const missingItem = missingSoftware(item);
    missing.push(missingItem);
    blockers.push(`Missing runtime software: ${missingItem.package}`);
  }

  for (const browser of probe.browsers) {
    if (browser.installed) continue;
    const missingItem = missingSoftware(browser);
    missing.push(missingItem);
    if (usage.hasWebAction) blockers.push(`Missing runtime software: ${missingItem.package}`);
    else optional.push(`${missingItem.package}: ${missingItem.impact}`);
  }

  for (const driver of probe.optional_db_drivers) {
    if (driver.installed) continue;
    const missingItem = missingSoftware(driver);
    missing.push(missingItem);
    if (usage.hasDatabaseAction) blockers.push(`Missing runtime software: ${missingItem.package}`);
    else optional.push(`${missingItem.package}: ${missingItem.impact}`);
  }

  for (const connectivity of probe.target_connectivity) {
    if (!connectivity.reachable) blockers.push(`Target not reachable: ${connectivity.target_alias}`);
  }

  if (missing.length > 0) copyable.runtime = { missing_software: missing };
  return {
    probe: {
      runner: probe.runner,
      node: probe.node,
      browsers: [...probe.browsers],
      target_connectivity: [...probe.target_connectivity],
      optional_db_drivers: [...probe.optional_db_drivers],
      missing_software: missing,
    },
    blockers,
    optional,
  };
}

function availableCategories(
  cases: readonly NormalizedCase[],
  input: ReadinessInput,
  targetBlockers: readonly string[],
  credentialBlockers: readonly string[],
  compile: CompileState,
  runtimeBlockers: readonly string[],
): PreparationCategory[] {
  const available: PreparationCategory[] = [];
  if (cases.length > 0) available.push("formal_cases");
  if (targetBlockers.length === 0 && (input.manifest || input.required_targets?.length)) available.push("targets");
  if (credentialBlockers.length === 0) available.push("credentials");
  if (compile.missingData.size === 0) available.push("test_data");
  if (!compile.missingAssertion) available.push("assertions");
  if (!compile.missingCleanup) available.push("cleanup_strategy");
  if (input.manifest && targetBlockers.length === 0 && credentialBlockers.length === 0 && compile.blockers.length === 0 && runtimeBlockers.length === 0) {
    available.push("manifest_preview");
  }
  if (input.runtime_probe) available.push("runtime_probe");
  return [...new Set(available)];
}

function approvalPending(input: ReadinessInput): string[] {
  if (input.approval && input.approval_validation?.valid) return [];
  if (input.approval_validation && !input.approval_validation.valid) {
    const errors = input.approval_validation.errors?.join("; ") || "approval validation failed";
    return [`Approval validation failed: ${errors}`];
  }
  return ["Awaiting execution approval for the manifest preview."];
}

export function assessReadiness(input: ReadinessInput): ReadinessAssessment {
  const copyable: CopyableExamples = {};
  const cases = formalCases(input.case_set);
  const usage = collectTargetUsage(input.manifest, input.required_targets);
  const runtime = assessRuntime(input.runtime_probe, usage, copyable);

  if (cases.length === 0) {
    return {
      level: "E0",
      available: input.runtime_probe ? ["runtime_probe"] : [],
      blocking: ["No normalized formal cases are available."],
      optional: runtime.optional,
      reasons: ["Add or normalize at least one non-divider test case."],
      copyable_examples: copyable,
      runtime_probe: runtime.probe,
      runner_allowed: false,
    };
  }

  const targetBlockers = assessTargets(input.profile, usage, input.required_targets ?? [], copyable);
  const credentialBlockers = assessCredentials(input.profile, usage, input.required_credentials ?? [], copyable);
  const compile = assessCompilation(cases, input, copyable);
  const e1Blockers = [...targetBlockers, ...credentialBlockers];
  const e2Blockers = [...compile.blockers, ...runtime.blockers];

  if (e1Blockers.length > 0) {
    return {
      level: "E1",
      available: availableCategories(cases, input, targetBlockers, credentialBlockers, compile, runtime.blockers),
      blocking: [...e1Blockers, ...e2Blockers],
      optional: runtime.optional,
      reasons: ["Complete target addresses and credential references before compiling the manifest."],
      copyable_examples: copyable,
      runtime_probe: runtime.probe,
      runner_allowed: false,
    };
  }

  if (e2Blockers.length > 0) {
    return {
      level: "E2",
      available: availableCategories(cases, input, targetBlockers, credentialBlockers, compile, runtime.blockers),
      blocking: e2Blockers,
      optional: runtime.optional,
      reasons: ["Resolve compile-time case data, assertion, cleanup, and runtime prerequisites."],
      copyable_examples: copyable,
      runtime_probe: runtime.probe,
      runner_allowed: false,
    };
  }

  const approvalBlockers = approvalPending(input);
  if (approvalBlockers.length > 0) {
    return {
      level: "E3",
      available: availableCategories(cases, input, targetBlockers, credentialBlockers, compile, runtime.blockers),
      blocking: approvalBlockers,
      optional: runtime.optional,
      reasons: ["Manifest preview is ready for human approval."],
      copyable_examples: copyable,
      runtime_probe: runtime.probe,
      runner_allowed: false,
    };
  }

  return {
    level: "E4",
    available: availableCategories(cases, input, targetBlockers, credentialBlockers, compile, runtime.blockers),
    blocking: [],
    optional: runtime.optional,
    reasons: ["Approval validation succeeded; runner execution is allowed."],
    copyable_examples: copyable,
    runtime_probe: runtime.probe,
    runner_allowed: true,
  };
}
