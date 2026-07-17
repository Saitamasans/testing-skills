import { redact } from "../security/redactor.js";
import type { CaseStatus, ManifestAction, RunManifest, RunResult } from "../types.js";
import type { ActionOutcome } from "./execution-context.js";

export type PresentationPhase =
  | "preflight"
  | "case-preview"
  | "running"
  | "collecting"
  | "results";

export type PresentationView = "web" | "api";
export type PanelSide = "left" | "right";
export type VisualActionStatus = "准备" | "执行中" | "通过" | "不通过" | "待定" | "未执行";

export interface DeliveryArtifact {
  kind: "excel" | "html" | "json" | "screenshots" | "logs" | "trace";
  label: string;
  fileName: string;
  href: string;
  exists: boolean;
}

export interface DeliverySummary {
  result: RunResult;
  artifacts: DeliveryArtifact[];
}

export interface VisualActionPresentation {
  category: "web" | "api" | "database" | "cleanup" | "blocked";
  title: string;
  summary: string;
  method?: string;
  path?: string;
  responseStatus?: number;
  expected?: string;
  actual?: string;
  assertionSource?: string;
}

export interface VisualTargetBox {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
}

export interface VisualProgressState {
  phase: PresentationPhase;
  view: PresentationView;
  panelSide: PanelSide;
  manifestHash: string;
  origins: string[];
  caseIndex: number;
  caseTotal: number;
  caseLabel: string;
  caseId: string;
  caseTitle: string;
  module: string;
  verificationPoint: string;
  precondition: string;
  expectedResult: string;
  actionIndex: number;
  actionTotal: number;
  actionTotalOverall: number;
  actionType: string;
  actionSummary: string;
  actionStatus: VisualActionStatus;
  actionPresentation: VisualActionPresentation | undefined;
  targetBox: VisualTargetBox | undefined;
  counts: Record<CaseStatus, number>;
  artifacts: DeliveryArtifact[];
  resultCases: RunResult["cases"];
  elapsedMs: number;
}

export function createInitialVisualProgressState(input: {
  manifestHash: string;
  origins: string[];
  caseTotal: number;
  actionTotal?: number;
}): VisualProgressState {
  return {
    phase: "preflight",
    view: "web",
    panelSide: "right",
    manifestHash: input.manifestHash,
    origins: [...input.origins],
    caseIndex: 0,
    caseTotal: input.caseTotal,
    caseLabel: `${input.caseTotal} 条测试用例（Test Cases）`,
    caseId: "等待开始",
    caseTitle: "正在准备执行材料",
    module: "-",
    verificationPoint: "确认测试范围、目标地址和执行产物",
    precondition: "执行清单与审批文件已锁定",
    expectedResult: "准备完成后自动开始真实执行",
    actionIndex: 0,
    actionTotal: 0,
    actionTotalOverall: input.actionTotal ?? 0,
    actionType: "preflight",
    actionSummary: "锁定执行清单与目标范围",
    actionStatus: "准备",
    actionPresentation: undefined,
    targetBox: undefined,
    counts: { "通过": 0, "不通过": 0, "待定": 0, "未执行": input.caseTotal },
    artifacts: [],
    resultCases: [],
    elapsedMs: 0,
  };
}

export function casePreviewState(
  state: VisualProgressState,
  item: RunManifest["cases"][number],
  caseIndex: number,
): VisualProgressState {
  return {
    ...state,
    phase: "case-preview",
    caseIndex,
    caseLabel: `第 ${caseIndex} / ${state.caseTotal} 条测试用例（Test Case）`,
    caseId: item.case_id,
    caseTitle: item.original["用例标题"],
    module: item.original["所属模块"],
    verificationPoint: item.original["验证功能点"],
    precondition: item.original["前置条件"],
    expectedResult: item.original["预期结果"],
    actionIndex: 0,
    actionTotal: item.steps.length,
    actionType: "case-preview",
    actionSummary: item.original["验证功能点"],
    actionStatus: "准备",
    actionPresentation: undefined,
    targetBox: undefined,
  };
}

export function actionStartedState(
  state: VisualProgressState,
  action: ManifestAction,
  actionIndex = state.actionIndex + 1,
): VisualProgressState {
  return {
    ...state,
    phase: "running",
    view: action.type.startsWith("web.") || action.type === "cleanup.web" ? "web" : "api",
    actionIndex,
    actionType: action.type,
    actionSummary: actionPresentation(action).summary,
    actionStatus: "执行中",
    actionPresentation: actionPresentation(action),
    targetBox: undefined,
  };
}

