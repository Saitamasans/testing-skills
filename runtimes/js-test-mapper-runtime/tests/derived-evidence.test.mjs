import assert from "node:assert/strict";
import test from "node:test";
import { buildStage4NonOrderFixture } from "./fixtures/stage4-lineage.mjs";
import { buildStage4Bundle } from "../src/stage4-artifacts.mjs";
import { validateDerivedEvidence } from "../src/evidence-views.mjs";

test("derived evidence resolves typed refs and preserves entity-to-asset lineage", () => {
  const fixture = buildStage4NonOrderFixture();
  const bundle = buildStage4Bundle(fixture);
  const route = bundle.lineage.entities.route[0];
  route.fact_ids = [fixture.runData.technical_facts[0].fact_id];
  route.asset_ids = [fixture.runData.assets[0].asset_id];
  assert.deepEqual(validateDerivedEvidence({ runData: fixture.runData, lineage: bundle.lineage }), { valid: true });

  const badFact = structuredClone(bundle.lineage);
  badFact.entities.route[0].fact_ids = ["fact-ffffffffffffffff"];
  assert.throws(() => validateDerivedEvidence({ runData: fixture.runData, lineage: badFact }), /unknown_fact_id/);

  const badEvidence = structuredClone(bundle.lineage);
  badEvidence.entities.route[0].evidence_ids = ["evidence-asset-ffffffffffffffff"];
  assert.throws(() => validateDerivedEvidence({ runData: fixture.runData, lineage: badEvidence }), /unknown_evidence_id/);
});
