import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "playwright";

import type { ManifestAction } from "../types.js";
import type {
  ActionCompletedEvent,
  ActionStartedEvent,
  CaseCompletedEvent,
  CaseStartedEvent,
  RunCompletedEvent,
  RunObserver,
  RunStartedEvent,
} from "./run-orchestrator.js";
import {
  countsFromResult,
  createInitialVisualProgressState,
  type VisualActionStatus,
  type VisualProgressState,
} from "./visual-progress-model.js";

export {
  createInitialVisualProgressState,
  type PanelSide,
  type PresentationPhase,
  type PresentationView,
  type VisualActionStatus,
  type VisualProgressState,
} from "./visual-progress-model.js";

interface ProgressHostElement {
  id: string;
  dataset: Record<string, string | undefined>;
  style: { cssText: string };
  remove(): void;
  attachShadow(options: { mode: "closed" }): { innerHTML: string };
}

declare const document: {
  getElementById(id: string): ProgressHostElement | null;
  createElement(tag: "div"): ProgressHostElement;
  documentElement: { append(element: ProgressHostElement): void };
};

export type ProgressVisibility = "auto" | "off";
export const VISUAL_PROGRESS_HOST_ID = "testing-runner-visual-progress";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function elapsedLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

export function summarizeProgressAction(action: ManifestAction): string {
  if (action.type === "api.request" || action.type === "api.concurrent" || action.type === "cleanup.api") {
    return `${action.method} ${action.path}`;
  }
  if (action.type === "api.assert" || action.type === "web.assert") return action.assertion;
  if (action.type === "api.extract") return `${action.from} → ${action.as}`;
  if (action.type === "web.goto") return action.url;
  if (action.type === "web.fill" || action.type === "web.click" || action.type === "web.select" || action.type === "cleanup.web") {
    return action.locator;
  }
  if (action.type === "web.wait") return action.condition;
  if (action.type === "db.select") return "只读数据库校验";
  if (action.type === "execution.blocked") return action.reason;
  return "未知动作";
}

function phaseLabel(phase: VisualProgressState["phase"]): string {
  if (phase === "preflight") return "执行准备";
  if (phase === "case-preview") return "用例预告";
  if (phase === "collecting") return "证据收集";
  if (phase === "results") return "结果中心";
  return "正在执行";
}