export function actionCompletedState(
  state: VisualProgressState,
  action: ManifestAction,
  outcome: ActionOutcome,
): VisualProgressState {
  return {
    ...state,
    actionStatus: visualStatus(outcome.status),
    actionPresentation: actionPresentation(action, outcome),
  };
}

export function collectingState(state: VisualProgressState, result: RunResult): VisualProgressState {
  return {
    ...state,
    phase: "collecting",
    counts: countsFromResult(result),
    resultCases: [...result.cases],
    actionType: "evidence.collect",
    actionSummary: "正在保存截图、请求响应、日志、Trace 与回填报告",
    actionStatus: "执行中",
    targetBox: undefined,
  };
}

export function resultsState(state: VisualProgressState, summary: DeliverySummary): VisualProgressState {
  return {
    ...state,
    phase: "results",
    caseIndex: state.caseTotal,
    counts: countsFromResult(summary.result),
    resultCases: [...summary.result.cases],
    artifacts: summary.artifacts.map((artifact) => ({ ...artifact })),
    actionType: "delivery.complete",
    actionSummary: "执行证据和报告已完成一致性校验",
    actionStatus: summary.result.run_status === "completed" ? "通过" : "未执行",
    targetBox: undefined,
  };
}

export function actionPresentation(
  action: ManifestAction,
  outcome?: ActionOutcome,
): VisualActionPresentation {
  const category = actionCategory(action);
  const presentation: VisualActionPresentation = {
    category,
    title: actionTitle(action),
    summary: actionSummary(action),
  };
  if ("method" in action) presentation.method = action.method;
  if ("path" in action) presentation.path = action.path;
  if ("assertion" in action) {
    presentation.expected = action.assertion;
    presentation.assertionSource = "测试用例（Test Case）预期结果";
  }
  if (outcome?.actual !== undefined) {
    const safeActual = redact(outcome.actual);
    presentation.actual = boundedText(safeActual);
    const status = responseStatus(safeActual);
    if (status !== undefined) presentation.responseStatus = status;
    const expected = assertionExpected(safeActual);
    if (expected !== undefined) presentation.expected = boundedText(expected);
  }
  return presentation;
}

function actionCategory(action: ManifestAction): VisualActionPresentation["category"] {
  if (action.type === "execution.blocked") return "blocked";
  if (action.type.startsWith("cleanup.")) return "cleanup";
  if (action.type.startsWith("web.")) return "web";
  if (action.type.startsWith("api.")) return "api";
  return "database";
}

function actionTitle(action: ManifestAction): string {
  if (action.type === "web.goto") return "打开页面";
  if (action.type === "web.fill") return "填写内容";
  if (action.type === "web.click") return "点击控件";
  if (action.type === "web.select") return "选择选项";
  if (action.type === "web.wait") return "等待页面状态";
  if (action.type === "web.assert" || action.type === "api.assert") return "核对断言";
  if (action.type === "api.request" || action.type === "api.concurrent") return "发送 API 请求";
  if (action.type === "api.extract") return "提取响应变量";
  if (action.type === "db.select") return "只读数据库核对";
  if (action.type.startsWith("cleanup.")) return "清理测试数据";
  return "执行已阻塞";
}

function actionSummary(action: ManifestAction): string {
  if ("method" in action && "path" in action) return `${action.method} ${action.path}`;
  if (action.type === "web.goto") return action.url;
  if (action.type === "web.fill" || action.type === "web.click" || action.type === "web.select" || action.type === "cleanup.web") {
    return action.locator;
  }
  if (action.type === "web.wait") return action.condition;
  if (action.type === "web.assert" || action.type === "api.assert") return action.assertion;
  if (action.type === "api.extract") return `${action.from} → ${action.as}`;
  if (action.type === "db.select") return "只读数据库校验";
  return action.reason;
}

function visualStatus(status: ActionOutcome["status"]): VisualActionStatus {
  if (status === "passed") return "通过";
  if (status === "pending") return "待定";
  if (status === "failed") return "不通过";
  return "未执行";
}

function responseStatus(value: unknown): number | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const response = (value as Record<string, unknown>).response;
  if (!response || typeof response !== "object" || Array.isArray(response)) return undefined;
  const status = (response as Record<string, unknown>).status;
  return typeof status === "number" ? status : undefined;
}

function assertionExpected(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>).expected;
}

function boundedText(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text.length <= 800) return text;
  return `${text.slice(0, 797)}...`;
}

export function countsFromResult(result: RunResult): Record<CaseStatus, number> {
  const counts: Record<CaseStatus, number> = { "通过": 0, "不通过": 0, "待定": 0, "未执行": 0 };
  for (const item of result.cases) counts[item.case_status] += 1;
  return counts;
}
