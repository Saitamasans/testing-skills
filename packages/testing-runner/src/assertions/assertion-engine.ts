export type AssertionSource =
  | "case_expected"
  | "project_contract"
  | "technical_rule"
  | "high-risk-heuristic";

export type AssertionOperator = "equals" | "includes" | "status_is";
export type VerdictPolicy = "auto" | "candidate_only" | "pending_only";

export interface AssertionSpec {
  assertion_id: string;
  source: AssertionSource;
  mandatory: boolean;
  operator: AssertionOperator;
  expected: unknown;
  actual: unknown;
  rule_id?: string;
  automatic?: boolean;
  needs_human_review?: boolean;
  verdict_policy?: VerdictPolicy;
}

export interface AssertionOutcome {
  assertion_id: string;
  source: AssertionSource;
  mandatory: boolean;
  passed: boolean;
  automatic: boolean;
  needs_human_review: boolean;
  verdict_policy: VerdictPolicy;
  reason: string;
  rule_id?: string;
}

const SOURCE_PRIORITY: Record<AssertionSource, number> = {
  case_expected: 0,
  project_contract: 1,
  technical_rule: 2,
  "high-risk-heuristic": 3,
};

function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function evaluate(spec: AssertionSpec): boolean {
  if (spec.operator === "equals") return valuesEqual(spec.actual, spec.expected);
  if (spec.operator === "includes") return String(spec.actual).includes(String(spec.expected));
  if (spec.operator === "status_is") return Number(spec.actual) === Number(spec.expected);
  return false;
}

export function evaluateAssertions(specs: readonly AssertionSpec[]): AssertionOutcome[] {
  return [...specs]
    .sort((left, right) => SOURCE_PRIORITY[left.source] - SOURCE_PRIORITY[right.source])
    .map((spec): AssertionOutcome => {
      const passed = evaluate(spec);
      const outcome: AssertionOutcome = {
        assertion_id: spec.assertion_id,
        source: spec.source,
        mandatory: spec.mandatory,
        passed,
        automatic: spec.automatic ?? spec.source !== "high-risk-heuristic",
        needs_human_review: spec.needs_human_review ?? spec.source === "high-risk-heuristic",
        verdict_policy: spec.verdict_policy ?? (spec.source === "high-risk-heuristic" ? "candidate_only" : "auto"),
        reason: passed ? "matched" : `expected ${JSON.stringify(spec.expected)} but got ${JSON.stringify(spec.actual)}`,
      };
      if (spec.rule_id) outcome.rule_id = spec.rule_id;
      return outcome;
    });
}