export function renderVisualProgressHtml(state: VisualProgressState): string {
  const actionFinished = ["通过", "不通过", "待定", "未执行"].includes(state.actionStatus);
  const completedCases = state.phase === "results"
    ? state.caseTotal
    : Math.max(0, state.caseIndex - (actionFinished ? 0 : 1));
  const progress = state.caseTotal === 0
    ? 0
    : Math.min(100, Math.round((completedCases / state.caseTotal) * 100));
  const origins = state.origins.length > 0 ? state.origins.join(" · ") : "未声明浏览器目标";
  const safe = (value: string) => escapeHtml(value);
  const phaseContent = state.phase === "preflight"
    ? renderPreflight(state, safe)
    : state.phase === "case-preview"
      ? renderCasePreview(state, safe)
      : state.phase === "collecting"
        ? renderCollecting(state)
        : state.phase === "results"
          ? renderResults(state, safe)
          : renderLiveExecution(state, safe);
  return `
    <style>
      :host { all: initial; color-scheme: light; }
      * { box-sizing: border-box; }
      .shell { width: min(440px, calc(100vw - 32px)); border: 1px solid #35423a; border-radius: 8px; overflow: hidden; background: #1e2721; color: #eef3ef; box-shadow: 0 18px 50px rgba(22, 35, 26, .28); font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif; font-size: 14px; line-height: 1.5; letter-spacing: 0; }
      :host([data-layout="fullscreen"]) .shell, .shell.preflight, .shell.results { width: min(1040px, calc(100vw - 64px)); margin: 5vh auto 0; }
      .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; min-height: 54px; padding: 0 18px; border-bottom: 1px solid #35423a; background: #18201b; }
      .skill { font-size: 13px; font-weight: 700; }
      .phase { padding: 4px 8px; border-radius: 4px; background: #304137; color: #9fd1ad; font-size: 12px; font-weight: 700; }
      .stage-nav { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 1px; background: #35423a; }
      .stage { padding: 8px 5px; background: #242f28; color: #89958d; text-align: center; font-size: 11px; }
      .stage.active { color: #eef3ef; background: #314238; box-shadow: inset 0 -3px #82bc91; }
      .body { padding: 18px; }
      .eyebrow { color: #9aa69e; font-size: 12px; font-weight: 700; }
      .title { margin-top: 4px; font-size: 20px; font-weight: 700; overflow-wrap: anywhere; }
      .subtitle { margin-top: 5px; color: #b6c0b9; overflow-wrap: anywhere; }
      .scope-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1px; margin-top: 18px; background: #3a463e; }
      .scope-item { min-height: 84px; padding: 12px; background: #263129; }
      .scope-item span { display: block; color: #9aa69e; font-size: 11px; }
      .scope-item strong { display: block; margin-top: 5px; font-size: 16px; overflow-wrap: anywhere; }
      .deliverables { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 15px; }
      .deliverable { padding: 6px 9px; border: 1px solid #46544a; border-radius: 4px; color: #dce4de; background: #263129; font-size: 12px; }
      .intent { display: grid; gap: 10px; margin-top: 16px; }
      .intent-row { display: grid; grid-template-columns: 96px 1fr; gap: 12px; padding-top: 10px; border-top: 1px solid #35423a; }
      .intent-row span { color: #9aa69e; }
      .action { margin-top: 14px; padding: 13px; border-left: 3px solid #82bc91; background: #28352d; }
      .action-line { display: flex; justify-content: space-between; gap: 12px; font-weight: 700; }
      .summary { margin-top: 6px; color: #dce4de; overflow-wrap: anywhere; }
      .api-detail { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; align-items: center; margin-top: 10px; }
      .api-detail code, .actual { overflow-wrap: anywhere; color: #eef3ef; }
      .actual { max-height: 112px; margin-top: 10px; overflow: auto; padding: 9px; background: #18201b; font-family: Consolas, monospace; font-size: 11px; }
      .counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 14px; }
      .count { padding: 8px 4px; border: 1px solid #3a463e; border-radius: 4px; text-align: center; }
      .count strong { display: block; font-size: 17px; font-variant-numeric: tabular-nums; }
      .passed strong { color: #92cda2; }
      .failed strong { color: #ee9b93; }
      .pending strong { color: #d8c9a4; }
      .idle strong { color: #9aa69e; }
      .bar { height: 7px; margin-top: 14px; overflow: hidden; border-radius: 4px; background: #3a463e; }
      .bar > span { display: block; width: ${progress}%; height: 100%; background: #82bc91; transition: width .2s ease; }
      .foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: #9aa69e; font-size: 12px; }
      .scope { margin-top: 10px; padding-top: 10px; border-top: 1px solid #35423a; color: #89958d; font-size: 11px; overflow-wrap: anywhere; }
      .collection-list { display: grid; gap: 8px; margin-top: 16px; }
      .collection-row { display: grid; grid-template-columns: 22px 1fr auto; gap: 9px; align-items: center; padding: 9px 0; border-bottom: 1px solid #35423a; }
      .collection-row b { color: #92cda2; }
      .result-grid { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(300px, .85fr); gap: 18px; margin-top: 16px; }
      .status-list, .artifact-list { display: grid; gap: 7px; }
      .status-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 9px 11px; border-radius: 4px; background: #28332c; }
      .status-failed { color: #ffd8d4; background: #56312f; }
      .status-pending { color: #e2e4e1; background: #424743; }
      .status-idle { color: #adb5af; background: #303630; }
      .artifact { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: center; padding: 10px 0; border-bottom: 1px solid #35423a; color: #dce4de; text-decoration: none; }
      .artifact strong { color: #9fd1ad; }
      @media (max-width: 720px) { .scope-grid, .result-grid { grid-template-columns: 1fr; } .stage { font-size: 10px; } .intent-row { grid-template-columns: 1fr; gap: 3px; } }
    </style>
    <section class="shell ${state.phase}" data-phase="${state.phase}" data-view="${state.view}" data-panel-side="${state.panelSide}" aria-label="Web/API 测试执行驾驶舱">
      <div class="header"><span class="skill">web-api-test-execution-evidence</span><span class="phase">${phaseLabel(state.phase)}</span></div>
      ${renderStageNavigation(state.phase)}
      <div class="body">${phaseContent}
        <div class="bar"><span></span></div>
        <div class="foot"><span>总体进度 ${progress}%</span><span>已用时 ${elapsedLabel(state.elapsedMs)}</span></div>
        <div class="scope">manifest ${safe(state.manifestHash.slice(0, 12))} · ${safe(origins)}</div>
      </div>
    </section>`;
}

function renderStageNavigation(active: VisualProgressState["phase"]): string {
  const stages: Array<[VisualProgressState["phase"], string]> = [
    ["preflight", "执行准备"],
    ["case-preview", "用例预告"],
    ["running", "实时执行"],
    ["collecting", "证据收集"],
    ["results", "结果中心"],
  ];
  return `<nav class="stage-nav" aria-label="执行阶段">${stages.map(([phase, label]) =>
    `<span class="stage${phase === active ? " active" : ""}">${label}</span>`).join("")}</nav>`;
}

