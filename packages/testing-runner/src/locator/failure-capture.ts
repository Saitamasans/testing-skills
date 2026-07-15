import { createHash } from "node:crypto";

export type LocatorStrategy = "data-testid" | "role" | "label" | "text" | "stable-css";

export interface LocatorCandidate {
  locator: string;
  strategy: LocatorStrategy;
  unique: boolean;
  element_summary: string;
}

export interface LocatorFailure {
  manifest_hash: string;
  action_id: string;
  old_locator: string;
  matched_count: number;
  url_origin: string;
  dom_fragment: string;
  accessibility_fragment: string;
  candidates: readonly LocatorCandidate[];
}

export function hashEvidence(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
