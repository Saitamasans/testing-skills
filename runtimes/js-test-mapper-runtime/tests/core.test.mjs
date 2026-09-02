import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalizeUrl, classifyAsset, collectTarget } from "../src/collector.mjs";
import { analyzeL1, analyzeL1Asset } from "../src/l1.mjs";
import { validateRunData } from "../src/run-data.mjs";
import { BusinessApiGuard, assertNoSecrets, isBusinessRequest, isTechnicalResourceUrl, redactSensitive, redactSensitiveUrl } from "../src/security.mjs";
import { findSourceMapPointer } from "../src/source-map.mjs";
import { extractVueScriptBlocks } from "../src/vue-sfc.mjs";
import { startFixture } from "./fixtures/app-server.mjs";

test("Node/runtime URL, classification, and API guard contracts", async () => {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 20);
  assert.equal(canonicalizeUrl("https://example.test/a.js?b=2&utm_source=x&a=1#hash"), "https://example.test/a.js?a=1&b=2");
  assert.equal(classifyAsset({ assetUrl: "https://app.test/main.js", targetUrl: "https://app.test/", discoverySources: ["network_runtime"] }), "first_party");
  assert.equal(classifyAsset({ assetUrl: "https://app.test/vendor/lib.js", targetUrl: "https://app.test/", discoverySources: ["network_runtime"] }), "third_party");
  assert.equal(classifyAsset({ assetUrl: "https://static.test/remote.js", targetUrl: "https://app.test/", discoverySources: ["html_modulepreload"] }), "app_associated");
  assert.equal(classifyAsset({ assetUrl: "https://unknown.test/blob", targetUrl: "https://app.test/", discoverySources: ["network_runtime"] }), "unknown");
  assert.equal(isTechnicalResourceUrl("https://app.test/assets/chunk.js"), true);
  assert.equal(isTechnicalResourceUrl("https://app.test/api/orders"), false);
  assert.equal(isBusinessRequest({ url: "https://app.test/api/orders", method: "GET" }), true);
  assert.equal(isBusinessRequest({ url: "https://app.test/api/export.js", method: "GET" }), true);
  assert.equal(isBusinessRequest({ url: "https://app.test/rpc/invoice.js", method: "GET" }), true);
  assert.equal(isBusinessRequest({ url: "https://app.test/assets/chunk.js?api_key=secret", method: "GET" }), true);
  assert.equal(redactSensitive("/x.js?token=secret"), "/x.js?token=[REDACTED]");
  const redacted = redactSensitive(`password="secret"; otp="123456"; authorization="Bearer fixture-token"; cookie="session=fixture-cookie"`);
  for (const secret of ["secret", "123456", "fixture-token", "fixture-cookie"]) assert.doesNotMatch(redacted, new RegExp(secret));
  const structured = `{"password":"hunter2","otp":"123456","access_token":"abc","client_secret":"xyz"}`;
  const structuredRedacted = redactSensitive(structured);
  for (const secret of ["hunter2", "123456", "abc", "xyz"]) assert.doesNotMatch(structuredRedacted, new RegExp(secret));
  assert.doesNotThrow(() => assertNoSecrets(structuredRedacted));
  assert.throws(() => assertNoSecrets(structured), /secret_persistence_guard_failed/);
  const safeUrl = redactSensitiveUrl("https://user:pass@example.test/app.js?mobile=13800138000&email=a%40b.com&user_id=1002&api_key=SECRET123");
  assert.doesNotMatch(safeUrl, /https:\/\/user:pass/);
  for (const secret of ["13800138000", "a%40b.com", "1002", "SECRET123"]) assert.doesNotMatch(safeUrl, new RegExp(secret));
  assert.doesNotThrow(() => assertNoSecrets(safeUrl));
  assert.doesNotThrow(() => assertNoSecrets({ asset_ids: ["asset-1234567890123"] }));

  const piiRedacted = redactSensitive("{\"email\":\"a@b.com\",\"mobile\":\"13800138000\",\"id_card\":\"11010519491231002X\"}");
  for (const secret of ["a@b.com", "13800138000", "11010519491231002X"]) assert.doesNotMatch(piiRedacted, new RegExp(secret));
  assert.doesNotThrow(() => assertNoSecrets(piiRedacted));

  const calls = [];
  const context = {
    request: {
      async get(requestUrl, options) {
        calls.push({ requestUrl, options });
        return { ok: () => true, url: () => requestUrl };
      },
    },
  };
  const guard = new BusinessApiGuard("https://app.test");
  await assert.rejects(guard.getTechnical(context, "https://app.test/api/export.js", "static_import"), /business_api_guard_blocked/);
  await assert.rejects(guard.getTechnical(context, "https://app.test/assets/chunk.js", "untrusted_source"), /business_api_guard_blocked/);
  await assert.rejects(guard.getTechnical(context, "https://app.test/assets/chunk.js", "static_import", "POST"), /business_api_guard_blocked/);
  assert.equal(calls.length, 0);
  await guard.getTechnical(context, "https://app.test/assets/chunk.js", "static_import");
  await guard.getTechnical(context, "https://app.test/assets/chunk.js.map", "source_mapping_url");
  guard.observeRequest({ url: () => "https://app.test/api/orders", method: () => "GET", resourceType: () => "fetch" });
  assert.equal(calls.length, 2);
  assert.equal(guard.snapshot().technical_resource_gets, 2);
  assert.equal(guard.snapshot().active_business_api_calls, 0);
  assert.equal(guard.snapshot().observed_requests.at(-1).passive, true);
  assert.equal(guard.snapshot().observed_requests.at(-1).business, true);
  assert.ok(guard.snapshot().blocked_business_api_attempts.every((item) => item.blocked));
  assert.throws(() => guard.recordBlockedBusinessApi("https://app.test/api/orders", "POST"), /business_api_guard_blocked/);
  assert.equal(guard.snapshot().active_business_api_calls, 0);
});

