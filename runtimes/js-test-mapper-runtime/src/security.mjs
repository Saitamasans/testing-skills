const TECHNICAL_EXTENSIONS = /\.(?:js|mjs|cjs|jsx|ts|tsx|map)$/i;
const TECHNICAL_DISCOVERY_SOURCES = new Set([
  "static_import",
  "source_mapping_url",
  "response_header",
  "html_script",
  "html_preload",
  "html_modulepreload",
  "user_provided_technical",
]);
const SENSITIVE_QUERY_KEY_SOURCE = "(?:mobile|phone|email|user[_-]?id|uid|id[_-]?card|idcard|identity|api[_-]?key|client[_-]?secret|secret|token|access[_-]?token|refresh[_-]?token|session(?:[_-]?id)?|code|otp|password|passwd|cookie|set[_-]?cookie|card(?:[_-]?(?:number|no))?|bank(?:[_-]?card)?|payment|cvv|cvc|pin)";
const SENSITIVE_KEY_SOURCE = `${SENSITIVE_QUERY_KEY_SOURCE}|authorization|bearer|csrf[_-]?token`;
const SENSITIVE_QUERY_KEY = new RegExp(`^${SENSITIVE_QUERY_KEY_SOURCE}$`, "i");
const BUSINESS_PATH_SEGMENTS = new Set([
  "api",
  "graphql",
  "rpc",
  "rest",
  "service",
  "services",
  "ajax",
  "action",
  "actions",
  "query",
  "queries",
  "mutation",
  "mutations",
  "export",
  "download",
  "report",
  "reports",
  "data",
]);

function pathSegments(url) {
  return url.pathname
    .split("/")
    .map((segment) => segment.trim().toLowerCase())
    .filter(Boolean)
    .map((segment) => segment.replace(/\.(?:js|mjs|cjs|jsx|ts|tsx|map)$/i, ""));
}

function isRedacted(value) {
  try {
    const decoded = decodeURIComponent(value);
    return decoded === "[REDACTED]" || value === "[REDACTED]";
  } catch {
    return value === "[REDACTED]";
  }
}

export function isTechnicalResourceUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && TECHNICAL_EXTENSIONS.test(url.pathname);
  } catch {
    return false;
  }
}

export function isBusinessRequest({ url, method = "GET" }) {
  try {
    const parsed = new URL(url);
    if (method.toUpperCase() !== "GET") return true;
    if (parsed.username || parsed.password) return true;
    if ([...parsed.searchParams.keys()].some((key) => SENSITIVE_QUERY_KEY.test(key))) return true;
    return pathSegments(parsed).some((segment) => BUSINESS_PATH_SEGMENTS.has(segment));
  } catch {
    return true;
  }
}

export function redactSensitiveUrl(value) {
  if (typeof value !== "string") return value;
  try {
    const parsed = new URL(value);
    parsed.username = "";
    parsed.password = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (SENSITIVE_QUERY_KEY.test(key)) parsed.searchParams.set(key, "[REDACTED]");
    }
    return parsed.href;
  } catch {
    return value;
  }
}

const SECRET_KEY_PATTERN = `(?:${SENSITIVE_KEY_SOURCE})`;
const QUOTED_OR_UNQUOTED_SECRET_VALUE = new RegExp(
  `((?:["']${SECRET_KEY_PATTERN}["']|\\b${SECRET_KEY_PATTERN}\\b)\\s*[:=]\\s*)(?:"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|[^\\s,;}\\)&]+)`,
  "gi",
);
const QUERY_SECRET_VALUE = new RegExp(`([?&]${SENSITIVE_QUERY_KEY_SOURCE}=)([^&#\\s"'<>]+)`, "gi");

export function redactSensitive(value) {
  if (typeof value !== "string") return value;
  let result = value;
  result = result.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactSensitiveUrl(url));
  result = result.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]");
  result = result.replace(QUOTED_OR_UNQUOTED_SECRET_VALUE, "$1[REDACTED]");
  result = result.replace(QUERY_SECRET_VALUE, "$1[REDACTED]");
  result = result.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]");
  result = result.replace(/(?<!\d)1\d{10}(?!\d)/g, "[REDACTED_PHONE]");
  result = result.replace(/(?<!\d)\d{17}[0-9X](?!\d)/gi, "[REDACTED_IDENTITY]");
  result = result.replace(/(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g, "[REDACTED_PAYMENT]");
  return result;
}

