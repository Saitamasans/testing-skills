import type { TenColumnName } from "../types.js";

export type SplitRule = {
  version: "1.0.0";
  source_column: string;
  strategy: "delimiter" | "labeled-sections";
  separator: string;
  targets: ["测试步骤", "预期结果"];
};

interface SourceColumnReference {
  source_sheet: string;
  source_column: string;
  source_column_index: number;
}

export type DirectColumnRule = SourceColumnReference & {
  kind: "direct";
  target_field: TenColumnName;
};

export type SplitColumnRule = SourceColumnReference & {
  kind: "split";
  split_rule: SplitRule;
};

export type MappingColumnRule = DirectColumnRule | SplitColumnRule;

export interface MappingApproval {
  source_sha256: string;
  proposal_sha256: string;
  confirmed_at: string;
  confirmed_by: string;
  column_rules: MappingColumnRule[];
}
