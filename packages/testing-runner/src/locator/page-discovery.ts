import type { Locator, Page } from "playwright";

import { hashEvidence } from "./failure-capture.js";
import { locatorForSpec } from "../actions/locator-resolver.js";

export interface DiscoveryCandidate {
  locator: string;
  strategy: "data-testid" | "role" | "label" | "stable-css";
  confidence: number;
  matched_count: number;
  visible_count: number;
}

export interface DiscoveredElement {
  tag: string;
  role: string;
  name: string;
  label: string;
  type: string;
  candidates: DiscoveryCandidate[];
}

export interface WebDiscoveryResult {
  url: string;
  title: string;
  discovered_at: string;
  requires_user_confirmation: true;
  interaction_policy: "read-only-dom-and-accessibility";
  dom_sha256: string;
  accessibility_sha256: string;
  elements: DiscoveredElement[];
}

interface RawElement {
  tag: string;
  role: string;
  name: string;
  label: string;
  type: string;
  testId: string;
  id: string;
  fieldName: string;
}

const STRATEGY_CONFIDENCE: Record<DiscoveryCandidate["strategy"], number> = {
  "data-testid": 0.95,
  role: 0.9,
  label: 0.85,
  "stable-css": 0.7,
};

function escapeQuoted(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function escapeCssId(value: string): string {
  return value.replace(/(^-?\d)|[^A-Za-z0-9_-]/g, (match, leadingDigit: string | undefined) =>
    leadingDigit ? `\\3${leadingDigit} ` : `\\${match}`,
  );
}

async function countVisible(locator: Locator): Promise<number> {
  const count = await locator.count();
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) visible += 1;
  }
  return visible;
}

function candidateSpecs(item: RawElement): Array<Pick<DiscoveryCandidate, "locator" | "strategy">> {
  const candidates: Array<Pick<DiscoveryCandidate, "locator" | "strategy">> = [];
  if (item.testId) candidates.push({ locator: `data-testid=${item.testId}`, strategy: "data-testid" });
  if (item.role && item.name) {
    candidates.push({ locator: `role=${item.role}[name="${escapeQuoted(item.name)}"]`, strategy: "role" });
  }
  if (item.label) candidates.push({ locator: `label=${item.label}`, strategy: "label" });
  if (item.id) candidates.push({ locator: `css=#${escapeCssId(item.id)}`, strategy: "stable-css" });
  else if (item.fieldName) {
    candidates.push({ locator: `css=[name="${escapeQuoted(item.fieldName)}"]`, strategy: "stable-css" });
  }
  return candidates.filter((candidate, index, values) =>
    values.findIndex((value) => value.locator === candidate.locator) === index,
  );
}

export async function discoverCurrentPage(page: Page, options: { now?: Date } = {}): Promise<WebDiscoveryResult> {
  const rawElements = await page.locator(
    'input:not([type="hidden"]),button,select,textarea,a[href],[role="button"],[role="link"],[role="textbox"],[role="searchbox"],[role="combobox"]',
  ).evaluateAll((nodes) => nodes.filter((node) => {
    const element = node as any;
    const style = (globalThis as any).getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
  }).map((node) => {
    const element = node as any;
    const input = element as any;
    const tag = element.tagName.toLowerCase();
    const type = input.type?.toLowerCase?.() ?? "";
    const label = "labels" in input && input.labels?.length
      ? [...input.labels].map((item) => item.textContent?.trim() ?? "").filter(Boolean).join(" ")
      : "";
    const explicitRole = element.getAttribute("role") ?? "";
    const role = explicitRole || (
      tag === "button" || (tag === "input" && ["button", "submit", "reset"].includes(type)) ? "button" :
      tag === "a" ? "link" :
      tag === "select" ? "combobox" :
      tag === "textarea" || tag === "input" ? (type === "search" ? "searchbox" : "textbox") : ""
    );
    const name = (
      element.getAttribute("aria-label") ||
      label ||
      (tag === "input" ? input.value : element.textContent) ||
      element.getAttribute("title") ||
      ""
    ).trim();
    return {
      tag,
      role,
      name,
      label,
      type,
      testId: element.getAttribute("data-testid") ?? "",
      id: element.id,
      fieldName: element.getAttribute("name") ?? "",
    };
  })) as RawElement[];

  const elements: DiscoveredElement[] = [];
  for (const item of rawElements) {
    const candidates: DiscoveryCandidate[] = [];
    for (const proposal of candidateSpecs(item)) {
      const locator = locatorForSpec(page, proposal.locator);
      const matched_count = await locator.count();
      const visible_count = await countVisible(locator);
      candidates.push({
        ...proposal,
        confidence: matched_count === 1 && visible_count === 1 ? STRATEGY_CONFIDENCE[proposal.strategy] : 0,
        matched_count,
        visible_count,
      });
    }
    elements.push({
      tag: item.tag,
      role: item.role,
      name: item.name,
      label: item.label,
      type: item.type,
      candidates,
    });
  }

  const dom = await page.content();
  const accessibility = await page.locator("body").ariaSnapshot().catch(() => "");
  return {
    url: page.url(),
    title: await page.title(),
    discovered_at: (options.now ?? new Date()).toISOString(),
    requires_user_confirmation: true,
    interaction_policy: "read-only-dom-and-accessibility",
    dom_sha256: hashEvidence(dom),
    accessibility_sha256: hashEvidence(accessibility),
    elements,
  };
}
