export interface RunnerError {
  kind: string;
}

export interface RetryDecision {
  retry: boolean;
  max_attempts: 2;
}

const TRANSIENT_FAILURES = new Set([
  "page_load_timeout",
  "network_reset",
  "browser_crash",
  "service_unavailable",
]);

export function retryDecision(error: RunnerError, attempt: number): RetryDecision {
  return {
    retry: attempt === 1 && TRANSIENT_FAILURES.has(error.kind),
    max_attempts: 2,
  };
}
