import type { NormalizedCaseSet, OriginalSourceRow, TenColumnName } from "../types.js";
import { TEN_COLUMNS } from "./detect-input.js";
import type { MappingApproval, MappingColumnRule } from "./mapping-approval.js";
import {
  MAX_SPLIT_INPUT_LENGTH,
  MAX_SPLIT_SEPARATOR_LENGTH,
  buildMappingProposal,
  calculateProposalSha256,
  canonicalize,
  inspectNonstandardWorkbook,
  splitValue,
  type MappingProposal,
} from "./mapping-proposal.js";
import { normalizeSourceRows, type SourceRow } from "./report-reader.js";

export { MAX_SPLIT_INPUT_LENGTH, MAX_SPLIT_SEPARATOR_LENGTH } from "./mapping-proposal.js";

function text(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return text(value.result);
    if ("text" in value) return text(value.text);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) =>
        typeof part === "object" && part !== null && "text" in part ? text(part.text) : "",
      ).join("");
    }
  }
  return String(value);
}

function sourceKey(rule: MappingColumnRule): string {
  return `${rule.source_sheet}\u0000${rule.source_column_index}`;
}

function targetFields(rule: MappingColumnRule): TenColumnName[] {
  return rule.kind === "direct" ? [rule.target_field] : [...rule.split_rule.targets];
}

function validateColumnRules(proposal: MappingProposal, approval: MappingApproval): void {
  const proposalColumns = new Map(
    proposal.columns.map((column) => [
      `${column.source_sheet}\u0000${column.source_column_index}`,
      column,
    ]),
  );
  const rulesBySource = new Map<string, MappingColumnRule[]>();
  const sourcesBySheetTarget = new Map<string, string[]>();
  const unpreviewedDirectRules: MappingColumnRule[] = [];
  const unpreviewedSplitRules: MappingColumnRule[] = [];
  for (const rule of approval.column_rules) {
    const proposedColumn = proposalColumns.get(sourceKey(rule));
    if (!proposedColumn || proposedColumn.source_column !== rule.source_column) {
      throw new Error(`审批引用了提案中不存在的源列：${rule.source_sheet}.${rule.source_column}`);
    }
    if (rule.kind === "direct" && (
      proposedColumn.suggested_rule?.kind !== "direct" ||
      canonicalize(proposedColumn.suggested_rule) !== canonicalize(rule)
    )) {
      unpreviewedDirectRules.push(rule);
    }
    const rules = rulesBySource.get(sourceKey(rule)) ?? [];
    rules.push(rule);
    rulesBySource.set(sourceKey(rule), rules);
    for (const target of targetFields(rule)) {
      const targetKey = `${rule.source_sheet}\u0000${target}`;
      const sources = sourcesBySheetTarget.get(targetKey) ?? [];
      sources.push(sourceKey(rule));
      sourcesBySheetTarget.set(targetKey, sources);
    }
    if (rule.kind === "split") {
      if (proposedColumn.suggested_rule?.kind !== "split" ||
          canonicalize(proposedColumn.suggested_rule) !== canonicalize(rule)) {
        unpreviewedSplitRules.push(rule);
      }
      const wasPreviewed = proposal.split_previews.some((preview) =>
        preview.source_sheet === rule.source_sheet &&
        preview.source_column === rule.source_column &&
        preview.source_column_index === rule.source_column_index &&
        canonicalize(preview.split_rule) === canonicalize(rule.split_rule),
      );
      if (!wasPreviewed) unpreviewedSplitRules.push(rule);
    }
  }
  for (const rules of rulesBySource.values()) {
    const distinctTargets = new Set(rules.flatMap(targetFields));
    if (rules.length > 1 || distinctTargets.size !== targetFields(rules[0]!).length) {
      throw new Error(`同一源列映射到冲突目标：${rules[0]!.source_sheet}.${rules[0]!.source_column}`);
    }
  }
  for (const [key, sources] of sourcesBySheetTarget) {
    if (new Set(sources).size > 1) {
      const [sheet, target] = key.split("\u0000");
      throw new Error(`多个源列重复映射到 ${sheet}.${target}`);
    }
  }
  if (unpreviewedDirectRules.length > 0) {
    const rule = unpreviewedDirectRules[0]!;
    throw new Error(`直接映射规则未在提案中预览：${rule.source_sheet}.${rule.source_column}`);
  }
  if (unpreviewedSplitRules.length > 0) {
    const rule = unpreviewedSplitRules[0]!;
    throw new Error(`拆分规则未在提案中预览：${rule.source_sheet}.${rule.source_column}`);
  }

  const sheets = new Set(approval.column_rules.map(({ source_sheet }) => source_sheet));
  if (sheets.size === 0) throw new Error("测试步骤和预期结果字段缺失：没有确认任何映射");
  for (const sheet of sheets) {
    const covered = new Set(
      approval.column_rules
        .filter(({ source_sheet }) => source_sheet === sheet)
        .flatMap(targetFields),
    );
    if (!covered.has("测试步骤") || !covered.has("预期结果")) {
      throw new Error(`测试步骤和预期结果字段缺失：${sheet}`);
    }
  }
  const proposalRules = proposal.columns.flatMap(({ suggested_rule }) =>
    suggested_rule === null ? [] : [suggested_rule],
  );
  if (canonicalize(approval.column_rules) !== canonicalize(proposalRules)) {
    throw new Error("审批字段规则与提案不完全一致，必须重新生成预览和提案哈希");
  }
}