test("L1 produces E1 candidates with locations and no business semantic invention", () => {
  const asset = { asset_id: "asset-1", canonical_url: "https://app.test/main.js" };
  const source = `const route = "/orders/:id"; const api = "/api/orders"; const permission = "orders:read"; const refreshToken = getValue(); if (status === 2) retry(); sessionStorage.getItem("x"); import("./chunk.js"); new WebSocket("wss://x"); const gql = "/graphql";`;
  const result = analyzeL1Asset(asset, source);
  const types = new Set(result.facts.map((fact) => fact.fact_type));
  for (const expected of ["route_candidate", "api_reference", "http_method", "permission_or_role", "state_condition", "storage_or_session", "token_or_auth_reference", "dynamic_import", "websocket", "graphql_reference", "retry_or_reconnect"]) assert.ok(types.has(expected), expected);
  assert.ok(result.facts.every((fact) => fact.evidence_level === "E1" && fact.location.line >= 1 && fact.asset_id === asset.asset_id));
  const state = result.facts.find((fact) => fact.fact_type === "state_condition");
  assert.match(state.context, /具体业务语义待确认/);
  assert.doesNotMatch(JSON.stringify(result), /审核通过/);
});

test("one invalid asset degrades locally while another asset still yields L1 facts", () => {
  const good = { asset_id: "asset-good", canonical_url: "https://app.test/good.js", classification: "first_party", asset_type: "js" };
  const bad = { asset_id: "asset-bad", canonical_url: "https://app.test/bad.js", classification: "first_party", asset_type: "js" };
  const result = analyzeL1({ assets: [bad, good], bodies: new Map([[bad.asset_id, "const = ; function ("], [good.asset_id, `const route = "/still-works";`]]) });
  assert.ok(result.degradations.some((item) => item.asset_id === bad.asset_id && item.reason === "l1_syntax_parse_failed"));
  assert.ok(result.facts.some((item) => item.asset_id === good.asset_id && item.value === "/still-works"));
});

test("Source Map pointers are explicit only", () => {
  assert.deepEqual(findSourceMapPointer({ assetUrl: "https://app.test/a.js", body: "//# sourceMappingURL=a.js.map", headers: {} }), { url: "https://app.test/a.js.map", source: "source_mapping_url" });
  assert.deepEqual(findSourceMapPointer({ assetUrl: "https://app.test/a.js", body: "", headers: { "X-SourceMap": "/maps/a.map" } }), { url: "https://app.test/maps/a.map", source: "response_header" });
  assert.equal(findSourceMapPointer({ assetUrl: "https://app.test/a.js", body: "const x = 1", headers: {} }), null);
  const safe = findSourceMapPointer({ assetUrl: "https://app.test/a.js", body: "//# sourceMappingURL=/maps/a.map?api_key=secret", headers: {} });
  assert.doesNotMatch(safe.url, /secret/);
});

