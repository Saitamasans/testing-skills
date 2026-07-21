import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ContractCase } from "@saitamasans/testing-contract-compiler";
import type { Page } from "playwright";

import { canonicalize, sha256Canonical } from "../compiler/canonical-json.js";
import { discoveryTaskId, planDiscoveryTasks, transitionActions, type DiscoveryTask } from "../discovery/discovery-task.js";
import { discoverCurrentPage } from "../locator/page-discovery.js";
import { validateDocument } from "../schema-registry.js";
import type { DiscoveryReceiptReference, ExecutionProfile, ManifestAction } from "../types.js";
import { TESTING_RUNNER_VERSION } from "../version.js";

export { TESTING_RUNNER_VERSION } from "../version.js";

export const DISCOVERY_RECEIPT_SCHEMA_VERSION = "1.0.0";
export const DISCOVERY_SESSION_SCHEMA_VERSION = "1.0.0";
export const TESTING_RUNTIME_VERSION = "1.0.3-dev";
export const DISCOVERY_SESSION_MAX_AGE_MS = 15 * 60_000;

interface RuntimeSessionState {
  secret: Buffer;
  issued: Map<string, { receiptSha256: string; mac: string }>;
}

const SESSION_TOKEN = Symbol("active-testing-runtime-session");
const ACTIVE_SESSIONS = new WeakMap<ActiveRuntimeSession, RuntimeSessionState>();

export class ActiveRuntimeSession {
  readonly runRoot: string;
  readonly runNonce: string;
  readonly generatedAt: string;
  readonly expiresAt: string;

  constructor(token: symbol, runRoot: string, runNonce: string, generatedAt: string, expiresAt: string) {
    if (token !== SESSION_TOKEN) throw new Error("runtime_session_invalid");
    this.runRoot = runRoot;
    this.runNonce = runNonce;
    this.generatedAt = generatedAt;
    this.expiresAt = expiresAt;
  }
}

export interface DiscoveryApproval {
  approval_schema_version: "1.0.0";
  approval_id: string;
  source_package_sha256: string;
  source_case_ids: string[];
  transition_case_id: string;
  transition_actions_sha256: string;
  target_origin: string;
  requested_url: string;
  page_state_id: string;
  approved_risks: Array<"R0" | "R1" | "R2" | "R3">;
  approved_r3_action_ids: string[];
  issued_by: string;
  issued_at: string;
  expires_at: string;
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
  discovery_task_id: string;
  source_case_id: string;
  transition_case_id: string;
  transition_actions_sha256: string;
  approval_reference: string;
  approval_sha256: string;
  purpose: "target_state_discovery_only";
  session_mac: string;
}

interface WebDiscoveryArtifact {
  url: string;
  discovered_at: string;
  dom_sha256: string;
  accessibility_sha256: string;
}

export interface DiscoverAndIssueReceiptInput {
  session: ActiveRuntimeSession;
  page: Page;
  packageSha256: string;
  sourceCaseIds: string[];
  sourceCaseId?: string;
  discoveryTaskId?: string;
  transitionCaseId: string;
  transitionActions: ManifestAction[];
  targetOrigin: string;
  requestedUrl: string;
  pageStateId: string;
  isolationScope?: ContractCase["isolation_scope"];
  flowGroup?: string | null;
  requiredAuthProfile?: string | null;
  startState?: Record<string, unknown>;
  authProfile?: Record<string, unknown>;
  approvalPath: string;
  now?: Date;
  clock?: () => Date;
  afterExclusiveCreate?: (kind: "artifact" | "receipt", file: string) => Promise<void>;
}

export interface VerifyDiscoveryReceiptsInput {
  session?: ActiveRuntimeSession;
  receiptPaths: string[];
  packageSha256: string;
  sourceCaseIds: string[];
  contractCases: ContractCase[];
  profile: ExecutionProfile;
  approvalPath?: string;
  approvalPaths?: string[];
  livePage?: Page;
  livePages?: Page[];
  now?: Date;
  clock?: () => Date;
}

