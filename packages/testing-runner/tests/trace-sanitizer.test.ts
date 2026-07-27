import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import JSZip from "jszip";

import { fingerprintSecret } from "../src/security/redactor.js";
import { sanitizePlaywrightTrace } from "../src/security/trace-sanitizer.js";

test("sanitizes a Playwright Trace without breaking the archive", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "trace-sanitizer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rawPath = path.join(root, "raw.zip");
  const finalPath = path.join(root, "playwright-trace.zip");
  const password = "CANARY_PASSWORD_456";
  const wrongPassword = "CANARY_WRONG_PASSWORD_789";
  const token = "CANARY_TOKEN_123";
  const cookie = "session=CANARY_COOKIE_321";
  const zip = new JSZip();
  zip.file("trace.trace", `${JSON.stringify({
    type: "frame-snapshot",
    snapshot: {
      html: ["HTML", {}, ["BODY", {},
        ["INPUT", { type: "password", value: "DYNAMIC_DOM_PASSWORD", __playwright_value_: wrongPassword }],
        ["INPUT", { type: "hidden", name: "_csrf", value: "DYNAMIC_DOM_CSRF_TOKEN" }],
        ["META", { name: "access-token", content: "DYNAMIC_DOM_META_TOKEN" }],
      ]],
      storageState: { cookies: [{ name: "session", value: "CANARY_COOKIE_321" }] },
    },
  })}\n`);
  zip.file("trace.network", `${JSON.stringify({
    type: "resource-snapshot",
    snapshot: {
      request: { headers: [
        { name: "Authorization", value: `Bearer ${token}` },
        { name: "Cookie", value: cookie },
        { name: "X-CSRF-Token", value: "DYNAMIC_CSRF_HEADER_TOKEN" },
        { name: "X-API-Key", value: "DYNAMIC_API_KEY_HEADER" },
      ], postData: { _sha1: "request-body.txt" } },
      response: { headers: [{ name: "Set-Cookie", value: cookie }] },
    },
  })}\n${JSON.stringify({
    type: "resource-snapshot",
    snapshot: { request: { headers: [], postData: { _file: "request-body.bin" } }, response: { headers: [] } },
  })}\n`);
  zip.file("resources/request-body.txt", `password=${password}&token=DYNAMIC_BODY_TOKEN`);
  zip.file("resources/request-body.bin", Buffer.from("BINARY_DYNAMIC_BODY_TOKEN\0", "utf8"));
  zip.file("resources/source.txt", [
    `const leaked = ${JSON.stringify(wrongPassword)}; cookie mirror CANARY_COOKIE_321 token mirror ${token}`,
    '<input value="DYNAMIC_CSRF_TOKEN" type="hidden" name="csrf_token">',
    '<meta content="DYNAMIC_META_TOKEN" name="csrf-token">',
    'localStorage.setItem("token", "DYNAMIC_LOCAL_TOKEN");',
    'sessionStorage.setItem("access_token", "DYNAMIC_SESSION_TOKEN");',
    'const refreshToken = "DYNAMIC_CONST_TOKEN";',
  ].join("\n"));
  zip.file("context-1.trace", `${JSON.stringify({ type: "event", params: { token: "DYNAMIC_PREFIXED_TRACE_TOKEN" } })}\n`);
  zip.file("context-1.network", `${JSON.stringify({ type: "resource-snapshot", snapshot: { request: { headers: [{ name: "Authorization", value: "Bearer DYNAMIC_PREFIXED_NETWORK_TOKEN" }] } } })}\n`);
  const binary = Buffer.from([0, 255, 1, 254, 2, 253]);
  zip.file("resources/image.png", binary);
  await writeFile(rawPath, await zip.generateAsync({ type: "nodebuffer" }));

  await sanitizePlaywrightTrace({
    rawPath,
    outputPath: finalPath,
    fingerprints: [password, wrongPassword].map((value) => fingerprintSecret(value)),
  });

  const sanitizedBytes = await readFile(finalPath);
  const sanitized = await JSZip.loadAsync(sanitizedBytes);
  assert.deepEqual(Object.keys(sanitized.files).sort(), Object.keys(zip.files).sort());
  assert.deepEqual(await sanitized.file("resources/image.png")!.async("nodebuffer"), binary);
  for (const name of ["trace.network", "trace.trace", "context-1.trace", "context-1.network", "resources/request-body.txt", "resources/request-body.bin", "resources/source.txt"]) {
    const text = await sanitized.file(name)!.async("string");
    assert.doesNotMatch(text, /CANARY_PASSWORD_456|CANARY_WRONG_PASSWORD_789|CANARY_TOKEN_123|CANARY_COOKIE_321|DYNAMIC_(?:DOM_PASSWORD|DOM_CSRF_TOKEN|DOM_META_TOKEN|BODY_TOKEN|CSRF_HEADER_TOKEN|API_KEY_HEADER|CSRF_TOKEN|META_TOKEN|LOCAL_TOKEN|SESSION_TOKEN|CONST_TOKEN|PREFIXED_TRACE_TOKEN|PREFIXED_NETWORK_TOKEN)/);
  }
  assert.equal(await sanitized.file("resources/request-body.txt")!.async("string"), "[REDACTED]");
  assert.equal(await sanitized.file("resources/request-body.bin")!.async("string"), "[REDACTED]");
  const network = await sanitized.file("trace.network")!.async("string");
  assert.doesNotMatch(network, /Bearer\s+(?!\[REDACTED\])/);
  assert.doesNotMatch(network, /Set-Cookie[^\n]*CANARY/);
});

test("fails closed and removes both raw and final Trace when sanitization is unsafe", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "trace-sanitizer-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rawPath = path.join(root, "raw.zip");
  const finalPath = path.join(root, "playwright-trace.zip");
  await writeFile(rawPath, "not a zip", "utf8");
  await writeFile(finalPath, "stale unsafe evidence", "utf8");

  await assert.rejects(() => sanitizePlaywrightTrace({ rawPath, outputPath: finalPath, fingerprints: [] }));
  await assert.rejects(() => access(rawPath), /ENOENT/);
  await assert.rejects(() => access(finalPath), /ENOENT/);
});

test("fails closed when any prefixed Trace NDJSON entry is not valid UTF-8", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "trace-sanitizer-invalid-prefixed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rawPath = path.join(root, "raw.zip");
  const finalPath = path.join(root, "playwright-trace.zip");
  const zip = new JSZip();
  zip.file("trace.trace", `${JSON.stringify({ type: "context-options", version: 8 })}\n`);
  zip.file("context-1.network", Buffer.from([0xff, 0xfe, 0x00, 0x7b]));
  await writeFile(rawPath, await zip.generateAsync({ type: "nodebuffer" }));

  await assert.rejects(() => sanitizePlaywrightTrace({ rawPath, outputPath: finalPath, fingerprints: [] }));
  await assert.rejects(() => access(rawPath), /ENOENT/);
  await assert.rejects(() => access(finalPath), /ENOENT/);
});
