import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateAssertions,
  type AssertionSpec,
} from "../src/assertions/assertion-engine.js";
import {
  deriveCaseVerdict,
} from "../src/assertions/verdict.js";

test("assertion evaluation preserves source precedence and mandatory failure semantics", () => {
  const specs: AssertionSpec[] = [
    {
      assertion_id: "technical-status",
      source: "technical_rule",
      mandatory: true,
      operator: "equals",
      expected: 200,
      actual: 200,
      rule_id: "http-status-body-consistency",
    },
    {
      assertion_id: "case-total",
      source: "case_expected",
      mandatory: true,
      operator: "equals",
      expected: "paid",
      actual: "cancelled",
    },
  ];

  const outcomes = evaluateAssertions(specs);

  assert.deepEqual(outcomes.map(({ assertion_id }) => assertion_id), ["case-total", "technical-status"]);
  assert.equal(outcomes[0]?.passed, false);
  assert.equal(deriveCaseVerdict({ case_id: "PAY-001", assertions: outcomes }).case_status, "不通过");
});

test("verdict keeps runtime failures separate from business case status", () => {
  assert.deepEqual(
    deriveCaseVerdict({
      case_id: "LOCATOR-001",
      assertions: [],
      runtime: { run_status: "executor_error", error_type: "locator_not_found" },
    }),
    {
      case_id: "LOCATOR-001",
      case_status: "未执行",
      run_status: "executor_error",
      automatic: true,
      needs_human_review: true,
      reasons: ["Runtime condition prevented a business verdict: locator_not_found"],
    },
  );

  assert.equal(
    deriveCaseVerdict({
      case_id: "SSO-001",
      assertions: [],
      runtime: { run_status: "manual_required", error_type: "manual_auth" },
    }).case_status,
    "未执行",
  );
});

test("only unresolved confirmed wording conflicts produce 待定", () => {
  const verdict = deriveCaseVerdict({
    case_id: "REQ-001",
    assertions: [
      {
        assertion_id: "wording-conflict",
        source: "case_expected",
        mandatory: true,
        passed: false,
        automatic: false,
        needs_human_review: true,
        verdict_policy: "pending_only",
        reason: "Product and test wording conflict after execution",
      },
    ],
  });

  assert.equal(verdict.case_status, "待定");
  assert.equal(verdict.run_status, "completed");
  assert.equal(verdict.needs_human_review, true);
});

test("passing mandatory assertions produce 通过", () => {
  const verdict = deriveCaseVerdict({
    case_id: "API-OK",
    assertions: [
      {
        assertion_id: "status",
        source: "case_expected",
        mandatory: true,
        passed: true,
        automatic: true,
        needs_human_review: false,
        verdict_policy: "auto",
        reason: "matched",
      },
    ],
  });

  assert.equal(verdict.case_status, "通过");
  assert.equal(verdict.run_status, "completed");
});
