import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import JSZip from "jszip";

import {
  assertNoSecrets,
  fingerprintSecret,
  redact,
  secretVariants,
  SecurityBoundaryError,
  type SecretFingerprint,
} from "./redactor.js";

export interface SanitizePlaywrightTraceInput {
  rawPath: string;
  outputPath: string;
  fingerprints: readonly SecretFingerprint[];
}

const MASK = "[REDACTED]";
const SENSITIVE_HEADER_NAMES = new Set(["authorization", "proxy-authorization", "cookie", "set-cookie"]);
const SENSITIVE_KEYS = [
  "postData", "post_data", "requestBody", "request_body", "storageState", "storage_state",
];

function sensitiveKey(key: string): boolean {
  return /password|secret|token|authorization|cookie|api[_-]?key|csrf|xsrf|jwt|session/i.test(key);
}

function sensitiveHeaderName(name: string): boolean {
  return SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) || sensitiveKey(name);
}

function sensitiveDomValueKeys(tagName: string, attributes: Record<string, unknown>): string[] {
  const tag = tagName.toUpperCase();
  const identity = String(attributes.name ?? attributes.id ?? attributes.property ?? attributes["http-equiv"] ?? "");
  if (tag === "INPUT" && (String(attributes.type ?? "").toLowerCase() === "password" || sensitiveKey(identity))) {
    return ["value", "__playwright_value_"];
  }
  if (tag === "META" && sensitiveKey(identity)) return ["content"];
  return [];
}

function addDerivedSecret(values: Set<string>, candidate: string): void {
  const value = candidate.trim();
  if (!value || value === MASK) return;
  if (value.length < 4) {
    throw new SecurityBoundaryError("Playwright Trace contains a sensitive value too short to redact safely");
  }
  values.add(value);
}

function collectHeaderSecret(name: string, value: string, values: Set<string>): void {
  addDerivedSecret(values, value);
  const normalized = name.toLowerCase();
  if (normalized === "authorization" || normalized === "proxy-authorization") {
    const token = value.replace(/^\s*(?:Bearer|Basic)\s+/i, "");
    if (token !== value) addDerivedSecret(values, token);
  }
  if (normalized === "cookie" || normalized === "set-cookie") {
    const pairs = normalized === "set-cookie" ? [value.split(";", 1)[0]!] : value.split(";");
    for (const pair of pairs) {
      const separator = pair.indexOf("=");
      if (separator >= 0) addDerivedSecret(values, pair.slice(separator + 1));
    }
  }
}

function collectStructuredSecrets(value: unknown, values: Set<string>, storageState = false): void {
  if (Array.isArray(value)) {
    if (typeof value[0] === "string" && value[1] && typeof value[1] === "object") {
      const attributes = value[1] as Record<string, unknown>;
      for (const key of sensitiveDomValueKeys(value[0], attributes)) {
        if (typeof attributes[key] === "string") addDerivedSecret(values, attributes[key]);
      }
    }
    for (const item of value) collectStructuredSecrets(item, values, storageState);
    return;
  }
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  if (typeof input.name === "string" && typeof input.value === "string" && sensitiveHeaderName(input.name)) {
    collectHeaderSecret(input.name, input.value, values);
  }
  for (const [key, nested] of Object.entries(input)) {
    const nestedStorageState = storageState || key === "storageState" || key === "storage_state";
    if (typeof nested === "string" && (sensitiveKey(key) || (nestedStorageState && key === "value"))) {
      addDerivedSecret(values, nested);
    }
    if (typeof nested === "string" && SENSITIVE_HEADER_NAMES.has(key.toLowerCase())) collectHeaderSecret(key, nested, values);
    if (typeof nested === "string" && ["postData", "post_data", "requestBody", "request_body"].includes(key)) {
      collectTextSecrets(nested, values);
    }
    collectStructuredSecrets(nested, values, nestedStorageState);
  }
}

