import { createHash } from "node:crypto";

const DISPLAY_PREFIX = {
  route: "ROUTE",
  chain: "CHAIN",
  rule: "RULE",
  risk: "RISK",
};

const TESTER_STATUSES = new Set(["静态恢复", "运行观察", "待执行验证"]);
const BATCH_STATUSES = new Set(["完成", "部分完成", "阻塞"]);
const FOCUS_TYPES = new Set(["测试关注点", "风险", "待确认"]);
const SET_LIKE_FIELDS = new Set(["fact_ids", "asset_ids", "evidence_ids"]);
const REFERENCE_ID = /^(?:fact|evidence)-/;

function isReferenceId(value) {
  return typeof value === "string" && REFERENCE_ID.test(value);
}

function stableSet(value) {
  const unique = new Map();
  for (const item of value) {
    const normalized = stableNormalize(item);
    unique.set(JSON.stringify(normalized), normalized);
  }
  return [...unique.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, item]) => item);
}

function stableNormalize(value, field = "") {
  if (Array.isArray(value)) {
    const normalized = value.map((item) => stableNormalize(item, field));
    if (SET_LIKE_FIELDS.has(field) || (field === "evidence" && normalized.every(isReferenceId))) return stableSet(normalized);
    return normalized;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableNormalize(value[key], key)]));
}

export function digest(value) {
  return createHash("sha256").update(JSON.stringify(stableNormalize(value))).digest("hex");
}

export function sourceFingerprint(runData) {
  return digest(runData);
}

function clean(value) {
  return String(value ?? "").trim();
}

function postProcessingSummary(value) {
  if (!Array.isArray(value)) return clean(value) || "无明确后处理证据";
  const parts = value.map((item) => {
    if (!item || typeof item !== "object") return clean(item);
    const label = clean(item.summary || item.expression || item.effect || item.target || item.kind);
    return label || "存在结构化后处理证据，详见 evidence";
  }).filter(Boolean);
  return parts.join("；") || "存在结构化后处理证据，详见 evidence";
}

function apiSemantic(chain) {
  return (chain.api_references || chain.apiReferences || [])
    .map((item) => `${clean(item.method || item.http_method).toUpperCase()} ${clean(item.url || item.path)}`)
    .filter(Boolean)
    .sort();
}

function technicalAnchor(entity, ...keys) {
  for (const key of keys) {
    if (clean(entity?.[key])) return clean(entity[key]);
  }
  return "";
}

export function identityBasis(kind, entity) {
  if (kind === "route") {
    return {
      identity_version: "stage4-v2",
      kind,
      route_anchor: technicalAnchor(entity, "technical_route", "route", "path"),
      entry_anchor: technicalAnchor(entity, "technical_entry", "entry", "route_anchor"),
    };
  }
  if (kind === "chain") {
    const nodeAnchor = entity?.nodes?.[0]?.label || entity?.entry_anchor || "";
    return {
      identity_version: "stage4-v2",
      kind,
      route_anchor: technicalAnchor(entity, "route_anchor", "technical_route", "route"),
      entry_anchor: technicalAnchor(entity, "technical_function", "function_anchor", "technical_entry", "entry_anchor") || clean(nodeAnchor),
      api_semantic: apiSemantic(entity),
      branch_signature: [...(entity.branch_signature || entity.branches || [])].map((item) => clean(typeof item === "string" ? item : `${item.branch_kind || ""}:${item.condition || item.expression || ""}`)).filter(Boolean).sort(),
      evidence_anchor: [...(entity.evidence_ids || entity.evidence_id ? (entity.evidence_ids || [entity.evidence_id]) : [])].map(clean).filter(Boolean).sort(),
      source_anchor: clean(entity.source_location || entity.nodes?.[0]?.location?.file),
    };
  }
  if (kind === "rule") {
    return {
      identity_version: "stage4-v2",
      kind,
      subject_anchor: technicalAnchor(entity, "technical_subject", "subject_anchor", "relation_id", "evidence_anchor"),
      rule_type: technicalAnchor(entity, "rule_type", "type"),
      expression_anchor: technicalAnchor(entity, "technical_expression", "expression", "value"),
    };
  }
  return {
    identity_version: "stage4-v2",
    kind,
    focus_type: technicalAnchor(entity, "focus_type", "risk_type", "type"),
    basis_anchor: technicalAnchor(entity, "technical_basis", "basis_anchor", "evidence_anchor", "basis"),
    related_object: technicalAnchor(entity, "related_technical_id", "related_display_id"),
  };
}

