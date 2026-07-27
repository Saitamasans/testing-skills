import type { ExecutionTimingPhase, ExecutionTimingStates, ExecutionTimings, TimingState } from "../types.js";

export interface MonotonicClock { now(): number; }
export const systemMonotonicClock: MonotonicClock = { now: () => performance.now() };

export const TIMING_PHASES: readonly ExecutionTimingPhase[] = [
  "package_validation_ms", "contract_loading_ms", "runtime_doctor_ms", "web_discovery_ms",
  "binding_ms", "transition_discovery_ms", "manifest_assembly_ms", "approval_wait_ms",
  "execution_ms", "report_ms",
];

export function emptyExecutionTimings(): ExecutionTimings {
  return Object.fromEntries(TIMING_PHASES.map((phase) => [phase, null])) as ExecutionTimings;
}

export function emptyTimingStates(): ExecutionTimingStates {
  return Object.fromEntries(TIMING_PHASES.map((phase) => [phase, "not_executed" as TimingState])) as ExecutionTimingStates;
}

export class PhaseTimer {
  readonly timings: ExecutionTimings;
  readonly states: ExecutionTimingStates;
  #started = new Map<ExecutionTimingPhase, number>();
  constructor(readonly clock: MonotonicClock = systemMonotonicClock, timings = emptyExecutionTimings(), states = emptyTimingStates()) {
    this.timings = timings;
    this.states = states;
  }
  start(phase: ExecutionTimingPhase): void { this.#started.set(phase, this.clock.now()); this.states[phase] = "running"; }
  finish(phase: ExecutionTimingPhase, state: Exclude<TimingState, "running" | "not_executed"> = "completed"): number {
    const started = this.#started.get(phase);
    if (started === undefined) return 0;
    const elapsed = Math.max(0, this.clock.now() - started);
    this.timings[phase] = elapsed;
    this.states[phase] = state;
    this.#started.delete(phase);
    return elapsed;
  }
  block(phase: ExecutionTimingPhase): void { this.#started.delete(phase); this.timings[phase] = null; this.states[phase] = "blocked"; }
  progress(phase: ExecutionTimingPhase, progress: number, nextStep: string): { phase: ExecutionTimingPhase; progress: number; elapsed_ms: number; next_step: string } {
    const started = this.#started.get(phase);
    const elapsed_ms = started === undefined ? 0 : Math.max(0, this.clock.now() - started);
    return { phase, progress: Math.max(0, Math.min(1, progress)), elapsed_ms, next_step: nextStep.slice(0, 200) };
  }
  elapsed(phase: ExecutionTimingPhase): number { const started = this.#started.get(phase); return started === undefined ? 0 : Math.max(0, this.clock.now() - started); }
}