function collectTextSecrets(text: string, values: Set<string>): void {
  try {
    collectStructuredSecrets(JSON.parse(text), values);
  } catch {
    // Trace text and request bodies are not necessarily JSON.
  }
  for (const match of text.matchAll(/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*([^\r\n]+)/gi)) {
    collectHeaderSecret(match[1]!, match[2]!, values);
  }
  for (const match of text.matchAll(/<input\b[^>]*\btype\s*=\s*["']?password["']?[^>]*\bvalue\s*=\s*(["'])([^"']*)\1/gi)) {
    addDerivedSecret(values, match[2]!);
  }
  for (const match of text.matchAll(/<(input|meta)\b[^>]*>/gi)) {
    const tag = match[0];
    const attribute = (name: string): string | undefined => {
      const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
      return found?.[1] ?? found?.[2] ?? found?.[3];
    };
    const key = attribute("name") ?? attribute("id") ?? attribute("property") ?? attribute("http-equiv") ?? "";
    const value = match[1]!.toLowerCase() === "meta" ? attribute("content") : (attribute("value") ?? attribute("__playwright_value_"));
    if (value !== undefined && (sensitiveKey(key) || attribute("type")?.toLowerCase() === "password")) addDerivedSecret(values, value);
  }
  for (const match of text.matchAll(/(?:localStorage|sessionStorage)\.setItem\(\s*(["'])([^"']+)\1\s*,\s*(["'])([^"']*)\3\s*\)/gi)) {
    if (sensitiveKey(match[2]!)) addDerivedSecret(values, match[4]!);
  }
  for (const match of text.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(["'])([^"']*)\2/g)) {
    if (sensitiveKey(match[1]!)) addDerivedSecret(values, match[3]!);
  }
  for (const match of text.matchAll(/(?:^|[?&;\s])(password|secret|token|authorization|cookie|api[_-]?key)=([^&;\s]+)/gi)) {
    let decoded = match[2]!;
    try { decoded = decodeURIComponent(decoded.replaceAll("+", " ")); } catch { /* keep literal */ }
    addDerivedSecret(values, decoded);
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { collectStructuredSecrets(JSON.parse(line), values); } catch { /* non-JSON line */ }
  }
}

function sanitizePasswordHtml(text: string): string {
  return text.replace(/<input\b([^>]*\btype\s*=\s*["']?password["']?[^>]*)>/gi, (tag) => {
    let sanitized = tag.replace(/\bvalue\s*=\s*(["'])[^"']*\1/gi, `value="${MASK}"`);
    sanitized = sanitized.replace(/\b__playwright_value_\s*=\s*(["'])[^"']*\1/gi, `__playwright_value_="${MASK}"`);
    return sanitized;
  });
}

function sanitizeStructured(value: unknown, fingerprints: readonly SecretFingerprint[]): unknown {
  if (Array.isArray(value)) {
    const output = value.map((item) => sanitizeStructured(item, fingerprints));
    if (typeof output[0] === "string" && output[1] && typeof output[1] === "object") {
      const attributes = output[1] as Record<string, unknown>;
      for (const key of sensitiveDomValueKeys(output[0], attributes)) if (Object.hasOwn(attributes, key)) attributes[key] = MASK;
    }
    return output;
  }
  if (!value || typeof value !== "object") {
    return redact(typeof value === "string" ? sanitizePasswordHtml(value) : value, { fingerprints, customKeys: SENSITIVE_KEYS });
  }
  const input = value as Record<string, unknown>;
  if (
    typeof input.name === "string"
    && sensitiveHeaderName(input.name)
    && Object.hasOwn(input, "value")
  ) {
    return { ...input, value: MASK };
  }
  const sanitized = Object.fromEntries(Object.entries(input).map(([key, nested]) => [
    key,
    sanitizeStructured(nested, fingerprints),
  ]));
  return redact(sanitized, { fingerprints, customKeys: SENSITIVE_KEYS });
}

function sanitizeText(name: string, text: string, fingerprints: readonly SecretFingerprint[]): string {
  try {
    const result = JSON.stringify(sanitizeStructured(JSON.parse(text), fingerprints));
    assertNoSecrets(result, fingerprints);
    return result;
  } catch (error) {
    if (error instanceof SecurityBoundaryError) throw error;
  }
  if (!isTraceNdjson(name)) {
    if (/password|secret|token|authorization|cookie|api[_-]?key|storageState|storage_state/i.test(text)) {
      return MASK;
    }
    const result = String(redact(text, { fingerprints, customKeys: SENSITIVE_KEYS }));
    assertNoSecrets(result, fingerprints);
    return result;
  }
  const lines = text.split("\n").map((line) => {
    if (line.trim() === "") return line;
    try {
      return JSON.stringify(sanitizeStructured(JSON.parse(line), fingerprints));
    } catch {
      return String(redact(line, { fingerprints, customKeys: SENSITIVE_KEYS }));
    }
  });
  let result = lines.join("\n");
  result = sanitizePasswordHtml(result);
  result = result.replace(/\b(Authorization|Proxy-Authorization|Cookie|Set-Cookie)\s*:\s*[^\r\n]*/gi, `$1: ${MASK}`);
  assertNoSecrets(result, fingerprints);
  return result;
}

function isTraceNdjson(name: string): boolean {
  return name === "trace.trace" || name === "trace.network" || name.endsWith(".trace") || name.endsWith(".network");
}

function decodeText(name: string, bytes: Buffer): string | undefined {
  if (isTraceNdjson(name)) return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (bytes.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}

function assertBinaryHasNoSecrets(bytes: Buffer, fingerprints: readonly SecretFingerprint[]): void {
  for (const fingerprint of fingerprints) {
    for (const variant of secretVariants(fingerprint)) {
      if (variant && bytes.includes(Buffer.from(variant, "utf8"))) {
        throw new SecurityBoundaryError(`Trace sanitization blocked: ${fingerprint.label ?? "runtime secret"} was present in a binary resource`);
      }
    }
  }
}

function requestBodyResourceRefs(value: unknown, refs: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) requestBodyResourceRefs(item, refs);
    return;
  }
  if (!value || typeof value !== "object") return;
  const input = value as Record<string, unknown>;
  const request = input.request as Record<string, unknown> | undefined;
  const postData = request?.postData as Record<string, unknown> | undefined;
  for (const key of ["_sha1", "_file"] as const) {
    const resource = postData?.[key];
    if (typeof resource === "string" && resource.length > 0) refs.add(`resources/${resource}`);
  }
  for (const nested of Object.values(input)) requestBodyResourceRefs(nested, refs);
}

function parseTraceLines(name: string, text: string, requestBodies: Set<string>): void {
  if (!isTraceNdjson(name)) return;
  let count = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const value = JSON.parse(line) as unknown;
    requestBodyResourceRefs(value, requestBodies);
    count += 1;
  }
  if (count === 0) throw new SecurityBoundaryError(`Playwright Trace entry is empty: ${name}`);
}

export async function sanitizePlaywrightTrace(input: SanitizePlaywrightTraceInput): Promise<void> {
  const temporaryOutput = `${input.outputPath}.sanitizing-${randomUUID()}`;
  await rm(input.outputPath, { force: true }).catch(() => undefined);
  await rm(temporaryOutput, { force: true }).catch(() => undefined);
  try {
    const source = await JSZip.loadAsync(await readFile(input.rawPath), { checkCRC32: true });
    const entryBytes = new Map<string, Buffer>();
    const derivedValues = new Set<string>();
    const requestBodies = new Set<string>();
    let traceEntryCount = 0;
    for (const [name, entry] of Object.entries(source.files)) {
      if (entry.dir) continue;
      const bytes = await entry.async("nodebuffer");
      entryBytes.set(name, bytes);
      const text = decodeText(name, bytes);
      if (text !== undefined) {
        collectTextSecrets(text, derivedValues);
        parseTraceLines(name, text, requestBodies);
        if (name === "trace.trace" || name.endsWith(".trace")) traceEntryCount += 1;
      }
    }
    if (traceEntryCount === 0) throw new SecurityBoundaryError("Playwright Trace has no trace NDJSON entry");
    const fingerprints = [
      ...input.fingerprints,
      ...[...derivedValues].map((value) => fingerprintSecret(value, "Trace-derived secret")),
    ];
    const output = new JSZip();
    for (const [name, entry] of Object.entries(source.files)) {
      if (entry.dir) {
        output.folder(name);
        continue;
      }
      const bytes = entryBytes.get(name)!;
      if (requestBodies.has(name)) {
        output.file(name, MASK, { date: entry.date, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions });
        continue;
      }
      const text = decodeText(name, bytes);
      if (text === undefined) {
        assertBinaryHasNoSecrets(bytes, fingerprints);
        output.file(name, bytes, { date: entry.date, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions });
      } else {
        output.file(name, sanitizeText(name, text, fingerprints), { date: entry.date, unixPermissions: entry.unixPermissions, dosPermissions: entry.dosPermissions });
      }
    }
    const generated = await output.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const validated = await JSZip.loadAsync(generated, { checkCRC32: true });
    for (const [name, entry] of Object.entries(validated.files)) {
      if (entry.dir) continue;
      const bytes = await entry.async("nodebuffer");
      const text = decodeText(name, bytes);
      if (text !== undefined) parseTraceLines(name, text, new Set());
      else assertBinaryHasNoSecrets(bytes, fingerprints);
    }
    await writeFile(temporaryOutput, generated);
    await JSZip.loadAsync(await readFile(temporaryOutput), { checkCRC32: true });
    await rename(temporaryOutput, input.outputPath);
  } catch (error) {
    await rm(temporaryOutput, { force: true }).catch(() => undefined);
    await rm(input.outputPath, { force: true }).catch(() => undefined);
    throw new SecurityBoundaryError(`Playwright Trace sanitization failed closed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await rm(input.rawPath, { force: true }).catch(() => undefined);
  }
}
