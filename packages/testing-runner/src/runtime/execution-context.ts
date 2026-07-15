import type { Page } from "playwright";

import { VariableStore } from "../actions/variable-store.js";
import type { DatabaseAdapter } from "../actions/database-adapter.js";
import type { RuntimeSecretStore } from "../security/credential-resolver.js";
import type { SecretFingerprint } from "../security/redactor.js";
import type { DataReference, ExecutionTarget, ManifestAction } from "../types.js";

export type ActionOutcomeStatus =
  | "passed"
  | "failed"
  | "blocked"
  | "manual_required"
  | "executor_error";

export interface ActionOutcome {
  action_id: string;
  started_at: string;
  finished_at: string;
  status: ActionOutcomeStatus;
  actual?: unknown;
  attachments: string[];
  error?: {
    type: string;
    message: string;
  };
}

export interface ActionStepResult {
  status: ActionOutcomeStatus;
  actual?: unknown;
  attachments?: string[];
  error?: {
    type: string;
    message: string;
  };
}

export interface LastApiResponse {
  action_id: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
  url: string;
}

export interface ExecutionContext {
  targets: Record<string, ExecutionTarget>;
  approvedOrigins: Set<string>;
  variables: VariableStore;
  data: Record<string, unknown>;
  secrets: RuntimeSecretStore;
  page?: Page;
  mode: "interactive" | "ci";
  redactionFingerprints: SecretFingerprint[];
  lastApiResponse?: LastApiResponse;
  databaseAdapters?: Partial<Record<"mysql" | "postgresql", DatabaseAdapter>>;
}

export interface CreateExecutionContextInput {
  targets: Record<string, ExecutionTarget>;
  approvedOrigins: string[];
  data?: Record<string, unknown>;
  secrets: RuntimeSecretStore;
  page?: Page;
  mode?: "interactive" | "ci";
  redactionFingerprints?: SecretFingerprint[];
  databaseAdapters?: Partial<Record<"mysql" | "postgresql", DatabaseAdapter>>;
}

export class ActionExecutionError extends Error {
  readonly status: ActionOutcomeStatus;
  readonly type: string;

  constructor(status: ActionOutcomeStatus, type: string, message: string) {
    super(message);
    this.name = "ActionExecutionError";
    this.status = status;
    this.type = type;
  }
}

export function createExecutionContext(input: CreateExecutionContextInput): ExecutionContext {
  const context: ExecutionContext = {
    targets: input.targets,
    approvedOrigins: new Set(input.approvedOrigins.map((origin) => new URL(origin).origin)),
    variables: new VariableStore(),
    data: input.data ?? {},
    secrets: input.secrets,
    mode: input.mode ?? "interactive",
    redactionFingerprints: input.redactionFingerprints ?? input.secrets.fingerprints(),
  };
  if (input.page) context.page = input.page;
  if (input.databaseAdapters) context.databaseAdapters = input.databaseAdapters;
  return context;
}

export function targetFor(context: ExecutionContext, alias: string, kind?: ExecutionTarget["kind"]): ExecutionTarget {
  const target = context.targets[alias];
  if (!target) throw new ActionExecutionError("blocked", "unknown_target", `Target alias is not declared: ${alias}`);
  if (kind && target.kind !== kind) {
    throw new ActionExecutionError("blocked", "target_kind", `Target ${alias} is ${target.kind}, not ${kind}`);
  }
  return target;
}

export function assertApprovedUrl(context: ExecutionContext, value: string): URL {
  const url = new URL(value);
  if (!context.approvedOrigins.has(url.origin)) {
    throw new ActionExecutionError("blocked", "target_origin", `URL origin is not approved: ${url.origin}`);
  }
  return url;
}

export function resolveDataReference(ref: DataReference, context: ExecutionContext): unknown {
  if (ref.source === "fixture") {
    if (!(ref.name in context.data)) {
      throw new ActionExecutionError("blocked", "missing_fixture", `Fixture data is missing: ${ref.name}`);
    }
    return context.data[ref.name];
  }
  if (ref.source === "output") return context.variables.get(ref.name).value;
  if (ref.source === "env") return context.secrets.get(ref.name);
  throw new ActionExecutionError("blocked", "unsupported_data_ref", `Unsupported data reference source: ${ref.source}`);
}

export function interpolateActionText(text: string, context: ExecutionContext): string {
  try {
    return context.variables.interpolate(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ActionExecutionError("blocked", "missing_variable", message);
  }
}

export function actionTargetKind(action: ManifestAction): "web" | "api" | "database" {
  if (action.type.startsWith("web.") || action.type === "cleanup.web") return "web";
  if (action.type === "db.select") return "database";
  return "api";
}
