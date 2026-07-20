import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ContractCase } from "@saitamasans/testing-contract-compiler";

import { sha256Canonical } from "../compiler/canonical-json.js";
import { validateDocument } from "../schema-registry.js";
import type {
  DiscoveryReceiptReference,
  ExecutionProfile,
  ManifestAction,
} from "../types.js";

export const DISCOVERY_RECEIPT_SCHEMA_VERSION = "1.0.0";
export const DISCOVERY_SESSION_SCHEMA_VERSION = "1.0.0";
export const TESTING_RUNTIME_VERSION = "1.0.2-dev";
export const TESTING_RUNNER_VERSION = "1.1.2";
export const DISCOVERY_SESSION_MAX_AGE_MS = 15 * 60_000;

interface RuntimeDiscoverySession {
  session_schema_version: string;
  run_nonce: string;
  generated_by: string;
  runtime_version: string;
  runner_version: string;
  generated_at: string;
  expires_at: string;
  issued_receipts: Array<{ receipt_path: string; receipt_sha256: string }>;
}

export interface DiscoveryReceipt {
  receipt_schema_version: string;
  run_nonce: string;
  discovery_id: string;
  generated_by: string;
  runtime_version: string;
  runner_version: string;
  target_origin: string;
  requested_url: string;
  final_url: string;
  page_state_id: string;
  dom_sha256: string;
  accessibility_sha256: string;
  page_fingerprint_sha256: string;
  discovery_artifact_path: string;
  discovery_artifact_sha256: string;
  generated_at: string;
  expires_at: string;
  source_package_sha256: string;
  source_case_ids: string[];
  transition_case_id: string;
  transition_actions_sha256: string;
  approval_reference: string;
  purpose: "target_state_discovery_only";
}

interface WebDiscoveryArtifact {
  url: string;
  discovered_at: string;
  dom_sha256: string;
  accessibility_sha256: string;
}

export interface VerifyDiscoveryReceiptsInput {
  runDir: string;
  receiptPaths: string[];
  packageSha256: string;
  sourceCaseIds: string[];
  contractCases: ContractCase[];
  profile: ExecutionProfile;
  approvalReference?: string;
  now?: Date;
}

export interface IssueDiscoveryReceiptInput {
  runDir: string;
  artifactPath: string;
  outputPath: string;
  packageSha256: string;
  sourceCaseIds: string[];
  transitionCaseId: string;
  transitionActions: ManifestAction[];
  targetOrigin: string;
  requestedUrl: string;
  pageStateId: string;
  approvalReference: string;
  now?: Date;
}

function invalid(reason: string): never {
  throw new Error(`discovery_receipt_invalid: ${reason}`);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${field}_missing`);
  return value;
}

function requireSha(value: unknown, field: string): string {
  const result = requireString(value, field);
  if (!/^[a-f0-9]{64}$/.test(result)) invalid(`${field}_invalid`);
  return result;
}

function requireDate(value: unknown, field: string): Date {
  const text = requireString(value, field);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) invalid(`${field}_invalid`);
  return date;
}

async function requirePathInside(runDir: string, candidate: string, label: string): Promise<{ absolute: string; relative: string }> {
  const root = await realpath(runDir).catch(() => invalid("run_directory_missing"));
  const absolute = await realpath(path.resolve(candidate)).catch(() => invalid(`${label}_missing`));
  const relative = path.relative(root, absolute);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
    invalid(`${label}_outside_current_run`);
  }
  return { absolute, relative: relative.split(path.sep).join("/") };
}

async function requireOutputPathInside(runDir: string, candidate: string): Promise<{ absolute: string; relative: string }> {
  const root = await realpath(runDir).catch(() => invalid("run_directory_missing"));
  const absolute = path.resolve(candidate);
  const parent = await realpath(path.dirname(absolute)).catch(() => invalid("receipt_parent_missing"));
  const relativeParent = path.relative(root, parent);
  if (path.isAbsolute(relativeParent) || relativeParent === ".." || relativeParent.startsWith(`..${path.sep}`)) invalid("receipt_path_outside_current_run");
  if (path.extname(absolute).toLowerCase() !== ".json") invalid("receipt_path_invalid");
  return { absolute, relative: path.relative(root, absolute).split(path.sep).join("/") };
}

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label}_invalid`);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("discovery_receipt_invalid:")) throw error;
    return invalid(`${label}_invalid`);
  }
}

function normalizeOrigin(value: string, field: string): string {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) invalid(`${field}_invalid`);
    return url.origin;
  } catch {
    return invalid(`${field}_invalid`);
  }
}

