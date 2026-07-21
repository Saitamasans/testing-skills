import { writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";
import type { Browser, BrowserContext, Page } from "playwright";

import { executeAction } from "../actions/action-registry.js";
import { readExecutionPackage } from "../input/execution-package.js";
import { createExecutionContext } from "../runtime/execution-context.js";
import { resolveCredentials } from "../security/credential-resolver.js";
import { planDiscoveryTasks, transitionActions, type DiscoveryTask } from "../discovery/discovery-task.js";
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
  discoveryApproval: string | string[];
  transitionCaseId?: string;
  browser?: "visible" | "headless";
  now?: Date;
  clock?: () => Date;
  afterReceiptIssued?: (page: Page, task?: DiscoveryTask) => Promise<void>;
  launchBrowser?: (options: { headless: boolean }) => Promise<Browser>;
}

export interface DiscoverPlanCommandResult extends PlanCommandResult {
  discovery_tasks: DiscoveryTask[];
}

export async function runDiscoverPlanCommand(options: DiscoverPlanCommandOptions): Promise<DiscoverPlanCommandResult> {
  if (!options.input.toLowerCase().endsWith(".execution-package.zip")) {
    throw new Error("discover_plan_execution_package_required");
  }
  const clock = options.clock ?? (options.now ? () => options.now! : () => new Date());
  const loaded = await readExecutionPackage(options.input);
  const profile = await readProfile(options.profile);
  const tasks = planDiscoveryTasks({ contractCases: loaded.contract.cases, profile, packageSha256: loaded.package_sha256 });
  if (tasks.length === 0) throw new Error("transition_case_target_state_required");
  if (options.transitionCaseId && (tasks.length !== 1 || tasks[0]?.transition_case_id !== options.transitionCaseId)) {
    throw new Error("transition_case_id_only_supported_for_single_discovery_task");
  }
  const approvals = Array.isArray(options.discoveryApproval) ? options.discoveryApproval : [options.discoveryApproval];
  if (approvals.length !== tasks.length) throw new Error(`discovery_approval_count_mismatch: required=${tasks.length}:received=${approvals.length}`);

  const session = await createActiveRuntimeSession(options.outputDir, clock());
  await writeFile(path.join(session.runRoot, "discovery-tasks.json"), `${JSON.stringify({ discovery_tasks: tasks }, null, 2)}\n`, "utf8");
  const launchBrowser = options.launchBrowser ?? ((launchOptions: { headless: boolean }) => chromium.launch(launchOptions));
  const browser = await launchBrowser({ headless: options.browser !== "visible" });
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const receiptPaths: string[] = [];
  try {
    const secrets = resolveCredentials(Object.entries(profile.credentials).map(([alias, ref]) => ({
      alias,
      source: "configured_env" as const,
      name: ref.name,
    })), process.env, { now: clock() });
    for (const [index, task] of tasks.entries()) {
      const actions = transitionActions(profile.case_plans?.[task.transition_case_id] ?? []);
      const approvalInput = {
        session,
        approvalPath: approvals[index]!,
        packageSha256: loaded.package_sha256,
        sourceCaseIds: loaded.contract.cases.map(({ source_case_id }) => source_case_id),
        sourceCaseId: task.source_case_id,
        discoveryTaskId: task.discovery_task_id,
        transitionCaseId: task.transition_case_id,
        transitionActions: actions,
        targetOrigin: task.origin,
        requestedUrl: task.requested_url,
        pageStateId: task.target_state,
        isolationScope: task.isolation_scope,
        requiredAuthProfile: task.required_auth_profile,
      };
      try {
        await validateDiscoveryApprovalForTransition({ ...approvalInput, now: clock() });
        const browserContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
        contexts.push(browserContext);
        const page = await browserContext.newPage();
        pages.push(page);
        const context = createExecutionContext({
          targets: profile.targets,
          approvedOrigins: [task.origin],
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
        const issued = await discoverAndIssueReceipt({ ...approvalInput, page, clock });
        receiptPaths.push(issued.receiptPath);
        await options.afterReceiptIssued?.(page, task);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`discovery_task_failed:${task.discovery_task_id}:${task.source_case_id}:${message}`);
      }
    }
    const result = await runPlanCommand({
      input: options.input,
      profile: options.profile,
      outputDir: session.runRoot,
      discoveryReceipts: receiptPaths,
      discoveryApprovals: approvals,
      runtimeSession: session,
      livePages: pages,
      clock,
    });
    return { ...result, discovery_tasks: tasks };
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    await browser.close();
  }
}
