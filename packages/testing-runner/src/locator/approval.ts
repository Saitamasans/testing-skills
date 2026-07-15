import { sha256Canonical } from "../compiler/canonical-json.js";
import type { RunManifest } from "../types.js";
import type { LocatorProposal } from "./proposal.js";

export interface LocatorApproval {
  proposal_hash: string;
  approved: boolean;
  approved_locator?: string;
}

function replaceLocator(manifest: RunManifest, actionId: string, oldLocator: string, newLocator: string): void {
  for (const item of manifest.cases) {
    for (const action of item.steps) {
      if (action.action_id !== actionId) continue;
      if (!("locator" in action)) throw new Error(`Action ${actionId} does not have a locator`);
      if (action.locator !== oldLocator) throw new Error(`Old locator mismatch for ${actionId}`);
      action.locator = newLocator;
      return;
    }
  }
  throw new Error(`Action not found for locator approval: ${actionId}`);
}

export function applyLocatorApproval(
  manifest: RunManifest,
  proposal: LocatorProposal,
  approval: LocatorApproval,
): RunManifest {
  if (!approval.approved) throw new Error("Locator proposal approval is required before applying a repair");
  if (approval.proposal_hash !== proposal.proposal_hash) throw new Error("Locator proposal hash mismatch");
  if (sha256Canonical(manifest) !== proposal.manifest_hash) throw new Error("Current manifest hash does not match locator proposal");
  const locator = approval.approved_locator ?? proposal.candidate_locator;
  if (!locator) throw new Error("Approved locator is required for an ambiguous proposal");

  const updated = structuredClone(manifest);
  replaceLocator(updated, proposal.action_id, proposal.old_locator, locator);
  updated.manifest_id = `${manifest.manifest_id}-locator-${proposal.proposal_hash.slice(0, 8)}`;
  return updated;
}