function hasTechnicalIdentityAnchor(kind, basis) {
  if (kind === "route") return Boolean(basis.route_anchor || basis.entry_anchor);
  if (kind === "chain") return Boolean(basis.route_anchor || basis.entry_anchor || basis.api_semantic.length || basis.branch_signature.length || basis.evidence_anchor.length || basis.source_anchor);
  if (kind === "rule") return Boolean(basis.subject_anchor || basis.expression_anchor);
  return Boolean(basis.basis_anchor || basis.related_object);
}

function assertIdentityCompleteness(kind, entity, basis) {
  const formalStatic = entity?.representative !== false && ["静态恢复", "运行观察"].includes(statusOf(entity));
  if (formalStatic && kind === "chain" && !hasTechnicalIdentityAnchor(kind, basis)) throw new Error("stage4_representative_chain_identity_basis_required");
}

export function buildMachineIdentity(kind, entity) {
  return `${kind}:${digest(identityBasis(kind, entity)).slice(0, 24)}`;
}

function nextDisplayNumber(registry, kind) {
  const prefix = `${DISPLAY_PREFIX[kind]}-`;
  return registry
    .filter((item) => item.kind === kind && item.display_id.startsWith(prefix))
    .map((item) => Number(item.display_id.slice(prefix.length)))
    .filter(Number.isInteger)
    .reduce((max, current) => Math.max(max, current), 0) + 1;
}

function displayId(registry, kind) {
  return `${DISPLAY_PREFIX[kind]}-${String(nextDisplayNumber(registry, kind)).padStart(3, "0")}`;
}

function changedFields(previous, current) {
  const fields = new Set([...Object.keys(previous || {}), ...Object.keys(current || {})]);
  return [...fields].filter((field) => !["display_id", "machine_identity", "content_digest", "revisions", "first_seen_batch", "last_seen_batch"].includes(field) && JSON.stringify(stableNormalize(previous?.[field], field)) !== JSON.stringify(stableNormalize(current?.[field], field))).sort();
}

function cloneEntity(entity) {
  return JSON.parse(JSON.stringify(entity));
}

function canonicalizeEntity(kind, entity) {
  const result = cloneEntity(entity);
  for (const field of SET_LIKE_FIELDS) if (Array.isArray(result[field])) result[field] = stableSet(result[field]);
  if (Array.isArray(result.evidence) && result.evidence.every(isReferenceId)) result.evidence = stableSet(result.evidence);
  if (kind === "route") {
    const routeFacts = stableSet([
      ...(result.fact_ids || []),
      ...(result.evidence || []).filter((item) => typeof item === "string" && item.startsWith("fact-")),
    ]);
    if (routeFacts.length) result.relations = `证据 ${routeFacts.join("、")}`;
  }
  return result;
}

function ensureRegistry(lineage) {
  lineage.display_id_registry ||= [];
  for (const kind of Object.keys(DISPLAY_PREFIX)) lineage.entities ||= {};
  for (const kind of Object.keys(DISPLAY_PREFIX)) lineage.entities[kind] ||= [];
  lineage.revisions ||= [];
  lineage.successor_candidates ||= [];
}

export function createLineage({ lineageId = "js-test-mapper-demo", baseRunId = "run-stage4-demo" } = {}) {
  return {
    lineage_id: lineageId,
    base_run_id: baseRunId,
    current_batch: null,
    display_id_registry: [],
    entities: { route: [], chain: [], rule: [], risk: [] },
    revisions: [],
    successor_candidates: [],
    batches: [],
    batch_entities: {},
  };
}

function currentEntity(lineage, kind, identity) {
  return lineage.entities[kind].find((item) => item.machine_identity === identity);
}