function targetState(item: ContractCase): string | null {
  const browserState = item.effects.browser_state;
  if (!browserState || typeof browserState !== "object" || !("target_state" in browserState)) return null;
  const value = (browserState as { target_state?: unknown }).target_state;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function transitionActions(actions: ManifestAction[]): ManifestAction[] {
  return actions.filter((action) => !action.type.endsWith(".assert") && !action.type.startsWith("cleanup.") && action.type !== "execution.blocked");
}

function expectedWebBinding(profile: ExecutionProfile, actions: ManifestAction[]): { origin: string; requestedUrl: string } {
  const webActions = actions.filter((action) => action.type.startsWith("web."));
  const aliases = [...new Set(webActions.map(({ target_alias }) => target_alias))];
  if (aliases.length !== 1) invalid("transition_origin_ambiguous");
  const target = profile.targets[aliases[0]!];
  if (!target || target.kind !== "web") invalid("transition_origin_missing");
  const origin = normalizeOrigin(target.origin, "profile_origin");
  const firstGoto = webActions.find((action) => action.type === "web.goto");
  const requestedUrl = firstGoto?.type === "web.goto" ? firstGoto.url : target.origin;
  if (normalizeOrigin(requestedUrl, "requested_url") !== origin) invalid("requested_url_origin_mismatch");
  return { origin, requestedUrl };
}

function assertCurrentLifetime(session: RuntimeDiscoverySession, receipt: DiscoveryReceipt, now: Date): void {
  const sessionGenerated = requireDate(session.generated_at, "session_generated_at");
  const sessionExpires = requireDate(session.expires_at, "session_expires_at");
  const receiptGenerated = requireDate(receipt.generated_at, "generated_at");
  const receiptExpires = requireDate(receipt.expires_at, "expires_at");
  if (sessionGenerated.getTime() > now.getTime() || receiptGenerated.getTime() > now.getTime()) invalid("generated_at_in_future");
  if (now.getTime() - sessionGenerated.getTime() > DISCOVERY_SESSION_MAX_AGE_MS) invalid("old_session");
  if (now.getTime() > sessionExpires.getTime() || now.getTime() > receiptExpires.getTime()) invalid("expired");
  if (receiptGenerated.getTime() < sessionGenerated.getTime() || receiptExpires.getTime() > sessionExpires.getTime()) invalid("receipt_outside_session_lifetime");
}

function assertSessionIdentity(session: RuntimeDiscoverySession): void {
  if (session.session_schema_version !== DISCOVERY_SESSION_SCHEMA_VERSION) invalid("session_schema_version");
  if (session.generated_by !== "@saitamasans/testing-runtime") invalid("session_generator");
  if (session.runtime_version !== TESTING_RUNTIME_VERSION) invalid("runtime_version");
  if (session.runner_version !== TESTING_RUNNER_VERSION) invalid("runner_version");
  if (!/^[a-f0-9]{64}$/.test(session.run_nonce)) invalid("session_run_nonce");
  if (!Array.isArray(session.issued_receipts)) invalid("session_issued_receipts");
}

async function loadOrCreateRuntimeSession(runDir: string, now: Date): Promise<RuntimeDiscoverySession> {
  await mkdir(runDir, { recursive: true });
  const sessionPath = path.join(runDir, "runtime-session.json");
  try {
    const session = parseJsonObject(await readFile(sessionPath), "session") as unknown as RuntimeDiscoverySession;
    assertSessionIdentity(session);
    const sessionGenerated = requireDate(session.generated_at, "session_generated_at");
    const sessionExpires = requireDate(session.expires_at, "session_expires_at");
    if (sessionGenerated.getTime() > now.getTime() || now.getTime() - sessionGenerated.getTime() > DISCOVERY_SESSION_MAX_AGE_MS || now.getTime() > sessionExpires.getTime()) {
      invalid("old_session");
    }
    return session;
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
    if (code !== "ENOENT") throw error;
  }

  const generatedAt = now.toISOString();
  const session: RuntimeDiscoverySession = {
    session_schema_version: DISCOVERY_SESSION_SCHEMA_VERSION,
    run_nonce: randomBytes(32).toString("hex"),
    generated_by: "@saitamasans/testing-runtime",
    runtime_version: TESTING_RUNTIME_VERSION,
    runner_version: TESTING_RUNNER_VERSION,
    generated_at: generatedAt,
    expires_at: new Date(now.getTime() + DISCOVERY_SESSION_MAX_AGE_MS).toISOString(),
    issued_receipts: [],
  };
  await writeFile(sessionPath, `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return session;
}

export async function issueDiscoveryReceipt(input: IssueDiscoveryReceiptInput): Promise<{ receiptPath: string; receipt: DiscoveryReceipt }> {
  const now = input.now ?? new Date();
  if (!Number.isFinite(now.getTime())) invalid("current_time_invalid");
  const locatedArtifact = await requirePathInside(input.runDir, input.artifactPath, "artifact_path");
  const output = await requireOutputPathInside(input.runDir, input.outputPath);
  const artifactBytes = await readFile(locatedArtifact.absolute);
  const artifact = parseJsonObject(artifactBytes, "artifact") as unknown as WebDiscoveryArtifact;
  const domSha = requireSha(artifact.dom_sha256, "artifact_dom_sha256");
  const accessibilitySha = requireSha(artifact.accessibility_sha256, "artifact_accessibility_sha256");
  const finalUrl = requireString(artifact.url, "artifact_url");
  const targetOrigin = normalizeOrigin(input.targetOrigin, "target_origin");
  if (input.targetOrigin !== targetOrigin) invalid("target_origin_not_exact");
  if (normalizeOrigin(input.requestedUrl, "requested_url") !== targetOrigin) invalid("requested_url_origin_mismatch");
  if (normalizeOrigin(finalUrl, "final_url") !== targetOrigin) invalid("final_url_origin_mismatch");
  requireSha(input.packageSha256, "package_sha256");
  if (input.sourceCaseIds.length === 0 || input.sourceCaseIds.some((item) => typeof item !== "string" || item.length === 0)) invalid("source_cases_missing");
  if (input.transitionActions.length === 0) invalid("transition_actions_missing");
  requireString(input.transitionCaseId, "transition_case_id");
  requireString(input.pageStateId, "page_state_id");
  requireString(input.approvalReference, "approval_reference");

  const session = await loadOrCreateRuntimeSession(input.runDir, now);
  const receipt: DiscoveryReceipt = {
    receipt_schema_version: DISCOVERY_RECEIPT_SCHEMA_VERSION,
    run_nonce: session.run_nonce,
    discovery_id: `discovery-${sha256Canonical({ run_nonce: session.run_nonce, case_id: input.transitionCaseId, state_id: input.pageStateId, artifact_sha256: createHash("sha256").update(artifactBytes).digest("hex") }).slice(0, 24)}`,
    generated_by: session.generated_by,
    runtime_version: session.runtime_version,
    runner_version: session.runner_version,
    target_origin: targetOrigin,
    requested_url: input.requestedUrl,
    final_url: finalUrl,
    page_state_id: input.pageStateId,
    dom_sha256: domSha,
    accessibility_sha256: accessibilitySha,
    page_fingerprint_sha256: sha256Canonical({ dom_sha256: domSha, accessibility_sha256: accessibilitySha }),
    discovery_artifact_path: locatedArtifact.relative,
    discovery_artifact_sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    generated_at: now.toISOString(),
    expires_at: session.expires_at,
    source_package_sha256: input.packageSha256,
    source_case_ids: [...input.sourceCaseIds],
    transition_case_id: input.transitionCaseId,
    transition_actions_sha256: sha256Canonical(input.transitionActions),
    approval_reference: input.approvalReference,
    purpose: "target_state_discovery_only",
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  await writeFile(output.absolute, receiptBytes, { flag: "wx", mode: 0o600 });
  session.issued_receipts.push({
    receipt_path: output.relative,
    receipt_sha256: createHash("sha256").update(receiptBytes).digest("hex"),
  });
  await writeFile(path.join(input.runDir, "runtime-session.json"), `${JSON.stringify(session, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return { receiptPath: output.absolute, receipt };
}

function assertReceiptIdentity(receipt: DiscoveryReceipt, session: RuntimeDiscoverySession): void {
  if (receipt.receipt_schema_version !== DISCOVERY_RECEIPT_SCHEMA_VERSION) invalid("receipt_schema_version");
  if (receipt.generated_by !== session.generated_by) invalid("generator");
  if (receipt.runtime_version !== session.runtime_version) invalid("runtime_version");
  if (receipt.runner_version !== session.runner_version) invalid("runner_version");
  if (receipt.run_nonce !== session.run_nonce) invalid("run_nonce_mismatch");
  if (receipt.purpose !== "target_state_discovery_only") invalid("purpose");
  requireString(receipt.discovery_id, "discovery_id");
}

async function verifyOneReceipt(
  input: VerifyDiscoveryReceiptsInput,
  receiptPath: string,
  session: RuntimeDiscoverySession,
  contractCase: ContractCase,
): Promise<DiscoveryReceiptReference> {
  const locatedReceipt = await requirePathInside(input.runDir, receiptPath, "receipt_path");
  const receiptBytes = await readFile(locatedReceipt.absolute);
  const receipt = validateDocument<DiscoveryReceipt>("discovery-receipt", parseJsonObject(receiptBytes, "receipt"));
  assertReceiptIdentity(receipt, session);
  const receiptSha = createHash("sha256").update(receiptBytes).digest("hex");
  if (!session.issued_receipts.some((issued) => issued.receipt_path === locatedReceipt.relative && issued.receipt_sha256 === receiptSha)) {
    invalid("receipt_not_issued_by_current_session");
  }
  assertCurrentLifetime(session, receipt, input.now ?? new Date());

  const pageStateId = targetState(contractCase);
  if (!pageStateId || receipt.transition_case_id !== contractCase.case_id || receipt.page_state_id !== pageStateId) invalid("page_state_mismatch");
  if (receipt.source_package_sha256 !== input.packageSha256) invalid("package_mismatch");
  if (JSON.stringify(receipt.source_case_ids) !== JSON.stringify(input.sourceCaseIds)) invalid("source_cases_mismatch");
  if (!input.approvalReference || receipt.approval_reference !== input.approvalReference) invalid("approval_reference_mismatch");

  const actions = input.profile.case_plans?.[contractCase.case_id] ?? [];
  const transitions = transitionActions(actions);
  if (transitions.length === 0 || receipt.transition_actions_sha256 !== sha256Canonical(transitions)) invalid("actions_mismatch");
  const binding = expectedWebBinding(input.profile, transitions);
  if (receipt.target_origin !== binding.origin) invalid("origin_mismatch");
  if (receipt.requested_url !== binding.requestedUrl) invalid("requested_url_mismatch");
  if (normalizeOrigin(receipt.final_url, "final_url") !== binding.origin) invalid("final_url_origin_mismatch");

  if (path.isAbsolute(receipt.discovery_artifact_path) || receipt.discovery_artifact_path.split(/[\\/]+/).includes("..")) invalid("artifact_path_outside_current_run");
  const artifactCandidate = path.join(input.runDir, ...receipt.discovery_artifact_path.split("/"));
  const locatedArtifact = await requirePathInside(input.runDir, artifactCandidate, "artifact_path");
  const artifactBytes = await readFile(locatedArtifact.absolute);
  const artifact = parseJsonObject(artifactBytes, "artifact") as unknown as WebDiscoveryArtifact;
  requireSha(receipt.dom_sha256, "dom_sha256");
  requireSha(receipt.accessibility_sha256, "accessibility_sha256");
  requireSha(receipt.page_fingerprint_sha256, "page_fingerprint_sha256");
  requireSha(receipt.discovery_artifact_sha256, "discovery_artifact_sha256");
  if (artifact.url !== receipt.final_url) invalid("final_url_artifact_mismatch");
  if (artifact.dom_sha256 !== receipt.dom_sha256 || artifact.accessibility_sha256 !== receipt.accessibility_sha256) invalid("page_fingerprint_mismatch");
  const fingerprint = sha256Canonical({ dom_sha256: artifact.dom_sha256, accessibility_sha256: artifact.accessibility_sha256 });
  if (fingerprint !== receipt.page_fingerprint_sha256) invalid("page_fingerprint_mismatch");
  if (createHash("sha256").update(artifactBytes).digest("hex") !== receipt.discovery_artifact_sha256) invalid("artifact_sha_mismatch");

  return {
    case_id: contractCase.case_id,
    page_state_id: pageStateId,
    discovery_id: receipt.discovery_id,
    receipt_path: locatedReceipt.relative,
    receipt_sha256: receiptSha,
  };
}

export async function verifyDiscoveryReceipts(input: VerifyDiscoveryReceiptsInput): Promise<DiscoveryReceiptReference[]> {
  const requiredCases = input.contractCases.filter((item) => targetState(item) !== null);
  if (requiredCases.length === 0) {
    if (input.receiptPaths.length > 0) invalid("unexpected_receipt");
    return [];
  }
  if (input.receiptPaths.length === 0) {
    const item = requiredCases[0]!;
    throw new Error(`target_state_not_discovered: ${item.case_id}:${targetState(item)}`);
  }
  if (input.receiptPaths.length !== requiredCases.length) invalid("receipt_count_mismatch");

  const sessionPath = path.join(input.runDir, "runtime-session.json");
  await requirePathInside(input.runDir, sessionPath, "session_path");
  const session = parseJsonObject(await readFile(sessionPath), "session") as unknown as RuntimeDiscoverySession;
  assertSessionIdentity(session);

  const receipts = await Promise.all(requiredCases.map((item, index) => verifyOneReceipt(input, input.receiptPaths[index]!, session, item)));
  if (new Set(receipts.map(({ discovery_id }) => discovery_id)).size !== receipts.length) invalid("duplicate_discovery_id");
  return receipts;
}
