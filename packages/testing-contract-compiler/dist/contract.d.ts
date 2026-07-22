import type { CaseOverride, ContractCase, SourceCase } from "./types.js";
export declare function buildContract(sourceCases: SourceCase[], overrides?: Record<string, CaseOverride>): {
    contract_version: "1.0.0";
    cases: ContractCase[];
};
