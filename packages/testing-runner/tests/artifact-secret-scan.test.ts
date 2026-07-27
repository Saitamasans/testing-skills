import assert from "node:assert/strict";
import test from "node:test";

import { scanArtifactSecretFields } from "../src/security/artifact-secret-scan.js";

test("strict password token cookie and storage-state matches always fail without echoing values", () => {
  const secrets = [
    { name: "TEST_PASSWORD", kind: "password" as const, value: "strict-password-canary" },
    { name: "TEST_WRONG_PASSWORD", kind: "wrong_password" as const, value: "strict-wrong-canary" },
    { name: "TEST_TOKEN", kind: "token" as const, value: "strict-token-canary" },
    { name: "TEST_COOKIE", kind: "cookie" as const, value: "strict-cookie-canary" },
    { name: "TEST_STORAGE", kind: "storage_state" as const, value: "strict-storage-canary" },
  ];
  const result = scanArtifactSecretFields({
    secrets,
    fields: secrets.map((secret) => ({ file: "run-result.json", field: `/actual/${secret.kind}`, value: `prefix-${secret.value}-suffix`, provenance: "runtime_output" as const })),
  });

  assert.equal(result.passed, false);
  assert.equal(result.findings.length, 5);
  assert.ok(result.findings.every(({ classification }) => classification === "confirmed_leak"));
  for (const secret of secrets) assert.doesNotMatch(JSON.stringify(result), new RegExp(secret.value));
});

test("low-entropy username collisions in public metadata are recorded but are not leaks", () => {
  const username = "public-name";
  const result = scanArtifactSecretFields({
    secrets: [{ name: "TEST_USERNAME", kind: "username", value: username }],
    fields: [
      { file: "web-discovery.json", field: "/elements/0/name", value: username, provenance: "page_label" },
      { file: "package-manifest.json", field: "/source_files/0", value: `source/${username}.xlsx`, provenance: "project_name" },
      { file: "discovery.json", field: "/url", value: `https://${username}.example.test/`, provenance: "domain" },
    ],
  });

  assert.equal(result.passed, true);
  assert.equal(result.findings.length, 3);
  assert.ok(result.findings.every(({ classification }) => classification === "natural_collision"));
  assert.deepEqual(result.findings.map(({ file, field, provenance }) => ({ file, field, provenance })), [
    { file: "web-discovery.json", field: "/elements/0/name", provenance: "page_label" },
    { file: "package-manifest.json", field: "/source_files/0", provenance: "project_name" },
    { file: "discovery.json", field: "/url", provenance: "domain" },
  ]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(username));
});

test("username matches in credential-bearing fields remain confirmed leaks", () => {
  const username = "credential-user-canary";
  const result = scanArtifactSecretFields({
    secrets: [{ name: "TEST_USERNAME", kind: "username", value: username }],
    fields: [{ file: "run-events.jsonl", field: "/input/username", value: username, provenance: "credential_field" }],
  });

  assert.equal(result.passed, false);
  assert.equal(result.findings[0]?.classification, "confirmed_leak");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(username));
});

test("username matches with unknown provenance fail closed", () => {
  const username = "ambiguous-user-canary";
  const result = scanArtifactSecretFields({
    secrets: [{ name: "TEST_USERNAME", kind: "username", value: username }],
    fields: [{ file: "trace-metadata.json", field: "/unknown", value: username, provenance: "unknown" }],
  });

  assert.equal(result.passed, false);
  assert.equal(result.findings[0]?.classification, "unclassified_match");
  assert.doesNotMatch(JSON.stringify(result), new RegExp(username));
});
