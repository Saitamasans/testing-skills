import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildDefaultOutputPath,
  buildWorkbook,
  renderClarificationXlsx,
  validateClarificationReport,
  validateWrittenWorkbook,
} from "../skill-sources/requirement-clarification-test/scripts/render-clarification-assets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = JSON.parse(
  await fs.readFile(path.join(ROOT, "tests/fixtures/requirement-clarification-login.json"), "utf8"),
);

test("valid clarification fixture renders and validates deterministically", async () => {
  const { buffer, counts } = buildWorkbook(FIXTURE);
  const inspected = validateWrittenWorkbook(buffer, FIXTURE, counts);
  assert.deepEqual(inspected.sheetNames, ["产品核对问题表", "需求澄清摘要"]);
  assert.equal(counts.p0, 4);
  assert.equal(counts.p1, 2);
  assert.equal(counts.p2, 1);
  assert.ok(inspected.sheet1Rows >= FIXTURE.questions.length + 3);
  assert.ok(inspected.sheet2Rows >= 24);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "clarification-render-"));
  const outputPath = path.join(tempDir, "需求澄清问题表_工作台登录需求_20260727.xlsx");
  const result = await renderClarificationXlsx(FIXTURE, outputPath);
  assert.equal(result.outputPath, outputPath);
  assert.equal((await fs.stat(outputPath)).size > 1000, true);
  assert.equal(buildDefaultOutputPath(FIXTURE, tempDir).endsWith("需求澄清问题表_工作台登录需求_20260727.xlsx"), true);
});

test("validator rejects generic questions and duplicate ids", async () => {
  const badQuestion = structuredClone(FIXTURE);
  badQuestion.questions[0].question = "请确认";
  await assert.rejects(
    () => renderClarificationXlsx(badQuestion, path.join(os.tmpdir(), "bad-question.xlsx"), { overwrite: true }),
    /过于空泛|无效/,
  );

  const duplicateIds = structuredClone(FIXTURE);
  duplicateIds.questions[1].id = "Q001";
  await assert.rejects(
    () => renderClarificationXlsx(duplicateIds, path.join(os.tmpdir(), "duplicate-question.xlsx"), { overwrite: true }),
    /连续且从 Q001 开始|重复/,
  );
});

test("schema-shaped report passes validation before write", () => {
  const counts = validateClarificationReport(FIXTURE);
  assert.equal(counts.p0, 4);
  assert.equal(counts.p1, 2);
  assert.equal(counts.p2, 1);
});
