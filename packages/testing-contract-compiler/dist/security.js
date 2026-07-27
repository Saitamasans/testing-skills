const INLINE_SECRET = /(?:password|passwd|pwd|token|cookie|secret|api[_-]?key|private[_-]?key)\s*[:=]\s*[^\s,;]+|(?:authorization\s*[:=]\s*)?(?:bearer|basic)\s+[A-Za-z0-9+/_=-]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@/i;
function tokenizeKey(key) {
    return key
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((token) => token.toLowerCase());
}
function isSensitiveKey(key) {
    const tokens = tokenizeKey(key);
    return tokens.some((token) => ["password", "passwd", "pwd", "token", "cookie", "secret", "authorization"].includes(token))
        || tokens.some((token, index) => token === "api" && tokens[index + 1] === "key")
        || tokens.some((token, index) => token === "private" && tokens[index + 1] === "key");
}
function referenceSuffix(key) {
    const tokens = tokenizeKey(key);
    const suffix = tokens.at(-1);
    return suffix === "env" || suffix === "ref" || suffix === "reference" ? suffix : null;
}
function isStructuredReference(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const record = value;
    const keys = Object.keys(record).sort();
    return keys.length === 2
        && keys[0] === "name"
        && keys[1] === "source"
        && typeof record.source === "string"
        && ["env", "fixture", "output", "configured_env"].includes(record.source)
        && typeof record.name === "string"
        && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(record.name);
}
function isSafeSensitiveValue(key, value) {
    if (value === null || value === "" || value === false || isStructuredReference(value))
        return true;
    const suffix = referenceSuffix(key);
    if (suffix === "env")
        return typeof value === "string" && /^[A-Z][A-Z0-9_]*$/.test(value);
    return (suffix === "ref" || suffix === "reference")
        && typeof value === "string"
        && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(value);
}
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
        if (item && typeof item === "object") {
            for (const [key, child] of Object.entries(item)) {
                if (isSensitiveKey(key) && !isSafeSensitiveValue(key, child))
                    throw new Error("secret_value_forbidden");
                visit(child);
            }
        }
    };
    if (typeof value === "string" && /^[\s\r\n]*[\[{]/.test(value)) {
        try {
            visit(JSON.parse(value));
        }
        catch (error) {
            if (error instanceof SyntaxError) { /* Text fallback below owns non-JSON inputs. */ }
            else
                throw error;
        }
    }
    visit(value);
}
//# sourceMappingURL=security.js.map