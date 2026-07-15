import { mkdir } from "node:fs/promises";
import path from "node:path";

import { chromium, type Browser, type LaunchOptions, type Page } from "playwright";

import type { RunManifest } from "../types.js";

export type BrowserVisibility = "auto" | "visible" | "headless";

export interface BrowserSettingsInput {
  mode: "interactive" | "ci";
  visibility?: BrowserVisibility;
  slowMo?: number;
}

export interface BrowserSessionOptions extends BrowserSettingsInput {
  manifest: RunManifest;
  outputDir: string;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
}

export interface BrowserSession {
  page: Page;
  close(): Promise<void>;
}

function configurationError(message: string): Error {
  const error = new Error("browser_configuration_invalid: " + message);
  error.name = "BrowserConfigurationError";
  return error;
}

export function resolveBrowserSettings(input: BrowserSettingsInput): {
  headless: boolean;
  slowMo: number;
} {
  const visibility = input.visibility ?? "auto";
  if (!["auto", "visible", "headless"].includes(visibility)) {
    throw configurationError("browser must be auto, visible, or headless");
  }
  if (input.mode === "ci") {
    return { headless: true, slowMo: 0 };
  }
  if (input.mode !== "interactive") {
    throw configurationError("mode must be interactive or ci");
  }

  const headless = visibility === "headless";
  const slowMo = input.slowMo ?? (headless ? 0 : 200);
  if (!Number.isSafeInteger(slowMo) || slowMo < 0 || slowMo > 5000) {
    throw configurationError("slow-mo must be an integer from 0 to 5000");
  }
  return { headless, slowMo: headless ? 0 : slowMo };
}

export function hasWebActions(manifest: RunManifest): boolean {
  return manifest.cases.some((item) =>
    item.steps.some((action) => action.type.startsWith("web.") || action.type === "cleanup.web")
  );
}

export async function openBrowserSession(
  options: BrowserSessionOptions,
): Promise<BrowserSession | undefined> {
  if (!hasWebActions(options.manifest)) return undefined;

  const settings = resolveBrowserSettings(options);
  const launchBrowser = options.launchBrowser ?? ((launchOptions) => chromium.launch(launchOptions));
  let browser: Browser;
  try {
    browser = await launchBrowser(settings);
  } catch (error) {
    if (!settings.headless) {
      const visibleError = new Error(
        "browser_visible_launch_failed: "
        + (error instanceof Error ? error.message : String(error)),
      );
      visibleError.name = "VisibleBrowserLaunchError";
      throw visibleError;
    }
    throw error;
  }

  const context = await browser.newContext();
  await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
  const page = await context.newPage();
  let closed = false;

  return {
    page,
    close: async () => {
      if (closed) return;
      closed = true;
      const evidenceDir = path.join(options.outputDir, "evidence");
      await mkdir(evidenceDir, { recursive: true });
      let traceError;
      try {
        await context.tracing.stop({
          path: path.join(evidenceDir, "playwright-trace.zip"),
        });
      } catch (error) {
        traceError = error;
      }
      try {
        await context.close();
      } finally {
        await browser.close();
      }
      if (traceError) throw traceError;
    },
  };
}

