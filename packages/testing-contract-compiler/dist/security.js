const INLINE_SECRET = /(?:password|passwd|pwd|token|cookie|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+|(?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+[A-Za-z0-9+/_=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
function configuredSecretValues() {
    return Object.entries(process.env)
        .filter(([name, value]) => /(?:password|passwd|pwd|token|cookie|secret|api[_-]?key|private[_-]?key)/i.test(name) && typeof value === "string" && value.length >= 4)
        .map(([, value]) => value);
}
export function assertNoInlineSecret(value) {
    const canaries = configuredSecretValues();
    const visit = (item) => {
        if (typeof item === "string") {
            if (INLINE_SECRET.test(item) || canaries.some((secret) => item.includes(secret)))
                throw new Error("secret_value_forbidden");
            return;
        }
        if (Array.isArray(item))
            return item.forEach(visit);
        if (item && typeof item === "object")
            Object.values(item).forEach(visit);
    };
    visit(value);
}
//# sourceMappingURL=security.js.map