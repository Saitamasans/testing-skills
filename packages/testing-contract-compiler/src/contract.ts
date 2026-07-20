import type { CaseOverride, ContractCase, SourceCase } from "./types.js";

function lines(text: string): string[] { return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }

function merge(base: ContractCase, override: CaseOverride | undefined): ContractCase {
  if (!override) return base;
  return { ...base, ...override, case_id: base.case_id, source_case_id: base.source_case_id, source_sheet: base.source_sheet };
}

function assertNoSecrets(value: unknown, key = "root"): void {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoSecrets(item, `${key}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
    const normalized = childKey.toLowerCase();
    const sensitive = /(password|cookie|token|private.?key|secret)/i.test(normalized);
    const reference = /(_env|_ref|reference|storage_state)$/i.test(normalized);
    if (sensitive && !reference && child !== null && child !== "") throw new Error(`secret_value_forbidden: ${key}.${childKey}`);
    if (reference && typeof child === "string" && /_env$/i.test(normalized) && !/^[A-Z][A-Z0-9_]*$/.test(child)) throw new Error(`secret_value_forbidden: ${key}.${childKey}`);
    assertNoSecrets(child, `${key}.${childKey}`);
  }
}

function assertAcyclic(cases: ContractCase[]): void {
  const ids = new Set(cases.map((item) => item.case_id));
  const graph = new Map(cases.map((item) => [item.case_id, item.dependencies.filter((id) => ids.has(id))]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new Error(`dependency_cycle: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

function assertConsistency(cases: ContractCase[]): void {
  const ids = new Set(cases.map((item) => item.case_id));
  const exclusiveLocks = new Map<string, string>();
  for (const item of cases) {
    for (const dependency of item.dependencies) if (!ids.has(dependency)) throw new Error(`dependency_unknown: ${item.case_id}:${dependency}`);
    const grouped = item.isolation_scope === "flow_group";
    if (grouped !== (typeof item.flow_group === "string" && item.flow_group.length > 0)) throw new Error(`flow_group_inconsistent: ${item.case_id}`);
    for (const lock of item.resource_locks) {
      if (!lock || typeof lock !== "object") throw new Error(`resource_lock_invalid: ${item.case_id}`);
      const value = lock as { resource?: unknown; mode?: unknown };
      if (typeof value.resource !== "string" || !value.resource || !["shared", "exclusive"].includes(String(value.mode))) throw new Error(`resource_lock_invalid: ${item.case_id}`);
      if (value.mode !== "exclusive") continue;
      const owner = exclusiveLocks.get(value.resource);
      if (owner && !item.dependencies.includes(owner)) throw new Error(`resource_lock_conflict: ${owner}:${item.case_id}:${value.resource}`);
      exclusiveLocks.set(value.resource, item.case_id);
    }
  }
}

export function buildContract(sourceCases: SourceCase[], overrides: Record<string, CaseOverride> = {}) {
  const cases = sourceCases.map((source): ContractCase => {
    const unresolved: ContractCase["unresolved"] = [];
    if (!source.precondition) unresolved.push({ field: "start_state", reason: "missing_precondition" });
    if (!source.steps) unresolved.push({ field: "actions", reason: "missing_steps" });
    if (!source.expected) unresolved.push({ field: "assertions", reason: "missing_expected" });
    if (!["P0", "P1", "P2"].includes(source.priority)) unresolved.push({ field: "priority", reason: "invalid_priority" });
    const base: ContractCase = {
      case_id: source.case_id, source_case_id: source.case_id, source_sheet: source.source_sheet,
      title: source.title, module: source.module, priority: source.priority, execution_type: "web_ui",
      automation_status: unresolved.length ? "needs_confirmation" : "auto_ready",
      isolation_scope: "case", flow_group: null,
      start_state: source.precondition ? { description: source.precondition } : {},
      auth_profile: { id: "anonymous", strategy: "none", credential_refs: {} },
      setup: [], actions: lines(source.steps).map((description, index) => ({ action_id: `${source.case_id}-A${index + 1}`, type: "business_step", description })),
      assertions: lines(source.expected).map((description, index) => ({ assertion_id: `${source.case_id}-E${index + 1}`, type: "business_expectation", description })),
      effects: { browser_state: null, identity_state: null, account_data: null, shared_business_data: null, global_environment: null, external_system: null },
      cleanup: { technical_cleanup: [{ type: "close_browser_context" }], business_cleanup: [] },
      dependencies: [], resource_locks: [], evidence_policy: { screenshot: "on_failure", trace: "retain" }, unresolved,
    };
    const result = merge(base, overrides[source.case_id]);
    result.automation_status = result.unresolved.length ? "needs_confirmation" : result.automation_status;
    return result;
  });
  assertNoSecrets(cases);
  assertConsistency(cases);
  assertAcyclic(cases);
  return { contract_version: "1.0.0" as const, cases };
}