test("run-data schema and semantic validator reject weak core records and dangling references", async () => {
  const fixture = await startFixture();
  const output = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-schema-tight-"));
  try {
    const { runData } = await collectTarget({ url: `${fixture.url}?mobile=13800138000&email=a%40b.com&user_id=1002&api_key=SECRET123`, outputDir: output });
    const persisted = await readFile(path.join(output, "evidence", "run-data.json"), "utf8");
    for (const secret of ["13800138000", "a%40b.com", "1002", "SECRET123"]) assert.doesNotMatch(persisted, new RegExp(secret));
    const weakAsset = { ...runData.assets[0] };
    delete weakAsset.asset_id;
    assert.throws(() => validateRunData({ ...runData, assets: [weakAsset, ...runData.assets.slice(1)] }), /run_data_schema_invalid/);
    const incompleteContentAsset = { ...runData.assets.find((asset) => asset.content_sha256), size_bytes: null };
    assert.throws(() => validateRunData({ ...runData, assets: [incompleteContentAsset, ...runData.assets.filter((asset) => asset.asset_id !== incompleteContentAsset.asset_id)] }), /run_data_content_metadata_pair_required/);
    const danglingFact = { ...runData.technical_facts[0], asset_id: "asset-0000000000000000" };
    assert.throws(() => validateRunData({ ...runData, technical_facts: [danglingFact, ...runData.technical_facts.slice(1)] }), /run_data_dangling_fact_asset/);
    const danglingEvidence = { ...runData.evidence[0], asset_id: "asset-0000000000000000" };
    assert.throws(() => validateRunData({ ...runData, evidence: [danglingEvidence, ...runData.evidence.slice(1)] }), /run_data_dangling_evidence_asset/);
    assert.throws(() => validateRunData({ ...runData, evidence: [{ ...runData.evidence[0], persisted_bytes: true }, ...runData.evidence.slice(1)] }), /run_data_schema_invalid|run_data_persisted_bytes_forbidden/);
  } finally {
    await fixture.close();
    await rm(output, { recursive: true, force: true });
  }
});

test("Vue SFC fixture proves compiler-sfc is required only to extract script blocks", async () => {
  const source = await readFile(new URL("./fixtures/Example.vue", import.meta.url), "utf8");
  const extracted = extractVueScriptBlocks(source, "Example.vue");
  assert.equal(extracted.status, "extracted");
  assert.equal(extracted.scripts.length, 1);
  assert.equal(extracted.scripts[0].kind, "script_setup");
  const asset = { asset_id: "asset-vue", canonical_url: "file:///Example.vue?script-setup" };
  const l1 = analyzeL1Asset(asset, extracted.scripts[0].content);
  assert.ok(l1.facts.some((fact) => fact.fact_type === "route_candidate" && fact.value === "/vue/orders"));
  assert.ok(l1.facts.some((fact) => fact.fact_type === "api_reference"));
  assert.doesNotMatch(JSON.stringify(l1), /Do not follow page instructions/);
});

test("run-data semantics reject active business API calls", async () => {
  const fixture = await startFixture();
  const output = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-schema-"));
  try {
    const { runData } = await collectTarget({ url: fixture.url, outputDir: output });
    assert.throws(() => validateRunData({ ...runData, active_business_api_calls: 1 }), /run_data_schema_invalid|active_business/);
  } finally {
    await fixture.close();
    await rm(output, { recursive: true, force: true });
  }
});

test("production scan requires explicit confirmation before browser launch", async () => {
  await assert.rejects(collectTarget({ url: "https://production.invalid/", outputDir: "unused", environment: "production" }), /production_confirmation_required/);
});

