import { createHash } from "node:crypto";
import { parse } from "@babel/parser";
import { redactSensitive } from "./security.mjs";

const EVIDENCE_LEVEL = "E2";
const PRIORITIES = new Set(["HIGH", "MEDIUM", "LOW"]);
const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const TECHNICAL_STRING = /\.(?:js|mjs|cjs|jsx|ts|tsx|map)$/i;
const CRITICAL_THIRD_PARTY = /auth|token|payment|upload|websocket|recovery|refresh|401/i;
const RELATION_RICHNESS = /\b(?:import|export|function|class|route|router|permission|role|status|state|storage|session|token|fetch|request|reload|refresh|retry)\b/i;
const RISK_SIGNAL = /\b(?:POST|PUT|PATCH|DELETE|permission|role|status|state|401|refreshToken|payment|upload|WebSocket|replay|retry)\b/i;
const WRAPPER_SIGNAL = /^(?:apiClient|httpTransport|transport|axios|adapter|frameworkProxy|promiseProxy)(?:\.|$)|(?:^|\.)request$/i;

function hashId(prefix, value) {
  return `${prefix}-${createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function safe(value) {
  return redactSensitive(String(value ?? ""));
}

function nodeLocation(asset, node) {
  return {
    file: asset.canonical_url,
    line: node?.loc?.start?.line || 1,
    column: node?.loc?.start?.column || 0,
  };
}

function nodeText(source, node) {
  if (!node || typeof node.start !== "number" || typeof node.end !== "number") return "";
  return source.slice(node.start, node.end);
}

function visitNodes(root, callback) {
  if (!root || typeof root !== "object") return;
  const stack = [root];
  while (stack.length) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (typeof current.type === "string") callback(current);
    for (const [key, value] of Object.entries(current)) {
      if (["loc", "extra", "comments", "tokens", "errors"].includes(key)) continue;
      if (Array.isArray(value)) {
        for (let index = value.length - 1; index >= 0; index -= 1) {
          if (value[index] && typeof value[index] === "object") stack.push(value[index]);
        }
      } else if (value && typeof value === "object") {
        stack.push(value);
      }
    }
  }
}

function parseSource(source) {
  return parse(source, {
    sourceType: "unambiguous",
    errorRecovery: false,
    plugins: ["jsx", "typescript", "topLevelAwait", "classProperties", "objectRestSpread"],
  });
}

function keyName(node) {
  if (!node) return "";
  if (node.type === "Identifier" || node.type === "PrivateName") return node.name || node.id?.name || "";
  if (node.type === "StringLiteral" || node.type === "NumericLiteral") return String(node.value);
  return "";
}

function unwrap(node) {
  let current = node;
  while (current && ["TSAsExpression", "TypeCastExpression", "ParenthesizedExpression"].includes(current.type)) current = current.expression;
  return current;
}

function stringValue(node) {
  const current = unwrap(node);
  if (!current) return null;
  if (["StringLiteral", "DirectiveLiteral"].includes(current.type)) return String(current.value);
  if (current.type === "TemplateLiteral" && current.expressions.length === 0) return current.quasis[0]?.value?.cooked ?? current.quasis[0]?.value?.raw ?? "";
  return null;
}

function objectProperty(properties, wanted) {
  return properties.find((property) => keyName(property.key).toLowerCase() === wanted.toLowerCase());
}

function functionNode(node) {
  const current = unwrap(node);
  return current && ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression", "ObjectMethod", "ClassMethod"].includes(current.type) ? current : null;
}

function calleeName(node) {
  const current = unwrap(node);
  if (!current) return "";
  if (current.type === "Identifier") return current.name;
  if (["MemberExpression", "OptionalMemberExpression"].includes(current.type)) {
    const object = calleeName(current.object);
    const property = keyName(current.property);
    return object && property ? `${object}.${property}` : property || object;
  }
  return "";
}

function lastName(name) {
  return name.split(".").at(-1) || name;
}

function relation({ asset, relationType, value, node, source, context, from, to, metadata }) {
  const cleanValue = safe(value);
  return {
    relation_id: hashId("relation", `${asset.asset_id}:${relationType}:${node?.start || 0}:${cleanValue}`),
    asset_id: asset.asset_id,
    relation_type: relationType,
    value: cleanValue,
    location: nodeLocation(asset, node),
    evidence_level: EVIDENCE_LEVEL,
    context: safe(context || "静态 AST 关系；未执行代码，不能替代运行验证"),
    ...(from ? { from: safe(from) } : {}),
    ...(to ? { to: safe(to) } : {}),
    ...(metadata ? { metadata } : {}),
    ...(source && node ? { snippet: safe(nodeText(source, node)).slice(0, 360) } : {}),
  };
}

function functionRecord(name, node, kind = "function", owner = null) {
  return {
    name,
    simpleName: owner ? name.split(".").at(-1) : name,
    qualifiedName: name,
    node,
    kind,
    owner,
  };
}

function collectTopLevel(ast) {
  const functions = [];
  const objects = [];
  const topLevelNodes = ast.program.body;
  const seen = new Set();
  const addFunction = (name, node, kind = "function", owner = null) => {
    const current = functionNode(node);
    if (!name || !current) return;
    const key = `${name}:${current.start}`;
    if (seen.has(key)) return;
    seen.add(key);
    functions.push(functionRecord(name, current, kind, owner));
  };
  const processDeclaration = (declaration) => {
    if (!declaration) return;
    if (declaration.type === "FunctionDeclaration") {
      addFunction(declaration.id?.name, declaration);
      return;
    }
    if (declaration.type !== "VariableDeclaration") return;
    for (const declarator of declaration.declarations) {
      const name = keyName(declarator.id);
      const init = unwrap(declarator.init);
      if (functionNode(init)) addFunction(name, init, "function");
      if (init?.type !== "ObjectExpression") continue;
      objects.push({ name, node: init });
      for (const property of init.properties) {
        const propertyName = keyName(property.key);
        const value = property.type === "ObjectMethod" ? property : property.value;
        if (functionNode(value)) addFunction(`${name}.${propertyName}`, value, "object_method", name);
      }
    }
  };
  for (const statement of topLevelNodes) {
    if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") processDeclaration(statement.declaration);
    else processDeclaration(statement);
  }
  const byName = new Map();
  for (const record of functions) {
    byName.set(record.qualifiedName, record);
    if (!byName.has(record.simpleName)) byName.set(record.simpleName, record);
  }
  return { functions, byName, objects, topLevelNodes };
}

function topLevelStringRelations({ asset, source, topLevelNodes }) {
  const relations = [];
  for (const statement of topLevelNodes) {
    const statementText = nodeText(source, statement);
    const isRouteContainer = /(?:routes?|router|path|redirect)/i.test(statementText);
    if (!isRouteContainer) continue;
    visitNodes(statement, (node) => {
      const value = stringValue(node);
      if (!value || !value.startsWith("/") || value.startsWith("/api") || value.startsWith("/graphql") || TECHNICAL_STRING.test(value)) return;
      relations.push(relation({ asset, relationType: "route_definition", value, node, source, context: "顶层路由字符串关系；静态存在不等于当前账号可达" }));
    });
  }
  return relations;
}

function extractApiReference(call, source) {
  const name = calleeName(call.callee);
  const methodName = lastName(name).toLowerCase();
  const args = call.arguments || [];
  let url = stringValue(args[0]);
  let method = HTTP_METHODS.has(methodName.toUpperCase()) ? methodName.toUpperCase() : "UNKNOWN";
  const config = unwrap(args[0]);
  if (config?.type === "ObjectExpression") {
    const urlProperty = objectProperty(config.properties, "url");
    const methodProperty = objectProperty(config.properties, "method");
    url = stringValue(urlProperty?.value);
    const configuredMethod = stringValue(methodProperty?.value);
    if (configuredMethod) method = configuredMethod.toUpperCase();
  }
  if (methodName === "fetch" && args[1]?.type === "ObjectExpression") {
    const configuredMethod = stringValue(objectProperty(args[1].properties, "method")?.value);
    if (configuredMethod) method = configuredMethod.toUpperCase();
  }
  if (!url || (!url.startsWith("/") && !/^https?:\/\//i.test(url))) return null;
  if (!url.startsWith("/api") && !url.startsWith("/graphql") && !/^https?:\/\//i.test(url)) return null;
  return { url, method, call, callee: name };
}

function functionCalls(record) {
  const calls = [];
  visitNodes(record.node.body, (node) => {
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") calls.push(node);
  });
  return calls.sort((left, right) => (left.start || 0) - (right.start || 0));
}

function statementList(statement) {
  if (!statement) return [];
  return statement.type === "BlockStatement" ? statement.body : [statement];
}

function callsInNode(node) {
  const calls = [];
  visitNodes(node, (current) => {
    if (current.type === "CallExpression" || current.type === "OptionalCallExpression") calls.push(current);
  });
  return calls.sort((left, right) => (left.start || 0) - (right.start || 0));
}

function terminalStatement(node) {
  let found = null;
  visitNodes(node, (current) => {
    if (!found && ["ReturnStatement", "ThrowStatement"].includes(current.type)) found = current;
  });
  return found;
}

function returnCall(node) {
  let found = null;
  visitNodes(node, (current) => {
    if (found || current.type !== "ReturnStatement" || !current.argument) return;
    const argument = unwrap(current.argument);
    if (argument?.type === "CallExpression" || argument?.type === "OptionalCallExpression") found = argument;
  });
  return found;
}

function isResponseCondition(expression) {
  return /response\s*\.\s*(?:ok|status|data|error)/i.test(expression);
}

function isPermissionCondition(expression) {
  return /permission|role|authorize|can[A-Z]|\.includes\s*\(/i.test(expression);
}

function isStateCondition(expression) {
  return /(?:^|[^\w])(status|state)(?:\b|\.)/i.test(expression) && !/response\s*\.\s*status/i.test(expression);
}

function isRequestReplay(call) {
  if (!call) return false;
  const name = calleeName(call.callee);
  const hasConfig = (call.arguments || []).some((argument) => unwrap(argument)?.type === "Identifier" && unwrap(argument).name === "config");
  return hasConfig && /request$/i.test(lastName(name));
}

function controlFlowRecords({ asset, source, record }) {
  const branches = [];
  visitNodes(record.node.body, (node) => {
    if (node.type !== "IfStatement") return;
    const expression = nodeText(source, node.test);
    const consequentCalls = callsInNode(node.consequent);
    const alternateCalls = callsInNode(node.alternate);
    const refreshCall = consequentCalls.find((call) => /refreshToken/i.test(lastName(calleeName(call.callee))));
    const returnedReplay = returnCall(node.consequent);
    const replayCall = consequentCalls.find((call) => isRequestReplay(call) && returnedReplay === call);
    const terminal = terminalStatement(node.consequent);
    const isRecovery = /401/.test(expression) && Boolean(refreshCall) && Boolean(replayCall);
    const isGuard = !node.alternate && Boolean(terminal) && (isPermissionCondition(expression) || isStateCondition(expression));
    const isIfElse = Boolean(node.alternate) && isResponseCondition(expression);
    if (!isRecovery && !isGuard && !isIfElse) return;
    const kind = isRecovery ? "recovery" : isGuard ? "guard" : "if_else";
    branches.push({
      branch_id: hashId("branch", `${asset.asset_id}:${node.start}:${expression}`),
      branch_kind: kind,
      expression: safe(expression),
      ifNode: node,
      testNode: node.test,
      terminal,
      refreshCall,
      replayCall,
      consequentCalls,
      alternateCalls,
      location: nodeLocation(asset, node.test),
      condition_kind: isPermissionCondition(expression) ? "permission" : isStateCondition(expression) ? "state" : "response",
    });
  });
  return branches.sort((left, right) => (left.ifNode.start || 0) - (right.ifNode.start || 0));
}

function branchForNode(node, branches) {
  if (!node || typeof node.start !== "number") return null;
  return branches
    .filter((branch) => {
      const consequent = branch.ifNode.consequent;
      const alternate = branch.ifNode.alternate;
      return (consequent && node.start >= consequent.start && node.end <= consequent.end) || (alternate && node.start >= alternate.start && node.end <= alternate.end);
    })
    .sort((left, right) => (right.ifNode.end - right.ifNode.start) - (left.ifNode.end - left.ifNode.start))[0] || null;
}

function branchOutcomeForNode(node, branch) {
  if (!node || !branch) return null;
  const consequent = branch.ifNode.consequent;
  const alternate = branch.ifNode.alternate;
  if (consequent && node.start >= consequent.start && node.end <= consequent.end) return "true";
  if (alternate && node.start >= alternate.start && node.end <= alternate.end) return "false";
  return null;
}

function publicCondition(branch) {
  const condition = {
    kind: branch.condition_kind,
    expression: branch.expression,
    evidence_level: EVIDENCE_LEVEL,
    context: branch.condition_kind === "permission"
      ? "静态权限/角色条件；未验证当前账号是否满足"
      : branch.condition_kind === "state"
        ? "状态条件的静态关系；业务枚举语义待确认"
        : "Response 条件分支的静态关系；未验证返回结果",
    location: branch.location,
    branch_id: branch.branch_id,
    branch_kind: branch.branch_kind,
  };
  if (branch.branch_kind === "guard") condition.guard_outcomes = { true: "stop", false: "continue" };
  return condition;
}

function conditionRecords({ asset, source, record }) {
  return controlFlowRecords({ asset, source, record })
    .filter((branch) => ["permission", "state"].includes(branch.condition_kind))
    .map(publicCondition)
    .sort((left, right) => left.location.line - right.location.line || left.location.column - right.location.column);
}

function postProcessing({ asset, source, record, branches = controlFlowRecords({ asset, source, record }) }) {
  const results = [];
  const handledCallStarts = new Set();
  const add = (kind, expression, node, context, metadata = {}) => {
    const item = { kind, expression: safe(expression), evidence_level: EVIDENCE_LEVEL, context: safe(context), location: nodeLocation(asset, node), ...metadata };
    if (!results.some((existing) => existing.kind === item.kind && existing.expression === item.expression && existing.branch_id === item.branch_id && existing.branch_outcome === item.branch_outcome)) results.push(item);
  };
  const addCallPost = (call, branch = null, branchOutcome = null) => {
    const name = calleeName(call.callee);
    const simple = lastName(name);
    const metadata = branch ? { branch_id: branch.branch_id, branch_outcome: branchOutcome } : {};
    handledCallStarts.add(call.start);
    if (/refreshToken/i.test(simple)) add("auth_recovery", name, call, "认证恢复公共层影响测试行为；保留但不执行", metadata);
    else if (/reload|refetch|refresh|invalidate|requery/i.test(simple)) add("reload_or_cache", name, call, "API 后重新查询/缓存处理的静态关系；未执行", metadata);
    else if (/showError|toast|notify|error/i.test(simple)) add("error_feedback", name, call, "错误反馈的静态关系；未验证 UI 表现", metadata);
    else if (/replay|retry/i.test(simple)) add("replay_or_retry", name, call, "重放/重试的静态关系；未执行请求", metadata);
  };
  for (const branch of branches) {
    if (branch.branch_kind === "if_else") {
      add("response_branch", branch.expression, branch.testNode, "Response 条件分支的静态关系；未验证返回结果", { branch_id: branch.branch_id, branch_role: "condition" });
      for (const call of branch.consequentCalls) addCallPost(call, branch, "true");
      for (const call of branch.alternateCalls) addCallPost(call, branch, "false");
    }
    if (branch.branch_kind === "recovery") {
      add("auth_recovery", branch.expression, branch.testNode, "401 分支改变测试行为；保留恢复逻辑，未执行请求", { branch_id: branch.branch_id, branch_outcome: "true" });
      addCallPost(branch.refreshCall, branch, "true");
      add("replay_or_retry", "request(config)", branch.replayCall, "401 分支中的原请求重放候选；未执行请求", { branch_id: branch.branch_id, branch_outcome: "true" });
      handledCallStarts.add(branch.replayCall.start);
    }
  }
  visitNodes(record.node.body, (node) => {
    if (node.type === "IfStatement") return;
    if (node.type === "AssignmentExpression") {
      const left = nodeText(source, node.left);
      const right = nodeText(source, node.right);
      if (/\.value\b|\b(?:items|list|detail|cache|state)\b/i.test(left) && /response|result|detail|data/i.test(`${left} ${right}`)) {
        const branch = branchForNode(node, branches);
        const branchOutcome = branchOutcomeForNode(node, branch);
        add("state_update", `${left} = ${right}`, node, "Response 后的前端状态更新；未验证实际数据", branch ? { branch_id: branch.branch_id, branch_outcome: branchOutcome } : {});
      }
    }
    if (node.type === "CallExpression" || node.type === "OptionalCallExpression") {
      if (handledCallStarts.has(node.start)) return;
      const branch = branchForNode(node, branches);
      if (branch?.branch_kind === "if_else" || branch?.branch_kind === "recovery") return;
      addCallPost(node);
    }
  });
  if (/response\s*\.\s*data/i.test(nodeText(source, record.node.body))) add("response_mapping", "response.data", record.node.body, "Response 字段被前端读取；字段含义和实际值待确认");
  return results.sort((left, right) => left.location.line - right.location.line || left.location.column - right.location.column);
}

function functionReferenceNames(record) {
  return [...new Set(functionCalls(record).map((call) => calleeName(call.callee)).filter(Boolean))];
}

export function recoverL2({ asset, source }) {
  try {
    const ast = parseSource(source);
    const { functions, byName, objects, topLevelNodes } = collectTopLevel(ast);
    const relations = [];
    const add = (args) => relations.push(relation({ asset, source, ...args }));
    for (const statement of topLevelNodes) {
      if (statement.type === "ImportDeclaration") add({ relationType: "import", value: statement.source.value, node: statement, context: "模块导入的静态关系；未执行模块" });
      if (statement.type === "ExportNamedDeclaration" || statement.type === "ExportDefaultDeclaration") {
        const exported = statement.source?.value || statement.declaration?.id?.name || statement.specifiers?.map((item) => item.exported?.name || item.local?.name).join(",") || "default";
        add({ relationType: "export", value: exported, node: statement, context: "模块导出的静态关系；未验证消费方" });
      }
    }
    for (const object of objects) {
      add({ relationType: "object_definition", value: object.name, node: object.node, context: "顶层对象/service 定义；仅恢复结构" });
      for (const property of object.node.properties) {
        const propertyName = keyName(property.key);
        const value = property.type === "ObjectMethod" ? property : property.value;
        if (functionNode(value)) add({ relationType: "service_method_definition", value: `${object.name}.${propertyName}`, node: value, context: "对象/service 方法定义；仅恢复结构" });
      }
    }
    for (const record of functions) {
      add({ relationType: "function_definition", value: record.qualifiedName, node: record.node, context: "顶层函数或 service 方法定义；未执行函数" });
      const lower = record.simpleName.toLowerCase();
      if (/^(?:handle|on)[A-Z_]|^(?:handle|on)\b/i.test(record.simpleName)) add({ relationType: "event_handler", value: record.qualifiedName, node: record.node, context: "事件/动作入口锚点；未验证事件是否可达" });
      if (/load|list|fetch|get|cancel|submit|create|update|delete|approve|enter/i.test(lower)) add({ relationType: "action_anchor", value: record.qualifiedName, node: record.node, context: "动作符号锚点；名称不等于已确认业务语义" });
      for (const called of functionReferenceNames(record)) {
        const target = byName.get(called);
        if (target && target.qualifiedName !== record.qualifiedName) add({ relationType: "function_reference", value: `${record.qualifiedName} -> ${target.qualifiedName}`, node: record.node, from: record.qualifiedName, to: target.qualifiedName, context: "函数到函数的静态引用；未执行调用" });
      }
      for (const call of functionCalls(record)) {
        const api = extractApiReference(call, source);
        if (!api) continue;
        add({ relationType: "api_reference", value: `${api.method} ${api.url}`, node: call, metadata: { method: api.method, url: safe(api.url), callee: safe(api.callee) }, context: "API 引用来自静态调用参数；未发出请求" });
        add({ relationType: "http_method", value: api.method, node: call, metadata: { url: safe(api.url) }, context: "HTTP method 来自静态配置；未发出请求" });
      }
      for (const condition of conditionRecords({ asset, source, record })) add({ relationType: `${condition.kind}_condition`, value: condition.expression, node: { start: 0, end: 0, loc: { start: condition.location } }, metadata: { kind: condition.kind }, context: condition.context });
      const bodyText = nodeText(source, record.node.body);
      if (/localStorage|sessionStorage|document\.cookie/i.test(bodyText)) add({ relationType: "storage_session_reference", value: bodyText.match(/(?:localStorage|sessionStorage|document\.cookie)/i)?.[0] || "storage", node: record.node.body, context: "本地状态/会话技术引用；未验证生命周期" });
      if (/token|authorization|bearer|csrf/i.test(bodyText)) add({ relationType: "token_auth_reference", value: bodyText.match(/(?:refreshToken|token|Authorization|Bearer|csrfToken)/i)?.[0] || "token", node: record.node.body, context: "Token/认证技术引用；不保存凭据，未执行请求" });
    }
    relations.push(...topLevelStringRelations({ asset, source, topLevelNodes }));
    return { asset_id: asset.asset_id, analysis_status: "completed", relations };
  } catch (error) {
    return { asset_id: asset.asset_id, analysis_status: "parse_failed", relations: [], degradation: { reason: "l2_syntax_parse_failed", error: safe(error.message || error) } };
  }
}

function signalSet({ asset, source, l1Facts, currentBatch }) {
  const facts = l1Facts.filter((fact) => fact.asset_id === asset.asset_id);
  const body = source || "";
  return {
    current_batch_relevance: asset.first_seen_batch === currentBatch || asset.runtime_loaded === true,
    first_party_trust: ["first_party", "app_associated"].includes(asset.classification),
    runtime_activity: asset.runtime_loaded === true,
    relationship_richness: facts.length > 0 || RELATION_RICHNESS.test(body),
    risk_behavior: RISK_SIGNAL.test(body),
    information_novelty: !asset.duplicate_of && !asset.unchanged_from_previous_run,
  };
}

export function selectAnalysisFocus({ assets, bodies = new Map(), l1Facts = [], currentBatch = "B01", manualPromotions = [] }) {
  const promoted = new Set(manualPromotions);
  return assets.map((asset) => {
    const source = bodies.get(asset.asset_id) || "";
    const signals = signalSet({ asset, source, l1Facts, currentBatch });
    const thirdPartyCritical = asset.classification === "third_party" && CRITICAL_THIRD_PARTY.test(source);
    const manuallyPromoted = promoted.has(asset.asset_id) || promoted.has(asset.canonical_url);
    let priority = "LOW";
    let focusReasons = [];
    if (manuallyPromoted || thirdPartyCritical) {
      priority = "HIGH";
      focusReasons.push(manuallyPromoted ? "manual_or_rule_promotion" : "third_party_directly_affects_critical_test_behavior");
    } else if (signals.first_party_trust && signals.relationship_richness && (signals.runtime_activity || signals.risk_behavior)) {
      priority = "HIGH";
      focusReasons.push("trusted_asset_has_rich_runtime_or_risk_relationships");
    } else if (signals.first_party_trust && (signals.current_batch_relevance || signals.information_novelty)) {
      priority = "MEDIUM";
      focusReasons.push("trusted_asset_is_relevant_to_current_or_new_scope");
    } else if (asset.classification === "third_party" || asset.classification === "unknown") {
      focusReasons.push("third_party_or_unknown_defaults_to_low_and_skip");
    } else {
      focusReasons.push("insufficient_test_value_signal_for_deep_analysis");
    }
    if (signals.risk_behavior) focusReasons.push("contains_test_relevant_state_permission_or_recovery_signal");
    if (signals.runtime_activity) focusReasons.push("observed_active_in_current_run");
    if (signals.information_novelty) focusReasons.push("new_or_changed_information_available");
    return {
      asset_id: asset.asset_id,
      canonical_url: safe(asset.canonical_url),
      priority,
      focus_reasons: [...new Set(focusReasons)],
      signals,
      l2_eligible: priority !== "LOW",
      l3_eligible: priority === "HIGH",
      skip_reason: priority === "LOW" ? "deep_analysis_skipped_low_priority" : null,
    };
  });
}

function isWrapper(name) {
  return WRAPPER_SIGNAL.test(name) || /(?:adapter|axios|transport|framework|promise)/i.test(name);
}

function wrapperClosure(record, byName) {
  const found = new Set();
  const pending = [...functionReferenceNames(record)];
  while (pending.length) {
    const name = pending.shift();
    if (found.has(name)) continue;
    const target = byName.get(name);
    if (!target || !isWrapper(name)) continue;
    found.add(name);
    for (const next of functionReferenceNames(target)) pending.push(next);
  }
  return [...found];
}

function actionType(record, source, apiReferences, conditions, branches) {
  const text = nodeText(source, record.node.body);
  if (branches.some((branch) => branch.branch_kind === "recovery")) return "recovery";
  if (/unknownAction|invokeByRuntime|dynamicAction/i.test(`${record.qualifiedName} ${text}`)) return "insufficient";
  if (apiReferences.some((api) => api.method === "POST") && /cancel|approve|submit|delete|update/i.test(record.simpleName)) return "stateful_action";
  if (apiReferences.some((api) => api.method === "GET") && /load|list|fetch|get/i.test(record.simpleName)) return "query";
  if (apiReferences.length && conditions.length) return "stateful_action";
  return null;
}

export function evaluateStopGate({ businessLoopClosed = false, frameworkBoundary = false, noNewInformation = false, frontEndBoundary = false, evidenceSufficient = true } = {}) {
  if (!evidenceSufficient) return { stop: true, reason: "evidence_insufficient", context: "证据不足，继续恢复只能猜测" };
  if (businessLoopClosed) return { stop: true, reason: "business_loop_closed", context: "已形成测试可理解的前端业务闭环" };
  if (frameworkBoundary) return { stop: true, reason: "framework_boundary", context: "后续只剩框架或第三方实现，没有新的测试认知" };
  if (noNewInformation) return { stop: true, reason: "no_new_test_information", context: "继续追踪不会增加测试认知" };
  if (frontEndBoundary) return { stop: true, reason: "front_end_observable_boundary", context: "已越过前端可观察边界，不能凭静态代码补全" };
  return { stop: false, reason: "continue_within_observable_boundary", context: "仍有明确静态证据可分析" };
}

function chainNode(asset, type, label, node, context) {
  return {
    node_id: hashId("node", `${asset.asset_id}:${type}:${node?.start || 0}:${label}`),
    node_type: type,
    label: safe(label),
    location: nodeLocation(asset, node),
    evidence_level: EVIDENCE_LEVEL,
    context: safe(context),
  };
}

function nextStatementAfter(record, ifNode) {
  const statements = statementList(record.node.body);
  const index = statements.findIndex((statement) => statement.start === ifNode.start);
  return index >= 0 ? statements[index + 1] || null : null;
}

function chainEdge(asset, from, to, relationType, context, options = {}) {
  const edge = {
    edge_id: hashId("edge", `${asset.asset_id}:${from}:${to}:${relationType}:${options.branchOutcome || ""}`),
    from,
    to,
    relation_type: relationType,
    evidence_level: EVIDENCE_LEVEL,
    context: safe(context),
  };
  if (options.branchId) edge.branch_id = options.branchId;
  if (options.branchOutcome) edge.branch_outcome = options.branchOutcome;
  if (options.pathEffect) edge.path_effect = options.pathEffect;
  return edge;
}

function branchSummary(branch, edges) {
  const outcomes = ["true", "false"].map((outcome) => {
    const outcomeEdges = edges.filter((edge) => edge.branch_id === branch.branch_id && edge.branch_outcome === outcome);
    if (!outcomeEdges.length) return null;
    return {
      outcome,
      path_effect: outcomeEdges[0].path_effect || "continue",
      target_node_ids: [...new Set(outcomeEdges.map((edge) => edge.to))],
      evidence_level: EVIDENCE_LEVEL,
      context: outcome === "true" ? "条件为 true 时的静态路径" : "条件为 false 时的静态路径",
    };
  }).filter(Boolean);
  return {
    branch_id: branch.branch_id,
    branch_kind: branch.branch_kind,
    condition: branch.expression,
    location: branch.location,
    outcomes,
    evidence_level: EVIDENCE_LEVEL,
    context: "由同一个 IfStatement 的 consequent/alternate 恢复；未执行代码",
  };
}

function candidateChain({ asset, source, record, l2, byName, focus }) { // 从一个函数里拼出可读的候选调用链
  const branches = controlFlowRecords({ asset, source, record });
  const calls = functionCalls(record);
  const apiReferencesInternal = calls.map((call) => {
    const api = extractApiReference(call, source);
    return api ? { ...api, branch: branchForNode(call, branches), branchOutcome: branchOutcomeForNode(call, branchForNode(call, branches)) } : null;
  }).filter(Boolean);
  const apiReferences = apiReferencesInternal.map((api) => ({
    method: api.method,
    url: safe(api.url),
    callee: safe(api.callee),
    evidence_level: EVIDENCE_LEVEL,
    context: "API 仅来自静态配置；未发出请求",
    ...(api.branch ? { branch_id: api.branch.branch_id, branch_outcome: api.branchOutcome } : {}),
  })); // 只认静态写明的 API
  const conditions = conditionRecords({ asset, source, record });
  const posts = postProcessing({ asset, source, record, branches });
  const type = actionType(record, source, apiReferences, conditions, branches);
  if (!type) return null;
  const relations = l2.relations.filter((item) => item.asset_id === asset.asset_id);
  const routeContext = [...new Set(relations.filter((item) => item.relation_type === "route_definition").map((item) => item.value))];
  const wrappers = wrapperClosure(record, byName);
  const nodes = [];
  const edges = [];
  const addNode = (node) => { nodes.push(node); return node.node_id; };
  const entry = chainNode(asset, "function", record.qualifiedName, record.node, "静态函数入口；未执行");
  let previous = addNode(entry);
  const pendingGuardFalse = [];
  const addSequentialNode = (node, relationType, context) => {
    const id = addNode(node);
    if (pendingGuardFalse.length) {
      for (const pending of pendingGuardFalse) {
        edges.push(chainEdge(asset, pending.nodeId, id, "guard_continue", context, { branchId: pending.branch.branch_id, branchOutcome: "false", pathEffect: "continue" }));
      }
      pendingGuardFalse.length = 0;
    } else if (previous) {
      edges.push(chainEdge(asset, previous, id, relationType, context));
    }
    previous = id;
    return id;
  };

  const guardBranches = branches.filter((branch) => branch.branch_kind === "guard");
  for (const branch of guardBranches) {
    const conditionType = branch.condition_kind === "permission" ? "permission_condition" : "state_condition";
    const conditionNode = chainNode(asset, conditionType, branch.expression, branch.testNode, "静态 guard 条件；未执行");
    const conditionId = addSequentialNode(conditionNode, "guard_condition", "静态 guard 条件关系");
    const terminalLabel = branch.terminal?.type === "ThrowStatement" ? "throw / stop" : "return / stop";
    const terminalNode = chainNode(asset, "terminal", terminalLabel, branch.terminal || branch.ifNode.consequent, "guard 为 true 时当前路径终止");
    const terminalId = addNode(terminalNode);
    edges.push(chainEdge(asset, conditionId, terminalId, "guard_stop", "guard 为 true 时停止当前路径", { branchId: branch.branch_id, branchOutcome: "true", pathEffect: "stop" }));
    pendingGuardFalse.push({ nodeId: conditionId, branch });
  }

  if (type === "recovery") { // 认证恢复会影响测试行为，所以单独保留
    const branch = branches.find((item) => item.branch_kind === "recovery");
    const unauthorized = chainNode(asset, "response_condition", branch.expression, branch.testNode, "401 分支来自真实 AST；未发出请求");
    const unauthorizedId = addSequentialNode(unauthorized, "response_condition", "静态 401 分支");
    const recovery = chainNode(asset, "public_recovery", "refreshToken()", branch.refreshCall, "认证恢复公共层改变测试行为；保留");
    const replay = chainNode(asset, "replay", "replay original request", branch.replayCall, "原请求重放候选；未执行");
    const recoveryId = addNode(recovery);
    const replayId = addNode(replay);
    edges.push(chainEdge(asset, unauthorizedId, recoveryId, "auth_recovery", "同一 401 consequent 内的 refreshToken 调用", { branchId: branch.branch_id, branchOutcome: "true", pathEffect: "continue" }));
    edges.push(chainEdge(asset, recoveryId, replayId, "replay", "同一 401 consequent 内的返回重放调用", { branchId: branch.branch_id, branchOutcome: "true", pathEffect: "continue" }));
    const continuation = nextStatementAfter(record, branch.ifNode);
    if (continuation) {
      const continuationId = addNode(chainNode(asset, "continuation", nodeText(source, continuation), continuation, "401 为 false 时沿函数后续路径继续"));
      edges.push(chainEdge(asset, unauthorizedId, continuationId, "recovery_fallthrough", "401 为 false 时不进入恢复分支", { branchId: branch.branch_id, branchOutcome: "false", pathEffect: "continue" }));
    }
  } else {
    for (const api of apiReferencesInternal) {
      const apiNode = chainNode(asset, "api_reference", `${api.method} ${api.url}`, api.call, apiReferences.find((item) => item.url === safe(api.url) && item.method === api.method)?.context || "业务函数到 API 静态关系；未发出请求");
      const id = addSequentialNode(apiNode, "api_reference", "业务函数到 API 静态关系；未发出请求");
      if (api.branch) {
        edges[edges.length - 1].branch_id = api.branch.branch_id;
        edges[edges.length - 1].branch_outcome = api.branchOutcome;
        edges[edges.length - 1].path_effect = "continue";
      }
    }
    const responseBranches = branches.filter((branch) => branch.branch_kind === "if_else");
    for (const branch of responseBranches) {
      const conditionNode = chainNode(asset, "response_condition", branch.expression, branch.testNode, "if/else 条件来自真实 AST；未验证返回结果");
      const conditionId = addSequentialNode(conditionNode, "response_condition", "Response 条件分支");
      for (const outcome of ["true", "false"]) {
        let branchPrevious = conditionId;
        const outcomePosts = posts.filter((post) => post.branch_id === branch.branch_id && post.branch_outcome === outcome);
        for (const post of outcomePosts) {
          const postNode = chainNode(asset, "response_post_processing", post.expression, { start: 0, end: 0, loc: { start: post.location } }, post.context);
          const postId = addNode(postNode);
          edges.push(chainEdge(asset, branchPrevious, postId, post.kind, `Response ${outcome} 分支后处理`, { branchId: branch.branch_id, branchOutcome: outcome, pathEffect: "continue" }));
          branchPrevious = postId;
        }
      }
      previous = null;
    }
    const linearPosts = posts.filter((post) => !post.branch_id);
    for (const post of linearPosts) {
      if (!previous) break;
      const postNode = chainNode(asset, "response_post_processing", post.expression, { start: 0, end: 0, loc: { start: post.location } }, post.context);
      previous = addSequentialNode(postNode, post.kind, "Response 后处理静态关系");
    }
  }
  const actionLabel = type === "insufficient" ? "待确认" : `${record.simpleName}()`;
  const stop = type === "insufficient"
    ? evaluateStopGate({ evidenceSufficient: false })
    : type === "recovery"
      ? { stop: true, reason: "test_relevant_public_layer_preserved", context: "401 refresh/replay 会改变测试行为，保留该公共层后停止追踪适配器细节" }
      : evaluateStopGate({ businessLoopClosed: apiReferences.length > 0 && posts.length > 0, frameworkBoundary: wrappers.length > 0 && apiReferences.length === 0 });
  const permissionConditions = conditions.filter((item) => item.kind === "permission");
  const stateConditions = conditions.filter((item) => item.kind === "state");
  return {
    chain_id: hashId("chain", `${asset.asset_id}:${type}:${record.qualifiedName}`),
    asset_id: asset.asset_id,
    action_label: actionLabel,
    action_candidate: actionLabel,
    module_route_context: { routes: routeContext, module: safe(asset.canonical_url) },
    nodes,
    edges,
    branches: branches.map((branch) => branchSummary(branch, edges)),
    preconditions: [...conditions],
    permission_conditions: permissionConditions,
    state_conditions: stateConditions,
    api_references: apiReferences,
    post_processing: posts,
    collapsed_wrappers: type === "recovery" ? wrappers.filter((name) => !/apiClient\.request/i.test(name)) : wrappers,
    expanded_public_layers: type === "recovery" ? ["401 response branch", "refreshToken()", "replay original request"] : [],
    stop_reason: stop.reason,
    stop_context: stop.context,
    evidence_ids: [`evidence-${asset.asset_id}`],
    evidence_level: EVIDENCE_LEVEL,
    context: "L3 仅针对 HIGH 资产恢复的静态候选；不是已执行或已验证的业务链",
    focus_reasons: focus.focus_reasons,
  };
}

export function recoverL3({ asset, source, focus, l2 }) {
  if (!focus || focus.priority !== "HIGH") return { asset_id: asset.asset_id, analysis_status: "skipped_low_priority", call_chain_candidates: [], stop_reason: "deep_analysis_skipped_low_priority" };
  try {
    const ast = parseSource(source);
    const { functions, byName } = collectTopLevel(ast);
    const candidates = functions.map((record) => candidateChain({ asset, source, record, l2, byName, focus })).filter(Boolean);
    return { asset_id: asset.asset_id, analysis_status: "completed", call_chain_candidates: candidates };
  } catch (error) {
    return { asset_id: asset.asset_id, analysis_status: "parse_failed", call_chain_candidates: [], degradation: { reason: "l3_syntax_parse_failed", error: safe(error.message || error) } };
  }
}

export function runStage3Analysis({ assets, bodies = new Map(), l1Facts = [], currentBatch = "B01", manualPromotions = [] }) {
  const analysisFocus = selectAnalysisFocus({ assets, bodies, l1Facts, currentBatch, manualPromotions });
  const l2Results = analysisFocus.filter((focus) => focus.l2_eligible).map((focus) => recoverL2({ asset: assets.find((item) => item.asset_id === focus.asset_id), source: bodies.get(focus.asset_id) || "" }));
  const l2ByAsset = new Map(l2Results.map((result) => [result.asset_id, result]));
  const l3Results = analysisFocus.filter((focus) => focus.l3_eligible).map((focus) => recoverL3({ asset: assets.find((item) => item.asset_id === focus.asset_id), source: bodies.get(focus.asset_id) || "", focus, l2: l2ByAsset.get(focus.asset_id) || { relations: [] } }));
  return {
    analysis_status: "completed",
    analysis_focus: analysisFocus,
    structural_relations: l2Results.flatMap((result) => result.relations || []),
    call_chain_candidates: l3Results.flatMap((result) => result.call_chain_candidates || []),
    l2_results: l2Results,
    l3_results: l3Results,
  };
}
