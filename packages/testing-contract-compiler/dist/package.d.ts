import type { CompileOptions, PackageManifest, ValidationResult } from "./types.js";
export declare function validateZipEntries(entries: string[]): void;
export declare function compilePackage(options: CompileOptions): Promise<{
    output: string;
    package_status: "READY" | "NOT_READY";
    package_id: string;
    source_case_count: number;
    unresolved_count: number;
}>;
export declare function validatePackage(packagePath: string): Promise<ValidationResult>;
export declare function loadExecutionPackage(packagePath: string, options?: {
    requireReady?: boolean;
}): Promise<{
    manifest: PackageManifest;
    contract: {
        contract_version: "1.0.0";
        cases: import("./types.js").ContractCase[];
    };
    sourceMapping: {
        cases: Array<{
            source_case_id: string;
            case_id: string;
            source_sheet: string;
            source_row: number;
        }>;
    };
    sourceFiles: Map<string, Buffer<ArrayBufferLike>>;
    package_sha256: string;
    timings: {
        package_validation_ms: number;
        contract_loading_ms: number;
    };
}>;
export declare function diffPackage(input: string, packagePath: string): Promise<{
    stale: boolean;
    valid: boolean;
    errors: string[];
    expected_sha256?: never;
    actual_sha256?: never;
} | {
    stale: boolean;
    valid: boolean;
    expected_sha256: string | null;
    actual_sha256: string;
    errors: string[];
}>;