function renderPreflight(state: VisualProgressState, safe: (value: string) => string): string {
  return `<div class="eyebrow">即将开始真实 Web/API 自动执行</div>
    <div class="title">执行范围和交付物已准备</div>
    <div class="subtitle">确认本次输入后自动开始，不需要再次点击。</div>
    <div class="scope-grid">
      <div class="scope-item"><span>执行输入</span><strong>${safe(state.caseLabel)}</strong></div>
      <div class="scope-item"><span>动作规模</span><strong>${state.actionTotalOverall} 个执行动作</strong></div>
      <div class="scope-item"><span>目标地址</span><strong>${safe(state.origins[0] ?? "未声明")}</strong></div>
    </div>
    <div class="deliverables" aria-label="交付物"><span class="deliverable">Excel</span><span class="deliverable">HTML</span><span class="deliverable">JSON</span><span class="deliverable">截图</span><span class="deliverable">日志</span><span class="deliverable">Trace</span></div>`;
}

function renderCasePreview(state: VisualProgressState, safe: (value: string) => string): string {
  return `<div class="eyebrow">${safe(state.caseLabel)}</div>
    <div class="title">${safe(state.caseId)} · ${safe(state.caseTitle)}</div>
    <div class="subtitle">模块：${safe(state.module)}</div>
    <div class="intent">
      <div class="intent-row"><span>验证什么</span><strong>${safe(state.verificationPoint)}</strong></div>
      <div class="intent-row"><span>执行前提</span><strong>${safe(state.precondition)}</strong></div>
      <div class="intent-row"><span>预期结果</span><strong>${safe(state.expectedResult)}</strong></div>
    </div>`;
}

function renderLiveExecution(state: VisualProgressState, safe: (value: string) => string): string {
  const detail = state.actionPresentation;
  const api = detail && state.view === "api"
    ? `<div class="api-detail"><strong>${safe(detail.method ?? "API")}</strong><code>${safe(detail.path ?? detail.summary)}</code><span>${detail.responseStatus === undefined ? "等待响应" : `HTTP ${detail.responseStatus}`}</span></div>
       ${detail.expected ? `<div class="intent-row"><span>预期 / 断言</span><strong>${safe(detail.expected)}</strong></div>` : ""}
       ${detail.actual ? `<div class="actual">${safe(detail.actual)}</div>` : ""}`
    : "";
  return `<div class="eyebrow">${safe(state.caseLabel)}</div>
    <div class="title">${safe(state.caseId)} · ${safe(state.caseTitle)}</div>
    <div class="subtitle">${safe(state.verificationPoint)}</div>
    <div class="action"><div class="action-line"><span>动作 ${state.actionIndex} / ${state.actionTotal} · ${safe(state.actionType)}</span><span>${safe(state.actionStatus)}</span></div><div class="summary">${safe(state.actionSummary)}</div>${api}</div>
    ${renderCounts(state)}`;
}

function renderCollecting(state: VisualProgressState): string {
  return `<div class="eyebrow">业务动作已经执行完成</div><div class="title">正在整理可核验的交付证据</div><div class="subtitle">执行完成不等于交付完成，全部产物通过一致性校验后才进入结果中心。</div>
    <div class="collection-list"><div class="collection-row"><b>✓</b><span>测试用例（Test Cases）状态已锁定</span><strong>完成</strong></div><div class="collection-row"><b>✓</b><span>Web 截图与 API 请求响应</span><strong>整理中</strong></div><div class="collection-row"><b>✓</b><span>Excel / HTML / JSON 一致性</span><strong>校验中</strong></div><div class="collection-row"><b>✓</b><span>日志与 Playwright Trace</span><strong>写入中</strong></div></div>${renderCounts(state)}`;
}

function renderResults(state: VisualProgressState, safe: (value: string) => string): string {
  const statusClass: Record<string, string> = {
    "通过": "status-passed",
    "不通过": "status-failed",
    "待定": "status-pending",
    "未执行": "status-idle",
  };
  const rows = state.resultCases.map((item) => `<div data-case-status="${item.case_status}" class="status-row ${statusClass[item.case_status]}"><strong>${safe(item.case_id)}</strong><span>${item.case_status}</span></div>`).join("");
  const artifacts = state.artifacts.map((artifact) => artifact.exists
    ? `<a class="artifact" href="${safe(artifact.href)}"><span>${safe(artifact.label)}</span><strong>${safe(artifact.fileName)}</strong></a>`
    : `<div class="artifact"><span>${safe(artifact.label)}</span><strong>未生成</strong></div>`).join("");
  return `<div class="eyebrow">真实执行与证据整理已结束</div><div class="title">结果中心</div><div class="subtitle">四状态、缺陷根因与报告产物均来自同一份 run-result.json。</div>${renderCounts(state)}
    <div class="result-grid"><div><div class="eyebrow">测试用例（Test Cases）</div><div class="status-list">${rows}</div></div><div><div class="eyebrow">可验收产物</div><div class="artifact-list">${artifacts}</div></div></div>`;
}