export function applyBatch(lineage, snapshot) {
  ensureRegistry(lineage);
  if (!snapshot?.batch_id) throw new Error("stage4_batch_id_required");
  if (lineage.batches.some((batch) => batch.batch_id === snapshot.batch_id)) throw new Error(`stage4_duplicate_batch: ${snapshot.batch_id}`);
  const batchSummary = {
    batch_id: snapshot.batch_id,
    scanned_at: snapshot.scanned_at,
    purpose: snapshot.purpose,
    scope: snapshot.scope,
    status: snapshot.status || "完成",
    asset_counts: snapshot.asset_counts || { added: 0, updated: 0 },
    added: { route: 0, chain: 0, rule: 0, risk: 0 },
    updated: { route: 0, chain: 0, rule: 0, risk: 0 },
    unchanged: { route: 0, chain: 0, rule: 0, risk: 0 },
    changes: [],
  };
  lineage.batch_entities[snapshot.batch_id] = { route: [], chain: [], rule: [], risk: [] };
  if (!BATCH_STATUSES.has(batchSummary.status)) throw new Error(`stage4_invalid_batch_status: ${batchSummary.status}`);
  for (const kind of Object.keys(DISPLAY_PREFIX)) {
    const candidatesByIdentity = new Map();
    for (const raw of snapshot[kind + "s"] || []) {
      const identity = buildMachineIdentity(kind, raw);
      const existing = candidatesByIdentity.get(identity);
      if (!existing) candidatesByIdentity.set(identity, raw);
      else {
        const merged = cloneEntity(existing);
        for (const field of ["fact_ids", "asset_ids", "evidence", "evidence_ids", "nodes", "edges", "branches"]) {
          if (Array.isArray(existing[field]) || Array.isArray(raw[field])) {
            const values = [...existing[field] || [], ...raw[field] || []];
            merged[field] = SET_LIKE_FIELDS.has(field) || (field === "evidence" && values.every(isReferenceId))
              ? stableSet(values)
              : [...new Map(values.map((item) => [JSON.stringify(item), item])).values()];
          }
        }
        candidatesByIdentity.set(identity, canonicalizeEntity(kind, merged));
      }
    }
    const candidates = [...candidatesByIdentity.values()].sort((left, right) => buildMachineIdentity(kind, left).localeCompare(buildMachineIdentity(kind, right)));
    for (const raw of candidates) {
      const candidate = canonicalizeEntity(kind, raw);
      const identity = buildMachineIdentity(kind, candidate);
      candidate.identity_version = "stage4-v2";
      candidate.identity_basis = identityBasis(kind, candidate);
      assertIdentityCompleteness(kind, candidate, candidate.identity_basis);
      const digestable = { ...candidate, machine_identity: undefined, display_id: undefined, content_digest: undefined, revisions: undefined, first_seen_batch: undefined, last_seen_batch: undefined };
      const candidateDigest = digest(digestable);
      const previous = currentEntity(lineage, kind, identity);
      if (previous) {
        const beforeDigest = previous.content_digest;
        const fields = changedFields(previous, candidate);
        batchSummary.unchanged[kind] += beforeDigest === candidateDigest ? 1 : 0;
        batchSummary.updated[kind] += beforeDigest === candidateDigest ? 0 : 1;
        candidate.display_id = previous.display_id;
        candidate.machine_identity = identity;
        candidate.identity_version = "stage4-v2";
        candidate.identity_basis = identityBasis(kind, candidate);
        assertIdentityCompleteness(kind, candidate, candidate.identity_basis);
        candidate.content_digest = candidateDigest;
        candidate.first_seen_batch = previous.first_seen_batch;
        candidate.last_seen_batch = snapshot.batch_id;
        candidate.revisions = previous.revisions || [];
        if (beforeDigest !== candidateDigest) {
          const revision = (candidate.revisions.at(-1)?.revision || 1) + 1;
          const record = {
            display_id: previous.display_id,
            machine_identity: identity,
            identity_version: candidate.identity_version,
            identity_basis: candidate.identity_basis,
            revision,
            batch: snapshot.batch_id,
            changed_fields: fields,
            previous_digest: beforeDigest,
            current_digest: candidateDigest,
            reason: candidate.change_reason || "same high-confidence identity with substantive content change",
            evidence: candidate.evidence || [],
          };
          candidate.revisions.push(record);
          lineage.revisions.push(record);
          batchSummary.changes.push({ kind, display_id: candidate.display_id, change: "updated", revision });
        }
        const index = lineage.entities[kind].indexOf(previous);
        lineage.entities[kind][index] = candidate;
        lineage.batch_entities[snapshot.batch_id][kind].push(cloneEntity(candidate));
        continue;
      }
      candidate.display_id = candidate.display_id || displayId(lineage.display_id_registry, kind);
      candidate.machine_identity = identity;
      candidate.identity_version = "stage4-v2";
      candidate.identity_basis = identityBasis(kind, candidate);
      assertIdentityCompleteness(kind, candidate, candidate.identity_basis);
      candidate.content_digest = candidateDigest;
      candidate.first_seen_batch = snapshot.batch_id;
      candidate.last_seen_batch = snapshot.batch_id;
      candidate.revisions = [];
      lineage.entities[kind].push(candidate);
      lineage.batch_entities[snapshot.batch_id][kind].push(cloneEntity(candidate));
      lineage.display_id_registry.push({ kind, display_id: candidate.display_id, machine_identity: identity, identity_version: candidate.identity_version, identity_basis: candidate.identity_basis, first_seen_batch: snapshot.batch_id });
      batchSummary.added[kind] += 1;
      batchSummary.changes.push({ kind, display_id: candidate.display_id, change: "added" });
      const successorDisplayId = candidate.possible_successor_of || (candidate.possible_successor_of_identity ? lineage.entities[kind].find((item) => item.machine_identity === candidate.possible_successor_of_identity)?.display_id : null);
      if (successorDisplayId) {
        const successor = {
          kind,
          display_id: candidate.display_id,
          possible_successor_of: successorDisplayId,
          confidence: candidate.successor_confidence ?? "low",
          reason: candidate.successor_reason || "部分模块/结构相似，但业务动作或核心 API 不足以高置信合并",
          batch: snapshot.batch_id,
        };
        lineage.successor_candidates.push(successor);
        batchSummary.changes.push({ kind, display_id: candidate.display_id, change: "possible_successor" });
      }
    }
  }
  lineage.batches.push(batchSummary);
  lineage.current_batch = snapshot.batch_id;
  return batchSummary;
}

