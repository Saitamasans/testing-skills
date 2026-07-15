import { executeApiAction } from "./api-adapter.js";
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
  "api.extract",
  "api.assert",
  "db.select",
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
  if (result.error) outcome.error = result.error;
  return outcome;
}

export async function executeAction(action: ManifestAction, context: ExecutionContext): Promise<ActionOutcome> {
  const startedAt = new Date().toISOString();
  try {
    if (!ALLOWED_ACTION_TYPES.has(action.type)) {
      return blocked(action, startedAt, "unknown_action", `Action type is not allowlisted: ${action.type}`);
    }
    targetFor(context, action.target_alias, actionTargetKind(action));
    if (action.type === "db.select") {
      return blocked(action, startedAt, "database_not_enabled", "Database actions are handled by the read-only adapter task");
    }
    const result = action.type.startsWith("web.") || action.type === "cleanup.web"
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
