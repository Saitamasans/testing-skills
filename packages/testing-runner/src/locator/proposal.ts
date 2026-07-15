import { sha256Canonical } from "../compiler/canonical-json.js";
import {
  hashEvidence,
  type LocatorCandidate,
  type LocatorFailure,
  type LocatorStrategy,
} from "./failure-capture.js";

export interface LocatorProposal {
  manifest_hash: string;
  proposal_hash: string;
  action_id: string;
  old_locator: string;
  candidate_locator: string | null;
  matched_count: number;
  confidence: number;
  requires_manual_input: boolean;
  element_summary?: string;
  source_evidence_hashes: {
    dom_fragment: string;
    accessibility_fragment: string;
  };
  candidates: LocatorCandidate[];
}

const STRATEGY_PRIORITY: Record<LocatorStrategy, number> = {
  "data-testid": 0,
  role: 1,
  label: 2,
  text: 3,
  "stable-css": 4,
};

const STRATEGY_CONFIDENCE: Record<LocatorStrategy, number> = {
  "data-testid": 0.95,
  role: 0.9,
  label: 0.85,
  text: 0.75,
  "stable-css": 0.65,
};

function stable(candidate: LocatorCandidate): boolean {
  return (
    candidate.unique &&
    !/nth-child|:has\(|\b(x|y|left|top)=\d+/i.test(candidate.locator) &&
    !/css=\.(?:css|sc|chakra|mui|ant|_)[A-Za-z0-9_-]+/.test(candidate.locator)
  );
}

function chooseCandidate(candidates: readonly LocatorCandidate[]): LocatorCandidate | undefined {
  return candidates
    .filter(stable)
    .sort((left, right) => STRATEGY_PRIORITY[left.strategy] - STRATEGY_PRIORITY[right.strategy])[0];
}

export function createLocatorProposal(failure: LocatorFailure): LocatorProposal {
  const selected = failure.matched_count === 0 ? chooseCandidate(failure.candidates) : undefined;
  const withoutHash = {
    manifest_hash: failure.manifest_hash,
    action_id: failure.action_id,
    old_locator: failure.old_locator,
    candidate_locator: selected?.locator ?? null,
    matched_count: failure.matched_count,
    confidence: selected ? STRATEGY_CONFIDENCE[selected.strategy] : 0,
    requires_manual_input: !selected,
    ...(selected ? { element_summary: selected.element_summary } : {}),
    source_evidence_hashes: {
      dom_fragment: hashEvidence(failure.dom_fragment),
      accessibility_fragment: hashEvidence(failure.accessibility_fragment),
    },
    candidates: failure.candidates.map((candidate) => ({ ...candidate })),
  };
  return {
    ...withoutHash,
    proposal_hash: sha256Canonical(withoutHash),
  };
}
