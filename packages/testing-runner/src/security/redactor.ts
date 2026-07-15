import { createHash } from "node:crypto";

export class SecurityBoundaryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityBoundaryError";
  }
}

const SECRET_VARIANTS = Symbol("secretVariants");

export interface SecretFingerprint {
  sha256: string;
  length: number;
  label?: string;
  readonly [SECRET_VARIANTS]?: readonly string[];
}

export interface RedactionPolicy {
  fingerprints?: readonly SecretFingerprint[];
  customKeys?: readonly string[];
  mask?: string;
}

export function fingerprintSecret(secret: string, label?: string): SecretFingerprint {
  if (secret.length === 0) throw new Error("Cannot fingerprint an empty secret");
  const variants = [...new Set([
    secret,
    encodeURIComponent(secret),
    Buffer.from(secret, "utf8").toString("base64"),
  ])].sort((left, right) => right.length - left.length);
  const fingerprint: SecretFingerprint = {
    sha256: createHash("sha256").update(secret, "utf8").digest("hex"),
    length: secret.length,
  };
  if (label) fingerprint.label = label;
  Object.defineProperty(fingerprint, SECRET_VARIANTS, {
    value: variants,
    enumerable: false,
  });
  return fingerprint;
}

export function secretVariants(fingerprint: SecretFingerprint): readonly string[] {
  return fingerprint[SECRET_VARIANTS] ?? [];
}

function tokenizeKey(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

function includesSequence(tokens: readonly string[], first: string, second: string): boolean {
  return tokens.some((token, index) => token === first && tokens[index + 1] === second);
}

function isSensitiveKey(key: string, customKeys: readonly string[] = []): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/g, "").toLowerCase();
  if (customKeys.some((custom) => custom.replace(/[^A-Za-z0-9]/g, "").toLowerCase() === normalized)) {
    return true;
  }
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

function replaceAllLiteral(value: string, search: string, replacement: string): string {
  return search === "" ? value : value.split(search).join(replacement);
}

function redactKnownSecrets(text: string, fingerprints: readonly SecretFingerprint[], mask: string): string {
  let redacted = text;
  const variants = fingerprints.flatMap(secretVariants).sort((left, right) => right.length - left.length);
  for (const variant of variants) redacted = replaceAllLiteral(redacted, variant, mask);
  return redacted;
}

function sanitizeUrl(candidate: string, customKeys: readonly string[], mask: string): string {
  try {
    const url = new URL(candidate);
    if (url.username) url.username = mask;
    if (url.password) url.password = mask;
    for (const key of [...url.searchParams.keys()]) {
      if (isSensitiveKey(key, customKeys)) url.searchParams.set(key, mask);
    }
    return url.toString();
  } catch {
    return candidate;
  }
}

function redactUrls(text: string, customKeys: readonly string[], mask: string): string {
  return text.replace(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g, (candidate) =>
    sanitizeUrl(candidate, customKeys, mask),
  );
}

function redactString(text: string, policy: Required<Pick<RedactionPolicy, "fingerprints" | "customKeys" | "mask">>): string {
  let redacted = redactKnownSecrets(text, policy.fingerprints, policy.mask);
  redacted = redactUrls(redacted, policy.customKeys, policy.mask);
  redacted = redacted.replace(/\b(?:Bearer|Basic)\s+[^\s,;]+/gi, (match) =>
    match.replace(/\s+[^\s,;]+$/, ` ${policy.mask}`),
  );
  redacted = redacted.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, policy.mask);
  redacted = redacted.replace(/\b1[3-9]\d{9}\b/g, policy.mask);
  redacted = redacted.replace(/\b\d{17}[\dXx]\b/g, policy.mask);
  return redacted;
}

export function redact(value: unknown, policy: RedactionPolicy = {}): unknown {
  const normalizedPolicy = {
    fingerprints: policy.fingerprints ?? [],
    customKeys: policy.customKeys ?? [],
    mask: policy.mask ?? "[REDACTED]",
  };

  function walk(current: unknown, keyHint?: string): unknown {
    if (keyHint && isSensitiveKey(keyHint, normalizedPolicy.customKeys)) return normalizedPolicy.mask;
    if (typeof current === "string") return redactString(current, normalizedPolicy);
    if (Array.isArray(current)) return current.map((item) => walk(item));
    if (!current || typeof current !== "object") return current;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(current as Record<string, unknown>)) {
      output[key] = walk(nested, key);
    }
    return output;
  }

  return walk(value);
}

export function assertNoSecrets(value: unknown, fingerprints: readonly SecretFingerprint[]): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const text = serialized ?? "";
  for (const fingerprint of fingerprints) {
    const label = fingerprint.label ?? "runtime secret";
    if (text.includes(fingerprint.sha256)) {
      throw new SecurityBoundaryError(`Persistence blocked: ${label} fingerprint was present`);
    }
    for (const variant of secretVariants(fingerprint)) {
      if (variant && text.includes(variant)) {
        throw new SecurityBoundaryError(`Persistence blocked: ${label} value was present`);
      }
    }
  }
}