export function buildLineage({ lineageId, baseRunId, batches }) {
  const lineage = createLineage({ lineageId, baseRunId });
  for (const batch of batches) applyBatch(lineage, batch);
  return lineage;
}

function currentEntities(lineage, kind) {
  return [...(lineage.entities[kind] || [])].sort((left, right) => left.display_id.localeCompare(right.display_id));
}

function latestChanges(lineage, batchId) {
  const batch = lineage.batches.find((item) => item.batch_id === batchId);
  return new Set((batch?.changes || []).filter((item) => item.change === "added" || item.change === "updated" || item.change === "possible_successor").map((item) => `${item.kind}:${item.display_id}`));
}

function divider(batch, label, kind) {
  return { divider: true, values: [`【扫描批次】${batch.batch_id}｜${batch.scanned_at}`, `${label}｜新增${batch.added[kind] || 0}项｜更新${batch.updated[kind] || 0}项`] };
}

function statusOf(entity) {
  return entity.current_status || "静态恢复";
}

export function buildExcelProjection({ runData, lineage }) {
  const batches = [...lineage.batches].sort((left, right) => right.batch_id.localeCompare(left.batch_id));
  const latest = batches[0];
  const fingerprint = sourceFingerprint(runData);
  const sheets = [];
  sheets.push({
    name: "01_扫描批次与范围",
    columns: ["批次编号", "扫描时间", "批次主题", "形成原因", "扫描范围", "技术资产摘要", "新增资产数", "更新资产数", "新增调用链数", "批次状态", "未覆盖/阻塞摘要"],
    rows: batches.slice().reverse().map((batch) => ({ values: [batch.batch_id, batch.scanned_at, batch.purpose, batch.scope?.reason || "按增量信息选择重点", batch.scope?.description || "当前 URL 及已观察技术资产", batch.scope?.asset_summary || `run-data fingerprint=${fingerprint.slice(0, 16)}`, batch.asset_counts.added, batch.asset_counts.updated, batch.added.chain, batch.status, batch.scope?.blockers || "登录后范围、动态 dispatch 和未观察状态仍待确认"] })),
  });

  const rowsForKind = (kind, mapRow, label) => {
    const rows = [];
    for (const batch of batches) {
      const changeKeys = latestChanges(lineage, batch.batch_id);
      const history = lineage.batch_entities[batch.batch_id]?.[kind] || [];
      const entities = batch.batch_id === "B01" ? history : history.filter((entity) => changeKeys.has(`${kind}:${entity.display_id}`));
      if (!entities.length && batch.batch_id !== "B01") continue;
      rows.push(divider(batch, label, kind));
      for (const entity of entities) rows.push({ values: mapRow(entity, fingerprint) });
    }
    return rows;
  };

  sheets.push({
    name: "02_系统功能与路由地图",
    columns: ["所属模块", "功能/页面", "路由/入口", "主要能力", "关联关系", "当前状态"],
    rows: rowsForKind("route", (route) => [route.module, route.feature, `${route.display_id} / ${route.route}`, route.capability, route.relations || "静态路由与调用链候选关联", statusOf(route)], "系统功能与路由地图"),
  });
  sheets.push({
    name: "03_JS调用链与接口引用",
    columns: ["调用链ID", "所属功能", "业务动作", "JS调用链摘要", "接口引用", "后续处理", "当前状态"],
    rows: rowsForKind("chain", (chain) => [chain.display_id, chain.feature, chain.action, chain.summary, apiSemantic(chain).join("；"), postProcessingSummary(chain.post_processing), statusOf(chain)], "JS调用链与接口引用"),
  });
  sheets.push({
    name: "04_权限状态与生命周期",
    columns: ["所属功能", "类型", "关键规则/线索", "对测试的影响", "当前状态"],
    rows: rowsForKind("rule", (rule) => [rule.feature, rule.rule_type, `${rule.display_id}｜${rule.expression}`, rule.testing_impact, statusOf(rule)], "权限状态与生命周期"),
  });
  sheets.push({
    name: "05_测试关注点与风险待确认",
    columns: ["编号", "所属功能", "类型", "测试关注点 / 风险 / 待确认", "形成依据", "优先级", "状态"],
    rows: rowsForKind("risk", (risk) => [risk.display_id, risk.feature, risk.focus_type, risk.statement, risk.basis, risk.priority, statusOf(risk)], "测试关注点与风险待确认"),
  });
  return { title: "JS逆向测试资产表", run_data_fingerprint: fingerprint, current_batch: latest?.batch_id || null, sheets };
}

