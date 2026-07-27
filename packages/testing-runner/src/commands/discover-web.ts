import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { chromium } from "playwright";

import { discoverCurrentPage, type WebDiscoveryResult } from "../locator/page-discovery.js";

export interface DiscoverWebOptions {
  url: string;
  outputDir: string;
  browser?: "visible" | "headless";
}

export async function runDiscoverWebCommand(options: DiscoverWebOptions): Promise<WebDiscoveryResult> {
  const target = new URL(options.url);
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    throw new Error("discover-web only accepts http or https targets");
  }
  await mkdir(options.outputDir, { recursive: true });
  const browser = await chromium.launch({ headless: options.browser !== "visible" });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await page.goto(target.toString(), { waitUntil: "domcontentloaded" });
    const result = await discoverCurrentPage(page);
    await writeFile(path.join(options.outputDir, "web-discovery.json"), `${JSON.stringify(result, null, 2)}\n`, "utf8");
    await writeFile(path.join(options.outputDir, "web-discovery.md"), renderDiscovery(result), "utf8");
    await page.screenshot({ path: path.join(options.outputDir, "web-discovery.png"), fullPage: true });
    return result;
  } finally {
    await browser.close();
  }
}

function renderDiscovery(result: WebDiscoveryResult): string {
  const lines = [
    "# Web black-box discovery preview",
    "",
    `Target: ${result.url}`,
    `Title: ${result.title}`,
    "Interaction: read-only DOM and accessibility inspection; no click or input performed.",
    "Status: waiting for user confirmation before locator application or execution.",
    "",
  ];
  for (const [index, element] of result.elements.entries()) {
    lines.push(`## ${index + 1}. ${element.role || element.tag} ${element.name || element.label}`.trim());
    for (const candidate of element.candidates) {
      lines.push(`- ${candidate.locator} | matched=${candidate.matched_count} | visible=${candidate.visible_count} | confidence=${candidate.confidence}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
