#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRunData } from "../src/run-data.mjs";
import { buildStage4Bundle } from "../src/stage4-artifacts.mjs";
import { buildStage4DemoFixture } from "../tests/fixtures/stage4-lineage.mjs";

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

const outputDir = path.resolve(valueAfter(process.argv.slice(2), "--output-dir") || "review/stage4-demo-output");
const evidenceDir = path.join(outputDir, "evidence");
await fs.mkdir(evidenceDir, { recursive: true });

const fixture = buildStage4DemoFixture();
const bundle = buildStage4Bundle(fixture);
validateRunData(bundle.runData);

const files = {
  runData: path.join(evidenceDir, "run-data.json"),
  lineage: path.join(evidenceDir, "lineage.json"),
  excelProjection: path.join(evidenceDir, "excel-projection.json"),
  wordProjection: path.join(evidenceDir, "word-projection.json"),
  consistency: path.join(evidenceDir, "stage4-consistency.json"),
};
await fs.writeFile(files.runData, `${JSON.stringify(bundle.runData, null, 2)}\n`, "utf8");
await fs.writeFile(files.lineage, `${JSON.stringify(bundle.lineage, null, 2)}\n`, "utf8");
await fs.writeFile(files.excelProjection, `${JSON.stringify(bundle.excelProjection, null, 2)}\n`, "utf8");
await fs.writeFile(files.wordProjection, `${JSON.stringify(bundle.wordProjection, null, 2)}\n`, "utf8");
await fs.writeFile(files.consistency, `${JSON.stringify({ ...bundle.consistency, artifacts: { docx: "过程小结.docx", xlsx: "JS逆向测试资产表.xlsx" } }, null, 2)}\n`, "utf8");

console.log(JSON.stringify({ outputDir, files, display_ids: bundle.lineage.display_id_registry.map((item) => item.display_id), fingerprint: bundle.consistency.run_data_fingerprint }, null, 2));
