import { validateDocument } from "../schema-registry.js";
import { normalizeTargetOrigins } from "../security/target-scope.js";
import type {
  ExecutionProfile,
  ExecutionTarget,
  HttpUrl,
  ManifestAction,
  NormalizedCaseSet,
  RunManifest,
  RunManifestCase,
} from "../types.js";
import { classifyRisk } from "./risk-classifier.js";
import { sha256Canonical } from "./canonical-json.js";

export interface ExecutionProfileWithPlans extends ExecutionProfile {
  case_plans: Record<string, ManifestAction[]>;
  rule_versions?: string[];
  manifest_id?: string;
}

export interface CompileManifestOptions {
  manifest_id?: string;
  runner_version?: "1.0.0";
}

export type CompiledRunManifest = RunManifest & {
  targets: HttpUrl[];
  rule_versions: string[];
};

export function compileManifest(
  cases: NormalizedCaseSet,
  profile: ExecutionProfile,
  options: CompileManifestOptions = {},
): CompiledRunManifest {
  const plannedProfile = profile as ExecutionProfileWithPlans;
  const manifestCases = cases.cases
    .filter((item) => !item.divider)
    .map((item) => {
      const declaredActions = plannedProfile.case_plans?.[item.id];
      if (!declaredActions || declaredActions.length === 0) {
        throw new Error(`No declared actions for case ${item.id}`);
      }
      return {
        case_id: item.id,
        original: structuredClone(item.values) as RunManifestCase["original"],
        steps: declaredActions.map((action) => compileAction(action, item.id, profile.targets)),
      };
    });

  const manifest: CompiledRunManifest = {
    protocol_version: "1.0.0",
    manifest_id: options.manifest_id ?? plannedProfile.manifest_id ?? stableManifestId(cases, profile),
    runner: { version: options.runner_version ?? "1.0.0" },
    source: {
      path: cases.source_snapshot.absolute_path,
      sha256: cases.source_snapshot.sha256,
    },
    targets: normalizeTargetOrigins(profile.targets) as HttpUrl[],
    rule_versions: [...(plannedProfile.rule_versions ?? ["1.0.0"])],
    cases: manifestCases,
  };
  return validateDocument<CompiledRunManifest>("run-manifest", manifest);
}

function compileAction(
  action: ManifestAction,
  caseId: string,
  targets: Record<string, ExecutionTarget>,
): ManifestAction {
  if (!action.action_id || !action.target_alias || !action.type) {
    throw new Error(`Declared action for ${caseId} is incomplete`);
  }
  const target = targets[action.target_alias];
  if (!target) throw new Error(`Action ${action.action_id} references unknown target ${action.target_alias}`);

  const compiled = structuredClone(action);
  compiled.risk = classifyRisk(compiled, { target }).level;
  compiled.source_step ??= caseId;
  compiled.retry_eligible ??= isRetryEligible(compiled);
  return compiled;
}

function isRetryEligible(action: ManifestAction): boolean {
  return action.type.endsWith(".assert") || action.type === "web.wait" || action.type === "api.request";
}

function stableManifestId(cases: NormalizedCaseSet, profile: ExecutionProfile): string {
  return `manifest-${sha256Canonical({
    source: cases.source_snapshot.sha256,
    profile: profile.profile_id,
    case_ids: cases.cases.filter((item) => !item.divider).map((item) => item.id),
  }).slice(0, 16)}`;
}