function validateApproval(proposal: MappingProposal, approval?: MappingApproval): MappingApproval {
  if (!approval) throw new Error("非标准 Excel 必须确认字段映射后才能标准化");
  if (calculateProposalSha256(proposal) !== proposal.proposal_sha256) {
    throw new Error("映射提案已变更，原审批失效");
  }
  if (approval.source_sha256 !== proposal.source_snapshot.sha256) {
    throw new Error("源文件哈希不匹配，原审批失效");
  }
  if (approval.proposal_sha256 !== proposal.proposal_sha256) {
    throw new Error("映射提案哈希不匹配，原审批失效");
  }
  if (approval.confirmed_at.trim() === "" || approval.confirmed_by.trim() === "") {
    throw new Error("映射审批必须包含确认时间和确认人");
  }
  validateColumnRules(proposal, approval);
  return approval;
}

interface PreparedRow {
  original: OriginalSourceRow;
  normalized: SourceRow;
  extensions: Record<string, string>;
}

function prepareRows(proposal: MappingProposal, approval: MappingApproval): PreparedRow[] {
  const rulesBySheet = new Map<string, MappingColumnRule[]>();
  for (const rule of approval.column_rules) {
    const rules = rulesBySheet.get(rule.source_sheet) ?? [];
    rules.push(rule);
    rulesBySheet.set(rule.source_sheet, rules);
  }
  const extensionsBySheet = new Map<string, MappingProposal["extension_columns"]>();
  for (const descriptor of proposal.extension_columns) {
    const descriptors = extensionsBySheet.get(descriptor.source_sheet) ?? [];
    descriptors.push(descriptor);
    extensionsBySheet.set(descriptor.source_sheet, descriptors);
  }
  const prepared: PreparedRow[] = [];
  for (const original of proposal.source_snapshot.rows) {
    const rules = rulesBySheet.get(original.source_sheet);
    if (!rules) continue;
    const values = TEN_COLUMNS.map(() => "");
    for (const rule of rules) {
      const sourceIndex = rule.source_column_index - 1;
      const value = text(original.raw_values[sourceIndex]);
      if (rule.kind === "direct") {
        values[TEN_COLUMNS.indexOf(rule.target_field)] = value;
      } else {
        const [steps, expected] = splitValue(
          value,
          rule.split_rule.strategy,
          rule.split_rule.separator,
          original.source,
        );
        if (steps === "" || expected === "") {
          throw new Error(`测试步骤或预期结果为空，阻止执行：${original.source}`);
        }
        values[TEN_COLUMNS.indexOf("测试步骤")] = steps;
        values[TEN_COLUMNS.indexOf("预期结果")] = expected;
      }
    }
    if (values[TEN_COLUMNS.indexOf("测试步骤")]!.trim() === "" ||
        values[TEN_COLUMNS.indexOf("预期结果")]!.trim() === "") {
      throw new Error(`测试步骤或预期结果为空，阻止执行：${original.source}`);
    }
    if (values[0]!.trim() === "") {
      values[0] = `EXT-${proposal.source_snapshot.sha256.slice(0, 8)}-${String(original.source_row).padStart(6, "0")}`;
    }
    const extensions: Record<string, string> = {};
    for (const descriptor of extensionsBySheet.get(original.source_sheet) ?? []) {
      extensions[descriptor.extension_key] = text(
        original.raw_values[descriptor.source_column_index - 1],
      );
    }
    prepared.push({
      original,
      normalized: {
        sheet: original.source_sheet,
        row: original.source_row,
        values,
      },
      extensions,
    });
  }
  return prepared;
}

export async function applyConfirmedMapping(
  proposal: MappingProposal,
  unvalidatedApproval?: MappingApproval,
): Promise<NormalizedCaseSet> {
  if (!unvalidatedApproval) throw new Error("非标准 Excel 必须确认字段映射后才能标准化");
  if (calculateProposalSha256(proposal) !== proposal.proposal_sha256) {
    throw new Error("映射提案已变更，原审批失效");
  }
  const currentInspection = await inspectNonstandardWorkbook(proposal.source_snapshot.absolute_path);
  if (currentInspection.source_snapshot.sha256 !== proposal.source_snapshot.sha256) {
    throw new Error("源文件已变更，原审批失效");
  }
  const proposalRules = proposal.columns.flatMap(({ suggested_rule }) =>
    suggested_rule === null ? [] : [structuredClone(suggested_rule)],
  );
  const rebuiltProposal = buildMappingProposal(currentInspection, proposalRules);
  if (canonicalize(rebuiltProposal) !== canonicalize(proposal)) {
    throw new Error("映射提案派生内容与规则不一致，必须重新生成预览和提案哈希");
  }
  const approval = validateApproval(proposal, unvalidatedApproval);
  const prepared = prepareRows(proposal, approval);
  const cases = normalizeSourceRows(prepared.map(({ normalized }) => normalized));
  cases.forEach((item, index) => {
    item.raw_values = [...prepared[index]!.original.raw_values];
    item.extensions = prepared[index]!.extensions;
  });
  return {
    columns: [...TEN_COLUMNS],
    cases,
    source_snapshot: proposal.source_snapshot,
    normalization_metadata: {
      mapping: {
        source_sha256: approval.source_sha256,
        proposal_sha256: approval.proposal_sha256,
        confirmed_at: approval.confirmed_at,
        confirmed_by: approval.confirmed_by,
        column_rules: structuredClone(approval.column_rules),
        split_rule_versions: approval.column_rules.flatMap((rule) =>
          rule.kind === "split" ? [rule.split_rule.version] : [],
        ),
      },
    },
  };
}
