import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReportId, renderBoth, renderHtml, renderXlsx, validateReport } from "../tooling/test-case-renderer.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/sample-report.json", import.meta.url), "utf8"));

test("validates exact ten-column report", () => {
  assert.doesNotThrow(() => validateReport(fixture));
  const bad = structuredClone(fixture);
  bad.sheets[1].columns.pop();
  assert.throws(() => validateReport(bad), /统一十列/);
});

test("validates workbench eleven-column report with actual results", () => {
  const eleven = structuredClone(fixture);
  const cases = eleven.sheets.find((sheet) => sheet.kind === "test_cases");
  cases.columns.splice(8, 0, "实际结果");
  for (const row of cases.rows) row.values.splice(8, 0, row.divider ? "-" : "尚未执行");

  assert.doesNotThrow(() => validateReport(eleven));
});

test("report id is deterministic and isolated", () => {
  assert.equal(buildReportId(fixture), buildReportId(structuredClone(fixture)));
  const other = structuredClone(fixture);
  other.project = "另一个项目";
  assert.notEqual(buildReportId(fixture), buildReportId(other));
});

test("renders xlsx and html, with all sheet previews when supported", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-"));
  const result = await renderBoth(fixture, out, "sample");
  assert.ok((await fs.stat(result.xlsx)).size > 1000);
  const html = await fs.readFile(result.html, "utf8");
  assert.match(html, /localStorage/);
  assert.match(html, /不通过/);
  assert.match(html, /待定/);
  const previewDir = path.join(out, "sample-previews");
  try {
    const previews = await fs.readdir(previewDir);
    assert.equal(previews.length, fixture.sheets.length);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    const bytes = await fs.readFile(result.xlsx);
    assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
  }
});

test("generated inline script is syntactically valid", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-html-"));
  const target = path.join(out, "sample.html");
  await renderHtml(fixture, target);
  const html = await fs.readFile(target, "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(script);
  assert.doesNotThrow(() => new Function(script[1]));
});

test("portable xlsx fallback has no third-party runtime dependency", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-portable-"));
  const target = path.join(out, "portable.xlsx");
  process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX = "1";
  try {
    await renderXlsx(fixture, target);
  } finally {
    delete process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX;
  }
  const bytes = await fs.readFile(target);
  assert.equal(bytes.subarray(0, 2).toString("ascii"), "PK");
  assert.match(bytes.toString("utf8"), /dataValidations/);
  assert.match(bytes.toString("utf8"), /不通过/);
  assert.match(bytes.toString("utf8"), /待定/);
});

test("xlsx rows grow with multiline test steps instead of clipping content", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-row-height-"));
  const target = path.join(out, "multiline.xlsx");
  const multiline = structuredClone(fixture);
  multiline.sheets[1].rows[1].values[5] = "1. 第一步\n2. 第二步\n3. 第三步\n4. 第四步";
  process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX = "1";
  try {
    await renderXlsx(multiline, target);
  } finally {
    delete process.env.TESTING_SKILLS_FORCE_PORTABLE_XLSX;
  }
  const archive = (await fs.readFile(target)).toString("utf8");
  assert.match(archive, /<row r="3" ht="78" customHeight="1">/);
});
