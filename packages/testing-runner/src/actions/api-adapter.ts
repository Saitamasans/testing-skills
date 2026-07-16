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
import type { ApiAssertAction, ApiConcurrentAction, ApiExtractAction, ApiRequestAction, CleanupApiAction } from "../types.js";
import type { ApiTarget } from "../types.js";
import { readJsonPointer } from "./variable-store.js";
import { isDeepStrictEqual } from "node:util";

type ApiExecutableAction = ApiRequestAction | ApiConcurrentAction | ApiExtractAction | ApiAssertAction | CleanupApiAction;
type ApiRequestLikeAction = ApiRequestAction | ApiConcurrentAction | CleanupApiAction;

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

function jsonAttachment(relativePath: string, value: unknown) {
  return {
    relativePath,
    content: `${JSON.stringify(value, null, 2)}\n`,
  };
}

function prepareRequest(action: ApiRequestLikeAction, context: ExecutionContext): { url: URL; init: RequestInit } {
  const target = targetFor(context, action.target_alias, "api") as ApiTarget;
  const url = new URL(interpolateActionText(action.path, context), target.origin);
  const requestAction = action as ApiRequestAction | ApiConcurrentAction;
  for (const [name, ref] of Object.entries(requestAction.query_refs ?? {})) {
    url.searchParams.set(name, String(resolveDataReference(ref, context)));
  }
  assertApprovedUrl(context, url.toString());

  const headers = new Headers();
  const bodySources = [requestAction.input_ref, requestAction.raw_body_ref, requestAction.json_body_refs]
    .filter((value) => value !== undefined);
  if (bodySources.length > 1) {
    throw new ActionExecutionError("blocked", "ambiguous_request_body", "Only one request body source may be declared");
  }
  let requestBody: string | undefined;
  if (requestAction.input_ref) {
    requestBody = JSON.stringify(resolveDataReference(requestAction.input_ref, context));
    headers.set("content-type", "application/json");
  } else if (requestAction.raw_body_ref) {
    requestBody = String(resolveDataReference(requestAction.raw_body_ref, context));
  } else if (requestAction.json_body_refs) {
    requestBody = JSON.stringify(Object.fromEntries(
      Object.entries(requestAction.json_body_refs).map(([name, ref]) => [name, resolveDataReference(ref, context)]),
    ));
    headers.set("content-type", "application/json");
  }
  for (const [name, ref] of Object.entries(requestAction.header_refs ?? {})) {
    headers.set(name, String(resolveDataReference(ref, context)));
  }
  const init: RequestInit = { method: action.method, redirect: "follow", headers };
  if (requestBody !== undefined) init.body = requestBody;
  return { url, init };
}

async function performRequest(
  action: ApiRequestLikeAction,
  context: ExecutionContext,
): Promise<{ lastResponse: LastApiResponse; actual: Record<string, unknown> }> {
  const { url, init } = prepareRequest(action, context);
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
  const actual = {
    request: { method: action.method, path: url.pathname, query_keys: [...url.searchParams.keys()] },
    response: { status: response.status, headers: lastResponse.headers, body: boundedBody(body) },
  };
  return { lastResponse, actual };
}

async function executeRequest(
  action: ApiRequestAction | CleanupApiAction,
  context: ExecutionContext,
): Promise<ActionStepResult> {
  const { lastResponse, actual } = await performRequest(action, context);
  context.lastApiResponse = lastResponse;
  context.lastApiResponses = [lastResponse];
  return {
    status: action.type === "cleanup.api" && (lastResponse.status < 200 || lastResponse.status >= 300) ? "failed" : "passed",
    actual,
    attachments: [jsonAttachment(`${action.action_id}/api-request-response.json`, actual)],
  };
}

async function executeConcurrent(action: ApiConcurrentAction, context: ExecutionContext): Promise<ActionStepResult> {
  const results = await Promise.all(
    Array.from({ length: action.concurrency }, () => performRequest(action, context)),
  );
  const responses = results.map((item) => item.lastResponse);
  const firstResponse = responses[0];
  if (!firstResponse) {
    throw new ActionExecutionError("blocked", "missing_concurrent_response", "Concurrent API action produced no response");
  }
  context.lastApiResponses = responses;
  context.lastApiResponse = firstResponse;
  const actual = {
    concurrency: action.concurrency,
    request: results[0]?.actual.request,
    responses: results.map((item) => item.actual.response),
  };
  return {
    status: "passed",
    actual,
    attachments: [jsonAttachment(`${action.action_id}/api-concurrent-request-response.json`, actual)],
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
  if (match) {
    const expected = Number(match[1]);
    return assertionResult(action, context.lastApiResponse.status, expected);
  }
  const negativeStatusMatch = action.assertion.match(/^status is not (\d{3})$/i);
  if (negativeStatusMatch) {
    const expected = Number(negativeStatusMatch[1]);
    return assertionResult(action, context.lastApiResponse.status, expected, context.lastApiResponse.status !== expected);
  }

  const batchStatusMatch = action.assertion.match(/^batch status all (\d{3})$/i);
  if (batchStatusMatch) {
    const expected = Number(batchStatusMatch[1]);
    const actual = context.lastApiResponses?.map((item) => item.status) ?? [];
    return assertionResult(action, actual, `all ${expected}`, actual.length > 0 && actual.every((status) => status === expected));
  }

  const batchBodyMatch = action.assertion.match(/^batch body\s+(\/\S*)\s+all equal$/i);
  if (batchBodyMatch) {
    const actual = (context.lastApiResponses ?? []).map((item) => readJsonPointer(item, batchBodyMatch[1]!));
    return assertionResult(
      action,
      actual,
      actual[0],
      actual.length > 0 && actual.every((value) => isDeepStrictEqual(value, actual[0])),
    );
  }

  const bodyMatch = action.assertion.match(
    /^body\s+(\/\S*)\s+(equals|not equals)\s+(fixture|output|env):([A-Za-z][A-Za-z0-9_.-]*)$/i,
  );
  if (!bodyMatch) {
    throw new ActionExecutionError("blocked", "unsupported_assertion", `Unsupported API assertion: ${action.assertion}`);
  }
  const [, pointer, operator, source, name] = bodyMatch;
  const actual = readJsonPointer(context.lastApiResponse, pointer!);
  const expected = resolveDataReference({
    source: source!.toLowerCase() as "fixture" | "output" | "env",
    name: name!,
  }, context);
  const equal = isDeepStrictEqual(actual, expected);
  return assertionResult(action, actual, expected, operator!.toLowerCase() === "equals" ? equal : !equal);
}

function assertionResult(
  action: ApiAssertAction,
  actual: unknown,
  expected: unknown,
  passed = isDeepStrictEqual(actual, expected),
): ActionStepResult {
  const details = { assertion: action.assertion, actual, expected };
  const result: ActionStepResult = {
    status: passed ? (action.verdict_policy === "pending_only" ? "pending" : "passed") : "failed",
    actual: details,
    attachments: [jsonAttachment(`${action.action_id}/api-assertion.json`, details)],
  };
  if (!passed) {
    result.error = { type: "business_assertion_failed", message: `API assertion failed: ${action.assertion}` };
    if (action.root_cause_key) result.root_cause_key = action.root_cause_key;
  }
  return result;
}

export async function executeApiAction(action: ApiExecutableAction, context: ExecutionContext): Promise<ActionStepResult> {
  if (action.type === "api.concurrent") return executeConcurrent(action, context);
  if (action.type === "api.request" || action.type === "cleanup.api") return executeRequest(action, context);
  if (action.type === "api.extract") return executeExtract(action, context);
  return executeAssert(action, context);
}
