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
import { locatorForSpec, resolveLocator } from "./locator-resolver.js";
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
  const clickOptions = action.type === "web.click" && action.click_count === 2
    ? { clickCount: 2 as const }
    : undefined;
  await Promise.all([
    page.waitForLoadState("domcontentloaded").catch(() => undefined),
    locator.click(clickOptions),
  ]);
  const manual = await detectManualAuth(context);
  if (manual) return manual;
  assertApprovedUrl(context, page.url());
  return { status: "passed", actual: { locator: action.locator, click_count: clickOptions?.clickCount ?? 1 } };
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
  const assertion = interpolateActionText(action.assertion, context);
  if (assertion.startsWith("url=")) {
    const expected = assertion.slice("url=".length);
    const actual = page.url();
    return { status: actual === expected ? "passed" : "failed", actual: { assertion, expected, actual } };
  }
  if (assertion.startsWith("url-contains=")) {
    const expected = assertion.slice("url-contains=".length);
    const actual = page.url();
    return { status: actual.includes(expected) ? "passed" : "failed", actual: { assertion, expected, actual } };
  }
  const valueMatch = assertion.match(/^value\((.+)\)=(.*)$/s);
  if (valueMatch) {
    const locator = await resolveLocator(page, valueMatch[1]!);
    const actual = await locator.inputValue();
    const expected = valueMatch[2]!;
    return { status: actual === expected ? "passed" : "failed", actual: { assertion, expected, actual } };
  }
  const countMatch = assertion.match(/^count\((.+)\)>=(\d+)$/);
  if (countMatch) {
    const locator = locatorForSpec(page, countMatch[1]!);
    const visible = await visibleLocatorCount(locator);
    const expected = Number(countMatch[2]);
    return { status: visible >= expected ? "passed" : "failed", actual: { assertion, expected_minimum: expected, visible_count: visible } };
  }
  if (assertion.startsWith("text=")) {
    const text = assertion.slice("text=".length);
    const locator = page.getByText(text, { exact: true });
    const visible = await visibleLocatorCount(locator);
    return { status: visible > 0 ? "passed" : "failed", actual: { assertion, text, visible_count: visible } };
  }
  if (assertion.startsWith("text-contains=")) {
    const text = assertion.slice("text-contains=".length);
    const locator = page.getByText(text, { exact: false });
    const visible = await visibleLocatorCount(locator);
    return { status: visible > 0 ? "passed" : "failed", actual: { assertion, text, visible_count: visible } };
  }
  if (assertion.startsWith("visible:")) {
    const spec = assertion.slice("visible:".length);
    const visible = await visibleLocatorCount(locatorForSpec(page, spec));
    return { status: visible === 1 ? "passed" : "failed", actual: { assertion, visible_count: visible } };
  }
  if (assertion.startsWith("hidden:")) {
    const spec = assertion.slice("hidden:".length);
    const locator = locatorForSpec(page, spec);
    const count = await locator.count();
    const visible = await visibleLocatorCount(locator);
    return { status: count > 0 && visible === 0 ? "passed" : "failed", actual: { assertion, count, visible_count: visible } };
  }
  if (assertion.startsWith("not-exists:")) {
    const spec = assertion.slice("not-exists:".length);
    const count = await locatorForSpec(page, spec).count();
    return { status: count === 0 ? "passed" : "failed", actual: { assertion, count } };
  }
  throw new ActionExecutionError("blocked", "unsupported_assertion", `Unsupported Web assertion: ${assertion}`);
}

async function visibleLocatorCount(locator: ReturnType<typeof locatorForSpec>): Promise<number> {
  const count = await locator.count();
  let visible = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) visible += 1;
  }
  return visible;
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
