#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildExcelProjection, buildWordProjection, validateStage4Data } from "../src/stage4-artifacts.mjs";
import { applyCognitionToLineage, validateCognition } from "../src/cognition.mjs";
import { writeEvidenceViews } from "../src/evidence-views.mjs";
import { buildArtifacts } from "../scripts/build-artifacts.mjs";
import { validateRunData } from "../src/run-data.mjs";

function valueAfter(args, flag) { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
const args = process.argv.slice(2);
const outputDir = path.resolve(valueAfter(args, "--output-dir"));
const cognitionPath = path.resolve(valueAfter(args, "--cognition"));
if (!outputDir || !cognitionPath) throw new Error("Usage: js-test-mapper finalize --output-dir <dir> --cognition <cognition.json>");
const evidenceDir = path.join(outputDir, "evidence");
const runData = JSON.parse(await readFile(path.join(evidenceDir, "run-data.json"), "utf8"));
const lineage = JSON.parse(await readFile(path.join(evidenceDir, "lineage.json"), "utf8"));
const cognition = JSON.parse(await readFile(cognitionPath, "utf8"));
await validateCognition(cognition, runData);
const presentedLineage = applyCognitionToLineage(lineage, cognition);
const enrichedRunData = { ...runData, cognition };
validateRunData(enrichedRunData);
const excelProjection = buildExcelProjection({ runData: enrichedRunData, lineage: presentedLineage });
const wordProjection = buildWordProjection({ runData: enrichedRunData, lineage: presentedLineage });
validateStage4Data({ runData: enrichedRunData, lineage: presentedLineage, excelProjection, wordProjection });
await writeFile(path.join(evidenceDir, "run-data.json"), `${JSON.stringify(enrichedRunData, null, 2)}\n`, "utf8");
await writeEvidenceViews({ outputDir, runData: enrichedRunData, lineage: presentedLineage, cognition });
await writeFile(path.join(evidenceDir, "lineage.json"), `${JSON.stringify(presentedLineage, null, 2)}\n`, "utf8");
await writeFile(path.join(evidenceDir, "excel-projection.json"), `${JSON.stringify(excelProjection, null, 2)}\n`, "utf8");
await writeFile(path.join(evidenceDir, "word-projection.json"), `${JSON.stringify(wordProjection, null, 2)}\n`, "utf8");
const artifacts = await buildArtifacts(outputDir, outputDir);
console.log(JSON.stringify({ outputDir, artifacts, cognition: "validated", status: "formal_artifacts_finalized" }, null, 2));
