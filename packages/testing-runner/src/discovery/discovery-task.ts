import type { ContractCase } from "@saitamasans/testing-contract-compiler";

import { sha256Canonical } from "../compiler/canonical-json.js";
import type { ExecutionProfile, ManifestAction } from "../types.js";

export interface DiscoveryTask {
  discovery_task_id: string;
  source_case_id: string;
  source_case_ids: string[];
  transition_case_id: string;
  target_state: string;
  transition_actions_sha256: string;
  package_sha256: string;
  origin: string;
  requested_url: string;
  isolation_scope: ContractCase["isolation_scope"];
  flow_group: string | null;
  required_auth_profile: string | null;
  start_state_sha256: string;
  auth_profile_sha256: string;
}

export function transitionActions(actions: ManifestAction[]): ManifestAction[] {
  return actions.filter((action) => !action.type.endsWith(".assert") && !action.type.startsWith("cleanup.") && action.type !== "execution.blocked");
}

function transitionSemantics(actions: ManifestAction[]): Array<Omit<ManifestAction, "action_id" | "source_step">> {
  return actions.map(({ action_id: _actionId, source_step: _sourceStep, ...semantic }) => semantic);
}

export function contractTargetState(item: ContractCase): string | null {
  const browserState = item.effects.browser_state;
  if (!browserState || typeof browserState !== "object" || !("target_state" in browserState)) return null;
  const state = (browserState as { target_state?: unknown }).target_state;
  return typeof state === "string" && state.length > 0 ? state : null;
}

function authProfileId(item: ContractCase): string | null {
  const id = item.auth_profile?.id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

function webBinding(profile: ExecutionProfile, actions: ManifestAction[]): { origin: string; requestedUrl: string } {
  if (actions.length === 0 || actions.some((action) => !action.type.startsWith("web."))) {
    throw new Error("transition_discovery_execution_unsupported: only Runner web transition actions are allowed");
  }
  const aliases = [...new Set(actions.map(({ target_alias }) => target_alias))];
  if (aliases.length !== 1) throw new Error("transition_target_origin_ambiguous");
  const target = profile.targets[aliases[0]!];
  if (!target || target.kind !== "web") throw new Error("transition_target_web_origin_required");
  const origin = new URL(target.origin).origin;
  const goto = actions.find((action) => action.type === "web.goto");
  if (!goto || goto.type !== "web.goto") throw new Error("transition_discovery_goto_required");
  if (new URL(goto.url).origin !== origin) throw new Error("transition_requested_url_origin_mismatch");
  return { origin, requestedUrl: goto.url };
}

export function discoveryTaskId(input: {
  packageSha256: string;
  targetState: string;
  transitionActionsSha256: string;
  origin: string;
  isolationScope: ContractCase["isolation_scope"];
  flowGroup: string | null;
  requiredAuthProfile: string | null;
  startStateSha256: string;
  authProfileSha256: string;
}): string {
  return `discovery-task-${sha256Canonical(input).slice(0, 32)}`;
}

export function planDiscoveryTasks(input: {
  contractCases: ContractCase[];
  profile: ExecutionProfile;
  packageSha256: string;
}): DiscoveryTask[] {
  const tasks = new Map<string, DiscoveryTask>();
  for (const item of input.contractCases) {
    const targetState = contractTargetState(item);
    if (!targetState) continue;
    const actions = transitionActions(input.profile.case_plans?.[item.case_id] ?? []);
    const binding = webBinding(input.profile, actions);
    const transitionActionsSha256 = sha256Canonical(actions);
    const transitionSemanticsSha256 = sha256Canonical(transitionSemantics(actions));
    const requiredAuthProfile = authProfileId(item);
    const startStateSha256 = sha256Canonical(item.start_state);
    const authProfileSha256 = sha256Canonical(item.auth_profile);
    const dedupKey = sha256Canonical({
      target_state: targetState,
      transition_semantics_sha256: transitionSemanticsSha256,
      origin: binding.origin,
      isolation_scope: item.isolation_scope,
      flow_group: item.flow_group,
      required_auth_profile: requiredAuthProfile,
      start_state_sha256: startStateSha256,
      auth_profile_sha256: authProfileSha256,
    });
    const existing = tasks.get(dedupKey);
    if (existing) {
      existing.source_case_ids.push(item.source_case_id);
      continue;
    }
    tasks.set(dedupKey, {
      discovery_task_id: discoveryTaskId({
        packageSha256: input.packageSha256,
        targetState,
        transitionActionsSha256,
        origin: binding.origin,
        isolationScope: item.isolation_scope,
        flowGroup: item.flow_group,
        requiredAuthProfile,
        startStateSha256,
        authProfileSha256,
      }),
      source_case_id: item.source_case_id,
      source_case_ids: [item.source_case_id],
      transition_case_id: item.case_id,
      target_state: targetState,
      transition_actions_sha256: transitionActionsSha256,
      package_sha256: input.packageSha256,
      origin: binding.origin,
      requested_url: binding.requestedUrl,
      isolation_scope: item.isolation_scope,
      flow_group: item.flow_group,
      required_auth_profile: requiredAuthProfile,
      start_state_sha256: startStateSha256,
      auth_profile_sha256: authProfileSha256,
    });
  }
  return [...tasks.values()];
}
