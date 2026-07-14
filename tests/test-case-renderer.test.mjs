import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildReportId, renderBoth, renderXlsx, validateReport } from "../tooling/test-case-renderer.mjs";

const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/sample-report.json", import.meta.url), "utf8"));

test("validates exact ten-column report", () => {
  assert.doesNotThrow(() => validateReport(fixture));
  const bad = structuredClone(fixture);
  bad.sheets[1].columns.pop();
  assert.throws(() => validateReport(bad), /统一十列/);
});

test("report id is deterministic and isolated", () => {
  assert.equal(buildReportId(fixture), buildReportId(structuredClone(fixture)));
  const other = structuredClone(fixture);
  other.project = "另一个项目";
  assert.notEqual(buildReportId(fixture), buildReportId(other));
});

test("renders xlsx html and all sheet previews", async () => {
  const out = await fs.mkdtemp(path.join(os.tmpdir(), "testing-skills-"));
  const result = await renderBoth(fixture, out, "sample");
  assert.ok((await fs.stat(result.xlsx)).size > 1000);
  const html = await fs.readFile(result.html, "utf8");
  assert.match(html, /localStorage/);
  assert.match(html, /不通过/);
  assert.match(html, /待定/);
  const previews = await fs.readdir(path.join(out, "sample-previews"));
  assert.equal(previews.length, fixture.sheets.length);
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
