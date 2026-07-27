export type PackageStatus = "READY" | "NOT_READY";
export interface SourceCase {
    case_id: string;
    module: string;
    title: string;
    feature: string;
    precondition: string;
    steps: string;
    expected: string;
    priority: string;
    actual_result: string;
    execution_result: string;
    source_sheet: string;
    source_row: number;
}
export interface InspectResult {
    format: "standard_10" | "standard_11" | "non_standard";
    requires_confirmation: boolean;
    source_sheet_names: string[];
    case_ids: string[];
    field_mapping: Record<string, string | null>;
    cases: SourceCase[];
}
export interface ContractCase {
    case_id: string;
    source_case_id: string;
    source_sheet: string;
    title: string;
    module: string;
    priority: string;
    execution_type: "web_ui";
    automation_status: "auto_ready" | "needs_confirmation" | "partial_manual" | "manual_required" | "not_suitable_for_automation";
    isolation_scope: "case" | "flow_group" | "suite" | "external_existing";
    flow_group: string | null;
    start_state: Record<string, unknown>;
    auth_profile: Record<string, unknown>;
    setup: unknown[];
    actions: unknown[];
    assertions: unknown[];
    effects: Record<string, unknown>;
    cleanup: {
        technical_cleanup: unknown[];
        business_cleanup: unknown[];
    };
    dependencies: string[];
    resource_locks: unknown[];
    evidence_policy: Record<string, unknown>;
    unresolved: Array<{
        field: string;
        reason: string;
    }>;
}
export type CaseOverride = Partial<Omit<ContractCase, "case_id" | "source_case_id" | "source_sheet">>;
export interface CompileOptions {
    input: string;
    output: string;
    fieldMapping?: Record<string, string>;
    mappingConfirmed?: boolean;
    overrides?: Record<string, CaseOverride>;
    requirementFiles?: string[];
    projectConfigFile?: string;
    stagingParent?: string;
}
export interface PackageManifest {
    schema_version: "1.0.0";
    package_status: PackageStatus;
    package_id: string;
    compiler_name: "@saitamasans/testing-contract-compiler";
    compiler_version: "1.0.0";
    contract_version: "1.0.0";
    compiled_at: string;
    source_files: string[];
    source_sha256: Record<string, string>;
    source_sheet_names: string[];
    source_case_count: number;
    source_case_ids: string[];
    internal_files: string[];
    internal_file_sha256: Record<string, string>;
    unresolved_count: number;
    secret_values_included: false;
}
export interface ValidationResult {
    valid: boolean;
    package_status: PackageStatus | null;
    manifest: PackageManifest | null;
    errors: string[];
    trust_status: "untrusted";
    publisher_authenticated: false;
    execution_authorized: false;
}
