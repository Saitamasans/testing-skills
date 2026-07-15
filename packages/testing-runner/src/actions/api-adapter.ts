import {
  ActionExecutionError,
  assertApprovedUrl,
  interpolateActionText,
  resolveDataReference,
  targetFor,
  type ActionStepResult,
  type ExecutionContext,
  type LastApiResponse,
} from "../runtime/execution-context.js";
import type { ApiAssertAction, ApiExtractAction, ApiRequestAction, CleanupApiAction } from "../types.js";
import type { ApiTarget } from "../types.js";
import { readJsonPointer } from "./variable-store.js";

type ApiExecutableAction = ApiRequestAction | ApiExtractAction | ApiAssertAction | CleanupApiAction;

function boundedBody(body: unknown): unknown {
  const serialized = JSON.stringify(body);
  if (serialized.length <= 10_000) return body;
  return { truncated: true, length: serialized.length };
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") return "";
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.slice(0, 10_000);
  }
}

function selectedHeaders(headers: Headers): Record<string, string> {
  const selected = new Set(["content-type", "location", "x-request-id"]);
  return Object.fromEntries([...headers.entries()].filter(([key]) => selected.has(key.toLowerCase())));
}

async function executeRequest(
  action: ApiRequestAction | CleanupApiAction,
  context: ExecutionContext,
): Promise<ActionStepResult> {
  const target = targetFor(context, action.target_alias, "api") as ApiTarget;
  const url = assertApprovedUrl(context, new URL(interpolateActionText(action.path, context), target.origin).toString());
  const init: RequestInit = { method: action.method, redirect: "follow", headers: {} };
  if ("input_ref" in action && action.input_ref) {
    init.body = JSON.stringify(resolveDataReference(action.input_ref, context));
    init.headers = { "content-type": "application/json" };
  }
  const response = await fetch(url, init);
  assertApprovedUrl(context, response.url);
  const body = await parseBody(response);
  const lastResponse: LastApiResponse = {
    action_id: action.action_id,
    status: response.status,
    headers: selectedHeaders(response.headers),
    body,
    url: response.url,
  };
  context.lastApiResponse = lastResponse;
  return {
    status: response.ok ? "passed" : "failed",
    actual: {
      request: { method: action.method, path: url.pathname },
      response: { status: response.status, headers: lastResponse.headers, body: boundedBody(body) },
    },
  };
}

function executeExtract(action: ApiExtractAction, context: ExecutionContext): ActionStepResult {
  if (!context.lastApiResponse) {
    throw new ActionExecutionError("blocked", "missing_response", "No API response is available for extraction");
  }
  const value = readJsonPointer(context.lastApiResponse, action.from);
  if (value === undefined) {
    throw new ActionExecutionError("blocked", "missing_extract_value", `Extraction path was not found: ${action.from}`);
  }
  context.variables.set(action.as, value, { action_id: action.action_id, source: "api.extract" });
  return { status: "passed", actual: { variable: action.as } };
}

function executeAssert(action: ApiAssertAction, context: ExecutionContext): ActionStepResult {
  if (!context.lastApiResponse) {
    throw new ActionExecutionError("blocked", "missing_response", "No API response is available for assertion");
  }
  const match = action.assertion.match(/^status is (\d{3})$/i);
  if (!match) {
    throw new ActionExecutionError("blocked", "unsupported_assertion", `Unsupported API assertion: ${action.assertion}`);
  }
  const expected = Number(match[1]);
  return {
    status: context.lastApiResponse.status === expected ? "passed" : "failed",
    actual: { status: context.lastApiResponse.status, expected },
  };
}

export async function executeApiAction(action: ApiExecutableAction, context: ExecutionContext): Promise<ActionStepResult> {
  if (action.type === "api.request" || action.type === "cleanup.api") return executeRequest(action, context);
  if (action.type === "api.extract") return executeExtract(action, context);
  return executeAssert(action, context);
}
