import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export interface RenderedReportBundle {
  xlsx: string;
  html: string;
  reportId?: string;
}

export interface ReportRenderer {
  renderBoth(data: unknown, outputDir: string, basename: string): Promise<RenderedReportBundle>;
  validateReport(data: unknown): void;
}

function rendererCandidates(): URL[] {
  return [
    new URL("../vendor/test-case-renderer.mjs", import.meta.url),
    new URL("../../vendor/test-case-renderer.mjs", import.meta.url),
    pathToFileURL(path.resolve(process.cwd(), "tooling/test-case-renderer.mjs")),
  ];
}

export async function loadReportRenderer(): Promise<ReportRenderer> {
  for (const candidate of rendererCandidates()) {
    if (!existsSync(candidate)) continue;
    const loaded = await import(candidate.href) as Partial<ReportRenderer>;
    if (typeof loaded.renderBoth === "function" && typeof loaded.validateReport === "function") {
      return loaded as ReportRenderer;
    }
  }

  throw new Error("Cannot locate testing-skills report renderer");
}
