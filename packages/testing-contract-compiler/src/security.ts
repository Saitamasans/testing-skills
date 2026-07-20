const INLINE_SECRET = /(?:password|passwd|pwd|token|cookie|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+|(?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+[A-Za-z0-9+/_=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;

function configuredSecretValues(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => /(?:password|passwd|pwd|token|cookie|secret|api[_-]?key|private[_-]?key)/i.test(name) && typeof value === "string" && value.length >= 4)
    .map(([, value]) => value as string);
}

export function assertNoInlineSecret(value: unknown): void {
  const canaries = configuredSecretValues();
  const visit = (item: unknown): void => {
    if (typeof item === "string") {
      if (INLINE_SECRET.test(item) || canaries.some((secret) => item.includes(secret))) throw new Error("secret_value_forbidden");
      return;
    }
    if (Array.isArray(item)) return item.forEach(visit);
    if (item && typeof item === "object") Object.values(item as Record<string, unknown>).forEach(visit);
  };
  visit(value);
}
