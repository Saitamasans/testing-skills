import { runStage3Analysis } from "../../src/stage3-analysis.mjs";
import { buildMachineIdentity } from "../../src/stage4-artifacts.mjs";
import { stage3Source } from "./app-server.mjs";

const ASSET_ID = "asset-1111111111111111";
const ASSET_SHA = "1111111111111111111111111111111111111111111111111111111111111111";
const FACT_ID = "fact-1111111111111111";
const EVIDENCE_ID = "evidence-asset-1111111111111111";

function baseAsset() {
  return {
    asset_id: ASSET_ID,
    canonical_url: "https://app.test/assets/main.js",
    asset_type: "js",
    content_sha256: ASSET_SHA,
    size_bytes: 1200,
    classification: "first_party",
    classification_evidence: ["fixture", "same_origin"],
    discovery_sources: ["network_runtime", "html_script"],
    runtime_loaded: true,
    http_status: 200,
    response_headers: {},
    first_seen_batch: "B01",
    last_seen_batch: "B02",
    previous_sha256: null,
    content_changed: true,
    unchanged_from_previous_run: false,
    source_map: { status: "not_declared" },
  };
}

function stage3Snapshot(source) {
  const output = runStage3Analysis({
    assets: [baseAsset()],
    bodies: new Map([[ASSET_ID, source]]),
    currentBatch: "B01",
  });
  return output;
}

function chainFrom(output, actionOrPredicate, fallback = {}) {
  const candidate = output.call_chain_candidates.find(typeof actionOrPredicate === "function" ? actionOrPredicate : (chain) => chain.action_label === actionOrPredicate);
  const technicalFunction = candidate?.nodes?.find((node) => node.node_type === "function")?.label || "";
  const routeAnchor = candidate?.module_route_context?.routes?.[0] || "";
  return {
    ...candidate,
    ...(candidate ? { stage3_candidate_found: true, technical_function: technicalFunction, route_anchor: routeAnchor } : {}),
    ...fallback,
  };
}

function route(route, feature, capability, batch, fallback = {}) {
  return {
    module: "订单中心",
    feature,
    route,
    capability,
    entry: route,
    technical_route: route,
    technical_entry: route,
    current_status: "静态恢复",
    evidence: [`${batch}: route literal`],
    ...fallback,
  };
}

function rule(ruleType, expression, feature, impact, batch, fallback = {}) {
  return {
    subject: feature,
    feature,
    rule_type: ruleType,
    expression,
    technical_subject: `state:${expression}`,
    technical_expression: expression,
    testing_impact: impact,
    current_status: "静态恢复",
    evidence: [`${batch}: AST condition`],
    ...fallback,
  };
}

function risk(feature, focusType, statement, basis, priority, fallback = {}) {
  return {
    subject: feature,
    feature,
    focus_type: focusType,
    statement,
    basis,
    technical_basis: basis,
    priority,
    current_status: "待执行验证",
    ...fallback,
  };
}

const b01Output = stage3Snapshot(stage3Source());
const b01Cancel = chainFrom(b01Output, "cancelOrder()", {
  module: "订单中心",
  feature: "订单取消",
  action: "取消订单",
  summary: "cancelOrder() -> POST /api/order/cancel；Response 后处理待补充",
  post_processing: "已识别 POST 引用；Response 分支在后续批次补充",
  representative: true,
  current_status: "静态恢复",
  source_revision: "B01-source-cancel-v1",
  technical_function: "cancelOrder",
  route_anchor: "/orders",
});

const b01CancelIdentity = buildMachineIdentity("chain", b01Cancel);
const b01LoadOrders = chainFrom(b01Output, "loadOrders()", {
  module: "订单中心",
  feature: "订单列表",
  action: "查询订单",
  summary: "loadOrders() -> GET /api/orders -> response.data -> orderList.value",
  post_processing: "response.data -> orderList.value",
  current_status: "静态恢复",
  representative: true,
  source_revision: "B01-source-load-v1",
  technical_function: "loadOrders",
  route_anchor: "/orders",
});

const b02Source = stage3Source().replace('showError("cancel failed");', 'showError("cancel failed");\n    auditCancelFailure();');
const b02Output = stage3Snapshot(b02Source);
const b02Cancel = chainFrom(b02Output, "cancelOrder()", {
  module: "订单中心",
  feature: "订单取消",
  action: "取消订单",
  summary: "cancelOrder() -> status guard -> permission guard -> POST /api/order/cancel -> response.ok true=>reloadDetail / false=>showError",
  post_processing: "response.ok true -> reloadDetail()；response.ok false -> showError()",
  representative: true,
  current_status: "静态恢复",
  source_revision: "B02-source-cancel-v2",
  change_reason: "B02 增加失败路径审计调用，保留同一业务动作 identity",
  technical_function: "cancelOrder",
  route_anchor: "/orders",
});

