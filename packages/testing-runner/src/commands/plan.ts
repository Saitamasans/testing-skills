import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { compileManifest, type ExecutionProfileWithPlans } from "../compiler/manifest-compiler.js";
import { assessReadiness, type RuntimeProbeReport } from "../readiness.js";
import { validateDocument } from "../schema-registry.js";
import { readStandardExcel } from "../input/excel-reader.js";
import { detectInputKind } from "../input/detect-input.js";
import { readNativeReport } from "../input/report-reader.js";
import {
  applyConfirmedMapping,
} from "../input/nonstandard-excel.js";
import {
  inspectNonstandardWorkbook,
  proposeMapping,
  type MappingProposal,
} from "../input/mapping-proposal.js";
import type { ExecutionProfile, NormalizedCaseSet, RunManifest } from "../types.js";

export interface PlanCommandOptions {
  input: string;
  profile: string;
  outputDir: string;
  mappingApproval?: string;
}

export interface PlanCommandResult {
  case_set?: NormalizedCaseSet;
  mapping_proposal?: MappingProposal;
  manifest: RunManifest;
  readiness: ReturnType<typeof assessReadiness>;
}

export async function runPlanCommand(options: PlanCommandOptions): Promise<PlanCommandResult> {
  await mkdir(options.outputDir, { recursive: true });
  const profile = await readProfile(options.profile);
  const { caseSet, mappingProposal } = await readCases(options);
  const manifest = compileManifest(caseSet, profile);
  const readiness = assessReadiness({
    case_set: caseSet,
    manifest,
    profile,
    runtime_probe: defaultRuntimeProbe(),
  });

  await writeJson(options.outputDir, "input-inspection.json", {
    input_kind: caseSet.source_snapshot.input_kind,
    source_snapshot: caseSet.source_snapshot,
  });
  if (mappingProposal) await writeJson(options.outputDir, "mapping-proposal.json", mappingProposal);
  await writeJson(options.outputDir, "readiness.json", readiness);
  await writeJson(options.outputDir, "execution-profile.normalized.json", profile);
  await writeJson(options.outputDir, "run-manifest.json", manifest);
  await writeFile(path.join(options.outputDir, "execution-preview.md"), renderPreview(manifest), "utf8");

  const result: PlanCommandResult = { case_set: caseSet, manifest, readiness };
  if (mappingProposal) result.mapping_proposal = mappingProposal;
  return result;
}

async function readProfile(file: string): Promise<ExecutionProfileWithPlans> {
  const raw = JSON.parse(await readFile(file, "utf8")) as ExecutionProfileWithPlans;
  validateDocument<ExecutionProfile>("execution-profile", {
    protocol_version: raw.protocol_version,
    profile_id: raw.profile_id,
    targets: raw.targets,
    credentials: raw.credentials,
  });
  if (!raw.case_plans || Object.keys(raw.case_plans).length === 0) {
    throw new Error("Execution profile must include case_plans for planning");
  }
  return raw;
}

async function readCases(options: PlanCommandOptions): Promise<{
  caseSet: NormalizedCaseSet;
  mappingProposal?: MappingProposal;
}> {
  const kind = await detectInputKind(options.input);
  if (kind === "native-report") return { caseSet: await readNativeReport(options.input) };
  if (kind === "standard-excel") return { caseSet: await readStandardExcel(options.input) };

  const inspection = await inspectNonstandardWorkbook(options.input);
  const mappingProposal = proposeMapping(inspection);
  if (!options.mappingApproval) {
    throw new Error("Nonstandard Excel requires --mapping-approval before manifest planning");
  }
  const approval = JSON.parse(await readFile(options.mappingApproval, "utf8")) as Parameters<typeof applyConfirmedMapping>[1];
  return {
    caseSet: await applyConfirmedMapping(mappingProposal, approval),
    mappingProposal,
  };
}

async function writeJson(directory: string, fileName: string, value: unknown): Promise<void> {
  await writeFile(path.join(directory, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function renderPreview(manifest: RunManifest): string {
  const lines = [
    `# Execution preview`,
    ``,
    `Manifest: ${manifest.manifest_id}`,
    `Runner: ${manifest.runner.version}`,
    `Source: ${manifest.source.path}`,
    ``,
  ];
  for (const item of manifest.cases) {
    lines.push(`## ${item.case_id}`);
    for (const action of item.steps) {
      lines.push(`- ${action.action_id}: ${action.type} ${action.target_alias} ${action.risk}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

function defaultRuntimeProbe(): RuntimeProbeReport {
  return {
    runner: {
      package: "@saitamasans/testing-runner",
      source: "package.json",
      version: "1.0.0",
      required_version: "1.0.0",
      compatible: true,
      impact: "planner is available",
    },
    node: {
      package: "node",
      source: "process.version",
      version: process.version,
      required_version: ">=20",
      compatible: true,
      impact: "Node runtime is available",
    },
    browsers: [],
    target_connectivity: [],
    optional_db_drivers: [],
  };
}
