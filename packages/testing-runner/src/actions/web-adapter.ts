import {
  ActionExecutionError,
  assertApprovedUrl,
  interpolateActionText,
  resolveDataReference,
  type ActionStepResult,
  type ExecutionContext,
} from "../runtime/execution-context.js";
import type {
  CleanupWebAction,
  WebAssertAction,
  WebClickAction,
  WebFillAction,
  WebGotoAction,
  WebSelectAction,
  WebWaitAction,
} from "../types.js";
import { resolveLocator } from "./locator-resolver.js";
import { VISUAL_PROGRESS_HOST_ID } from "../runtime/visual-progress.js";

type WebExecutableAction =
  | WebGotoAction
  | WebFillAction
  | WebClickAction
  | WebSelectAction
  | WebWaitAction
  | WebAssertAction
  | CleanupWebAction;

export function formalEvidenceScreenshotOptions(): { fullPage: true; style: string } {
  return {
    fullPage: true,
    style: `#${VISUAL_PROGRESS_HOST_ID}{display:none!important}`,
  };
}

function requirePage(context: ExecutionContext) {
  if (!context.page) throw new ActionExecutionError("blocked", "missing_page", "A Playwright Page is required");
  return context.page;
}

async function detectManualAuth(context: ExecutionContext): Promise<ActionStepResult | undefined> {
  const page = requirePage(context);
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/\b(?:MFA|SSO|CAPTCHA|QR scan|Authenticator)\b/i.test(bodyText)) {
    return {
      status: "manual_required",
      actual: { url: page.url(), mode: context.mode },
      error: { type: "manual_auth", message: "Manual SSO/MFA handoff is required" },
    };
  }
  return undefined;
}

async function executeGoto(action: WebGotoAction, context: ExecutionContext): Promise<ActionStepResult> {
  const page = requirePage(context);
  const targetUrl = assertApprovedUrl(context, interpolateActionText(action.url, context));
  const response = await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded" });
  assertApprovedUrl(context, page.url());
  const manual = await detectManualAuth(context);
  if (manual) return manual;
  return {
    status: response && response.status() >= 400 ? "failed" : "passed",
    actual: { url: page.url(), status: response?.status() },
  };
}

async function executeFill(action: WebFillAction, context: ExecutionContext): Promise<ActionStepResult> {
  const page = requirePage(context);
  const locator = await resolveLocator(page, action.locator);
  const value = resolveDataReference(action.value_ref, context);
  await locator.fill(String(value));
  return { status: "passed", actual: { locator: action.locator, filled: true } };
}

async function executeClick(action: WebClickAction | CleanupWebAction, context: ExecutionContext): Promise<ActionStepResult> {
  const page = requirePage(context);
  const locator = await resolveLocator(page, action.locator);
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    locator.click(),
  ]);
  const manual = await detectManualAuth(context);
  if (manual) return manual;
  assertApprovedUrl(context, page.url());
  return { status: "passed", actual: { locator: action.locator } };
}

async function executeSelect(action: WebSelectAction, context: ExecutionContext): Promise<ActionStepResult> {
  const page = requirePage(context);
  const locator = await resolveLocator(page, action.locator);
  await locator.selectOption(action.option);
  return { status: "passed", actual: { locator: action.locator, option: action.option } };
}

async function executeWait(action: WebWaitAction, context: ExecutionContext): Promise<ActionStepResult> {
  const page = requirePage(context);
  const [kind, value = ""] = action.condition.split(/:(.*)/s);
  if (kind === "visible") await (await resolveLocator(page, value)).waitFor({ state: "visible" });
  else if (kind === "hidden") await page.locator(value).waitFor({ state: "hidden" });
  else if (kind === "url") await page.waitForURL(value);
  else if (kind === "business-state") await page.getByText(value, { exact: true }).waitFor({ state: "visible" });
  else if (kind === "response") await page.waitForResponse(value);
  else throw new ActionExecutionError("blocked", "unsupported_wait", `Unsupported web.wait condition: ${action.condition}`);
  return { status: "passed", actual: { condition: action.condition } };
}

async function executeAssert(action: WebAssertAction, context: ExecutionContext): Promise<ActionStepResult> {
  const page = requirePage(context);
  if (action.assertion.startsWith("text=")) {
    const text = action.assertion.slice("text=".length);
    const count = await page.getByText(text, { exact: true }).count();
    return { status: count > 0 ? "passed" : "failed", actual: { text, count } };
  }
  if (action.assertion.startsWith("visible:")) {
    const locator = await resolveLocator(page, action.assertion.slice("visible:".length));
    return { status: await locator.isVisible() ? "passed" : "failed", actual: { assertion: action.assertion } };
  }
  throw new ActionExecutionError("blocked", "unsupported_assertion", `Unsupported Web assertion: ${action.assertion}`);
}

async function withPageScreenshot(
  action: WebExecutableAction,
  context: ExecutionContext,
  result: ActionStepResult,
): Promise<ActionStepResult> {
  if (!context.page) return result;
  const content = await context.page.screenshot(formalEvidenceScreenshotOptions()).catch(() => undefined);
  if (!content) return result;
  return {
    ...result,
    attachments: [
      ...(result.attachments ?? []),
      { relativePath: `${action.action_id}/web-page.png`, content },
    ],
  };
}

export async function executeWebAction(action: WebExecutableAction, context: ExecutionContext): Promise<ActionStepResult> {
  const result = action.type === "web.goto"
    ? await executeGoto(action, context)
    : action.type === "web.fill"
      ? await executeFill(action, context)
      : action.type === "web.click" || action.type === "cleanup.web"
        ? await executeClick(action, context)
        : action.type === "web.select"
          ? await executeSelect(action, context)
          : action.type === "web.wait"
            ? await executeWait(action, context)
            : await executeAssert(action, context);
  return withPageScreenshot(action, context, result);
}
