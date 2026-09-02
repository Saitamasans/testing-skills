import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { buildTraceabilityIndex } from "./traceability.mjs";

const schemaPath = fileURLToPath(new URL("../schemas/cognition.schema.json", import.meta.url));
const OVERCLAIM = /已测试|测试通过|已验证成功|静态分析通过/;
let validator;

function ids(runData) {
  const traceability = buildTraceabilityIndex(runData);
  const display = new Set(traceability.entitiesByDisplayId.keys());
  const evidence = new Set(traceability.evidenceById.keys());
  const risk = new Set((runData.stage4?.entities?.risk || []).map((item) => item.display_id));
  return { display, evidence, risk, traceability };
}

function assertPresentationGrounding(item, known, label) {
  if (!item.evidence_ids.length) throw new Error(`cognition_empty_evidence_ids: ${label}:${item.display_id}`);
  const allowed = new Set(known.traceability.refsForDisplayId(item.display_id).evidence_ids);
  for (const evidenceId of item.evidence_ids) {
    if (!known.evidence.has(evidenceId)) throw new Error(`cognition_unknown_evidence_id: ${evidenceId}`);
    if (!allowed.has(evidenceId)) throw new Error(`cognition_unrelated_evidence_id: ${label}:${item.display_id}:${evidenceId}`);
  }
}

export async function validateCognition(cognition, runData) {
  if (!validator) validator = new Ajv2020({ allErrors: true, strict: false }).compile(JSON.parse(await readFile(schemaPath, "utf8")));
  if (!validator(cognition)) throw new Error(`cognition_schema_invalid: ${JSON.stringify(validator.errors)}`);
  if (cognition.run_id !== runData.run.run_id) throw new Error("cognition_run_id_mismatch");
  if (OVERCLAIM.test(JSON.stringify(cognition))) throw new Error("cognition_overclaim_forbidden");
  const known = ids(runData);
  for (const item of cognition.route_presentations) {
    if (!known.display.has(item.display_id)) throw new Error(`cognition_unknown_display_id: ${item.display_id}`);
    assertPresentationGrounding(item, known, "route");
  }
  for (const item of cognition.chain_presentations) {
    if (!known.display.has(item.display_id)) throw new Error(`cognition_unknown_display_id: ${item.display_id}`);
    assertPresentationGrounding(item, known, "chain");
  }
  for (const item of cognition.risk_items) {
    for (const displayId of item.related_display_ids) if (!known.display.has(displayId)) throw new Error(`cognition_unknown_display_id: ${displayId}`);
    for (const evidenceId of item.evidence_ids) if (!known.evidence.has(evidenceId)) throw new Error(`cognition_unknown_evidence_id: ${evidenceId}`);
    if (!known.risk.has(item.target_risk_display_id)) throw new Error(`cognition_unknown_risk_display_id: ${item.target_risk_display_id}`);
    if (item.related_display_ids.length && !item.related_display_ids.some((displayId) => item.evidence_ids.some((evidenceId) => known.traceability.refsForDisplayId(displayId).evidence_ids.includes(evidenceId)))) {
      throw new Error(`cognition_unrelated_risk_evidence: ${item.target_risk_display_id}`);
    }
  }
  return cognition;
}

export function buildCognitionInput(runData) {
  const entities = runData.stage4?.entities || {};
  const traceability = buildTraceabilityIndex(runData);
  return {
    schema_version: 1,
    run_id: runData.run.run_id,
    source: "deterministic run-data; AI may add presentation only",
    routes: (entities.route || []).map((item) => ({ display_id: item.display_id, route: item.route, evidence_ids: traceability.refsForEntity(item).evidence_ids })),
    chains: (entities.chain || []).map((item) => ({ display_id: item.display_id, technical_action: item.action, technical_summary: item.summary, evidence_ids: traceability.refsForEntity(item).evidence_ids })),
    risks: (entities.risk || []).map((item) => ({ display_id: item.display_id, type: item.focus_type, technical_basis: item.technical_basis, evidence_ids: traceability.refsForEntity(item).evidence_ids })),
    guard: "Do not change technical facts, IDs, evidence, API, branch, hash, or status fields.",
  };
}

export function applyCognitionToLineage(lineage, cognition) {
  const result = structuredClone(lineage);
  const routeById = new Map(cognition.route_presentations.map((item) => [item.display_id, item]));
  const chainById = new Map(cognition.chain_presentations.map((item) => [item.display_id, item]));
  const riskByTarget = new Map(cognition.risk_items.map((item) => [item.target_risk_display_id, item]));
  for (const route of result.entities.route || []) { const presentation = routeById.get(route.display_id); if (presentation) Object.assign(route, { module: presentation.module, feature: presentation.feature, capability: presentation.capability }); }
  for (const chain of result.entities.chain || []) { const presentation = chainById.get(chain.display_id); if (presentation) Object.assign(chain, { feature: presentation.feature, action: presentation.business_action, summary: presentation.tester_summary }); }
  for (const risk of result.entities.risk || []) {
    const presentation = riskByTarget.get(risk.display_id);
    if (presentation) Object.assign(risk, { focus_type: presentation.type, type: presentation.type, statement: presentation.statement, priority: presentation.priority });
  }
  for (const batch of Object.values(result.batch_entities || {})) {
    for (const route of batch.route || []) { const presentation = routeById.get(route.display_id); if (presentation) Object.assign(route, { module: presentation.module, feature: presentation.feature, capability: presentation.capability }); }
    for (const chain of batch.chain || []) { const presentation = chainById.get(chain.display_id); if (presentation) Object.assign(chain, { feature: presentation.feature, action: presentation.business_action, summary: presentation.tester_summary }); }
    for (const risk of batch.risk || []) {
      const presentation = riskByTarget.get(risk.display_id);
      if (presentation) Object.assign(risk, { focus_type: presentation.type, type: presentation.type, statement: presentation.statement, priority: presentation.priority });
    }
  }
  return result;
}
