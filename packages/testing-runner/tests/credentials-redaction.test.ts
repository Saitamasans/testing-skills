import assert from "node:assert/strict";
import test from "node:test";

import {
  ManualCredentialRequiredError,
  resolveCredentials,
} from "../src/security/credential-resolver.js";
import {
  assertNoSecrets,
  fingerprintSecret,
  redact,
  SecurityBoundaryError,
} from "../src/security/redactor.js";

test("credential resolution follows session, configured, storage, then manual priority", () => {
  const candidates = [
    { alias: "web_user", source: "configured_env", name: "CONFIGURED_WEB_TOKEN" },
    { alias: "web_user", source: "session_env", name: "SESSION_WEB_TOKEN" },
    {
      alias: "web_user",
      source: "approved_storage_state",
      storageStatePath: ".auth/web-user.json",
      approved: true,
      expiresAt: "2999-07-15T00:00:00.000Z",
    },
    { alias: "web_user", source: "manual_handoff" },
  ] as const;

  const store = resolveCredentials(candidates, {
    CONFIGURED_WEB_TOKEN: "configured-token",
    SESSION_WEB_TOKEN: "session-token",
  });

  assert.equal(store.get("web_user"), "session-token");
  assert.equal(store.selectedSource("web_user"), "session_env");
  assert.throws(() => JSON.stringify(store), /not serializable/i);
});

test("credential resolution falls back without exposing unavailable automatic options", () => {
  const candidates = [
    { alias: "api_admin", source: "session_env", name: "SESSION_API_TOKEN" },
    { alias: "api_admin", source: "configured_env", name: "CONFIGURED_API_TOKEN" },
    {
      alias: "api_admin",
      source: "approved_storage_state",
      storageStatePath: ".auth/api-admin.json",
      approved: true,
      expiresAt: "2999-07-15T00:00:00.000Z",
    },
    { alias: "api_admin", source: "manual_handoff" },
    {
      alias: "expired_user",
      source: "approved_storage_state",
      storageStatePath: ".auth/expired.json",
      approved: true,
      expiresAt: "2000-01-01T00:00:00.000Z",
    },
    { alias: "expired_user", source: "manual_handoff" },
  ] as const;

  const store = resolveCredentials(candidates, {
    CONFIGURED_API_TOKEN: "configured-token",
  }, { now: "2026-07-15T00:00:00.000Z" });

  assert.equal(store.get("api_admin"), "configured-token");
  assert.equal(store.selectedSource("api_admin"), "configured_env");
  assert.equal(store.selectedSource("expired_user"), "manual_handoff");
  assert.throws(() => store.get("expired_user"), ManualCredentialRequiredError);
});

test("redaction removes canary secrets from persisted headers, URLs, bodies, metadata and rows", () => {
  const fingerprints = [
    fingerprintSecret("CANARY_TOKEN_123", "api token"),
    fingerprintSecret("CANARY_PASSWORD_456", "password"),
    fingerprintSecret("session_cookie=CANARY_COOKIE_789", "cookie"),
  ];
  const artifact = {
    request: {
      url: "https://admin:CANARY_PASSWORD_456@app.example.test/orders?access_token=CANARY_TOKEN_123&safe=1",
      headers: {
        Authorization: "Bearer CANARY_TOKEN_123",
        Cookie: "session_cookie=CANARY_COOKIE_789",
        "X-Api-Key": "CANARY_TOKEN_123",
      },
      body: {
        password: "CANARY_PASSWORD_456",
        nested: [
          "contact qa-owner@example.test",
          "phone 13800138000",
          "id 11010519491231002X",
          { note: "token CANARY_TOKEN_123" },
        ],
      },
    },
    screenshot: {
      file: "evidence/screenshot.png",
      metadata: {
        focusedText: "session_cookie=CANARY_COOKIE_789",
      },
    },
    databaseRows: [
      {
        email: "customer@example.test",
        connectionString: "postgresql://admin:CANARY_PASSWORD_456@db.example.test/orders",
      },
    ],
  };

  const redacted = redact(artifact, { fingerprints });
  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(serialized, /CANARY_TOKEN_123|CANARY_PASSWORD_456|CANARY_COOKIE_789/);
  assert.doesNotMatch(serialized, /qa-owner@example\.test|13800138000|11010519491231002X/);
  assert.match(serialized, /REDACTED/);
  assert.doesNotThrow(() => assertNoSecrets(redacted, fingerprints));
  assert.throws(() => assertNoSecrets(artifact, fingerprints), SecurityBoundaryError);
});

test("persistence guard blocks raw and encoded runtime secret variants", () => {
  const fingerprints = [fingerprintSecret("CANARY/TOKEN+WITH SPACE", "api token")];

  assert.throws(
    () => assertNoSecrets({
      event: "request",
      url: `https://api.example.test/orders?token=${encodeURIComponent("CANARY/TOKEN+WITH SPACE")}`,
    }, fingerprints),
    /api token/i,
  );
  assert.throws(
    () => assertNoSecrets({ event: "hash", value: fingerprints[0]!.sha256 }, fingerprints),
    /fingerprint/i,
  );
});