const DETECTOR_QUERY_VALUE = new RegExp(`[?&](${SENSITIVE_QUERY_KEY_SOURCE})=([^&#\\s"'<>]+)`, "gi");
const DETECTOR_SECRET_VALUE = new RegExp(
  `(?:["'](${SECRET_KEY_PATTERN})["']|\\b(${SECRET_KEY_PATTERN})\\b)\\s*[:=]\\s*(?:"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"|'([^'\\\\]*(?:\\\\.[^'\\\\]*)*)'|([^\\s,;}\\)&]+))`,
  "gi",
);
const DETECTOR_BEARER = /\bBearer\s+([A-Za-z0-9._~+\/-]+)/gi;
const DETECTOR_URL_USERINFO = /https?:\/\/[^\s"'<>/:@]+:[^\s"'<>/@]+@/gi;
const DETECTOR_EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const DETECTOR_PHONE = /(?<!\d)1\d{10}(?!\d)/g;
const DETECTOR_IDENTITY = /(?<!\d)\d{17}[0-9X](?!\d)/gi;
const DETECTOR_PAYMENT = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;

function detectSensitiveText(text, { detectBroadNumericPii = true } = {}) {
  const findings = [];
  for (const match of text.matchAll(DETECTOR_QUERY_VALUE)) {
    if (!isRedacted(match[2])) findings.push(`query:${match[1].toLowerCase()}`);
  }
  for (const match of text.matchAll(DETECTOR_SECRET_VALUE)) {
    const candidate = match[3] ?? match[4] ?? match[5] ?? "";
    if (!isRedacted(candidate)) findings.push(`key:${(match[1] || match[2]).toLowerCase()}`);
  }
  for (const match of text.matchAll(DETECTOR_BEARER)) {
    if (!isRedacted(match[1])) findings.push("bearer");
  }
  if ([...text.matchAll(DETECTOR_URL_USERINFO)].length) findings.push("url_userinfo");
  if (detectBroadNumericPii && [...text.matchAll(DETECTOR_EMAIL)].length) findings.push("email");
  if (detectBroadNumericPii && [...text.matchAll(DETECTOR_PHONE)].length) findings.push("phone");
  if (detectBroadNumericPii && [...text.matchAll(DETECTOR_IDENTITY)].length) findings.push("identity");
  if (detectBroadNumericPii && [...text.matchAll(DETECTOR_PAYMENT)].length) findings.push("payment");
  return [...new Set(findings)];
}

export function findSensitiveData(value) {
  const findings = [];
  const pending = [{ value, path: "$" }];
  while (pending.length) {
    const current = pending.pop();
    if (typeof current.value === "string") {
      const field = (current.path.split(".").at(-1) || "").replace(/\[\d+\]$/, "");
      const internalIdentity = /^(?:run_id|base_run_id|asset_id|asset_ids|asset_summary|fact_id|fact_ids|evidence_id|evidence_ids|evidence_anchor|relation_id|relation_ids|duplicate_of|sha256|content_sha256|previous_sha256|digest|content_digest|previous_digest|current_digest|run_data_fingerprint|fingerprint|machine_identity|display_id|branch_id|branch_ids|node_id|node_ids|target_node_id|target_node_ids|edge_id|edge_ids|chain_id|from|to|relations)$/i.test(field)
        || /\.(?:evidence|evidence_ids|evidence_anchor)\[\d+\]$/i.test(current.path);
      for (const finding of detectSensitiveText(current.value, { detectBroadNumericPii: !internalIdentity })) findings.push(`${current.path}:${finding}`);
    } else if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => pending.push({ value: item, path: `${current.path}[${index}]` }));
    } else if (current.value && typeof current.value === "object") {
      for (const [key, item] of Object.entries(current.value)) pending.push({ value: item, path: `${current.path}.${key}` });
    }
  }
  return findings;
}

export class BusinessApiGuard {
  constructor(targetOrigin) {
    this.targetOrigin = targetOrigin;
    this.technicalResourceGets = 0;
    this.activeBusinessApiCalls = 0;
    this.blockedBusinessApiAttempts = [];
    this.observedRequests = [];
  }

  observeRequest(request) {
    const url = request.url();
    const method = request.method();
    const technical = isTechnicalResourceUrl(url) || ["script", "worker"].includes(request.resourceType());
    const business = isBusinessRequest({ url, method });
    this.observedRequests.push({
      url: redactSensitive(url),
      method,
      resource_type: request.resourceType(),
      technical,
      business,
      passive: true,
    });
  }

  recordBlockedBusinessApi(url, method, reason = "guard_denied") {
    const safeUrl = redactSensitiveUrl(url);
    this.blockedBusinessApiAttempts.push({ url: safeUrl, method, blocked: true, reason });
    throw new Error(`business_api_guard_blocked: ${method} ${safeUrl}`);
  }

  async getTechnical(context, url, source, method = "GET") {
    const reasons = [];
    if (!TECHNICAL_DISCOVERY_SOURCES.has(source)) reasons.push("source_not_allowlisted");
    if (method.toUpperCase() !== "GET") reasons.push("method_not_get");
    if (!isTechnicalResourceUrl(url)) reasons.push("not_technical_resource");
    if (isBusinessRequest({ url, method })) reasons.push("business_request_denied");
    if (reasons.length) {
      this.recordBlockedBusinessApi(url, method, reasons.join(","));
    }
    const response = await context.request.get(url, { maxRedirects: 0 });
    const responseUrl = typeof response.url === "function" ? response.url() : url;
    if (isBusinessRequest({ url: responseUrl, method: "GET" })) {
      this.recordBlockedBusinessApi(responseUrl, "GET");
    }
    this.technicalResourceGets += 1;
    return { response, source };
  }

  snapshot() {
    return {
      technical_resource_gets: this.technicalResourceGets,
      active_business_api_calls: this.activeBusinessApiCalls,
      blocked_business_api_attempts: this.blockedBusinessApiAttempts,
      observed_requests: this.observedRequests,
    };
  }
}

export function assertNoSecrets(value) {
  const findings = findSensitiveData(value);
  if (findings.length) throw new Error(`secret_persistence_guard_failed: ${findings.join(",")}`);
}
