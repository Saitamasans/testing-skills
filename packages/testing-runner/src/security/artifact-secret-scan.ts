export type ArtifactSecretKind = "username" | "password" | "wrong_password" | "token" | "cookie" | "storage_state";
export type ArtifactFieldProvenance = "credential_field" | "runtime_input" | "runtime_output" | "public_metadata" | "domain" | "project_name" | "locator" | "page_label" | "unknown";
export type ArtifactSecretClassification = "confirmed_leak" | "natural_collision" | "unclassified_match";

export interface ArtifactSecretScanInput {
  secrets: Array<{ name: string; kind: ArtifactSecretKind; value: string }>;
  fields: Array<{ file: string; field: string; value: string; provenance: ArtifactFieldProvenance }>;
}

export interface ArtifactSecretScanResult {
  passed: boolean;
  findings: Array<{
    secret_name: string;
    file: string;
    field: string;
    provenance: ArtifactFieldProvenance;
    classification: ArtifactSecretClassification;
  }>;
}

const PUBLIC_USERNAME_PROVENANCE = new Set<ArtifactFieldProvenance>([
  "public_metadata",
  "domain",
  "project_name",
  "locator",
  "page_label",
]);

export function scanArtifactSecretFields(input: ArtifactSecretScanInput): ArtifactSecretScanResult {
  const findings: ArtifactSecretScanResult["findings"] = [];
  for (const secret of input.secrets) {
    if (secret.value.length === 0) continue;
    for (const field of input.fields) {
      if (!field.value.includes(secret.value)) continue;
      const classification: ArtifactSecretClassification = secret.kind !== "username"
        ? "confirmed_leak"
        : PUBLIC_USERNAME_PROVENANCE.has(field.provenance)
          ? "natural_collision"
          : field.provenance === "unknown"
            ? "unclassified_match"
            : "confirmed_leak";
      findings.push({
        secret_name: secret.name,
        file: field.file,
        field: field.field,
        provenance: field.provenance,
        classification,
      });
    }
  }
  return {
    passed: findings.every(({ classification }) => classification === "natural_collision"),
    findings,
  };
}