export function buildWordProjection({ runData, lineage }) {
  const fingerprint = sourceFingerprint(runData);
  const routes = currentEntities(lineage, "route");
  const chains = currentEntities(lineage, "chain");
  const rules = currentEntities(lineage, "rule");
  const risks = currentEntities(lineage, "risk");
  const representativeChains = chains.filter((chain) => chain.representative !== false).slice(0, 3);
  const cognition = runData.cognition || {};
  const systemSummary = cognition.system_summary || "本轮交付物由确定性 run-data 投影生成，用于帮助测试人员理解已恢复的 Route、调用链和规则；未确认的业务含义保持待确认。";
  const lead = cognition.lead || "以下内容只展示已有证据支持的代表性结构；没有证据的业务含义保持待确认。";
  const deterministicNextTests = risks.filter((risk) => risk.focus_type === "测试关注点").map((risk) => risk.statement);
  const deterministicUncertain = risks.filter((risk) => risk.focus_type === "待确认").map((risk) => risk.statement);
  const nextTests = Array.isArray(cognition.next_test_focus) && cognition.next_test_focus.length ? cognition.next_test_focus.slice(0, 3) : deterministicNextTests;
  const uncertain = Array.isArray(cognition.uncertain) && cognition.uncertain.length ? cognition.uncertain.slice(0, 3) : deterministicUncertain;
  return {
    title: "过程小结",
    subtitle: cognition.subtitle || "基于 run-data 的测试认知摘要",
    header_label: cognition.header_label || "无需求-Web JS逆向测试建图",
    status_label: cognition.status_label || "静态恢复 / 待执行验证",
    run_data_fingerprint: fingerprint,
    current_batch: lineage.current_batch,
    summary: {
      system: systemSummary,
      lead,
      modules: routes.map((route) => `${route.module}：${route.feature}（${route.route}）`),
      representative_chains: representativeChains.map((chain) => `${chain.display_id}｜${chain.action || chain.action_label || "待确认"}：${chain.summary || "静态调用链候选；具体业务语义待确认"}`),
      next_tests: nextTests,
      uncertain,
    },
    chapters: [
      { number: 1, title: "本轮定位与一句话系统认知", paragraphs: ["本轮是从确定性 run-data 向测试人员可读交付物的 Stage 4 投影，不是新的 JS 深度分析。", systemSummary] },
      { number: 2, title: "系统功能地图", bullets: routes.map((route) => `${route.module} / ${route.feature} / ${route.route}：${route.capability}`) },
      { number: 3, title: "主要 JS 调用链", chains: representativeChains },
      { number: 4, title: "关键权限 / 状态 / 会话规则", rules: rules.map((rule) => ({ display_id: rule.display_id, type: rule.rule_type, content: `${rule.expression}。影响：${rule.testing_impact}`, current_status: statusOf(rule), evidence: rule.evidence || [] })), bullets: rules.map((rule) => `${rule.display_id}｜${rule.rule_type}：${rule.expression}。影响：${rule.testing_impact}`) },
      { number: 5, title: "测试关注点、风险与待确认", risks: risks.map((risk) => ({ display_id: risk.display_id, type: risk.focus_type, content: risk.statement, current_status: statusOf(risk), evidence: risk.basis || risk.evidence || [], priority: risk.priority })), bullets: risks.map((risk) => `${risk.display_id}｜${risk.focus_type}｜${risk.statement}（依据：${risk.basis}）`) },
       { number: 6, title: "扫描范围与结论边界", paragraphs: ["当前状态只使用静态恢复、运行观察、待执行验证，不把静态关系写成已测试或已验证。", `本次 run-data fingerprint 为 ${fingerprint}。active_business_api_calls=${runData.active_business_api_calls}。`, "未覆盖：复杂跨文件 dispatch、未捕获的动态状态分支、真实站点最终验收和后续阶段工作。"] },
    ],
  };
}

