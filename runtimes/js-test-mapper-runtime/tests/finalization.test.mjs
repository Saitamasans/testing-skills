import assert from "node:assert/strict";
import test from "node:test";
import { validateCognition } from "../src/cognition.mjs";
import { buildStage4NonOrderFixture } from "./fixtures/stage4-lineage.mjs";

test("cognition negative gates reject unknown IDs and overclaims", async () => {
  const { runData } = buildStage4NonOrderFixture();
  const valid = { schema_version: 1, run_id: runData.run.run_id, system_summary: "系统概览", lead: "测试关注点", route_presentations: [], chain_presentations: [], risk_items: [], next_test_focus: [], uncertain: [] };
  await assert.doesNotReject(validateCognition(valid, runData));
  await assert.rejects(validateCognition({ ...valid, route_presentations: [{ display_id: "ROUTE-999", module: "x", feature: "x", capability: "x", evidence_ids: [runData.evidence[0].evidence_id] }] }, runData), /unknown_display/);
  await assert.rejects(validateCognition({ ...valid, lead: "已测试成功" }, runData), /overclaim/);
});