const uncertainSuccessor = {
  ...chainFrom(b02Output, "待确认", {
    module: "订单中心",
    feature: "订单操作",
    action: "审批动作候选",
    summary: "动态调用目标无法静态确定；与订单模块相关但不能合并为既有取消链",
    current_status: "待执行验证",
    possible_successor_of_identity: b01CancelIdentity,
    successor_confidence: "low",
    successor_reason: "同模块出现，但动作和核心 API 语义不足以高置信匹配",
    representative: false,
  }),
  action_label: "审批动作候选",
  api_references: [{ method: "POST", url: "/api/order/approve" }],
};

export function buildStage4DemoFixture() {
  const currentAnalysis = {
    analysis_focus: b02Output.analysis_focus,
    structural_relations: b02Output.structural_relations,
    call_chain_candidates: b02Output.call_chain_candidates,
  };
  const runData = {
    schema_version: 1,
    run: {
      run_id: "run-stage4-demo-b02",
      target_url: "https://app.test/",
      started_at: "2026-09-01T09:00:00Z",
      finished_at: "2026-09-01T09:01:00Z",
      status: "partial",
      metadata: { lineage_id: "js-test-mapper-demo", current_batch: "B02" },
    },
    environment: "test",
    account_context: { state: "not_persisted", identifier: null },
    role_context: { role: "unknown", evidence: "not_inferred_from_navigation" },
    cognition: {
      system_summary: "当前演示以订单模块为主，展示列表查询、动作分支和认证恢复的测试认知投影。",
      lead: "先看已有证据支持的代表性链路；业务含义不确定的内容保留为待确认。",
      subtitle: "基于 run-data 的测试认知摘要",
    },
    batches: [
      { batch_id: "B01", purpose: "initial_asset_map", started_at: "2026-08-31T09:00:00Z", finished_at: "2026-08-31T09:01:00Z" },
      { batch_id: "B02", purpose: "incremental_order_flow_update", started_at: "2026-09-01T09:00:00Z", finished_at: "2026-09-01T09:01:00Z" },
    ],
    assets: [baseAsset()],
    technical_facts: [{ fact_id: FACT_ID, asset_id: ASSET_ID, fact_type: "route_candidate", value: "/orders", location: { file: "https://app.test/assets/main.js", line: 1, column: 0 }, snippet: "route candidate /orders", evidence_level: "E1", context: "静态线索；未验证当前账号可达" }],
    runtime_observations: [{ type: "passive_requests", requests: [{ url: "https://app.test/api/orders", method: "GET", passive: true }] }],
    evidence: [{ evidence_id: EVIDENCE_ID, asset_id: ASSET_ID, sha256: ASSET_SHA, source: ["network_runtime"], persisted_bytes: false }],
    degradation: [],
    runtime: { runtime_version: "0.1.0-stage2-fix.1", node_version: "24.19.0", minimum_node: 20, playwright_version: "1.61.1" },
    technical_resource_gets: 2,
    active_business_api_calls: 0,
    ...currentAnalysis,
  };
  const batches = [
    {
      batch_id: "B01",
      scanned_at: "2026-08-31 09:01",
      purpose: "首轮建立订单模块骨架",
      status: "完成",
      asset_counts: { added: 3, updated: 0 },
      scope: { reason: "首轮建立基础地图", description: "订单 URL、首屏 JS 和已观察静态关系", asset_summary: "首轮资产与静态关系已落盘", blockers: "登录后状态和未观察分支待确认" },
      routes: [route("/orders", "订单列表", "查询订单列表并进入订单操作", "B01")],
      chains: [
        b01LoadOrders,
        b01Cancel,
        chainFrom(b01Output, (chain) => chain.expanded_public_layers?.includes("refreshToken()"), { module: "公共认证层", feature: "认证恢复", action: "401 恢复", summary: "401 true -> refreshToken() -> replay；false -> continue", post_processing: "401 refresh/replay public layer", current_status: "静态恢复", representative: true, source_revision: "B01-source-auth-v1" }),
      ],
      rules: [
        rule("状态", "order.status !== 2", "订单取消", "状态值参与 guard；具体枚举语义待确认", "B01"),
        rule("权限", 'permissions.includes("orders:cancel")', "订单取消", "权限 guard 影响取消动作是否继续", "B01"),
      ],
      risks: [risk("订单取消", "待确认", "status 值 2 的业务含义需要产品或页面证据确认", "L1/L2 状态条件：order.status !== 2", "P1")],
    },
    {
      batch_id: "B02",
      scanned_at: "2026-09-01 09:01",
      purpose: "订单取消分支与新增入口增量复核",
      status: "部分完成",
      asset_counts: { added: 1, updated: 1 },
      scope: { reason: "根据 B01 链路新增 Response 分支和新入口", description: "订单列表、取消动作、认证恢复及新增设置入口", asset_summary: "B02 复用未变资产，记录取消链 revision", blockers: "未登录范围、动态 dispatch 和真实执行结果仍待确认" },
      routes: [route("/orders", "订单列表", "查询订单列表并进入订单操作", "B01"), route("/settings", "设置入口", "新增设置页面入口候选", "B02", { current_status: "待执行验证" })],
      chains: [b01LoadOrders, b02Cancel, uncertainSuccessor],
      rules: [rule("状态", "order.status !== 2", "订单取消", "B02 仍保留原 guard；新增 Response 分支前不改变状态语义", "B02", { change_reason: "B02 补充 guard 对测试路径的影响说明" })],
      risks: [risk("订单取消", "测试关注点", "验证 response.ok true/false 是否分别触发刷新详情和错误提示", "B02 AST if/else branch", "P1"), risk("订单操作", "待确认", "审批动作候选与取消链只具低置信相似性，不应静默合并", "B02 possible successor candidate", "P1")],
    },
  ];
  return { runData, batches };
}