function invalid(reason: string): never {
  throw new Error(`discovery_receipt_invalid: ${reason}`);
}

export function validateReceiptTaskQuorum<T extends { discovery_task_id: string }>(
  requiredTaskIds: readonly string[],
  receipts: readonly T[],
): T[] {
  const required = new Set(requiredTaskIds);
  if (required.size !== requiredTaskIds.length) invalid("duplicate_required_task_id");
  const byTask = new Map<string, T>();
  for (const receipt of receipts) {
    if (!required.has(receipt.discovery_task_id)) invalid(`unknown_task_receipt:${receipt.discovery_task_id}`);
    if (byTask.has(receipt.discovery_task_id)) invalid(`duplicate_task_receipt:${receipt.discovery_task_id}`);
    byTask.set(receipt.discovery_task_id, receipt);
  }
  for (const taskId of requiredTaskIds) {
    if (!byTask.has(taskId)) invalid(`missing_task_receipt:${taskId}`);
  }
  return requiredTaskIds.map((taskId) => byTask.get(taskId)!);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) invalid(`${field}_missing`);
  return value;
}

function requireSha(value: unknown, field: string): string {
  const valueString = requireString(value, field);
  if (!/^[a-f0-9]{64}$/.test(valueString)) invalid(`${field}_invalid`);
  return valueString;
}

function requireDate(value: unknown, field: string): Date {
  const text = requireString(value, field);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== text) invalid(`${field}_invalid`);
  return date;
}

function normalizeOrigin(value: string, field: string): string {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") invalid(`${field}_invalid`);
    return url.origin;
  } catch {
    return invalid(`${field}_invalid`);
  }
}

function stateFor(session: ActiveRuntimeSession, now = new Date()): RuntimeSessionState {
  const state = ACTIVE_SESSIONS.get(session);
  if (!state) throw new Error("runtime_session_required");
  if (now.getTime() < new Date(session.generatedAt).getTime() || now.getTime() > new Date(session.expiresAt).getTime()) {
    throw new Error("runtime_session_expired");
  }
  return state;
}

async function canonicalRunRoot(runDir: string): Promise<string> {
  await mkdir(runDir, { recursive: true });
  const root = await realpath(runDir);
  if (path.basename(root).toLowerCase() !== ".testing-run") throw new Error("runtime_session_run_root_invalid");
  return root;
}

function clockFor(input: { now?: Date; clock?: () => Date }): () => Date {
  if (input.clock) return input.clock;
  if (input.now) return () => input.now!;
  return () => new Date();
}

export function discoveryCaseDirectoryName(caseId: string): string {
  if (typeof caseId !== "string" || caseId.length === 0) invalid("transition_case_id_invalid");
  return `case-${createHash("sha256").update(caseId, "utf8").digest("hex")}`;
}

function assertResolvedInside(root: string, resolved: string, label: string): void {
  const relative = path.relative(root, resolved);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) invalid(`${label}_outside_current_run`);
}

async function requireWriteDirectoryInside(session: ActiveRuntimeSession, directory: string, now: Date): Promise<void> {
  stateFor(session, now);
  const resolved = await realpath(directory).catch(() => invalid("discovery_directory_missing"));
  assertResolvedInside(session.runRoot, resolved, "discovery_directory");
}

function sameFileIdentity(left: Awaited<ReturnType<typeof lstat>>, right: Awaited<ReturnType<typeof lstat>>): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

