const REFERENCE_SOURCES = new Set(["env", "fixture", "output"]);
const DATABASE_PROTOCOLS = new Set([
  "mongodb:",
  "mongodb+srv:",
  "mysql:",
  "postgres:",
  "postgresql:",
  "redis:",
]);
const SAFE_MARKERS = new Set([
  "",
  "absent",
  "empty",
  "header must be absent",
  "masked",
  "missing",
  "none",
  "not present",
  "not set",
  "null",
  "omitted",
  "redacted",
  "removed",
  "unset",
  "不存在",
  "不应存在",
  "已删除",
  "已移除",
  "已省略",
  "已脱敏",
  "已遮蔽",
  "已隐藏",
  "必须不存在",
  "无",
  "未提供",
  "未设置",
  "未返回",
  "省略",
  "空",
  "空值",
  "脱敏",
  "遮蔽",
  "隐藏",
  "为空",
]);

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function childPointer(pointer: string, segment: string | number): string {
  return `${pointer}/${escapePointerSegment(String(segment))}`;
}

function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function includesSequence(tokens: string[], first: string, second: string): boolean {
  return tokens.some((token, index) => token === first && tokens[index + 1] === second);
}

function isCredentialKey(key: string): boolean {
  const tokens = tokenizeKey(key);
  return (
    tokens.includes("password") ||
    tokens.includes("secret") ||
    tokens.includes("token") ||
    tokens.includes("authorization") ||
    tokens.includes("cookie") ||
    includesSequence(tokens, "api", "key") ||
    includesSequence(tokens, "connection", "string")
  );
}

function normalizedMarker(value: string): string {
  return value
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/[.。]+$/g, "")
    .trim()
    .toLowerCase();
}

function isSafeMarker(value: string): boolean {
  return SAFE_MARKERS.has(normalizedMarker(value));
}

function isStructuredReference(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 2 &&
    keys.includes("source") &&
    keys.includes("name") &&
    typeof record.source === "string" &&
    REFERENCE_SOURCES.has(record.source) &&
    typeof record.name === "string" &&
    record.name.length > 0
  );
}

function isParameterReference(value: string): boolean {
  return /^(?:\$\d+|\?|:[A-Za-z_][A-Za-z0-9_]*|@[A-Za-z_][A-Za-z0-9_]*)$/.test(
    value.trim(),
  );
}

function assignmentValue(text: string, start: number): string {
  const tail = text.slice(start);
  const boundary = tail.search(/(?:[;,}\n]|\s+(?:AND|OR)\s+)/i);
  return (boundary === -1 ? tail : tail.slice(0, boundary)).trim();
}

function credentialAssignmentIssue(text: string): string | undefined {
  const assignment = /([A-Za-z][A-Za-z0-9_-]*(?:\s+[A-Za-z][A-Za-z0-9_-]*)*)\s*[:=]\s*/g;
  for (let match = assignment.exec(text); match; match = assignment.exec(text)) {
    const key = match[1];
    if (!key || !isCredentialKey(key)) continue;
    const value = assignmentValue(text, assignment.lastIndex);
    if (isParameterReference(value) || isSafeMarker(value)) continue;
    return `credential assignment for "${key.trim()}" contains a persisted literal`;
  }
  return undefined;
}

function urlIssue(text: string): string | undefined {
  const candidates = text.match(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g) ?? [];
  for (const candidate of candidates) {
    try {
      const url = new URL(candidate);
      if (url.username || url.password) return "URL userinfo must not be persisted";
      if (DATABASE_PROTOCOLS.has(url.protocol.toLowerCase())) {
        return "database connection URI must not be persisted";
      }
    } catch {
      // Structural schemas own URL validity; semantic inspection only handles parsed URLs.
    }
  }
  return undefined;
}

function authSchemeIssue(text: string): string | undefined {
  const match = text.match(/(?:^|[\s:=])((?:Bearer|Basic))\s+([^\s,;]+)/i);
  if (!match) return undefined;
  const value = match[2] ?? "";
  return isSafeMarker(value) ? undefined : `${match[1]} credential value must not be persisted`;
}

function stringIssue(value: string): string | undefined {
  return urlIssue(value) ?? credentialAssignmentIssue(value) ?? authSchemeIssue(value);
}

function isSafeCredentialValue(value: unknown): boolean {
  return value === null || isStructuredReference(value) || (typeof value === "string" && isSafeMarker(value));
}

export function findPersistedSecretIssues(value: unknown): string[] {
  const issues: string[] = [];

  function walk(current: unknown, pointer: string): void {
    if (typeof current === "string") {
      const issue = stringIssue(current);
      if (issue) issues.push(`${pointer || "/"}: ${issue}`);
      return;
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => walk(item, childPointer(pointer, index)));
      return;
    }

    if (!current || typeof current !== "object") return;

    for (const [key, nestedValue] of Object.entries(current as Record<string, unknown>)) {
      const nestedPointer = childPointer(pointer, key);
      if (isCredentialKey(key)) {
        if (!isSafeCredentialValue(nestedValue)) {
          issues.push(
            `${nestedPointer}: credential-shaped key "${key}" must use a structured reference or explicit absence/masking marker`,
          );
        }
        continue;
      }
      walk(nestedValue, nestedPointer);
    }
  }

  walk(value, "");
  return [...new Set(issues)];
}