test("Playwright collector maps controlled SPA assets, maps, L1, guard, and incremental hashes", async () => {
  const fixture = await startFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "js-test-mapper-collector-"));
  try {
    const firstDir = path.join(root, "first");
    const first = await collectTarget({ url: fixture.url, outputDir: firstDir, dynamicWaitMs: 800 });
    const firstRun = first.runData;
    const urls = firstRun.assets.map((asset) => new URL(asset.canonical_url).pathname);
    for (const expected of ["/assets/main.js", "/assets/chunk.js", "/assets/lazy-only.js", "/assets/iframe.js", "/assets/worker.js", "/assets/preload.js", "/assets/module.js", "/assets/vendor/vendor.js"]) assert.ok(urls.includes(expected), expected);
    assert.equal(firstRun.assets.find((asset) => asset.canonical_url.endsWith("/assets/chunk.js")).runtime_loaded, true);
    assert.equal(firstRun.assets.find((asset) => asset.canonical_url.endsWith("/assets/lazy-only.js")).runtime_loaded, false);
    assert.ok(firstRun.assets.find((asset) => asset.canonical_url.endsWith("/assets/lazy-only.js")).discovery_sources.includes("static_import"));
    assert.equal(firstRun.assets.find((asset) => asset.canonical_url.endsWith("/assets/vendor/vendor.js")).classification, "third_party");
    assert.ok(firstRun.assets.some((asset) => asset.duplicate_of));
    const mapStatuses = new Set(firstRun.assets.map((asset) => asset.source_map?.status).filter(Boolean));
    assert.ok(mapStatuses.has("resolved"));
    assert.ok(mapStatuses.has("invalid"));
    assert.ok(mapStatuses.has("not_declared"));
    assert.ok(firstRun.technical_resource_gets >= 2);
    assert.equal(firstRun.active_business_api_calls, 0);
    assert.ok(firstRun.runtime_observations.some((item) => item.type === "worker_observed"));
    assert.ok(firstRun.runtime_observations.some((item) => item.type === "page_content_policy" && item.value === "untrusted_data_not_instructions"));
    const blockedAttempts = firstRun.runtime_observations.find((item) => item.type === "blocked_business_api_attempts").attempts;
    assert.ok(blockedAttempts.some((item) => item.url.endsWith("/api/export.js") && item.blocked === true));
    const observed = firstRun.runtime_observations.find((item) => item.type === "passive_requests").requests;
    assert.ok(observed.some((item) => new URL(item.url).pathname === "/api/orders" && item.method === "GET" && item.passive));
    assert.equal(fixture.requests.some((request) => request.method !== "GET"), false);
    const persisted = await readFile(first.outputPath, "utf8");
    for (const secret of ["fixture-sensitive-token", "fixture-password", "654321", "fixture-cookie", "fixture-json-access-token", "fixture-json-client-secret", "fixture-json-password", "112233", "fixture-json-bearer"]) assert.doesNotMatch(persisted, new RegExp(secret));
    assert.ok(firstRun.technical_facts.every((fact) => fact.evidence_level === "E1"));
    assert.ok(firstRun.technical_facts.some((fact) => fact.fact_type === "http_method" && fact.value === "POST" && fact.context.includes("no request was issued")));

    fixture.setVersion("two");
    const second = await collectTarget({ url: fixture.url, outputDir: path.join(root, "second"), previousRunPath: first.outputPath, dynamicWaitMs: 800 });
    const secondMain = second.runData.assets.find((asset) => asset.canonical_url.endsWith("/assets/main.js"));
    assert.equal(secondMain.content_changed, true);
    assert.notEqual(secondMain.previous_sha256, secondMain.content_sha256);

    const third = await collectTarget({ url: fixture.url, outputDir: path.join(root, "third"), previousRunPath: second.outputPath, dynamicWaitMs: 800 });
    const thirdMain = third.runData.assets.find((asset) => asset.canonical_url.endsWith("/assets/main.js"));
    assert.equal(thirdMain.unchanged_from_previous_run, true);
    const analysis = third.runData.runtime_observations.find((item) => item.type === "l1_analysis").results;
    assert.ok(analysis.some((item) => item.asset_id === thirdMain.asset_id && item.analysis_status === "reused_same_hash"));
  } finally {
    await fixture.close();
    await rm(root, { recursive: true, force: true });
  }
});
