import { parse } from "@babel/parser";
import { createHash } from "node:crypto";
import { redactSensitive } from "./security.mjs";

const STRING = /(["'`])((?:\\.|(?!\1)[\s\S])*?)\1/g;
const API = /(["'`])((?:https?:\/\/[^"'`\s]+)?\/(?:api|graphql)(?:\/[^"'`]*)?)\1/gi;
const ROUTE = /(["'`])((?:\/[A-Za-z0-9_$.:{}-]+){1,8})\1/g;
const IMPORT = /\bimport\s*\(\s*(["'`])([^"'`]+)\1\s*\)/g;
const STATUS = /\b(status|state)\s*(===|!==|==|!=|>=|<=|>|<)\s*([0-9]+|["'][^"']+["'])/g;
const PERMISSION = /\b(?:permission|permissions|hasPermission|can|role|roles)\b\s*(?:\(|\.|\[|=|:)?\s*(["'`])([^"'`]+)\1/gi;

function locationFor(source, index) {
  const before = source.slice(0, index);
  return { line: before.split("\n").length, column: index - before.lastIndexOf("\n") - 1 };
}

function safeSnippet(source, index, value) {
  const lineStart = source.lastIndexOf("\n", Math.max(0, index - 1)) + 1;
  const nextBreak = source.indexOf("\n", index);
  const lineEnd = nextBreak < 0 ? source.length : nextBreak;
  const redactedLine = redactSensitive(source.slice(lineStart, lineEnd));
  if (redactedLine.length <= 360) return redactedLine;
  const anchorValue = redactSensitive(String(value));
  const found = redactedLine.indexOf(anchorValue);
  const anchor = found >= 0 ? found : Math.min(index - lineStart, redactedLine.length);
  const start = Math.max(0, anchor - 120);
  return redactedLine.slice(start, Math.min(redactedLine.length, start + 360));
}

function fact({ asset, factType, value, index, source, context }) {
  return {
    fact_id: `fact-${createHash("sha256").update(`${asset.asset_id}:${factType}:${index}:${value}`).digest("hex").slice(0, 16)}`,
    asset_id: asset.asset_id,
    fact_type: factType,
    value: redactSensitive(value),
    location: { ...locationFor(source, index), file: asset.canonical_url },
    snippet: safeSnippet(source, index, value),
    evidence_level: "E1",
    context,
  };
}

function addMatches(facts, regex, source, asset, factType, valueIndex = 2, context = "static source text only; not current behavior") {
  for (const match of source.matchAll(regex)) {
    facts.push(fact({ asset, factType, value: match[valueIndex], index: match.index ?? 0, source, context }));
  }
}

export function analyzeL1Asset(asset, source) { // L1 只捞线索，不下业务结论
  const facts = [];
  let parseStatus = "not_attempted";
  try {
    parse(source, { sourceType: "unambiguous", errorRecovery: true, plugins: ["jsx", "typescript", "topLevelAwait"] }); // 坏文件单独降级
    parseStatus = "syntax_checked";
  } catch (error) {
    parseStatus = "parse_failed";
    return { asset_id: asset.asset_id, analysis_status: parseStatus, facts, degradation: { reason: "l1_syntax_parse_failed", error: String(error.message || error) } };
  }
  addMatches(facts, API, source, asset, "api_reference");
  for (const match of source.matchAll(API)) {
    const nearby = source.slice(Math.max(0, (match.index ?? 0) - 220), Math.min(source.length, (match.index ?? 0) + 220));
    const method = nearby.match(/\bmethod\s*:\s*["'](GET|POST|PUT|PATCH|DELETE)["']/i)?.[1]?.toUpperCase() || (nearby.match(/\.(get|post|put|patch|delete)\s*\(/i)?.[1]?.toUpperCase() || "UNKNOWN");
    facts.push(fact({ asset, factType: "http_method", value: method, index: match.index ?? 0, source, context: "method inferred from nearby static code; no request was issued" }));
  }
  for (const match of source.matchAll(ROUTE)) {
    const value = match[2];
    if (!value.startsWith("/api") && !value.startsWith("/graphql") && !/\.(?:js|mjs|map)$/.test(value)) facts.push(fact({ asset, factType: "route_candidate", value, index: match.index ?? 0, source, context: "candidate route literal; static existence is not current UI verification" }));
  }
  addMatches(facts, PERMISSION, source, asset, "permission_or_role", 2);
  for (const match of source.matchAll(STATUS)) {
    facts.push(fact({ asset, factType: "state_condition", value: `${match[1]} ${match[2]} ${match[3]}`, index: match.index ?? 0, source, context: "状态值参与条件判断，具体业务语义待确认" })); // 不翻译状态数字
  }
  addMatches(facts, IMPORT, source, asset, "dynamic_import", 2, "dynamic import candidate from static source; runtime loading is recorded separately");
  const patterns = [
    ["websocket", /\bnew\s+WebSocket\s*\(/g],
    ["graphql_reference", /\bgraphql\b|\/graphql\b/gi],
    ["retry_or_reconnect", /\b(?:retry|reconnect|backoff)\b/gi],
    ["storage_or_session", /\b(?:localStorage|sessionStorage|document\.cookie|sessionStorage)\b/g],
    ["token_or_auth_reference", /\b(?:Authorization|Bearer|accessToken|refreshToken|idToken|csrfToken)\b/g],
  ];
  for (const [factType, regex] of patterns) addMatches(facts, regex, source, asset, factType, 0);
  return { asset_id: asset.asset_id, analysis_status: parseStatus, facts };
}

export function analyzeL1({ assets, bodies }) {
  const facts = [];
  const degradations = [];
  const analyses = [];
  for (const asset of assets) {
    const source = bodies.get(asset.asset_id);
    if (!source || !["first_party", "app_associated"].includes(asset.classification) || !["js", "worker"].includes(asset.asset_type)) {
      analyses.push({ asset_id: asset.asset_id, analysis_status: source ? "skipped_non_core_asset" : "no_body" });
      continue;
    }
    const result = analyzeL1Asset(asset, source);
    analyses.push({ asset_id: asset.asset_id, analysis_status: result.analysis_status, fact_count: result.facts.length });
    facts.push(...result.facts);
    if (result.degradation) degradations.push({ asset_id: asset.asset_id, ...result.degradation });
  }
  return { facts, analyses, degradations };
}
