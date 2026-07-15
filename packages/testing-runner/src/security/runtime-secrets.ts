import {
  assertNoSecrets,
  redact,
  type RedactionPolicy,
  type SecretFingerprint,
} from "./redactor.js";

export interface PersistedArtifactGuardInput {
  value: unknown;
  fingerprints: readonly SecretFingerprint[];
  redaction?: RedactionPolicy;
}

export function preparePersistedArtifact(input: PersistedArtifactGuardInput): unknown {
  const redacted = redact(input.value, {
    ...(input.redaction ?? {}),
    fingerprints: input.fingerprints,
  });
  assertNoSecrets(redacted, input.fingerprints);
  return redacted;
}
