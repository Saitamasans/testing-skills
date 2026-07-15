import { readFile, writeFile } from "node:fs/promises";

import { applyLocatorApproval, type LocatorApproval } from "../locator/approval.js";
import type { LocatorProposal } from "../locator/proposal.js";
import type { RunManifest } from "../types.js";

export interface ApplyLocatorProposalCommandOptions {
  manifest: string;
  proposal: string;
  approval: string;
  out: string;
}

export async function runApplyLocatorProposalCommand(
  options: ApplyLocatorProposalCommandOptions,
): Promise<RunManifest> {
  const manifest = JSON.parse(await readFile(options.manifest, "utf8")) as RunManifest;
  const proposal = JSON.parse(await readFile(options.proposal, "utf8")) as LocatorProposal;
  const approval = JSON.parse(await readFile(options.approval, "utf8")) as LocatorApproval;
  const updated = applyLocatorApproval(manifest, proposal, approval);
  await writeFile(options.out, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
  return updated;
}
