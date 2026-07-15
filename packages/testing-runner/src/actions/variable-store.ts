export interface VariableProvenance {
  action_id: string;
  source: "api.extract" | "manual" | "fixture";
}

export interface VariableEntry {
  value: unknown;
  provenance: VariableProvenance;
}

export class VariableStore {
  readonly #values = new Map<string, VariableEntry>();

  set(name: string, value: unknown, provenance: VariableProvenance): void {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid variable name: ${name}`);
    this.#values.set(name, { value, provenance });
  }

  get(name: string): VariableEntry {
    const entry = this.#values.get(name);
    if (!entry) throw new Error(`Variable is not defined: ${name}`);
    return entry;
  }

  has(name: string): boolean {
    return this.#values.has(name);
  }

  interpolate(text: string): string {
    return text.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_match, name: string) => {
      const value = this.get(name).value;
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return encodeURIComponent(String(value));
      }
      throw new Error(`Variable cannot be interpolated as text: ${name}`);
    });
  }
}

export function readJsonPointer(value: unknown, pointer: string): unknown {
  if (pointer === "") return value;
  if (!pointer.startsWith("/")) throw new Error(`JSON Pointer must start with /: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current: unknown, segment) => {
      if (Array.isArray(current)) return current[Number(segment)];
      if (current && typeof current === "object") return (current as Record<string, unknown>)[segment];
      return undefined;
    }, value);
}
