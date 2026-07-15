import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import type { VerdictPolicy } from "./assertion-engine.js";

export interface KnowledgeRule {
  rule_id: string;
  version: string;
  source: "technical-rules" | "high-risk-heuristics";
  title: string;
  confidence: number;
  verdict_policy: VerdictPolicy;
  automatic: boolean;
  needs_human_review: boolean;
  applies_to: {
    protocols?: string[];
    risks?: string[];
  };
  exceptions: string[];
}

export interface RuleSelectionInput {
  rules: readonly KnowledgeRule[];
  context: {
    protocols?: readonly string[];
    risks?: readonly string[];
  };
  approved_rule_ids: readonly string[];
  automatic_assertion_count: number;
}

function knowledgePath(fileName: string): URL {
  const bundled = new URL(`../knowledge/${fileName}`, import.meta.url);
  if (existsSync(bundled)) return bundled;

  const workspace = new URL(`../../../../knowledge/${fileName}`, import.meta.url);
  if (existsSync(workspace)) return workspace;

  return pathToFileURL(path.resolve(process.cwd(), "knowledge", fileName));
}

async function readRules(fileName: string): Promise<KnowledgeRule[]> {
  return JSON.parse(await readFile(knowledgePath(fileName), "utf8")) as KnowledgeRule[];
}

export async function loadKnowledgeRules(): Promise<KnowledgeRule[]> {
  return [
    ...(await readRules("technical-rules.json")),
    ...(await readRules("high-risk-heuristics.json")),
  ];
}

function intersects(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (!left?.length || !right?.length) return false;
  const set = new Set(left);
  return right.some((item) => set.has(item));
}

function applies(rule: KnowledgeRule, input: RuleSelectionInput): boolean {
  return (
    intersects(rule.applies_to.protocols, input.context.protocols) ||
    intersects(rule.applies_to.risks, input.context.risks)
  );
}

export function enforceHeuristicCeiling(
  heuristicRules: readonly KnowledgeRule[],
  automaticAssertionCount: number,
): void {
  const automaticHeuristics = heuristicRules.filter((rule) => rule.automatic).length;
  if (automaticHeuristics === 0) return;
  if (automaticHeuristics / Math.max(automaticAssertionCount, 1) > 0.1) {
    throw new Error("Automatic high-risk heuristics exceed the 10% ceiling and require confirmation");
  }
}

export function selectKnowledgeRules(input: RuleSelectionInput): KnowledgeRule[] {
  const approved = new Set(input.approved_rule_ids);
  return input.rules
    .filter((rule) => applies(rule, input))
    .map((rule): KnowledgeRule => {
      if (rule.source !== "high-risk-heuristics") return { ...rule, automatic: true, needs_human_review: false };
      if (!approved.has(rule.rule_id)) return { ...rule, automatic: false, needs_human_review: true };
      return { ...rule, automatic: true, needs_human_review: false };
    });
}
