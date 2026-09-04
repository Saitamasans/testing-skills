import { createHash, randomUUID } from "node:crypto";
import { readFile, rename, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import { analyzeL1 } from "./l1.mjs";
import { BusinessApiGuard, assertNoSecrets, isTechnicalResourceUrl, redactSensitive, redactSensitiveUrl } from "./security.mjs";
import { resolveSourceMap } from "./source-map.mjs";
import { runtimeMetadata, validateRunData } from "./run-data.mjs";
import { integrateStage3Stage4 } from "./stage5-integration.mjs";
import { buildCognitionInput } from "./cognition.mjs";
import { batchPurpose, nextBatchId } from "./batch.mjs";
import { launchBrowserRuntime } from "./browser-runtime.mjs";
import { traverseReadonlyNavigation } from "./readonly-navigation.mjs";

const STATIC_IMPORT = /(?:\bimport\s*\(\s*|\b(?:import|export)\s+(?:[^;]*?\bfrom\s*)?)(["'`])([^"'`]+)\1/g;
const TRACKING_PARAMS = /^(?:utm_.+|fbclid|gclid|_ts|timestamp)$/i;

export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalizeUrl(value) {
  const url = new URL(value);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  return redactSensitiveUrl(url.href);
}

export function classifyAsset({ assetUrl, targetUrl, discoverySources = [] }) {
  const asset = new URL(assetUrl);
  const target = new URL(targetUrl);
  if (/(?:^|\/)(?:vendor|vendors|node_modules)(?:\/|$)/i.test(asset.pathname)) return "third_party";
  if (asset.origin === target.origin) return "first_party";
  if (/cdnjs|unpkg|jsdelivr|googleapis|gstatic/i.test(asset.hostname)) return "third_party";
  if (discoverySources.some((source) => ["html_script", "html_preload", "html_modulepreload", "static_import"].includes(source))) return "app_associated";
  return "unknown";
}

function assetType(url, resourceType) {
  if (/\.map(?:$|[?#])/i.test(url)) return "source_map";
  if (resourceType === "worker") return "worker";
  return "js";
}

function mergeAssetRecord(map, observation) {
  const key = observation.canonical_url;
  const current = map.get(key);
  if (!current) {
    map.set(key, observation);
    return;
  }
  current.discovery_sources = [...new Set([...current.discovery_sources, ...observation.discovery_sources])].sort();
  current.runtime_loaded ||= observation.runtime_loaded;
  current.http_status ??= observation.http_status;
  current.response_headers = { ...current.response_headers, ...observation.response_headers };
}

async function readPreviousRun(previousRunPath) {
  if (!previousRunPath) return null;
  return JSON.parse(await readFile(previousRunPath, "utf8"));
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export async function collectTarget({
  url,
  outputDir,
  previousRunPath,
  environment = "test",
  confirmProduction = false,
  headed = false,
  interactive = false,
  interactiveController = null,
  onInteractiveReady = null,
  autoReadonlyNavigation = true,
  dynamicWaitMs = 500,
  browserType = chromium,
}) {
  if (environment === "production" && !confirmProduction) throw new Error("production_confirmation_required");
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("node_20_or_newer_required");
  const startedAt = new Date().toISOString();
  const previous = await readPreviousRun(previousRunPath);
  const currentBatch = nextBatchId(previous);
  const previousByUrl = new Map((previous?.assets || []).map((item) => [item.canonical_url, item]));
  const previousFacts = previous?.technical_facts || [];
  const guard = new BusinessApiGuard(new URL(url).origin);
  const assetMap = new Map();
  const bodies = new Map();
  const responseBodiesByUrl = new Map();
  const responseTasks = [];
  const degradation = [];
  const runtimeObservations = [];
  const browser = browserType === chromium
    ? (await launchBrowserRuntime({ browserType, headless: !(headed || interactive) })).browser
    : await browserType.launch({ headless: !(headed || interactive) });
  const context = await browser.newContext();
  const page = await context.newPage();

  const handleResponse = async (response) => { // 这里只接收脚本和 Worker 这类技术资源
    const request = response.request();
    const responseUrl = response.url();
    if (!isTechnicalResourceUrl(responseUrl) && !["script", "worker"].includes(request.resourceType())) return;
    try {
      const canonical = canonicalizeUrl(responseUrl);
      const body = await response.body();
      const headers = await response.allHeaders();
      responseBodiesByUrl.set(canonical, { body, headers });
      mergeAssetRecord(assetMap, { // 记录哈希、分类和来源，后面做去重与增量对比
        asset_id: `asset-${sha256(canonical).slice(0, 16)}`,
        canonical_url: canonical,
        asset_type: assetType(responseUrl, request.resourceType()),
        content_sha256: sha256(body),
        size_bytes: body.length,
        classification: classifyAsset({ assetUrl: responseUrl, targetUrl: url, discoverySources: [request.resourceType() === "worker" ? "worker_runtime" : "network_runtime"] }),
        classification_evidence: [request.resourceType(), new URL(responseUrl).origin === new URL(url).origin ? "same_origin" : "cross_origin"],
        discovery_sources: [request.resourceType() === "worker" ? "worker_runtime" : "network_runtime"],
        runtime_loaded: true,
        http_status: response.status(),
        response_headers: { sourcemap: headers.sourcemap, "x-sourcemap": headers["x-sourcemap"] },
        first_seen_batch: currentBatch,
        last_seen_batch: currentBatch,
      });
    } catch (error) {
      degradation.push({ scope: "asset", url: redactSensitiveUrl(responseUrl), reason: "response_body_unavailable", error: String(error.message || error) });
    }
  };

  context.on("request", (request) => guard.observeRequest(request));
  context.on("response", (response) => responseTasks.push(handleResponse(response)));
  page.on("worker", (worker) => runtimeObservations.push({ type: "worker_observed", url: redactSensitiveUrl(worker.url()) }));

  try {
    const navigation = await page.goto(url, { waitUntil: "domcontentloaded" });
    runtimeObservations.push({ type: "navigation", url: redactSensitiveUrl(page.url()), http_status: navigation?.status() || null });
    const collectDeclared = async () => page.locator("script[src], link[rel=preload][as=script], link[rel=modulepreload]").evaluateAll((elements) => elements.map((element) => ({
      url: element.src || element.href,
      source: element.tagName === "SCRIPT" ? "html_script" : element.rel === "modulepreload" ? "html_modulepreload" : "html_preload",
    })));
    const declared = await collectDeclared();
    const addDeclared = (items) => { for (const item of items) {
      if (!item.url || !isTechnicalResourceUrl(item.url)) continue;
      const canonical = canonicalizeUrl(item.url);
      mergeAssetRecord(assetMap, {
        asset_id: `asset-${sha256(canonical).slice(0, 16)}`,
        canonical_url: canonical,
        asset_type: assetType(item.url, "script"),
        content_sha256: null,
        size_bytes: null,
        classification: classifyAsset({ assetUrl: item.url, targetUrl: url, discoverySources: [item.source] }),
        classification_evidence: [item.source, new URL(item.url).origin === new URL(url).origin ? "same_origin" : "cross_origin"],
        discovery_sources: [item.source],
        runtime_loaded: false,
        http_status: null,
        response_headers: {},
        first_seen_batch: currentBatch,
        last_seen_batch: currentBatch,
      });
    } };
    addDeclared(declared);
    await page.waitForTimeout(dynamicWaitMs);
    if (interactive) {
      console.log("如页面需要登录，请在这个受控浏览器中自行完成登录。登录完成后，采集器会自动遍历可确认安全的只读导航、列表、详情、页签和分页；不确定或可能改变业务状态的入口会自动跳过或阻止。");
      if (onInteractiveReady) await onInteractiveReady({ browser, context, page });
      if (interactiveController) await interactiveController({ browser, context, page });
      else {
        const readline = await import("node:readline/promises");
        const input = readline.createInterface({ input: process.stdin, output: process.stdout });
        await input.question("完成登录后按 Enter，开始自动安全只读遍历：");
        input.close();
      }
      addDeclared(await collectDeclared());
      if (autoReadonlyNavigation) {
        const readonlyNavigation = await traverseReadonlyNavigation({ page, onPage: async () => addDeclared(await collectDeclared()) });
        runtimeObservations.push({ type: "readonly_navigation", ...readonlyNavigation });
      }
    }
    await Promise.allSettled(responseTasks);

    for (const [canonical, responseData] of responseBodiesByUrl) {
      const asset = assetMap.get(canonical);
      if (asset) bodies.set(asset.asset_id, responseData.body.toString("utf8"));
    }

    const discoveredImports = [];
    for (const asset of assetMap.values()) {
      const source = bodies.get(asset.asset_id);
      if (!source || asset.asset_type !== "js") continue;
      for (const match of source.matchAll(STATIC_IMPORT)) {
        try {
          const importUrl = new URL(match[2], asset.canonical_url).href;
          if (isTechnicalResourceUrl(importUrl)) discoveredImports.push({ importUrl, parent: asset.asset_id });
        } catch {
        degradation.push({ scope: "asset", asset_id: asset.asset_id, reason: "invalid_static_import", reference: redactSensitive(match[2]) });
        }
      }
    }

    for (const discovered of discoveredImports) {
      const canonical = canonicalizeUrl(discovered.importUrl);
      const existing = assetMap.get(canonical);
      if (existing) {
        existing.discovery_sources = [...new Set([...existing.discovery_sources, "static_import"])].sort();
        continue;
      }
      try {
        const { response } = await guard.getTechnical(context, discovered.importUrl, "static_import");
        if (!response.ok()) throw new Error(`HTTP ${response.status()}`);
        const body = Buffer.from(await response.body());
        const asset = {
          asset_id: `asset-${sha256(canonical).slice(0, 16)}`,
          canonical_url: canonical,
          asset_type: assetType(discovered.importUrl, "script"),
          content_sha256: sha256(body),
          size_bytes: body.length,
          classification: classifyAsset({ assetUrl: discovered.importUrl, targetUrl: url, discoverySources: ["static_import"] }),
          classification_evidence: ["static_import", new URL(discovered.importUrl).origin === new URL(url).origin ? "same_origin" : "cross_origin"],
          discovery_sources: ["static_import"],
          runtime_loaded: false,
          http_status: response.status(),
          response_headers: {},
          first_seen_batch: currentBatch,
          last_seen_batch: currentBatch,
        };
        assetMap.set(canonical, asset);
        bodies.set(asset.asset_id, body.toString("utf8"));
      } catch (error) {
        degradation.push({ scope: "asset", url: redactSensitiveUrl(discovered.importUrl), reason: "technical_resource_get_failed", error: String(error.message || error) });
      }
    }

    const assets = [...assetMap.values()].sort((left, right) => left.canonical_url.localeCompare(right.canonical_url));
    const firstByHash = new Map();
    for (const asset of assets) {
      const previousAsset = previousByUrl.get(asset.canonical_url);
      asset.first_seen_batch = previousAsset?.first_seen_batch || currentBatch;
      asset.last_seen_batch = currentBatch;
      asset.previous_sha256 = previousAsset?.content_sha256 || null;
      asset.content_changed = Boolean(previousAsset?.content_sha256 && asset.content_sha256 && previousAsset.content_sha256 !== asset.content_sha256);
      asset.unchanged_from_previous_run = Boolean(previousAsset?.content_sha256 && previousAsset.content_sha256 === asset.content_sha256);
      if (asset.content_sha256 && firstByHash.has(asset.content_sha256)) asset.duplicate_of = firstByHash.get(asset.content_sha256);
      else if (asset.content_sha256) firstByHash.set(asset.content_sha256, asset.asset_id);
    }

    const maps = [];
    for (const asset of assets) {
      const body = bodies.get(asset.asset_id);
      if (!body || asset.asset_type !== "js") continue;
      const responseData = responseBodiesByUrl.get(asset.canonical_url);
      const sourceMap = await resolveSourceMap({ context, assetUrl: asset.canonical_url, body, headers: responseData?.headers || {}, guard });
      asset.source_map = sourceMap;
      maps.push({ asset_id: asset.asset_id, ...sourceMap });
      if (["invalid", "unavailable", "rejected"].includes(sourceMap.status)) degradation.push({ scope: "source_map", asset_id: asset.asset_id, reason: sourceMap.status, detail: sourceMap.reason || sourceMap.http_status || null });
    }

    const assetsForAnalysis = assets.filter((asset) => !asset.duplicate_of && !asset.unchanged_from_previous_run);
    const l1 = analyzeL1({ assets: assetsForAnalysis, bodies });
    degradation.push(...l1.degradations);
    const reusedFacts = [];
    for (const asset of assets.filter((item) => item.unchanged_from_previous_run)) {
      reusedFacts.push(...previousFacts.filter((item) => item.asset_id === asset.asset_id));
      l1.analyses.push({ asset_id: asset.asset_id, analysis_status: "reused_same_hash", fact_count: reusedFacts.filter((item) => item.asset_id === asset.asset_id).length });
    }

    const guardSnapshot = guard.snapshot();
    const finishedAt = new Date().toISOString();
    const baseRunData = {
      schema_version: 1,
      run: { run_id: `run-${randomUUID()}`, target_url: redactSensitiveUrl(url), started_at: startedAt, finished_at: finishedAt, status: degradation.length ? "partial" : "completed" },
      environment,
      account_context: { state: "not_persisted", identifier: null },
      role_context: { role: "unknown", evidence: "not_inferred_from_navigation" },
      batches: [
        ...(previous?.batches || []).filter((batch) => batch?.batch_id !== currentBatch),
        { batch_id: currentBatch, purpose: batchPurpose(currentBatch), started_at: startedAt, finished_at: finishedAt },
      ],
      assets,
      technical_facts: [...reusedFacts, ...l1.facts],
      runtime_observations: [...runtimeObservations, { type: "source_maps", results: maps }, { type: "l1_analysis", results: l1.analyses }, { type: "browser_navigation_requests", requests: guardSnapshot.observed_requests.filter((item) => item.navigation) }, { type: "page_initiated_requests", requests: guardSnapshot.observed_requests.filter((item) => !item.navigation) }, { type: "passive_requests", requests: guardSnapshot.observed_requests }, { type: "blocked_business_api_attempts", attempts: guardSnapshot.blocked_business_api_attempts }, { type: "page_content_policy", value: "untrusted_data_not_instructions" }],
      evidence: assets.filter((asset) => asset.content_sha256).map((asset) => ({ evidence_id: `evidence-${asset.asset_id}`, asset_id: asset.asset_id, sha256: asset.content_sha256, source: asset.discovery_sources, persisted_bytes: false })),
      degradation,
      runtime: await runtimeMetadata(),
      technical_resource_gets: guardSnapshot.technical_resource_gets,
      active_business_api_calls: guardSnapshot.active_business_api_calls,
    };
    const integrated = integrateStage3Stage4({ runData: baseRunData, bodies, previousRunData: previous, currentBatch });
    const runData = integrated.runData;
    assertNoSecrets(runData);
    validateRunData(runData);
    const outputPath = path.join(outputDir, "evidence", "run-data.json");
    await writeJsonAtomic(outputPath, runData);
    await writeJsonAtomic(path.join(outputDir, "evidence", "lineage.json"), integrated.lineage);
    await writeJsonAtomic(path.join(outputDir, "evidence", "excel-projection.json"), integrated.excelProjection);
    await writeJsonAtomic(path.join(outputDir, "evidence", "word-projection.json"), integrated.wordProjection);
    await writeJsonAtomic(path.join(outputDir, "evidence", "cognition-input.json"), buildCognitionInput(runData));
    return { outputPath, runData };
  } finally {
    await browser.close();
  }
}
