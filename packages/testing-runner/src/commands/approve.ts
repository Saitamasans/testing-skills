import { readFile, writeFile } from "node:fs/promises";

import { createApproval, verifyApproval } from "../security/approval.js";
import { validateDocument } from "../schema-registry.js";
import type { Approval, RiskLevel, RunManifest } from "../types.js";

export interface ApproveCommandOptions {
  manifest: string;
  out: string;
  expiresAt: string;
  approveR3?: string[];
  confirmedBy?: string;
  issuedAt?: string;
}

export async function runApproveCommand(options: ApproveCommandOptions): Promise<Approval> {
  if (!options.confirmedBy?.trim()) {
    throw new Error("approve requires confirmedBy from an interactive prompt or trusted wrapper");
  }
  const manifest = validateDocument<RunManifest>(
    "run-manifest",
    JSON.parse(await readFile(options.manifest, "utf8")),
  );
  const approvedR3 = options.approveR3 ?? [];
  const r3Actions = manifest.cases.flatMap((item) =>
    item.steps.filter((action) => action.risk === "R3").map((action) => action.action_id)
  );
  const missingR3 = r3Actions.filter((actionId) => !approvedR3.includes(actionId));
  if (missingR3.length > 0) {
    throw new Error(`R3 action requires explicit approval: ${missingR3.join(", ")}`);
  }

  const approval = createApproval({
    manifest,
    issued_by: options.confirmedBy,
    issued_at: options.issuedAt ?? new Date().toISOString(),
    expires_at: options.expiresAt,
    approved_risks: approvedRisks(manifest, approvedR3),
    approved_r3_action_ids: approvedR3,
  });
  const verification = verifyApproval(manifest, approval, "interactive");
  if (verification.status !== "approved") {
    throw new Error(`approval verification failed: ${verification.reasons.join("; ")}`);
  }
  await writeFile(options.out, `${JSON.stringify(approval, null, 2)}\n`, "utf8");
  return approval;
}

function approvedRisks(manifest: RunManifest, approvedR3: string[]): RiskLevel[] {
  const risks = new Set<RiskLevel>();
  for (const item of manifest.cases) {
    for (const action of item.steps) {
      if (action.risk === "R3" && !approvedR3.includes(action.action_id)) continue;
      risks.add(action.risk);
    }
  }
  return [...risks].sort((left, right) => riskRank(left) - riskRank(right));
}

function riskRank(risk: RiskLevel): number {
  return { R0: 0, R1: 1, R2: 2, R3: 3 }[risk];
}
