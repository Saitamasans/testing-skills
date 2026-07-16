import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "playwright";

import type { CaseStatus, ManifestAction, RunResult } from "../types.js";
import type {
  ActionCompletedEvent,
  ActionStartedEvent,
  CaseCompletedEvent,
  CaseStartedEvent,
  RunCompletedEvent,
  RunObserver,
  RunStartedEvent,
} from "./run-orchestrator.js";

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

type VisualActionStatus = "准备" | "执行中" | "通过" | "不通过" | "待定" | "未执行";

export interface VisualProgressState {
  phase: "preparing" | "running" | "completed";
  manifestHash: string;
  origins: string[];
  caseIndex: number;
  caseTotal: number;
  caseId: string;
  caseTitle: string;
  module: string;
  actionIndex: number;
  actionTotal: number;
  actionType: string;
  actionSummary: string;
  actionStatus: VisualActionStatus;
  counts: Record<CaseStatus, number>;
  elapsedMs: number;
}

export function createInitialVisualProgressState(input: {
  manifestHash: string;
  origins: string[];
  caseTotal: number;
}): VisualProgressState {
  return {
    phase: "preparing",
    manifestHash: input.manifestHash,
    origins: [...input.origins],
    caseIndex: 0,
    caseTotal: input.caseTotal,
    caseId: "等待开始",
    caseTitle: "正在准备执行材料",
    module: "-",
    actionIndex: 0,
    actionTotal: 0,
    actionType: "preflight",
    actionSummary: "锁定执行清单与目标范围",
    actionStatus: "准备",
    counts: { "通过": 0, "不通过": 0, "待定": 0, "未执行": input.caseTotal },
    elapsedMs: 0,
  };
}

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
  if (phase === "preparing") return "准备执行";
  if (phase === "completed") return "执行完成";
  return "正在执行";
}

export function renderVisualProgressHtml(state: VisualProgressState): string {
  const actionFinished = ["通过", "不通过", "待定", "未执行"].includes(state.actionStatus);
  const completedCases = state.phase === "completed"
    ? state.caseTotal
    : Math.max(0, state.caseIndex - (actionFinished ? 0 : 1));
  const progress = state.caseTotal === 0
    ? 0
    : Math.min(100, Math.round((completedCases / state.caseTotal) * 100));
  const origins = state.origins.length > 0 ? state.origins.join(" · ") : "未声明浏览器目标";
  const safe = (value: string) => escapeHtml(value);
  return `
    <style>
      :host { all: initial; color-scheme: light; }
      * { box-sizing: border-box; }
      .panel { width: min(440px, calc(100vw - 32px)); padding: 18px; border: 1px solid #c9ced6; border-radius: 8px; background: #ffffff; color: #18202b; box-shadow: 0 14px 36px rgba(16, 24, 40, .20); font-family: "Microsoft YaHei UI", "Segoe UI", sans-serif; font-size: 14px; line-height: 1.45; letter-spacing: 0; }
      :host([data-layout="fullscreen"]) .panel { width: min(920px, calc(100vw - 64px)); margin: 7vh auto 0; padding: 28px; box-shadow: 0 18px 48px rgba(16, 24, 40, .24); }
      .top { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 1px solid #e4e7ec; }
      .skill { font-size: 13px; font-weight: 700; color: #344054; }
      .phase { padding: 4px 8px; border-radius: 4px; background: #e8f1ff; color: #184f90; font-size: 12px; font-weight: 700; }
      .eyebrow { margin-top: 14px; color: #667085; font-size: 12px; font-weight: 700; }
      .title { margin-top: 3px; font-size: 18px; font-weight: 700; overflow-wrap: anywhere; }
      .meta { margin-top: 4px; color: #475467; overflow-wrap: anywhere; }
      .action { margin-top: 14px; padding: 12px; border-left: 4px solid #2563a9; background: #f6f8fb; }
      .action-line { display: flex; justify-content: space-between; gap: 12px; font-weight: 700; }
      .summary { margin-top: 6px; color: #344054; overflow-wrap: anywhere; }
      .counts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 14px; }
      .count { padding: 8px 4px; border: 1px solid #e4e7ec; border-radius: 4px; text-align: center; }
      .count strong { display: block; font-size: 17px; }
      .passed strong { color: #137a4a; }
      .failed strong { color: #b42318; }
      .pending strong { color: #8a4b08; }
      .idle strong { color: #667085; }
      .bar { height: 8px; margin-top: 14px; overflow: hidden; border-radius: 4px; background: #e4e7ec; }
      .bar > span { display: block; width: ${progress}%; height: 100%; background: #2563a9; transition: width .2s ease; }
      .foot { display: flex; justify-content: space-between; gap: 12px; margin-top: 8px; color: #667085; font-size: 12px; }
      .scope { margin-top: 10px; padding-top: 10px; border-top: 1px solid #e4e7ec; color: #667085; font-size: 11px; overflow-wrap: anywhere; }
    </style>
    <section class="panel" aria-label="Web/API 测试执行进度">
      <div class="top"><span class="skill">web-api-test-execution-evidence</span><span class="phase">${phaseLabel(state.phase)}</span></div>
      <div class="eyebrow">测试用例（Test Case） ${state.caseIndex} / ${state.caseTotal}</div>
      <div class="title">${safe(state.caseId)} · ${safe(state.caseTitle)}</div>
      <div class="meta">模块：${safe(state.module)}</div>
      <div class="action">
        <div class="action-line"><span>动作 ${state.actionIndex} / ${state.actionTotal} · ${safe(state.actionType)}</span><span>${safe(state.actionStatus)}</span></div>
        <div class="summary">${safe(state.actionSummary)}</div>
      </div>
      <div class="counts">
        <div class="count passed"><strong>${state.counts["通过"]}</strong>通过</div>
        <div class="count failed"><strong>${state.counts["不通过"]}</strong>不通过</div>
        <div class="count pending"><strong>${state.counts["待定"]}</strong>待定</div>
        <div class="count idle"><strong>${state.counts["未执行"]}</strong>未执行</div>
      </div>
      <div class="bar"><span></span></div>
      <div class="foot"><span>总体进度 ${progress}%</span><span>已用时 ${elapsedLabel(state.elapsedMs)}</span></div>
      <div class="scope">manifest ${safe(state.manifestHash.slice(0, 12))} · ${safe(origins)}</div>
    </section>`;
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
    });
    this.state.phase = "running";
    await this.render();
  }

  async caseStarted(event: CaseStartedEvent): Promise<void> {
    this.state.caseIndex = event.case_index;
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
  }

  async caseCompleted(event: CaseCompletedEvent): Promise<void> {
    this.state.counts["未执行"] = Math.max(0, this.state.counts["未执行"] - 1);
    this.state.counts[event.result.case_status] += 1;
    this.state.actionStatus = event.result.case_status;
    await this.render();
  }

  async runCompleted(event: RunCompletedEvent): Promise<void> {
    this.state.phase = "completed";
    this.state.caseIndex = event.case_total;
    this.state.counts = countsFromResult(event.result);
    this.state.actionStatus = event.result.run_status === "completed" ? "通过" : "未执行";
    await this.render();
  }

  async completionPause(milliseconds = 2500): Promise<void> {
    await delay(milliseconds);
  }
}

function countsFromResult(result: RunResult): Record<CaseStatus, number> {
  const counts: Record<CaseStatus, number> = { "通过": 0, "不通过": 0, "待定": 0, "未执行": 0 };
  for (const item of result.cases) counts[item.case_status] += 1;
  return counts;
}
