import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { evaluateStopGate, runStage3Analysis } from "../src/stage3-analysis.mjs";
import { stage3NegativeRecoverySource, stage3Source } from "./fixtures/app-server.mjs";

const HIGH_ID = "asset-high";
const MEDIUM_ID = "asset-medium";
const VENDOR_ID = "asset-vendor";

function asset(assetId, classification, overrides = {}) {
  return {
    asset_id: assetId,
    canonical_url: `https://app.test/assets/${assetId}.js`,
    classification,
    asset_type: "js",
    first_seen_batch: "B01",
    runtime_loaded: false,
    ...overrides,
  };
}

function allEvidenceAtLevel(result, level) {
  assert.ok(result.structural_relations.every((relation) => relation.evidence_level === level));
  for (const chain of result.call_chain_candidates) {
    assert.equal(chain.evidence_level, level);
    assert.ok(chain.preconditions.every((item) => item.evidence_level === level));
    assert.ok(chain.permission_conditions.every((item) => item.evidence_level === level));
    assert.ok(chain.state_conditions.every((item) => item.evidence_level === level));
    assert.ok(chain.api_references.every((item) => item.evidence_level === level));
    assert.ok(chain.post_processing.every((item) => item.evidence_level === level));
    assert.ok(chain.nodes.every((node) => node.evidence_level === level));
    assert.ok(chain.edges.every((edge) => edge.evidence_level === level));
    assert.ok(chain.branches.every((branch) => branch.evidence_level === level));
    assert.ok(chain.branches.every((branch) => branch.outcomes.every((outcome) => outcome.evidence_level === level)));
  }
}

test("Stage 3 selects assets with six signals and limits L3 to HIGH assets", () => {
  const assets = [
    asset(HIGH_ID, "first_party", { runtime_loaded: true }),
    asset(MEDIUM_ID, "first_party", { first_seen_batch: "B01" }),
    asset(VENDOR_ID, "third_party", { first_seen_batch: "B09", duplicate_of: "asset-known-vendor" }),
  ];
  const result = runStage3Analysis({
    assets,
    bodies: new Map([
      [HIGH_ID, stage3Source()],
      [MEDIUM_ID, 'const route = "/settings";'],
      [VENDOR_ID, "window.vendor = true;"],
    ]),
    currentBatch: "B01",
  });

  const focusById = new Map(result.analysis_focus.map((item) => [item.asset_id, item]));
  const signalNames = [
    "current_batch_relevance",
    "first_party_trust",
    "runtime_activity",
    "relationship_richness",
    "risk_behavior",
    "information_novelty",
  ];
  for (const focus of result.analysis_focus) {
    assert.deepEqual(Object.keys(focus.signals).sort(), [...signalNames].sort());
    assert.ok(focus.focus_reasons.length > 0);
  }

  assert.equal(focusById.get(HIGH_ID).priority, "HIGH");
  assert.equal(focusById.get(HIGH_ID).l3_eligible, true);
  assert.equal(focusById.get(MEDIUM_ID).priority, "MEDIUM");
  assert.equal(focusById.get(MEDIUM_ID).l3_eligible, false);
  assert.equal(focusById.get(VENDOR_ID).priority, "LOW");
  assert.equal(focusById.get(VENDOR_ID).l2_eligible, false);
  assert.equal(focusById.get(VENDOR_ID).l3_eligible, false);
  assert.equal(focusById.get(VENDOR_ID).skip_reason, "deep_analysis_skipped_low_priority");
  assert.equal(result.l3_results.some((item) => item.asset_id === VENDOR_ID), false);
  assert.equal(result.call_chain_candidates.some((item) => item.asset_id === VENDOR_ID), false);
});

test("Stage 3 recovers bounded L2 relations and E2 evidence", () => {
  const result = runStage3Analysis({
    assets: [asset(HIGH_ID, "first_party", { runtime_loaded: true })],
    bodies: new Map([[HIGH_ID, stage3Source()]]),
  });
  const expectedTypes = [
    "import",
    "export",
    "function_definition",
    "object_definition",
    "service_method_definition",
    "route_definition",
    "function_reference",
    "api_reference",
    "http_method",
    "permission_condition",
    "state_condition",
    "action_anchor",
  ];
  const relationTypes = new Set(result.structural_relations.map((relation) => relation.relation_type));
  for (const relationType of expectedTypes) assert.ok(relationTypes.has(relationType), relationType);
  assert.ok(result.structural_relations.every((relation) => relation.asset_id === HIGH_ID));
  assert.ok(result.structural_relations.every((relation) => relation.location.line >= 1));
  assert.ok(result.structural_relations.every((relation) => relation.context.length > 0));
  allEvidenceAtLevel(result, "E2");
  assert.doesNotMatch(JSON.stringify(result), /审核通过/);
});

