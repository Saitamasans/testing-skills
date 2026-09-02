const FACT_ID = /^fact-/;
const EVIDENCE_ID = /^evidence-/;

function values(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

export function buildTraceabilityIndex(runData, lineage = runData?.stage4) {
  const assetsById = new Map((runData?.assets || []).map((asset) => [asset.asset_id, asset]));
  const factsById = new Map((runData?.technical_facts || []).map((fact) => [fact.fact_id, fact]));
  const evidenceById = new Map((runData?.evidence || []).map((evidence) => [evidence.evidence_id, evidence]));
  const factIdsByAsset = new Map();
  const evidenceIdsByAsset = new Map();

  for (const fact of factsById.values()) {
    factIdsByAsset.set(fact.asset_id, [...factIdsByAsset.get(fact.asset_id) || [], fact.fact_id]);
  }
  for (const evidence of evidenceById.values()) {
    evidenceIdsByAsset.set(evidence.asset_id, [...evidenceIdsByAsset.get(evidence.asset_id) || [], evidence.evidence_id]);
  }

  const entitiesByDisplayId = new Map();
  for (const entity of Object.values(lineage?.entities || {}).flat()) {
    if (entity?.display_id) entitiesByDisplayId.set(entity.display_id, entity);
  }

  const refsForEntity = (entity) => {
    const factIds = new Set();
    const assetIds = new Set();
    const evidenceIds = new Set();

    const addAsset = (assetId) => {
      if (!assetsById.has(assetId) || assetIds.has(assetId)) return;
      assetIds.add(assetId);
      for (const evidenceId of evidenceIdsByAsset.get(assetId) || []) evidenceIds.add(evidenceId);
    };
    const addFact = (factId) => {
      const fact = factsById.get(factId);
      if (!fact) return;
      factIds.add(factId);
      addAsset(fact.asset_id);
    };
    const addEvidence = (evidenceId) => {
      const evidence = evidenceById.get(evidenceId);
      if (!evidence) return;
      evidenceIds.add(evidenceId);
      addAsset(evidence.asset_id);
    };

    for (const assetId of values(entity?.asset_ids)) addAsset(assetId);
    addAsset(entity?.asset_id);
    for (const factId of values(entity?.fact_ids)) addFact(factId);
    for (const evidenceId of values(entity?.evidence_ids)) {
      if (FACT_ID.test(String(evidenceId))) addFact(evidenceId);
      else if (EVIDENCE_ID.test(String(evidenceId))) addEvidence(evidenceId);
    }
    for (const evidenceId of values(entity?.evidence_id)) {
      if (FACT_ID.test(String(evidenceId))) addFact(evidenceId);
      else if (EVIDENCE_ID.test(String(evidenceId))) addEvidence(evidenceId);
    }
    for (const legacy of values(entity?.evidence)) {
      if (FACT_ID.test(String(legacy))) addFact(legacy);
      else if (EVIDENCE_ID.test(String(legacy))) addEvidence(legacy);
    }

    return {
      fact_ids: [...factIds].sort(),
      asset_ids: [...assetIds].sort(),
      evidence_ids: [...evidenceIds].sort(),
    };
  };

  const rawReferenceValues = (entity, field) => values(entity?.[field]).map(String).filter(Boolean);
  const assertEntityReferences = (entity, label = "entity") => {
    for (const assetId of [...rawReferenceValues(entity, "asset_id"), ...rawReferenceValues(entity, "asset_ids")]) {
      if (!assetsById.has(assetId)) throw new Error(`traceability_unknown_asset_id:${label}:${assetId}`);
    }
    for (const factId of rawReferenceValues(entity, "fact_ids")) {
      if (!factsById.has(factId)) throw new Error(`traceability_unknown_fact_id:${label}:${factId}`);
    }
    for (const evidenceId of [...rawReferenceValues(entity, "evidence_id"), ...rawReferenceValues(entity, "evidence_ids")]) {
      if (FACT_ID.test(evidenceId)) {
        if (!factsById.has(evidenceId)) throw new Error(`traceability_unknown_fact_id:${label}:${evidenceId}`);
      } else if (!evidenceById.has(evidenceId)) {
        throw new Error(`traceability_unknown_evidence_id:${label}:${evidenceId}`);
      }
    }
    for (const legacy of rawReferenceValues(entity, "evidence")) {
      if (FACT_ID.test(legacy) && !factsById.has(legacy)) throw new Error(`traceability_unknown_fact_id:${label}:${legacy}`);
      if (EVIDENCE_ID.test(legacy) && !evidenceById.has(legacy)) throw new Error(`traceability_unknown_evidence_id:${label}:${legacy}`);
    }
    return refsForEntity(entity);
  };

  return {
    assetsById,
    factsById,
    evidenceById,
    factIdsByAsset,
    evidenceIdsByAsset,
    entitiesByDisplayId,
    refsForEntity,
    assertEntityReferences,
    refsForDisplayId(displayId) {
      const entity = entitiesByDisplayId.get(displayId);
      return entity ? refsForEntity(entity) : { fact_ids: [], asset_ids: [], evidence_ids: [] };
    },
  };
}

export function assertResolvedRefs(refs, index, label = "entity") {
  for (const factId of refs.fact_ids || []) if (!index.factsById.has(factId)) throw new Error(`traceability_unknown_fact_id:${label}:${factId}`);
  for (const assetId of refs.asset_ids || []) if (!index.assetsById.has(assetId)) throw new Error(`traceability_unknown_asset_id:${label}:${assetId}`);
  for (const evidenceId of refs.evidence_ids || []) if (!index.evidenceById.has(evidenceId)) throw new Error(`traceability_unknown_evidence_id:${label}:${evidenceId}`);
  return refs;
}
