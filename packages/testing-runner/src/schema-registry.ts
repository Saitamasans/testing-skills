import { readFileSync } from "node:fs";

import type { ErrorObject, ValidateFunction } from "ajv";
import { Ajv2020 } from "ajv/dist/2020.js";

import type { SchemaId } from "./types.js";

interface JsonSchema {
  $id?: string;
  [key: string]: unknown;
}

const schemaFiles: Record<SchemaId, string> = {
  report: "report.schema.json",
  "execution-profile": "execution-profile.schema.json",
  "run-manifest": "run-manifest.schema.json",
  approval: "approval.schema.json",
  "run-result": "run-result.schema.json",
};

function loadSchema(fileName: string): JsonSchema {
  const url = new URL(`../../../schemas/${fileName}`, import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as JsonSchema;
}

function escapePointerSegment(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1");
}

function errorPointer(error: ErrorObject): string {
  if (error.keyword === "required") {
    const missingProperty = String(error.params.missingProperty);
    return `${error.instancePath}/${escapePointerSegment(missingProperty)}`;
  }

  if (error.keyword === "additionalProperties") {
    const additionalProperty = String(error.params.additionalProperty);
    return `${error.instancePath}/${escapePointerSegment(additionalProperty)}`;
  }

  if (error.keyword === "propertyNames") {
    const propertyName = String(error.params.propertyName);
    return `${error.instancePath}/${escapePointerSegment(propertyName)}`;
  }

  return error.instancePath || "/";
}

function normalizeError(error: ErrorObject): string {
  const received =
    error.keyword === "const" || error.keyword === "enum"
      ? `; received ${JSON.stringify(error.data)}`
      : "";
  return `${errorPointer(error)}: ${error.message ?? "is invalid"}${received}`;
}

function normalizeErrors(errors: ErrorObject[]): string[] {
  return errors.map(normalizeError);
}

const ajv = new Ajv2020({ allErrors: true, strict: true, verbose: true });
const validators = new Map<SchemaId, ValidateFunction>();

for (const schemaId of Object.keys(schemaFiles) as SchemaId[]) {
  const schema = loadSchema(schemaFiles[schemaId]);
  validators.set(schemaId, ajv.compile(schema));
}

export class ProtocolValidationError extends Error {
  readonly schemaId: SchemaId;
  readonly errors: string[];

  constructor(schemaId: SchemaId, errors: string[]) {
    super(`Invalid ${schemaId} document: ${errors.join("; ")}`);
    this.name = "ProtocolValidationError";
    this.schemaId = schemaId;
    this.errors = errors;
  }
}

export function validateDocument<T>(schemaId: SchemaId, value: unknown): T {
  const validator = validators.get(schemaId);
  if (!validator?.(value)) {
    throw new ProtocolValidationError(
      schemaId,
      normalizeErrors(validator?.errors ?? []),
    );
  }
  return value as T;
}

export function formatSchemaErrors(error: Error): string[] {
  return error instanceof ProtocolValidationError ? [...error.errors] : [error.message];
}
