import { chromium } from "playwright";

import { readExecutionPackage } from "../input/execution-package.js";
import {
  createActiveRuntimeSession,
  discoverAndIssueReceipt,
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
  const now = options.now ?? new Date();
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
  if (actions.length !== 1 || actions[0]?.type !== "web.goto") {
    throw new Error("transition_discovery_execution_unsupported: exactly one web.goto action is required");
  }
  const gotoAction = actions[0];
  const target = profile.targets[gotoAction.target_alias];
  if (!target || target.kind !== "web") throw new Error("transition_target_web_origin_required");
  const targetOrigin = new URL(target.origin).origin;
  if (new URL(gotoAction.url).origin !== targetOrigin) throw new Error("transition_requested_url_origin_mismatch");

  const session = await createActiveRuntimeSession(options.outputDir, now);
  const browser = await chromium.launch({ headless: options.browser !== "visible" });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(gotoAction.url, { waitUntil: "domcontentloaded" });
    const issued = await discoverAndIssueReceipt({
      session,
      page,
      packageSha256: loaded.package_sha256,
      sourceCaseIds: loaded.contract.cases.map(({ source_case_id }) => source_case_id),
      transitionCaseId: contractCase.case_id,
      transitionActions: actions,
      targetOrigin,
      requestedUrl: gotoAction.url,
      pageStateId: targetState(contractCase),
      approvalPath: options.discoveryApproval,
      now,
    });
    return runPlanCommand({
      input: options.input,
      profile: options.profile,
      outputDir: session.runRoot,
      discoveryReceipts: [issued.receiptPath],
      discoveryApproval: options.discoveryApproval,
      runtimeSession: session,
      now,
    });
  } finally {
    await browser.close();
  }
}
