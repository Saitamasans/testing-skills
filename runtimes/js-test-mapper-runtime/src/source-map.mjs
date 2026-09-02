import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { isTechnicalResourceUrl, redactSensitive, redactSensitiveUrl } from "./security.mjs";

const POINTER = /(?:\/\/[#@]\s*sourceMappingURL\s*=\s*([^\s]+))/g;

function findRawSourceMapPointer({ assetUrl, body = "", headers = {} }) {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  const headerPointer = normalizedHeaders.sourcemap || normalizedHeaders["x-sourcemap"];
  if (headerPointer) {
    return { url: new URL(headerPointer, assetUrl).href, source: "response_header" };
  }
  const matches = [...body.matchAll(POINTER)];
  const pointer = matches.at(-1)?.[1];
  if (!pointer) return null;
  return { url: new URL(pointer, assetUrl).href, source: "source_mapping_url" };
}

function safePointer(pointer) {
  return pointer ? { ...pointer, url: redactSensitiveUrl(pointer.url) } : pointer;
}

export function findSourceMapPointer(input) {
  return safePointer(findRawSourceMapPointer(input));
}

export async function resolveSourceMap({ context, assetUrl, body, headers, guard }) {
  const pointer = findRawSourceMapPointer({ assetUrl, body, headers });
  if (!pointer) return { status: "not_declared" };
  const persistedPointer = safePointer(pointer);
  if (!isTechnicalResourceUrl(pointer.url)) return { status: "rejected", pointer: persistedPointer, reason: "pointer_is_not_technical" };
  try {
    const { response } = await guard.getTechnical(context, pointer.url, pointer.source);
    if (!response.ok()) return { status: "unavailable", pointer: persistedPointer, http_status: response.status() };
    const mapText = await response.text();
    const map = JSON.parse(mapText);
    if (map.version !== 3 || !Array.isArray(map.sources) || typeof map.mappings !== "string") {
      return { status: "invalid", pointer: persistedPointer, reason: "unsupported_source_map_shape" };
    }
    const result = { status: "resolved", pointer: persistedPointer, sources: map.sources.map(redactSensitive), has_sources_content: Array.isArray(map.sourcesContent), source_count: map.sources.length };
    try {
      const trace = new TraceMap(map);
      const original = originalPositionFor(trace, { line: 1, column: 0 });
      if (original.source || original.line) result.sample_original_position = original;
    } catch {
      result.mapping_sample = "unavailable";
    }
    return result;
  } catch (error) {
    return { status: "invalid", pointer: persistedPointer, reason: "map_parse_failed", error: String(error.message || error) };
  }
}
