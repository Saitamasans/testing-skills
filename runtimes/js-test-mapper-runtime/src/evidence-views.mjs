import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertResolvedRefs, buildTraceabilityIndex } from "./traceability.mjs";

async function writeJson(dir, name, value) {
  await writeFile(path.join(dir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeEvidenceViews({ outputDir, runData, lineage, cognition }) {
  const evidenceDir = path.join(outputDir, "evidence");
  const traceability = buildTraceabilityIndex(runData, lineage);
  validateDerivedEvidence({ runData, lineage, traceability });
  const refs = (entity, label) => assertResolvedRefs(traceability.assertEntityReferences(entity, label), traceability, label);
  const routeRefs = (route) => refs(route, `route:${route.display_id || route.route}`);
  const chainRefs = (chain) => refs(chain, `chain:${chain.display_id || chain.chain_id}`);
  await mkdir(path.join(evidenceDir, "source-map"), { recursive: true });
  await mkdir(path.join(evidenceDir, "snippets"), { recursive: true });
  await writeJson(evidenceDir, "cognition.json", cognition);
  await writeJson(evidenceDir, "asset-manifest.json", { schema_version: 1, assets: runData.assets.map(({ asset_id, canonical_url, asset_type, classification, content_sha256, discovery_sources, source_map }) => ({ asset_id, canonical_url, asset_type, classification, content_sha256: content_sha256 || null, discovery_sources, source_map_status: source_map?.status || "not_declared" })) });
  await writeJson(evidenceDir, "application-map.json", { schema_version: 1, run_id: runData.run.run_id, routes: lineage.entities.route.map((item) => ({ ...item, ...routeRefs(item) })), cognition_status: "validated" });
  await writeJson(evidenceDir, "call-chains.json", { schema_version: 1, run_id: runData.run.run_id, chains: lineage.entities.chain.map((item) => ({ ...item, ...chainRefs(item) })) });
  await writeJson(evidenceDir, "routes.json", { schema_version: 1, run_id: runData.run.run_id, routes: lineage.entities.route.map((item) => ({ display_id: item.display_id, route: item.route, ...routeRefs(item) })) });
  await writeJson(evidenceDir, "api-references.json", { schema_version: 1, run_id: runData.run.run_id, references: runData.call_chain_candidates.flatMap((chain) => (chain.api_references || []).map((api) => ({ ...api, chain_id: chain.chain_id, ...chainRefs(chain) }))) });
  await writeJson(path.join(evidenceDir, "source-map"), "index.json", { schema_version: 1, persisted_sources: false, assets: runData.assets.map((asset) => ({ asset_id: asset.asset_id, ...refs(asset, `asset:${asset.asset_id}`), status: asset.source_map?.status || "not_declared", pointer: asset.source_map?.pointer || null })) });
  await writeJson(path.join(evidenceDir, "snippets"), "index.json", { schema_version: 1, persisted_snippets: false, reason: "安全边界不持久化完整 JS / Map / sourcesContent" });
}

export function validateDerivedEvidence({ runData, lineage = runData?.stage4, traceability = buildTraceabilityIndex(runData, lineage) }) {
  const collections = [
    ["route", lineage?.entities?.route || []],
    ["chain", lineage?.entities?.chain || []],
    ["risk", lineage?.entities?.risk || []],
  ];
  for (const [kind, entities] of collections) {
    for (const entity of entities) {
      const label = `${kind}:${entity.display_id || entity.route || entity.action || "unknown"}`;
      const refs = traceability.assertEntityReferences(entity, label);
      assertResolvedRefs(refs, traceability, label);
      const supportingFacts = refs.fact_ids.length > 0;
      const formalEvidence = refs.asset_ids.some((assetId) => (traceability.evidenceIdsByAsset.get(assetId) || []).length > 0);
      if (kind === "route" && supportingFacts && !refs.fact_ids.length) throw new Error(`derived_route_fact_refs_required:${label}`);
      if (kind !== "risk" && supportingFacts && formalEvidence && !refs.evidence_ids.length) throw new Error(`derived_${kind}_evidence_refs_required:${label}`);
      for (const evidenceId of refs.evidence_ids) {
        const evidence = traceability.evidenceById.get(evidenceId);
        if (!evidence || !refs.asset_ids.includes(evidence.asset_id)) throw new Error(`derived_evidence_asset_mismatch:${label}:${evidenceId}`);
      }
    }
  }
  return { valid: true };
}