test("Stage 3 produces query, stateful action, recovery, and insufficient-evidence chains", () => {
  const result = runStage3Analysis({
    assets: [asset(HIGH_ID, "first_party", { runtime_loaded: true })],
    bodies: new Map([[HIGH_ID, stage3Source()]]),
  });
  const chains = result.call_chain_candidates;
  const query = chains.find((chain) => chain.action_label === "loadOrders()");
  const action = chains.find((chain) => chain.action_label === "cancelOrder()");
  const recovery = chains.find((chain) => chain.expanded_public_layers.includes("refreshToken()"));
  const insufficient = chains.find((chain) => chain.action_label === "待确认");

  assert.ok(query, "query chain");
  assert.deepEqual(query.api_references.map((item) => `${item.method} ${item.url}`), ["GET /api/orders"]);
  assert.ok(query.post_processing.some((item) => item.kind === "response_mapping"));
  assert.ok(query.post_processing.some((item) => item.kind === "state_update"));
  assert.equal(query.stop_reason, "business_loop_closed");
  assert.ok(query.module_route_context.routes.includes("/orders"));

  assert.ok(action, "stateful action chain");
  assert.ok(action.state_conditions.some((item) => item.expression.includes("status !== 2")));
  assert.ok(action.permission_conditions.some((item) => item.expression.includes("orders:cancel")));
  assert.ok(action.api_references.some((item) => item.method === "POST" && item.url === "/api/order/cancel"));
  assert.ok(action.post_processing.some((item) => item.kind === "reload_or_cache" && item.expression === "reloadDetail"));
  assert.ok(action.post_processing.some((item) => item.kind === "error_feedback" && item.expression === "showError"));
  assert.equal(action.stop_reason, "business_loop_closed");

  const statusCondition = action.state_conditions.find((item) => item.expression.includes("status !== 2"));
  const permissionCondition = action.permission_conditions.find((item) => item.expression.includes("orders:cancel"));
  assert.deepEqual(statusCondition.guard_outcomes, { true: "stop", false: "continue" });
  assert.deepEqual(permissionCondition.guard_outcomes, { true: "stop", false: "continue" });
  for (const condition of [statusCondition, permissionCondition]) {
    const branch = action.branches.find((item) => item.branch_id === condition.branch_id);
    assert.equal(branch.branch_kind, "guard");
    const trueEdge = action.edges.find((edge) => edge.branch_id === branch.branch_id && edge.branch_outcome === "true");
    const falseEdge = action.edges.find((edge) => edge.branch_id === branch.branch_id && edge.branch_outcome === "false");
    assert.equal(trueEdge.path_effect, "stop");
    assert.equal(falseEdge.path_effect, "continue");
  }
  const cancelApiNode = action.nodes.find((node) => node.label === "POST /api/order/cancel");
  const statusBranch = action.branches.find((item) => item.branch_id === statusCondition.branch_id);
  const permissionBranch = action.branches.find((item) => item.branch_id === permissionCondition.branch_id);
  assert.ok(cancelApiNode);
  assert.ok(action.edges.some((edge) => edge.branch_id === statusBranch.branch_id && edge.branch_outcome === "false" && edge.to === action.nodes.find((node) => node.label.includes("orders:cancel")).node_id));
  assert.ok(action.edges.some((edge) => edge.branch_id === permissionBranch.branch_id && edge.branch_outcome === "false" && edge.to === cancelApiNode.node_id));

  const responseBranch = action.branches.find((item) => item.branch_kind === "if_else");
  const reloadNode = action.nodes.find((node) => node.label === "reloadDetail");
  const errorNode = action.nodes.find((node) => node.label === "showError");
  assert.ok(responseBranch);
  assert.deepEqual(responseBranch.outcomes.map((outcome) => outcome.outcome).sort(), ["false", "true"]);
  assert.ok(reloadNode);
  assert.ok(errorNode);
  assert.ok(action.edges.some((edge) => edge.branch_id === responseBranch.branch_id && edge.branch_outcome === "true" && edge.to === reloadNode.node_id));
  assert.ok(action.edges.some((edge) => edge.branch_id === responseBranch.branch_id && edge.branch_outcome === "false" && edge.to === errorNode.node_id));
  assert.equal(action.edges.some((edge) => edge.from === reloadNode.node_id && edge.to === errorNode.node_id), false);

  assert.ok(recovery, "401 recovery chain");
  assert.ok(recovery.expanded_public_layers.includes("401 response branch"));
  assert.ok(recovery.expanded_public_layers.includes("replay original request"));
  assert.ok(recovery.post_processing.length === 0 || recovery.post_processing.every((item) => item.evidence_level === "E2"));
  assert.ok(recovery.collapsed_wrappers.includes("httpTransport.request"));
  assert.ok(recovery.collapsed_wrappers.includes("frameworkProxy"));
  assert.equal(recovery.stop_reason, "test_relevant_public_layer_preserved");
  const recoveryBranch = recovery.branches.find((item) => item.branch_kind === "recovery");
  const recoveryNode = recovery.nodes.find((node) => node.label === "refreshToken()");
  const replayNode = recovery.nodes.find((node) => node.label === "replay original request");
  assert.ok(recoveryBranch);
  assert.ok(recoveryNode);
  assert.ok(replayNode);
  assert.ok(recovery.edges.some((edge) => edge.branch_id === recoveryBranch.branch_id && edge.branch_outcome === "true" && edge.to === recoveryNode.node_id));
  assert.ok(recovery.edges.some((edge) => edge.branch_id === recoveryBranch.branch_id && edge.branch_outcome === "true" && edge.to === replayNode.node_id));

  assert.ok(insufficient, "insufficient evidence chain");
  assert.equal(insufficient.stop_reason, "evidence_insufficient");
  assert.equal(insufficient.stop_context, "证据不足，继续恢复只能猜测");
  assert.ok(chains.every((chain) => chain.nodes.every((node) => !["frameworkProxy", "httpTransport.request"].includes(node.label))));
  assert.doesNotMatch(JSON.stringify(action), /审核通过/);
});