function renderCounts(state: VisualProgressState): string {
  return `<div class="counts"><div class="count passed"><strong>${state.counts["通过"]}</strong>通过</div><div class="count failed"><strong>${state.counts["不通过"]}</strong>不通过</div><div class="count pending"><strong>${state.counts["待定"]}</strong>待定</div><div class="count idle"><strong>${state.counts["未执行"]}</strong>未执行</div></div>`;
}

function visualStatus(status: string): VisualActionStatus {
  if (status === "passed") return "通过";
  if (status === "pending") return "待定";
  if (status === "failed") return "不通过";
  return "未执行";
}

function outcomeStatus(outcome: ActionCompletedEvent["outcome"]): string | undefined {
  const actual = outcome.actual;
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return undefined;
  const status = (actual as Record<string, unknown>).status;
  return typeof status === "number" ? String(status) : undefined;
}

export class VisualProgressController implements RunObserver {
  private readonly startedAt = Date.now();
  private state = createInitialVisualProgressState({ manifestHash: "", origins: [], caseTotal: 0 });

  constructor(
    private readonly page: Page,
    private readonly fullscreen: boolean,
    private readonly actionResultPauseMs = 0,
    private readonly pause: (milliseconds: number) => Promise<void> = delay,
  ) {}

  private async render(): Promise<void> {
    this.state.elapsedMs = Date.now() - this.startedAt;
    await this.page.evaluate(({ hostId, html, fullscreen }) => {
      document.getElementById(hostId)?.remove();
      const host = document.createElement("div");
      host.id = hostId;
      host.dataset.layout = fullscreen ? "fullscreen" : "overlay";
      host.style.cssText = fullscreen
        ? "position:fixed;inset:0;z-index:2147483647;pointer-events:none;background:#f2f4f7"
        : "position:fixed;top:18px;right:18px;z-index:2147483647;pointer-events:none";
      const root = host.attachShadow({ mode: "closed" });
      root.innerHTML = html;
      document.documentElement.append(host);
    }, { hostId: VISUAL_PROGRESS_HOST_ID, html: renderVisualProgressHtml(this.state), fullscreen: this.fullscreen });
  }

  async runStarted(event: RunStartedEvent): Promise<void> {
    this.state = createInitialVisualProgressState({
      manifestHash: event.manifest_hash,
      origins: event.manifest.targets ?? [],
      caseTotal: event.case_total,
      actionTotal: event.action_total,
    });
    this.state.phase = "running";
    await this.render();
  }

  async caseStarted(event: CaseStartedEvent): Promise<void> {
    this.state.phase = "case-preview";
    this.state.caseIndex = event.case_index;
    this.state.caseLabel = `第 ${event.case_index} / ${event.case_total} 条测试用例（Test Case）`;
    this.state.caseId = event.item.case_id;
    this.state.caseTitle = event.item.original["用例标题"];
    this.state.module = event.item.original["所属模块"];
    this.state.actionIndex = 0;
    this.state.actionTotal = event.action_total;
    this.state.actionType = "准备用例";
    this.state.actionSummary = event.item.original["验证功能点"];
    this.state.actionStatus = "准备";
    await this.render();
  }

  async actionStarted(event: ActionStartedEvent): Promise<void> {
    this.state.phase = "running";
    this.state.actionIndex = event.action_index;
    this.state.actionTotal = event.action_total;
    this.state.actionType = event.action.type;
    this.state.actionSummary = summarizeProgressAction(event.action);
    this.state.actionStatus = "执行中";
    await this.render();
  }

  async actionCompleted(event: ActionCompletedEvent): Promise<void> {
    this.state.actionStatus = visualStatus(event.outcome.status);
    const responseStatus = outcomeStatus(event.outcome);
    if (responseStatus && (event.action.type === "api.request" || event.action.type === "api.concurrent")) {
      this.state.actionSummary = `${summarizeProgressAction(event.action)} · HTTP ${responseStatus}`;
    }
    await this.render();
    if (this.actionResultPauseMs > 0) await this.pause(this.actionResultPauseMs);
  }

  async caseCompleted(event: CaseCompletedEvent): Promise<void> {
    this.state.counts["未执行"] = Math.max(0, this.state.counts["未执行"] - 1);
    this.state.counts[event.result.case_status] += 1;
    this.state.actionStatus = event.result.case_status;
    await this.render();
  }

  async runCompleted(event: RunCompletedEvent): Promise<void> {
    this.state.phase = "results";
    this.state.caseIndex = event.case_total;
    this.state.counts = countsFromResult(event.result);
    this.state.actionStatus = event.result.run_status === "completed" ? "通过" : "未执行";
    await this.render();
  }

  async completionPause(milliseconds = 2500): Promise<void> {
    await delay(milliseconds);
  }
}
