import { stat } from "node:fs/promises";
import path from "node:path";
import { loadExecutionPackage } from "@saitamasans/testing-contract-compiler";
import type { ContractCase } from "@saitamasans/testing-contract-compiler";
import type { CaseColumnName, CaseValues, NormalizedCaseSet, OriginalSourceRow } from "../types.js";

const COLUMNS: CaseColumnName[] = ["用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件", "测试步骤", "预期结果", "优先级", "实际结果", "执行结果", "备注"];

function descriptions(items: unknown[]): string {
  return items.map((item) => typeof item === "object" && item && "description" in item ? String(item.description) : JSON.stringify(item)).join("\n");
}

function values(item: ContractCase): CaseValues {
  return {
    "用例 ID": item.source_case_id, "所属模块": item.module, "用例标题": item.title, "验证功能点": item.title,
    "前置条件": typeof item.start_state.description === "string" ? item.start_state.description : JSON.stringify(item.start_state),
    "测试步骤": descriptions(item.actions), "预期结果": descriptions(item.assertions), "优先级": item.priority, "实际结果": "", "执行结果": "", "备注": "",
  };
}

export async function readExecutionPackage(file: string) {
  const loaded = await loadExecutionPackage(file, { requireReady: true });
  const sourceById = new Map(loaded.sourceMapping.cases.map((item) => [item.case_id, item]));
  const rows: OriginalSourceRow[] = loaded.contract.cases.map((item) => {
    const source = sourceById.get(item.case_id);
    const caseValues = values(item);
    return { source: `${source?.source_sheet ?? item.source_sheet}!${source?.source_row ?? 0}`, source_sheet: source?.source_sheet ?? item.source_sheet, source_row: source?.source_row ?? 0, columns: COLUMNS, raw_values: COLUMNS.map((column) => caseValues[column] ?? "") };
  });
  const packageStat = await stat(file);
  const caseSet: NormalizedCaseSet = {
    columns: COLUMNS,
    cases: loaded.contract.cases.map((item, index) => {
      const caseValues = values(item);
      const row = rows[index]!;
      return { id: item.case_id, values: caseValues, raw_values: row.raw_values, source: row.source, source_sheet: row.source_sheet, source_row: row.source_row, divider: false, extensions: {}, original_status: "", status: "" as never };
    }),
    source_snapshot: { absolute_path: path.resolve(file), sha256: loaded.manifest.source_sha256[path.basename(loaded.manifest.source_files[0]!) ]!, size: packageStat.size, modified_at: new Date(packageStat.mtimeMs).toISOString(), input_kind: "execution-package", sheet_names: loaded.manifest.source_sheet_names, rows },
    skill_invocation: { primary: "web-api-test-execution-evidence", secondary: "test-case-execution-compiler", roles: "environment_binding_only" },
  };
  return { ...loaded, caseSet };
}
