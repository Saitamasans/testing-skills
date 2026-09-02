import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import { assertNoSecrets } from "./security.mjs";

const packagePath = fileURLToPath(new URL("../package.json", import.meta.url));
const schemaPath = fileURLToPath(new URL("../schemas/run-data.schema.json", import.meta.url));

export async function runtimeMetadata() {
  const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
  return { runtime_version: packageJson.version, node_version: process.versions.node, minimum_node: 20, playwright_version: packageJson.dependencies.playwright };
}

let validator;

function assertUnique(items, key, label) {
  const seen = new Set();
  for (const item of items) {
    if (seen.has(item[key])) throw new Error(`run_data_duplicate_${label}: ${item[key]}`);
    seen.add(item[key]);
  }
}

function validateSemanticReferences(value) {
  assertUnique(value.assets, "asset_id", "asset_id");
  assertUnique(value.technical_facts, "fact_id", "fact_id");
  assertUnique(value.evidence, "evidence_id", "evidence_id");

  const assetIds = new Set(value.assets.map((asset) => asset.asset_id));
  for (const asset of value.assets) {
    if (asset.duplicate_of && !assetIds.has(asset.duplicate_of)) throw new Error(`run_data_dangling_duplicate_asset: ${asset.duplicate_of}`);
    const hasContentHash = typeof asset.content_sha256 === "string";
    const hasContentSize = Number.isInteger(asset.size_bytes);
    if (hasContentHash !== hasContentSize) throw new Error(`run_data_content_metadata_pair_required: ${asset.asset_id}`);
  }
  for (const fact of value.technical_facts) {
    if (!assetIds.has(fact.asset_id)) throw new Error(`run_data_dangling_fact_asset: ${fact.asset_id}`);
    if (fact.evidence_level === "E1" && (!fact.location?.file || !fact.location?.line || !fact.context)) {
      throw new Error(`run_data_e1_context_required: ${fact.fact_id}`);
    }
  }
  for (const evidence of value.evidence) {
    if (!assetIds.has(evidence.asset_id)) throw new Error(`run_data_dangling_evidence_asset: ${evidence.asset_id}`);
    if (evidence.persisted_bytes !== false) throw new Error(`run_data_persisted_bytes_forbidden: ${evidence.evidence_id}`);
  }
  try {
    assertNoSecrets(value);
  } catch (error) {
    throw new Error(`run_data_sensitive_data_detected: ${String(error.message || error)}`);
  }
}

export function validateRunData(value) {
  if (!validator) {
    throw new Error("run_data_validator_not_initialized");
  }
  if (!validator(value)) throw new Error(`run_data_schema_invalid: ${JSON.stringify(validator.errors)}`);
  if (value.active_business_api_calls !== 0) throw new Error("active_business_api_calls_must_be_zero");
  validateSemanticReferences(value);
  return value;
}

export async function initializeRunDataValidator() {
  if (!validator) {
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    validator = new Ajv2020({ allErrors: true, strict: false, validateFormats: false }).compile(schema);
  }
  return validator;
}

await initializeRunDataValidator();
