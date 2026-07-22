import { createHash } from "node:crypto";
export function sha256(value) {
    return createHash("sha256").update(value).digest("hex");
}
export function stableJson(value) {
    const normalize = (item) => {
        if (Array.isArray(item))
            return item.map(normalize);
        if (item && typeof item === "object") {
            return Object.fromEntries(Object.entries(item)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([key, child]) => [key, normalize(child)]));
        }
        return item;
    };
    return JSON.stringify(normalize(value), null, 2) + "\n";
}
//# sourceMappingURL=crypto.js.map