function assertUniqueDisplayIds(lineage) {
  const ids = lineage.display_id_registry.map((item) => item.display_id);
  if (new Set(ids).size !== ids.length) throw new Error("stage4_duplicate_display_id");
}

export function validateStage4Data({ runData, lineage, excelProjection, wordProjection }) {
  if (!runData || runData.active_business_api_calls !== 0) throw new Error("stage4_active_business_api_calls_must_be_zero");
  assertUniqueDisplayIds(lineage);
  for (const kind of Object.keys(DISPLAY_PREFIX)) {
    for (const entity of lineage.entities[kind] || []) {
      if (!entity.display_id.startsWith(`${DISPLAY_PREFIX[kind]}-`)) throw new Error(`stage4_invalid_display_id: ${entity.display_id}`);
      if (!entity.machine_identity) throw new Error(`stage4_machine_identity_missing: ${entity.display_id}`);
      if (!TESTER_STATUSES.has(statusOf(entity))) throw new Error(`stage4_invalid_tester_status: ${statusOf(entity)}`);
      if (kind === "chain") assertIdentityCompleteness(kind, entity, entity.identity_basis || identityBasis(kind, entity));
    }
  }
  for (const sheet of excelProjection.sheets) {
    for (const row of sheet.rows.filter((item) => !item.divider)) {
      const status = row.values.at(-1);
      if (sheet.name === "01_扫描批次与范围") continue;
      if (sheet.name === "05_测试关注点与风险待确认" && !FOCUS_TYPES.has(row.values[2])) throw new Error(`stage4_invalid_focus_type: ${row.values[2]}`);
      if (!TESTER_STATUSES.has(status)) throw new Error(`stage4_invalid_sheet_status: ${status}`);
    }
  }
  const knownDisplayIds = new Set(lineage.display_id_registry.map((item) => item.display_id));
  const routeSheet = excelProjection.sheets.find((sheet) => sheet.name === "02_系统功能与路由地图");
  for (const row of routeSheet?.rows.filter((item) => !item.divider) || []) {
    const routeId = clean(row.values[2]).split(" /")[0];
    if (!knownDisplayIds.has(routeId)) throw new Error(`stage4_excel_unknown_route_id: ${routeId}`);
  }
  const chainSheet = excelProjection.sheets.find((sheet) => sheet.name === "03_JS调用链与接口引用");
  for (const row of chainSheet?.rows.filter((item) => !item.divider) || []) if (!knownDisplayIds.has(clean(row.values[0]))) throw new Error(`stage4_excel_unknown_chain_id: ${row.values[0]}`);
  const riskSheet = excelProjection.sheets.find((sheet) => sheet.name === "05_测试关注点与风险待确认");
  for (const row of riskSheet?.rows.filter((item) => !item.divider) || []) if (!knownDisplayIds.has(clean(row.values[0]))) throw new Error(`stage4_excel_unknown_risk_id: ${row.values[0]}`);
  if (excelProjection.run_data_fingerprint !== wordProjection.run_data_fingerprint) throw new Error("stage4_artifact_fingerprint_mismatch");
  const chainIds = new Set(lineage.entities.chain.map((item) => item.display_id));
  for (const chain of wordProjection.chapters.find((chapter) => chapter.number === 3)?.chains || []) {
    if (!chainIds.has(chain.display_id)) throw new Error(`stage4_word_unknown_chain: ${chain.display_id}`);
    if (chain.expanded_public_layers?.includes("refreshToken()") && (!chain.stage3_candidate_found || !chain.nodes?.length || !chain.branches?.length || !chain.evidence_ids?.length)) throw new Error(`stage4_401_chain_traceability_missing: ${chain.display_id}`);
  }
  const statusById = new Map();
  for (const entity of Object.values(lineage.entities).flat()) statusById.set(entity.display_id, statusOf(entity));
  const compareStatus = (displayId, status, source) => {
    if (!statusById.has(displayId)) throw new Error(`stage4_status_unknown_id: ${displayId}`);
    if (statusById.get(displayId) !== status) throw new Error(`stage4_status_drift: ${displayId}:${source}:${status}:${statusById.get(displayId)}`);
  };
  const chainChapter = wordProjection.chapters.find((chapter) => chapter.number === 3);
  for (const chain of chainChapter?.chains || []) compareStatus(chain.display_id, statusOf(chain), "word_chain");
  const ruleChapter = wordProjection.chapters.find((chapter) => chapter.number === 4);
  for (const rule of ruleChapter?.rules || []) compareStatus(rule.display_id, rule.current_status, "word_rule");
  const riskChapter = wordProjection.chapters.find((chapter) => chapter.number === 5);
  for (const risk of riskChapter?.risks || []) compareStatus(risk.display_id, risk.current_status, "word_risk");
  const excelChainRows = chainSheet?.rows.filter((item) => !item.divider) || [];
  for (const row of excelChainRows) compareStatus(clean(row.values[0]), clean(row.values.at(-1)), "excel_chain");
  const excelRuleRows = excelProjection.sheets.find((sheet) => sheet.name === "04_权限状态与生命周期")?.rows.filter((item) => !item.divider) || [];
  for (const row of excelRuleRows) compareStatus(clean(row.values[2]).split("｜")[0], clean(row.values.at(-1)), "excel_rule");
  const excelRiskRows = riskSheet?.rows.filter((item) => !item.divider) || [];
  for (const row of excelRiskRows) compareStatus(clean(row.values[0]), clean(row.values.at(-1)), "excel_risk");
  const routeIds = new Set(lineage.entities.route.map((item) => item.display_id));
  for (const route of lineage.entities.route) if (!routeIds.has(route.display_id)) throw new Error(`stage4_route_id_missing: ${route.display_id}`);
  return { valid: true, run_data_fingerprint: excelProjection.run_data_fingerprint, display_id_count: lineage.display_id_registry.length };
}

export function buildStage4Bundle({ runData, batches, lineageId = "js-test-mapper-demo" }) {
  const lineage = buildLineage({ lineageId, baseRunId: runData.run.run_id, batches });
  const runDataWithStage4 = { ...runData, stage4: lineage };
  const excelProjection = buildExcelProjection({ runData: runDataWithStage4, lineage });
  const wordProjection = buildWordProjection({ runData: runDataWithStage4, lineage });
  const consistency = validateStage4Data({ runData: runDataWithStage4, lineage, excelProjection, wordProjection });
  return { runData: runDataWithStage4, lineage, excelProjection, wordProjection, consistency };
}

export { TESTER_STATUSES, BATCH_STATUSES, FOCUS_TYPES };