async function removeCreatedPathBestEffort(session: ActiveRuntimeSession, file: string, createdIdentity?: Awaited<ReturnType<typeof lstat>>): Promise<void> {
  const current = await lstat(file).catch(() => undefined);
  if (!current) return;
  if (current.isSymbolicLink() || (createdIdentity && sameFileIdentity(current, createdIdentity))) {
    await rm(file, { force: true }).catch(() => undefined);
    return;
  }
  const resolved = await realpath(file).catch(() => undefined);
  if (!resolved) return;
  const relative = path.relative(session.runRoot, resolved);
  if (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`)) await rm(file, { force: true }).catch(() => undefined);
}

async function createExclusiveContainedFile(input: {
  session: ActiveRuntimeSession;
  directory: string;
  file: string;
  bytes: Buffer;
  kind: "artifact" | "receipt";
  clock: () => Date;
  afterCreate?: (kind: "artifact" | "receipt", file: string) => Promise<void>;
}): Promise<Awaited<ReturnType<typeof lstat>>> {
  await requireWriteDirectoryInside(input.session, input.directory, input.clock());
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let createdIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    handle = await open(input.file, "wx", 0o600);
    await handle.writeFile(input.bytes);
    const handleStat = await handle.stat();
    createdIdentity = await lstat(input.file);
    if (!createdIdentity.isFile() || createdIdentity.isSymbolicLink() || createdIdentity.dev !== handleStat.dev || createdIdentity.ino !== handleStat.ino) {
      invalid(`${input.kind}_identity_changed`);
    }
    try {
      await input.afterCreate?.(input.kind, input.file);
    } catch {
      invalid(`${input.kind}_identity_changed`);
    }
    const current = await lstat(input.file).catch(() => invalid(`${input.kind}_missing_after_create`));
    const liveHandleStat = await handle.stat();
    if (
      !current.isFile()
      || current.isSymbolicLink()
      || !sameFileIdentity(current, createdIdentity)
      || current.dev !== liveHandleStat.dev
      || current.ino !== liveHandleStat.ino
    ) invalid(`${input.kind}_identity_changed`);
    const resolved = await realpath(input.file).catch(() => invalid(`${input.kind}_missing_after_create`));
    assertResolvedInside(input.session.runRoot, resolved, input.kind);
    await requireWriteDirectoryInside(input.session, input.directory, input.clock());
    await handle.close();
    handle = undefined;
    return current;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await removeCreatedPathBestEffort(input.session, input.file, createdIdentity);
    throw error;
  }
}

export async function createActiveRuntimeSession(runDir: string, now = new Date()): Promise<ActiveRuntimeSession> {
  if (!Number.isFinite(now.getTime())) throw new Error("runtime_session_time_invalid");
  const runRoot = await canonicalRunRoot(runDir);
  const generatedAt = now.toISOString();
  const session = new ActiveRuntimeSession(
    SESSION_TOKEN,
    runRoot,
    randomBytes(32).toString("hex"),
    generatedAt,
    new Date(now.getTime() + DISCOVERY_SESSION_MAX_AGE_MS).toISOString(),
  );
  ACTIVE_SESSIONS.set(session, { secret: randomBytes(32), issued: new Map() });
  await writeFile(path.join(runRoot, "runtime-session.json"), `${JSON.stringify({
    session_schema_version: DISCOVERY_SESSION_SCHEMA_VERSION,
    run_nonce: session.runNonce,
    generated_by: "@saitamasans/testing-runtime",
    runtime_version: TESTING_RUNTIME_VERSION,
    runner_version: TESTING_RUNNER_VERSION,
    generated_at: session.generatedAt,
    expires_at: session.expiresAt,
    authority: "in_memory_capability_required",
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return session;
}

async function requirePathInside(session: ActiveRuntimeSession, candidate: string, label: string, now: Date): Promise<{ absolute: string; relative: string }> {
  stateFor(session, now);
  const absolute = await realpath(path.resolve(candidate)).catch(() => invalid(`${label}_missing`));
  const relative = path.relative(session.runRoot, absolute);
  if (!relative || path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) invalid(`${label}_outside_current_run`);
  return { absolute, relative: relative.split(path.sep).join("/") };
}

function parseObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid(`${label}_invalid`);
    return value as Record<string, unknown>;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("discovery_receipt_invalid:")) throw error;
    return invalid(`${label}_invalid`);
  }
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

async function readApproval(
  session: ActiveRuntimeSession,
  approvalPath: string,
  expected: Omit<DiscoveryApproval, "approval_schema_version" | "approval_id" | "approved_risks" | "approved_r3_action_ids" | "issued_by" | "issued_at" | "expires_at">,
  now: Date,
): Promise<{ approval: DiscoveryApproval; sha256: string }> {
  const located = await requirePathInside(session, approvalPath, "approval_path", now);
  const bytes = await readFile(located.absolute);
  const approval = validateDocument<DiscoveryApproval>("discovery-approval", parseObject(bytes, "approval"));
  const issuedAt = requireDate(approval.issued_at, "approval_issued_at");
  const expiresAt = requireDate(approval.expires_at, "approval_expires_at");
  if (issuedAt.getTime() > now.getTime() || expiresAt.getTime() < now.getTime()) invalid("approval_expired");
  for (const [key, value] of Object.entries(expected)) {
    if (JSON.stringify(approval[key as keyof DiscoveryApproval]) !== JSON.stringify(value)) invalid(`approval_${key}_mismatch`);
  }
  return { approval, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function requireApprovedTransitionRisks(approval: DiscoveryApproval, actions: ManifestAction[]): void {
  const approvedRisks = new Set(approval.approved_risks);
  for (const action of actions) {
    if (action.risk === "R2" || action.risk === "R3") invalid(`automatic_discovery_risk_not_allowed_${action.risk}`);
    if (!approvedRisks.has(action.risk)) invalid(`approval_risk_missing_${action.risk}`);
  }
}

export interface ValidateDiscoveryApprovalInput {
  session: ActiveRuntimeSession;
  approvalPath: string;
  packageSha256: string;
  sourceCaseIds: string[];
  sourceCaseId?: string;
  discoveryTaskId?: string;
  transitionCaseId: string;
  transitionActions: ManifestAction[];
  targetOrigin: string;
  requestedUrl: string;
  pageStateId: string;
  isolationScope?: ContractCase["isolation_scope"];
  requiredAuthProfile?: string | null;
  now?: Date;
}

export async function validateDiscoveryApprovalForTransition(input: ValidateDiscoveryApprovalInput): Promise<DiscoveryApproval> {
  discoveryCaseDirectoryName(input.transitionCaseId);
  const now = input.now ?? new Date();
  const approval = await readApproval(input.session, input.approvalPath, {
    source_package_sha256: input.packageSha256,
    source_case_ids: input.sourceCaseIds,
    transition_case_id: input.transitionCaseId,
    transition_actions_sha256: sha256Canonical(input.transitionActions),
    target_origin: input.targetOrigin,
    requested_url: input.requestedUrl,
    page_state_id: input.pageStateId,
  }, now);
  requireApprovedTransitionRisks(approval.approval, input.transitionActions);
  return approval.approval;
}

function macFor(secret: Buffer, receipt: Omit<DiscoveryReceipt, "session_mac">): string {
  return createHmac("sha256", secret).update(canonicalize(receipt), "utf8").digest("hex");
}

export async function discoverAndIssueReceipt(input: DiscoverAndIssueReceiptInput): Promise<{ receiptPath: string; artifactPath: string; receipt: DiscoveryReceipt }> {
  const clock = clockFor(input);
  const now = clock();
  const sessionState = stateFor(input.session, now);
  requireSha(input.packageSha256, "package_sha256");
  if (input.sourceCaseIds.length === 0 || input.transitionActions.length === 0) invalid("discovery_binding_missing");
  const caseDirectoryName = discoveryCaseDirectoryName(input.transitionCaseId);
  const origin = normalizeOrigin(input.targetOrigin, "target_origin");
  if (input.targetOrigin !== origin || normalizeOrigin(input.requestedUrl, "requested_url") !== origin) invalid("requested_url_origin_mismatch");

  const approval = await readApproval(input.session, input.approvalPath, {
    source_package_sha256: input.packageSha256,
    source_case_ids: input.sourceCaseIds,
    transition_case_id: input.transitionCaseId,
    transition_actions_sha256: sha256Canonical(input.transitionActions),
    target_origin: origin,
    requested_url: input.requestedUrl,
    page_state_id: input.pageStateId,
  }, now);
  requireApprovedTransitionRisks(approval.approval, input.transitionActions);
  const sourceCaseId = input.sourceCaseId ?? input.transitionCaseId;
  const taskId = input.discoveryTaskId ?? discoveryTaskId({
    packageSha256: input.packageSha256,
    targetState: input.pageStateId,
    transitionActionsSha256: sha256Canonical(input.transitionActions),
    origin,
    isolationScope: input.isolationScope ?? "case",
    flowGroup: input.flowGroup ?? null,
    requiredAuthProfile: input.requiredAuthProfile ?? null,
    startStateSha256: sha256Canonical(input.startState ?? {}),
    authProfileSha256: sha256Canonical(input.authProfile ?? {}),
  });

  const discovery = await discoverCurrentPage(input.page, { now });
  if (discovery.discovered_at !== now.toISOString()) invalid("discovery_not_current");
  if (normalizeOrigin(discovery.url, "final_url") !== origin) invalid("final_url_origin_mismatch");
  const directory = path.join(input.session.runRoot, "discovery", caseDirectoryName);
  await mkdir(directory, { recursive: true });
  const artifactPath = path.join(directory, "web-discovery.json");
  const receiptPath = path.join(directory, "discovery-receipt.json");
  const artifactBytes = Buffer.from(`${JSON.stringify(discovery, null, 2)}\n`, "utf8");
  const artifactRelative = path.relative(input.session.runRoot, artifactPath).split(path.sep).join("/");
  const unsigned: Omit<DiscoveryReceipt, "session_mac"> = {
    receipt_schema_version: DISCOVERY_RECEIPT_SCHEMA_VERSION,
    run_nonce: input.session.runNonce,
    discovery_id: `discovery-${randomBytes(12).toString("hex")}`,
    generated_by: "@saitamasans/testing-runtime",
    runtime_version: TESTING_RUNTIME_VERSION,
    runner_version: TESTING_RUNNER_VERSION,
    target_origin: origin,
    requested_url: input.requestedUrl,
    final_url: discovery.url,
    page_state_id: input.pageStateId,
    dom_sha256: discovery.dom_sha256,
    accessibility_sha256: discovery.accessibility_sha256,
    page_fingerprint_sha256: sha256Canonical({ dom_sha256: discovery.dom_sha256, accessibility_sha256: discovery.accessibility_sha256 }),
    discovery_artifact_path: artifactRelative,
    discovery_artifact_sha256: createHash("sha256").update(artifactBytes).digest("hex"),
    generated_at: now.toISOString(),
    expires_at: input.session.expiresAt,
    source_package_sha256: input.packageSha256,
    source_case_ids: [...input.sourceCaseIds],
    discovery_task_id: taskId,
    source_case_id: sourceCaseId,
    transition_case_id: input.transitionCaseId,
    transition_actions_sha256: sha256Canonical(input.transitionActions),
    approval_reference: approval.approval.approval_id,
    approval_sha256: approval.sha256,
    purpose: "target_state_discovery_only",
  };
  const receipt: DiscoveryReceipt = { ...unsigned, session_mac: macFor(sessionState.secret, unsigned) };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  let artifactIdentity: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    artifactIdentity = await createExclusiveContainedFile({ session: input.session, directory, file: artifactPath, bytes: artifactBytes, kind: "artifact", clock, ...(input.afterExclusiveCreate ? { afterCreate: input.afterExclusiveCreate } : {}) });
    await createExclusiveContainedFile({ session: input.session, directory, file: receiptPath, bytes: receiptBytes, kind: "receipt", clock, ...(input.afterExclusiveCreate ? { afterCreate: input.afterExclusiveCreate } : {}) });
  } catch (error) {
    if (artifactIdentity) await removeCreatedPathBestEffort(input.session, artifactPath, artifactIdentity);
    throw error;
  }
  const relativeReceipt = path.relative(input.session.runRoot, receiptPath).split(path.sep).join("/");
  sessionState.issued.set(relativeReceipt, {
    receiptSha256: createHash("sha256").update(receiptBytes).digest("hex"),
    mac: receipt.session_mac,
  });
  return { receiptPath, artifactPath, receipt };
}

async function verifyOneReceipt(input: VerifyDiscoveryReceiptsInput, receiptPath: string, task: DiscoveryTask, approvalPath: string, livePage: Page | undefined, clock: () => Date): Promise<DiscoveryReceiptReference> {
  const now = clock();
  const session = input.session!;
  const sessionState = stateFor(session, now);
  const located = await requirePathInside(session, receiptPath, "receipt_path", now);
  const receiptBytes = await readFile(located.absolute);
  const receipt = validateDocument<DiscoveryReceipt>("discovery-receipt", parseObject(receiptBytes, "receipt"));
  const receiptSha = createHash("sha256").update(receiptBytes).digest("hex");
  const issued = sessionState.issued.get(located.relative);
  const { session_mac: suppliedMac, ...unsigned } = receipt;
  const expectedMac = macFor(sessionState.secret, unsigned);
  if (!issued || issued.receiptSha256 !== receiptSha || issued.mac !== suppliedMac) invalid("receipt_not_issued_by_active_session");
  const supplied = Buffer.from(suppliedMac, "hex");
  const expected = Buffer.from(expectedMac, "hex");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) invalid("session_mac_mismatch");
  if (receipt.run_nonce !== session.runNonce) invalid("run_nonce_mismatch");
  const generatedAt = requireDate(receipt.generated_at, "generated_at");
  if (now.getTime() - generatedAt.getTime() > DISCOVERY_SESSION_MAX_AGE_MS || now > new Date(receipt.expires_at)) invalid("expired");

  if (receipt.source_package_sha256 !== input.packageSha256) invalid("package_mismatch");
  if (JSON.stringify(receipt.source_case_ids) !== JSON.stringify(input.sourceCaseIds)) invalid("source_cases_mismatch");
  const actions = transitionActions(input.profile.case_plans?.[task.transition_case_id] ?? []);
  if (receipt.transition_actions_sha256 !== task.transition_actions_sha256 || receipt.transition_actions_sha256 !== sha256Canonical(actions)) invalid("actions_mismatch");
  if (receipt.discovery_task_id !== task.discovery_task_id) invalid("discovery_task_mismatch");
  if (receipt.source_case_id !== task.source_case_id) invalid("source_case_mismatch");
  if (receipt.transition_case_id !== task.transition_case_id || receipt.page_state_id !== task.target_state) invalid("page_state_mismatch");
  const binding = expectedWebBinding(input.profile, actions);
  if (receipt.target_origin !== task.origin || receipt.requested_url !== task.requested_url || receipt.target_origin !== binding.origin || receipt.requested_url !== binding.requestedUrl) invalid("origin_or_request_mismatch");
  const approval = await readApproval(session, approvalPath, {
    source_package_sha256: input.packageSha256,
    source_case_ids: input.sourceCaseIds,
    transition_case_id: task.transition_case_id,
    transition_actions_sha256: sha256Canonical(actions),
    target_origin: binding.origin,
    requested_url: binding.requestedUrl,
    page_state_id: task.target_state,
  }, now);
  requireApprovedTransitionRisks(approval.approval, actions);
  if (receipt.approval_reference !== approval.approval.approval_id || receipt.approval_sha256 !== approval.sha256) invalid("approval_binding_mismatch");

  const artifact = await requirePathInside(session, path.join(session.runRoot, ...receipt.discovery_artifact_path.split("/")), "artifact_path", now);
  const artifactBytes = await readFile(artifact.absolute);
  const discovery = parseObject(artifactBytes, "artifact") as unknown as WebDiscoveryArtifact;
  if (discovery.discovered_at !== receipt.generated_at) invalid("discovery_not_current");
  if (discovery.url !== receipt.final_url || discovery.dom_sha256 !== receipt.dom_sha256 || discovery.accessibility_sha256 !== receipt.accessibility_sha256) invalid("page_fingerprint_mismatch");
  if (sha256Canonical({ dom_sha256: discovery.dom_sha256, accessibility_sha256: discovery.accessibility_sha256 }) !== receipt.page_fingerprint_sha256) invalid("page_fingerprint_mismatch");
  if (createHash("sha256").update(artifactBytes).digest("hex") !== receipt.discovery_artifact_sha256) invalid("artifact_sha_mismatch");
  if (livePage) {
    const live = await discoverCurrentPage(livePage, { now: clock() });
    if (live.url !== receipt.final_url || live.dom_sha256 !== receipt.dom_sha256 || live.accessibility_sha256 !== receipt.accessibility_sha256) {
      invalid("live_page_fingerprint_mismatch");
    }
  }
  stateFor(session, clock());
  return { discovery_task_id: task.discovery_task_id, source_case_id: task.source_case_id, case_id: task.transition_case_id, page_state_id: task.target_state, discovery_id: receipt.discovery_id, receipt_path: located.relative, receipt_sha256: receiptSha };
}

export async function verifyDiscoveryReceipts(input: VerifyDiscoveryReceiptsInput): Promise<DiscoveryReceiptReference[]> {
  let required: DiscoveryTask[];
  try {
    required = planDiscoveryTasks({ contractCases: input.contractCases, profile: input.profile, packageSha256: input.packageSha256 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/origin/i.test(message)) invalid("origin_or_request_mismatch");
    invalid("task_binding_invalid");
  }
  if (required.length === 0) return [];
  if (input.receiptPaths.length === 0) throw new Error(`target_state_not_discovered: ${required[0]!.source_case_id}:${required[0]!.target_state}`);
  if (!input.session) throw new Error("runtime_session_required");
  const clock = clockFor(input);
  stateFor(input.session, clock());
  const approvals = input.approvalPaths ?? (input.approvalPath ? [input.approvalPath] : []);
  if (approvals.length !== required.length) invalid("approval_count_mismatch");
  const livePages = input.livePages ?? (input.livePage ? [input.livePage] : []);
  if (livePages.length !== 0 && livePages.length !== required.length) invalid("live_page_count_mismatch");
  const receiptIdentities = await Promise.all(input.receiptPaths.map(async (receiptPath) => {
    const located = await requirePathInside(input.session!, receiptPath, "receipt_path", clock());
    const receipt = validateDocument<DiscoveryReceipt>("discovery-receipt", parseObject(await readFile(located.absolute), "receipt"));
    if (receipt.source_package_sha256 !== input.packageSha256) invalid("package_mismatch");
    const transitionTask = required.find(({ transition_case_id }) => transition_case_id === receipt.transition_case_id);
    if (transitionTask) {
      const actions = transitionActions(input.profile.case_plans?.[transitionTask.transition_case_id] ?? []);
      if (receipt.transition_actions_sha256 !== sha256Canonical(actions)) invalid("actions_mismatch");
    }
    return { discovery_task_id: receipt.discovery_task_id, receiptPath };
  }));
  const orderedReceipts = validateReceiptTaskQuorum(required.map(({ discovery_task_id }) => discovery_task_id), receiptIdentities);
  return Promise.all(required.map((task, index) => verifyOneReceipt(input, orderedReceipts[index]!.receiptPath, task, approvals[index]!, livePages[index], clock)));
}
