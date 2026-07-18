import { mkdir } from "node:fs/promises";
import path from "node:path";

import {
  chromium,
  type Browser,
  type BrowserContext,
  type LaunchOptions,
  type Page,
} from "playwright";

import type { RunManifest } from "../types.js";
import type { RunObserver } from "./run-orchestrator.js";
import type { DeliverySummary } from "./visual-progress-model.js";
import {
  VisualProgressController,
  type ProgressVisibility,
} from "./visual-progress.js";

export type BrowserVisibility = "auto" | "visible" | "headless";

export interface BrowserSettingsInput {
  mode: "interactive" | "ci";
  visibility?: BrowserVisibility;
  slowMo?: number;
}

export interface BrowserSessionOptions extends BrowserSettingsInput {
  manifest: RunManifest;
  outputDir: string;
  progress?: ProgressVisibility;
  allowedNetworkOrigin?: string;
  launchBrowser?: (options: LaunchOptions) => Promise<Browser>;
}

export interface BrowserSession {
  page: Page;
  observer?: RunObserver;
  prepareCase(caseId: string): Promise<Page>;
  finalizeTrace(): Promise<string | undefined>;
  finalizeTraces(): Promise<string[]>;
  showDeliveryResult(summary: DeliverySummary): Promise<void>;
  completionPause(): Promise<void>;
  close(): Promise<void>;
}

function configurationError(message: string): Error {
  const error = new Error("browser_configuration_invalid: " + message);
  error.name = "BrowserConfigurationError";
  return error;
}

function smokeNetworkOrigin(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw configurationError("smoke network origin must be a valid URL");
  }
  if (
    parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.port === ""
    || parsed.origin !== value
  ) {
    throw configurationError("smoke network origin must be an exact http://127.0.0.1:<port> origin");
  }
  return parsed.origin;
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
  const settings = resolveBrowserSettings(options);
  const allowedNetworkOrigin = smokeNetworkOrigin(options.allowedNetworkOrigin);
  const progress = options.progress ?? "auto";
  if (!(["auto", "off"] as string[]).includes(progress)) {
    throw configurationError("progress must be auto or off");
  }
  const webActions = hasWebActions(options.manifest);
  const showProgress = progress === "auto" && options.mode === "interactive" && !settings.headless;
  if (!webActions && !showProgress) return undefined;

  const launchBrowser = options.launchBrowser ?? ((launchOptions) => chromium.launch(launchOptions));
  let browser: Browser;
  try {
    browser = await launchBrowser(settings.headless
      ? settings
      : { ...settings, args: ["--start-maximized"] });
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

  let context: BrowserContext | undefined;
  let page: Page;
  const blockedRequests = new Set<string>();
  const tracePaths: string[] = [];
  const contextOptions = settings.headless ? undefined : { viewport: null };
  const initializeContext = async (browserContext: BrowserContext): Promise<Page> => {
    if (allowedNetworkOrigin) {
      await browserContext.route("**/*", async (route) => {
        const requestUrl = route.request().url();
        let origin = "";
        try {
          origin = new URL(requestUrl).origin;
        } catch {
          // Non-URL requests are outside the locked smoke origin.
        }
        if (origin === allowedNetworkOrigin) {
          await route.continue();
          return;
        }
        blockedRequests.add(requestUrl);
        await route.abort("blockedbyclient");
      });
    }
    await browserContext.tracing.start({ screenshots: true, snapshots: true, sources: true });
    return browserContext.newPage();
  };
  try {
    context = await browser.newContext(contextOptions);
    page = await initializeContext(context);
    if (!webActions) {
      await page.setContent("<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><title>Web/API 测试执行</title></head><body></body></html>");
    }
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    if (context) {
      try {
        await context.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    try {
      await browser.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "browser_setup_failed: " + (error instanceof Error ? error.message : String(error)),
      );
    }
    throw error;
  }
  if (!context) throw new Error("browser context was not initialized");
  let activeContext: BrowserContext = context;
  let closed = false;
  let tracePromise: Promise<string | undefined> | undefined;
  let currentCaseId: string | undefined;
  const progressController = showProgress
    ? new VisualProgressController(page, !webActions, settings.slowMo)
    : undefined;

  const finalizeTrace = (): Promise<string | undefined> => {
    if (tracePromise) return tracePromise;
    tracePromise = (async () => {
      const evidenceDir = currentCaseId
        ? path.join(options.outputDir, "evidence", currentCaseId)
        : path.join(options.outputDir, "evidence");
      await mkdir(evidenceDir, { recursive: true });
      const tracePath = path.join(evidenceDir, "playwright-trace.zip");
      await activeContext.tracing.stop({ path: tracePath });
      if (!tracePaths.includes(tracePath)) tracePaths.push(tracePath);
      if (blockedRequests.size > 0) {
        const error = new Error(`smoke_external_request: ${[...blockedRequests].sort().join(", ")}`);
        error.name = "SmokeExternalRequestError";
        throw error;
      }
      return tracePath;
    })();
    return tracePromise;
  };

  const session: BrowserSession = {
    page,
    prepareCase: async (caseId) => {
      if (closed) throw new Error("browser session is closed");
      if (currentCaseId === undefined) {
        currentCaseId = caseId;
        return page;
      }
      if (currentCaseId === caseId) return page;
      await finalizeTrace();
      await activeContext.close();
      activeContext = await browser.newContext(contextOptions);
      page = await initializeContext(activeContext);
      currentCaseId = caseId;
      tracePromise = undefined;
      session.page = page;
      return page;
    },
    finalizeTrace,
    finalizeTraces: async () => {
      await finalizeTrace();
      return [...tracePaths];
    },
    showDeliveryResult: async (summary) => {
      if (progressController) await progressController.showDeliveryResult(summary);
    },
    completionPause: async () => {
      if (progressController) await progressController.completionPause();
    },
    close: async () => {
      if (closed) return;
      closed = true;
      let traceError;
      try {
        await finalizeTrace();
      } catch (error) {
        traceError = error;
      }
      try {
        await activeContext.close();
      } finally {
        await browser.close();
      }
      if (traceError) throw traceError;
    },
  };
  if (progressController) session.observer = progressController;
  return session;
}
