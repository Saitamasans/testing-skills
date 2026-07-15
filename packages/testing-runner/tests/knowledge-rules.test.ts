import assert from "node:assert/strict";
import test from "node:test";

import {
  enforceHeuristicCeiling,
  loadKnowledgeRules,
  selectKnowledgeRules,
} from "../src/assertions/knowledge-registry.js";

test("knowledge rules contain versioned source, confidence and verdict policy metadata", async () => {
  const rules = await loadKnowledgeRules();
  assert.ok(rules.length >= 4);
  for (const rule of rules) {
    assert.match(rule.rule_id, /^[a-z0-9-]+$/);
    assert.match(rule.version, /^\d+\.\d+\.\d+$/);
    assert.ok(rule.source);
    assert.ok(rule.confidence >= 0 && rule.confidence <= 1);
    assert.ok(["auto", "candidate_only"].includes(rule.verdict_policy));
    assert.equal(typeof rule.automatic, "boolean");
    assert.equal(typeof rule.needs_human_review, "boolean");
  }
  assert.ok(rules.some((rule) => rule.source === "high-risk-heuristics" && rule.verdict_policy === "candidate_only"));
});

test("technical rules can be automatic while high-risk heuristics require approval and ceiling control", async () => {
  const rules = await loadKnowledgeRules();
  const selectedWithoutApproval = selectKnowledgeRules({
    rules,
    context: { protocols: ["http"], risks: ["duplicate-submission"] },
    approved_rule_ids: [],
    automatic_assertion_count: 9,
  });

  assert.ok(selectedWithoutApproval.some((rule) => rule.rule_id === "http-status-body-consistency"));
  assert.ok(!selectedWithoutApproval.some((rule) => rule.source === "high-risk-heuristics" && rule.automatic));

  const selectedWithApproval = selectKnowledgeRules({
    rules,
    context: { protocols: ["http"], risks: ["duplicate-submission"] },
    approved_rule_ids: ["duplicate-submission-idempotency"],
    automatic_assertion_count: 9,
  });
  assert.ok(selectedWithApproval.some((rule) => rule.rule_id === "duplicate-submission-idempotency"));

  assert.throws(
    () => enforceHeuristicCeiling(
      selectedWithApproval.filter((rule) => rule.source === "high-risk-heuristics"),
      9,
    ),
    /10%/,
  );
});
