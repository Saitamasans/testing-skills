import { applyBatch, buildExcelProjection, buildLineage, buildWordProjection, createLineage } from "./stage4-artifacts.mjs";
import { runStage3Analysis } from "./stage3-analysis.mjs";
import { batchPurpose, nextBatchId } from "./batch.mjs";

function uniqueBy(items, key) {
  const seen = new Set();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function chainSummary(chain) {
  const labels = new Map((chain.nodes || []).map((node) => [node.node_id, node.label]));
  const parts = [];
  for (const branch of chain.branches || []) {
    if (branch.branch_kind === "guard") {
      const label = /permission|role|authorize|includes\s*\(/i.test(branch.condition || "") ? "permission guard" : "status guard";
      parts.push(`${label}: ${branch.condition} true=>stop; false=>continue`);
    } else if (branch.branch_kind === "if_else") {
      const outcomes = (branch.outcomes || []).map((outcome) => `${outcome.outcome}=>${(outcome.target_node_ids || []).map((id) => labels.get(id)).filter(Boolean).join(",") || outcome.path_effect}`);
      parts.push(`${branch.condition} ${outcomes.join("; ")}`);
    } else if (branch.branch_kind === "recovery") {
      parts.push(`401 true=>refreshToken(); replay original request; false=>continue`);
    }
  }
  return parts.join(" | ") || chain.context || chain.stop_context || "静态调用链候选；具体业务语义待确认";
}

function entitiesFromAnalysis({ runData, analysis }) {
  const routeFacts = runData.technical_facts.filter((fact) => fact.fact_type === "route_candidate");
  const routes = uniqueBy(routeFacts, (fact) => `${fact.asset_id}:${fact.value}`).map((fact) => ({
    module: "待确认",
    feature: "待确认",
    route: fact.value,
    technical_route: fact.value,
    capability: "静态路由候选；具体页面能力待确认",
    relations: `证据 ${[fact.fact_id].sort().join("、")}`,
    current_status: "静态恢复",
    fact_ids: [fact.fact_id],
    asset_ids: [fact.asset_id],
    evidence: [fact.fact_id],
  }));

  const chains = analysis.call_chain_candidates.map((chain) => {
    const entry = chain.nodes?.find((node) => node.node_type === "function") || chain.nodes?.[0];
    const routesForChain = chain.module_route_context?.routes || [];
    return {
      ...chain,
      feature: routesForChain[0] || "待确认",
      action: chain.action_candidate || chain.action_label || "待确认",
      summary: chainSummary(chain),
      technical_function: entry?.label || null,
      entry_anchor: entry?.label || null,
      route_anchor: routesForChain[0] || null,
      source_location: entry?.location?.file || null,
      branch_signature: chain.branches || [],
      current_status: "静态恢复",
      representative: true,
      stage3_candidate_found: true,
    };
  });

  const rules = uniqueBy(
    chains.flatMap((chain) => (chain.preconditions || []).map((condition) => ({
      feature: chain.feature,
      rule_type: condition.kind === "permission" ? "权限条件" : "状态条件",
      technical_subject: condition.kind,
      technical_expression: condition.expression,
      expression: condition.expression,
      testing_impact: condition.guard_outcomes?.true === "stop" ? "true 停止当前路径，false 继续；业务枚举待确认" : "条件影响调用路径；业务语义待确认",
      current_status: "静态恢复",
      evidence: [condition.branch_id].filter(Boolean),
    }))),
    (rule) => `${rule.rule_type}:${rule.expression}`,
  );

  const risks = uniqueBy(chains.filter((chain) => chain.action_label === "待确认").map((chain) => ({
    feature: chain.feature,
    focus_type: "待确认",
    type: "待确认",
    technical_basis: chain.stop_reason || "evidence_insufficient",
    basis: chain.stop_context || "证据不足，继续恢复只能猜测",
    statement: "该候选调用链缺少足够前端证据，业务语义保持待确认",
    priority: "P2",
    current_status: "待执行验证",
    evidence_ids: chain.evidence_ids || [],
  })), (risk) => `${risk.feature}:${risk.technical_basis}`);

  if (!risks.length) risks.push({
    feature: "全局",
    focus_type: "待确认",
    type: "待确认",
    technical_basis: "runtime_observation_boundary",
    basis: "静态建图未执行业务测试",
    statement: "当前未覆盖的页面范围、状态分支或业务枚举仍待确认",
    priority: "P2",
    current_status: "待执行验证",
    evidence_ids: runData.evidence.map((item) => item.evidence_id),
  });
  return { routes, chains, rules, risks };
}

function previousBatches(previousRunData) {
  const previous = previousRunData?.stage4;
  if (!previous?.batches?.length) return [];
  return previous.batches.map((batch) => ({
    ...batch,
    routes: previous.batch_entities?.[batch.batch_id]?.route || [],
    chains: previous.batch_entities?.[batch.batch_id]?.chain || [],
    rules: previous.batch_entities?.[batch.batch_id]?.rule || [],
    risks: previous.batch_entities?.[batch.batch_id]?.risk || [],
  }));
}

export function integrateStage3Stage4({ runData, bodies, previousRunData = null, currentBatch = nextBatchId(previousRunData) }) {
  const expectedBatch = nextBatchId(previousRunData);
  if (currentBatch !== expectedBatch) throw new Error(`stage5_current_batch_mismatch:${currentBatch}:${expectedBatch}`);
  if (runData.batches?.at(-1)?.batch_id !== currentBatch) throw new Error(`stage5_run_data_batch_mismatch:${runData.batches?.at(-1)?.batch_id || "missing"}:${currentBatch}`);
  const analysis = runStage3Analysis({ assets: runData.assets, bodies, l1Facts: runData.technical_facts, currentBatch });
  const entities = entitiesFromAnalysis({ runData, analysis });
  const previousBatchesList = previousBatches(previousRunData);
  const batch = {
    batch_id: currentBatch,
    scanned_at: runData.run.finished_at,
    purpose: currentBatch === "B01" ? "建立技术资产与代表性调用链骨架" : "基于新增或更新资产复核代表性调用链",
    scope: {
      reason: currentBatch === "B01" ? "首次 URL 扫描" : "增量 Hash / 运行时资产变化",
      description: "当前 URL、自然加载脚本、Dynamic Chunk、明确 Source Map 和静态引用的技术资源",
      asset_summary: `assets=${runData.assets.length}; fingerprint=${runData.run.run_id}`,
      blockers: "登录后范围、动态 dispatch 和未观察状态仍待确认",
    },
    status: runData.run.status === "completed" ? "完成" : "部分完成",
    asset_counts: {
      added: runData.assets.filter((asset) => !asset.previous_sha256).length,
      updated: runData.assets.filter((asset) => asset.content_changed).length,
    },
    ...entities,
  };
  const lineage = previousBatchesList.length
    ? buildLineage({ lineageId: previousRunData.stage4.lineage_id, baseRunId: previousRunData.run.run_id, batches: previousBatchesList })
    : createLineage({ lineageId: "js-test-mapper-runtime", baseRunId: runData.run.run_id });
  applyBatch(lineage, batch);
  const enrichedRunData = {
    ...runData,
    analysis_focus: analysis.analysis_focus,
    structural_relations: analysis.structural_relations,
    call_chain_candidates: analysis.call_chain_candidates,
    stage4: lineage,
  };
  const excelProjection = buildExcelProjection({ runData: enrichedRunData, lineage });
  const wordProjection = buildWordProjection({ runData: enrichedRunData, lineage });
  return { runData: enrichedRunData, lineage, analysis, excelProjection, wordProjection };
}
