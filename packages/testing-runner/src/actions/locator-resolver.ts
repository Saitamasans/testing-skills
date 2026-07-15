import type { Locator, Page } from "playwright";

function roleLocator(page: Page, spec: string): Locator {
  const match = spec.match(/^role=([A-Za-z0-9_-]+)(?:\[name=(?:"([^"]+)"|'([^']+)'|([^\]]+))\])?$/);
  if (!match) throw new Error(`Invalid role locator: ${spec}`);
  const options: NonNullable<Parameters<Page["getByRole"]>[1]> = {};
  const name = match[2] ?? match[3] ?? match[4];
  if (name !== undefined) options.name = name;
  return page.getByRole(match[1] as Parameters<Page["getByRole"]>[0], options);
}

function rawLocator(page: Page, spec: string): Locator {
  if (spec.startsWith("data-testid=")) return page.getByTestId(spec.slice("data-testid=".length));
  if (spec.startsWith("testid=")) return page.getByTestId(spec.slice("testid=".length));
  if (spec.startsWith("role=")) return roleLocator(page, spec);
  if (spec.startsWith("label=")) return page.getByLabel(spec.slice("label=".length));
  if (spec.startsWith("text=")) return page.getByText(spec.slice("text=".length), { exact: true });
  if (spec.startsWith("css=")) return page.locator(spec.slice("css=".length));
  return page.locator(spec);
}

export async function resolveLocator(page: Page, spec: string): Promise<Locator> {
  const locator = rawLocator(page, spec);
  const count = await locator.count();
  let visibleIndex = -1;
  let visibleCount = 0;
  for (let index = 0; index < count; index += 1) {
    if (await locator.nth(index).isVisible()) {
      visibleIndex = index;
      visibleCount += 1;
    }
  }
  if (visibleCount !== 1) {
    throw new Error(`Locator must match exactly one visible element: ${spec}; visible=${visibleCount}`);
  }
  return locator.nth(visibleIndex);
}
