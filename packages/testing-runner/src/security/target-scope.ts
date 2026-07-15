import type { ExecutionTarget } from "../types.js";

export function normalizeTargetOrigins(targets: Record<string, ExecutionTarget>): string[] {
  const origins = Object.values(targets).flatMap((target) => {
    if (target.kind === "database") return [];
    return [normalizeHttpOrigin(target.origin)];
  });
  return [...new Set(origins)].sort();
}

export function normalizeHttpOrigin(origin: string): string {
  const url = new URL(origin);
  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.pathname = "";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}