export function buildStage4NonOrderFixture() {
  const assetId = "asset-2222222222222222";
  const assetSha = "2222222222222222222222222222222222222222222222222222222222222222";
  const runData = {
    schema_version: 1,
    run: { run_id: "run-stage4-users", target_url: "https://users.test/", started_at: "2026-09-01T10:00:00Z", finished_at: "2026-09-01T10:01:00Z", status: "completed" },
    environment: "test",
    account_context: { state: "not_persisted", identifier: null },
    role_context: { role: "unknown", evidence: "not_inferred_from_navigation" },
    cognition: { system_summary: "这是一个用户管理页面，当前可见证据集中在用户列表入口和列表查询。", lead: "当前先展示用户列表的确定性结构，其他业务含义保持待确认。", subtitle: "基于 run-data 的测试认知摘要" },
    batches: [{ batch_id: "B01", purpose: "initial_asset_map", started_at: "2026-09-01T10:00:00Z", finished_at: "2026-09-01T10:01:00Z" }],
    assets: [{ asset_id: assetId, canonical_url: "https://users.test/assets/users.js", asset_type: "js", content_sha256: assetSha, size_bytes: 500, classification: "first_party", classification_evidence: ["fixture"], discovery_sources: ["network_runtime"], runtime_loaded: true, http_status: 200, response_headers: {}, first_seen_batch: "B01", last_seen_batch: "B01", previous_sha256: null, content_changed: false, unchanged_from_previous_run: false, source_map: { status: "not_declared" } }],
    technical_facts: [{ fact_id: "fact-2222222222222222", asset_id: assetId, fact_type: "route_candidate", value: "/users", location: { file: "https://users.test/assets/users.js", line: 1, column: 0 }, snippet: "route /users", evidence_level: "E1", context: "静态线索；未验证当前账号可达" }],
    runtime_observations: [{ type: "passive_requests", requests: [{ url: "https://users.test/api/users", method: "GET", passive: true }] }],
    evidence: [{ evidence_id: "evidence-asset-2222222222222222", asset_id: assetId, sha256: assetSha, source: ["network_runtime"], persisted_bytes: false }],
    degradation: [],
    runtime: { runtime_version: "0.1.0-stage2-fix.1", node_version: "24.19.0", minimum_node: 20, playwright_version: "1.61.1" },
    technical_resource_gets: 1,
    active_business_api_calls: 0,
  };
  const batches = [{
    batch_id: "B01",
    scanned_at: "2026-09-01 10:01",
    purpose: "建立用户列表骨架",
    status: "完成",
    asset_counts: { added: 1, updated: 0 },
    scope: { reason: "首轮建立用户页面地图", description: "用户列表 URL、首屏 JS 和 GET 查询引用", asset_summary: "用户列表资产与静态关系", blockers: "登录后范围仍待确认" },
    routes: [{ module: "用户中心", feature: "用户列表", route: "/users", capability: "加载用户列表", entry: "/users", technical_route: "/users", technical_entry: "/users", current_status: "静态恢复", evidence: ["B01: route literal"] }],
    chains: [{ module: "用户中心", feature: "用户列表", action: "查看用户", technical_function: "loadUsers", route_anchor: "/users", api_references: [{ method: "GET", url: "/api/users" }], summary: "loadUsers() -> GET /api/users -> userList.value", post_processing: "response.data -> userList.value", current_status: "静态恢复", representative: true, source_revision: "B01-users-v1" }],
    rules: [{ subject: "user.status", technical_subject: "user.status", feature: "用户列表", rule_type: "状态", expression: "user.status !== 0", technical_expression: "user.status !== 0", testing_impact: "状态条件影响列表操作可见性", current_status: "静态恢复", evidence: ["B01: AST condition"] }],
    risks: [{ subject: "userList", technical_basis: "GET /api/users", feature: "用户列表", focus_type: "测试关注点", statement: "验证分页和空列表展示", basis: "B01 API reference", priority: "P2", current_status: "待执行验证" }],
  }];
  return { runData, batches };
}