test("401, refreshToken, and request in separate branches do not form a recovery chain", () => {
  const result = runStage3Analysis({
    assets: [asset(HIGH_ID, "first_party", { runtime_loaded: true })],
    bodies: new Map([[HIGH_ID, stage3NegativeRecoverySource()]]),
  });
  assert.equal(result.l3_results[0].call_chain_candidates.length, 0);
  assert.equal(result.call_chain_candidates.some((chain) => chain.expanded_public_layers.includes("refreshToken()")), false);
  assert.equal(result.call_chain_candidates.some((chain) => chain.stop_reason === "test_relevant_public_layer_preserved"), false);
});

test("Stage 3 stop gate exposes each bounded stop reason", () => {
  const cases = [
    [{ businessLoopClosed: true }, "business_loop_closed"],
    [{ frameworkBoundary: true }, "framework_boundary"],
    [{ noNewInformation: true }, "no_new_test_information"],
    [{ frontEndBoundary: true }, "front_end_observable_boundary"],
    [{ evidenceSufficient: false }, "evidence_insufficient"],
  ];
  for (const [input, reason] of cases) {
    const result = evaluateStopGate(input);
    assert.equal(result.stop, true);
    assert.equal(result.reason, reason);
    assert.ok(result.context.length > 0);
  }
  assert.equal(evaluateStopGate().stop, false);
});

test("Stage 3 output validates against the minimum analysis schema", async () => {
  const result = runStage3Analysis({
    assets: [asset(HIGH_ID, "first_party", { runtime_loaded: true })],
    bodies: new Map([[HIGH_ID, stage3Source()]]),
  });
  const schema = JSON.parse(await readFile(new URL("../schemas/stage3-analysis.schema.json", import.meta.url), "utf8"));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  assert.equal(validate(result), true, JSON.stringify(validate.errors));

  const invalid = structuredClone(result);
  invalid.structural_relations[0].evidence_level = "E1";
  assert.equal(validate(invalid), false);
});
