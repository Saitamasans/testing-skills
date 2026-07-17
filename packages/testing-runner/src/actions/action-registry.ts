import { executeApiAction } from "./api-adapter.js";
import { executeDatabaseAction } from "./database-adapter.js";
import { executeWebAction } from "./web-adapter.js";
import {
  ActionExecutionError,
  actionTargetKind,
  targetFor,
  type ActionOutcome,
  type ActionStepResult,
  type ExecutionContext,
} from "../runtime/execution-context.js";
import { redact } from "../security/redactor.js";
import type { ManifestAction } from "../types.js";
import type { executeApiAction as executeApiActionType } from "./api-adapter.js";
import type { executeWebAction as executeWebActionType } from "./web-adapter.js";

const ALLOWED_ACTION_TYPES = new Set([
  "web.goto",
  "web.fill",
  "web.click",
  "web.select",
  "web.wait",
  "web.assert",
  "api.request",
  "api.concurrent",
  "api.extract",
  "api.assert",
  "execution.blocked",
  "db.select",
  "db.assert",
  "cleanup.api",
  "cleanup.web",
]);

function actionId(action: ManifestAction): string {
  return (action as { action_id?: string }).action_id ?? "unknown-action";
}

function blocked(action: ManifestAction, startedAt: string, type: string, message: string): ActionOutcome {
  return {
    action_id: actionId(action),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: "blocked",
    attachments: [],
    error: { type, message },
  };
}

function completed(action: ManifestAction, startedAt: string, result: ActionStepResult, context: ExecutionContext): ActionOutcome {
  const outcome: ActionOutcome = {
    action_id: actionId(action),
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    status: result.status,
    attachments: result.attachments ?? [],
  };
  if (result.actual !== undefined) {
    outcome.actual = redact(result.actual, { fingerprints: context.redactionFingerprints });
  }
  if (result.root_cause_key) outcome.root_cause_key = result.root_cause_key;
  if (result.error) outcome.error = result.error;
  return outcome;
}

export async function executeAction(action: ManifestAction, context: ExecutionContext): Promise<ActionOutcome> {
  const startedAt = new Date().toISOString();
  try {
    if (!ALLOWED_ACTION_TYPES.has(action.type)) {
      return blocked(action, startedAt, "unknown_action", `Action type is not allowlisted: ${action.type}`);
    }
    if (action.type === "execution.blocked") {
      const details = { reason: action.reason };
      return completed(action, startedAt, {
        status: "blocked",
        actual: details,
        attachments: [{
          relativePath: `${action.action_id}/execution-blocked.json`,
          content: `${JSON.stringify(details, null, 2)}\n`,
        }],
        error: { type: "execution_input_gap", message: action.reason },
      }, context);
    }
    targetFor(context, action.target_alias, actionTargetKind(action));
    const result = action.type === "db.select" || action.type === "db.assert"
      ? await executeDatabaseAction(action, context)
      : action.type.startsWith("web.") || action.type === "cleanup.web"
        ? await executeWebAction(action as Parameters<typeof executeWebActionType>[0], context)
        : await executeApiAction(action as Parameters<typeof executeApiActionType>[0], context);
    return completed(action, startedAt, result, context);
  } catch (error) {
    if (error instanceof ActionExecutionError) {
      return {
        action_id: actionId(action),
        started_at: startedAt,
        finished_at: new Date().toISOString(),
        status: error.status,
        attachments: [],
        error: { type: error.type, message: error.message },
      };
    }
    return {
      action_id: actionId(action),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
      status: "executor_error",
      attachments: [],
      error: {
        type: "executor_error",
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
