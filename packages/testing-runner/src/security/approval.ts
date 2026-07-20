import { validateDocument } from "../schema-registry.js";
import type { Approval, RiskLevel, RunManifest } from "../types.js";
import { sha256Canonical } from "../compiler/canonical-json.js";

export interface ApprovalInput {
  manifest: RunManifest;
  approval_id?: string;
  issued_by: string;
  issued_at: string;
  expires_at: string;
  approved_risks: RiskLevel[];
  approved_r3_action_ids: string[];
}

export interface ApprovalVerification {
  status: "approved" | "blocked";
  reasons: string[];
}

type LockableManifest = RunManifest & {
  targets?: string[];
  rule_versions?: string[];
};

type VersionedApproval = Approval & {
  runner?: { version: string };
  rule_versions?: string[];
};

export function createApproval(input: ApprovalInput): Approval {
  const manifest = input.manifest as LockableManifest;
  const manifestSha256 = sha256Canonical(input.manifest);
  const approval: VersionedApproval = {
    protocol_version: "1.0.0",
    approval_id: input.approval_id ?? `approval-${sha256Canonical({
      manifest: input.manifest,
      issued_by: input.issued_by,
      issued_at: input.issued_at,
    }).slice(0, 16)}`,
    manifest_hash: manifestSha256,
    manifest_sha256: manifestSha256,
    ...(input.manifest.package_sha256 ? { package_sha256: input.manifest.package_sha256 } : {}),
    source_hash: input.manifest.source.sha256,
    runner: { version: input.manifest.runner.version },
    rule_versions: [...(manifest.rule_versions ?? [])],
    targets: [...(manifest.targets ?? [])],
    approved_risks: unique(input.approved_risks),
    approved_r3_action_ids: unique(input.approved_r3_action_ids),
    issued_by: input.issued_by,
    issued_at: input.issued_at,
    expires_at: input.expires_at,
  };
  return validateDocument<Approval>("approval", approval);
}

export function verifyApproval(
  manifest: RunManifest,
  approval: Approval,
  mode: "interactive" | "ci",
): ApprovalVerification {
  const lockableManifest = manifest as LockableManifest;
  const versionedApproval = approval as VersionedApproval;
  const reasons: string[] = [];

  const currentManifestSha256 = sha256Canonical(manifest);
  if (approval.manifest_hash !== currentManifestSha256 || approval.manifest_sha256 !== currentManifestSha256) {
    reasons.push("manifest changed after approval");
  }
  if (manifest.package_sha256) {
    if (!approval.package_sha256) reasons.push("package SHA-256 missing from approval");
    else if (approval.package_sha256 !== manifest.package_sha256) reasons.push("package SHA-256 mismatch");
  } else if (approval.package_sha256) {
    reasons.push("unexpected package SHA-256 in approval");
  }
  if (approval.source_hash !== manifest.source.sha256) {
    reasons.push("source hash mismatch");
  }
  if (versionedApproval.runner?.version !== manifest.runner.version) {
    reasons.push("runner version mismatch");
  }
  if (JSON.stringify(versionedApproval.rule_versions ?? []) !== JSON.stringify(lockableManifest.rule_versions ?? [])) {
    reasons.push("rule version mismatch");
  }
  if (JSON.stringify([...approval.targets].sort()) !== JSON.stringify([...(lockableManifest.targets ?? [])].sort())) {
    reasons.push("target origin mismatch");
  }
  const expiryMs = Date.parse(approval.expires_at);
  if (!Number.isFinite(expiryMs) || expiryMs <= Date.now()) {
    reasons.push("approval expired");
  }

  const actionRisks = manifest.cases.flatMap((item) => item.steps.map((action) => action.risk));
  const approvedRisks = new Set(approval.approved_risks);
  for (const risk of actionRisks) {
    if (!approvedRisks.has(risk)) reasons.push(`risk ${risk} not approved`);
  }

  const r3ActionIds = manifest.cases.flatMap((item) =>
    item.steps.filter((action) => action.risk === "R3").map((action) => action.action_id)
  );
  const approvedR3 = new Set(approval.approved_r3_action_ids);
  for (const actionId of r3ActionIds) {
    if (!approvedR3.has(actionId)) reasons.push(`R3 action ${actionId} requires explicit approval`);
  }

  if (mode === "ci" && actionRisks.some((risk) => risk === "R2" || risk === "R3")) {
    reasons.push("CI mode rejects R2/R3 approvals");
  }

  return reasons.length === 0 ? { status: "approved", reasons: [] } : { status: "blocked", reasons };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
