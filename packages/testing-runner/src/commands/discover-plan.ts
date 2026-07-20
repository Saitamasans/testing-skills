import { chromium } from "playwright";
import type { Page } from "playwright";

import { executeAction } from "../actions/action-registry.js";
import { readExecutionPackage } from "../input/execution-package.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import { resolveCredentials } from "../security/credential-resolver.js";
import {
  createActiveRuntimeSession,
  discoverAndIssueReceipt,
  validateDiscoveryApprovalForTransition,
} from "../security/discovery-receipt.js";
import type { ManifestAction } from "../types.js";
import { readProfile, runPlanCommand, type PlanCommandResult } from "./plan.js";

export interface DiscoverPlanCommandOptions {
  input: string;
  profile: string;
  outputDir: string;
  discoveryApproval: string;
  transitionCaseId: string;
  browser?: "visible" | "headless";
  now?: Date;
  clock?: () => Date;
  afterReceiptIssued?: (page: Page) => Promise<void>;
}

function targetState(contractCase: Awaited<ReturnType<typeof readExecutionPackage>>["contract"]["cases"][number]): string {
  const browserState = contractCase.effects.browser_state;
  const value = browserState && typeof browserState === "object" && "target_state" in browserState
    ? (browserState as { target_state?: unknown }).target_state
    : undefined;
  if (typeof value !== "string" || value.length === 0) throw new Error("transition_case_target_state_required");
  return value;
}

function transitionActions(actions: ManifestAction[]): ManifestAction[] {
  return actions.filter((action) => !action.type.endsWith(".assert") && !action.type.startsWith("cleanup.") && action.type !== "execution.blocked");
}

export async function runDiscoverPlanCommand(options: DiscoverPlanCommandOptions): Promise<PlanCommandResult> {
  if (!options.input.toLowerCase().endsWith(".execution-package.zip")) {
    throw new Error("discover_plan_execution_package_required");
  }
  const clock = options.clock ?? (options.now ? () => options.now! : () => new Date());
  const loaded = await readExecutionPackage(options.input);
  const profile = await readProfile(options.profile);
  const targetStateCases = loaded.contract.cases.filter((item) => {
    const browserState = item.effects.browser_state;
    return Boolean(browserState && typeof browserState === "object" && "target_state" in browserState);
  });
  if (targetStateCases.length !== 1 || targetStateCases[0]?.case_id !== options.transitionCaseId) {
    throw new Error("discover_plan_requires_exactly_one_matching_target_state_case");
  }
  const contractCase = loaded.contract.cases.find(({ case_id }) => case_id === options.transitionCaseId);
  if (!contractCase) throw new Error("transition_case_not_found");
  const actions = transitionActions(profile.case_plans?.[options.transitionCaseId] ?? []);
  if (actions.length === 0 || actions.some((action) => !action.type.startsWith("web."))) {
    throw new Error("transition_discovery_execution_unsupported: only Runner web transition actions are allowed");
  }
  const gotoAction = actions.find((action) => action.type === "web.goto");
  if (!gotoAction || gotoAction.type !== "web.goto") throw new Error("transition_discovery_goto_required");
  const aliases = [...new Set(actions.map(({ target_alias }) => target_alias))];
  if (aliases.length !== 1) throw new Error("transition_target_origin_ambiguous");
  const target = profile.targets[aliases[0]!];
  if (!target || target.kind !== "web") throw new Error("transition_target_web_origin_required");
  const targetOrigin = new URL(target.origin).origin;
  if (new URL(gotoAction.url).origin !== targetOrigin) throw new Error("transition_requested_url_origin_mismatch");

  const session = await createActiveRuntimeSession(options.outputDir, clock());
  const approvalInput = {
    session,
    approvalPath: options.discoveryApproval,
    packageSha256: loaded.package_sha256,
    sourceCaseIds: loaded.contract.cases.map(({ source_case_id }) => source_case_id),
    transitionCaseId: contractCase.case_id,
    transitionActions: actions,
    targetOrigin,
    requestedUrl: gotoAction.url,
    pageStateId: targetState(contractCase),
  };
  await validateDiscoveryApprovalForTransition({ ...approvalInput, now: clock() });
  const browser = await chromium.launch({ headless: options.browser !== "visible" });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const secrets = resolveCredentials(Object.entries(profile.credentials).map(([alias, ref]) => ({
      alias,
      source: "configured_env" as const,
      name: ref.name,
    })), process.env, { now: clock() });
    const context = createExecutionContext({
      targets: profile.targets,
      approvedOrigins: [targetOrigin],
      data: profile.data ?? {},
      secrets,
      page,
      mode: "interactive",
    });
    for (const action of actions) {
      const outcome = await executeAction(action, context);
      if (outcome.status !== "passed") {
        throw new Error(`transition_action_failed: ${action.action_id}:${outcome.status}:${outcome.error?.type ?? "unknown"}`);
      }
    }
    const issued = await discoverAndIssueReceipt({
      ...approvalInput,
      page,
      clock,
    });
    await options.afterReceiptIssued?.(page);
    return await runPlanCommand({
      input: options.input,
      profile: options.profile,
      outputDir: session.runRoot,
      discoveryReceipts: [issued.receiptPath],
      discoveryApproval: options.discoveryApproval,
      runtimeSession: session,
      livePage: page,
      clock,
    });
  } finally {
    await browser.close();
  }
}
