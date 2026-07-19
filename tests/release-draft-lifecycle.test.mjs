import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitHubReleaseClient,
  discoverReleases,
  downloadAndVerifyDraft,
  prepareDraft,
  publishDraft,
  runLifecycleCommand,
  validateDraft,
  verifyPublicRelease,
} from "../packages/testing-runner/scripts/release-draft-lifecycle.mjs";

const TAG = "testing-runner-v1.1.2";
const COMMIT = "3088ed1763f430a1f617d86d6607792ef086e9fd";
const ASSETS = [
  { name: "SHA256SUMS.txt", bytes: Buffer.from("sums") },
  { name: "runner.tgz", bytes: Buffer.from("runner") },
];

function legalDraft(id = 42) {
  return {
    id,
    html_url: `https://github.test/releases/${id}`,
    tag_name: TAG,
    target_commitish: COMMIT,
    draft: true,
    prerelease: false,
    assets: ASSETS.map(({ name, bytes }, index) => ({
      id: id * 100 + index,
      name,
      size: bytes.length,
    })),
  };
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function publicRelease(id = 42, immutable = false) {
  return {
    ...legalDraft(id),
    draft: false,
    immutable,
    assets: ASSETS.map(({ name, bytes }, index) => ({
      id: id * 100 + index,
      name,
      size: bytes.length,
      digest: `sha256:${sha256(bytes)}`,
      browser_download_url: `https://downloads.test/${id}/${encodeURIComponent(name)}`,
    })),
  };
}

test("discovers matching drafts and public releases across every page", async () => {
  const calls = [];
  const firstPage = Array.from({ length: 100 }, (_, index) => ({
    id: index + 1,
    tag_name: `unrelated-${index + 1}`,
    draft: false,
  }));
  const client = {
    async listReleases(page, perPage) {
      calls.push({ page, perPage });
      if (page === 1) return firstPage;
      if (page === 2) {
        return [
          { id: 356357581, tag_name: "testing-runner-v1.1.2", draft: true },
          { id: 356358812, tag_name: "testing-runner-v1.1.2", draft: true },
          { id: 9001, tag_name: "testing-runner-v1.1.2", draft: false },
        ];
      }
      return [];
    },
  };

  const result = await discoverReleases({
    client,
    tag: "testing-runner-v1.1.2",
  });

  assert.deepEqual(calls, [
    { page: 1, perPage: 100 },
    { page: 2, perPage: 100 },
  ]);
  assert.deepEqual(result.drafts.map(({ id }) => id), [356357581, 356358812]);
  assert.deepEqual(result.publicReleases.map(({ id }) => id), [9001]);
});

test("creates one draft and keeps the release id from the create response", async () => {
  const calls = [];
  const client = {
    async listReleases() {
      calls.push("list");
      return [];
    },
    async createDraft(input) {
      calls.push({ create: input });
      return { id: 42, html_url: "https://github.test/releases/42" };
    },
    async uploadAsset(releaseId, asset) {
      calls.push({ upload: [releaseId, asset.name] });
      return { id: releaseId * 100 + calls.length, name: asset.name, size: asset.bytes.length };
    },
    async getRelease(releaseId) {
      calls.push({ get: releaseId });
      return legalDraft(releaseId);
    },
  };

  const result = await prepareDraft({
    client,
    tag: TAG,
    targetCommitish: COMMIT,
    title: "Testing Runner 1.1.2",
    assets: ASSETS,
  });

  assert.equal(result.releaseId, 42);
  assert.equal(result.releaseUrl, "https://github.test/releases/42");
  assert.equal(result.createdOrReused, "created");
  assert.equal(calls.filter((call) => call === "list").length, 1);
  assert.equal(calls.filter((call) => call.create).length, 1);
  assert.deepEqual(
    calls.filter((call) => call.upload).map((call) => call.upload),
    [[42, "SHA256SUMS.txt"], [42, "runner.tgz"]],
  );
  assert.deepEqual(calls.filter((call) => call.get), [{ get: 42 }]);
});

test("reuses one legal draft without creating or uploading assets", async () => {
  let createCalls = 0;
  let uploadCalls = 0;
  const client = {
    async listReleases() {
      return [legalDraft(77)];
    },
    async getRelease(releaseId) {
      assert.equal(releaseId, 77);
      return legalDraft(77);
    },
    async createDraft() {
      createCalls += 1;
    },
    async uploadAsset() {
      uploadCalls += 1;
    },
  };

  const result = await prepareDraft({
    client,
    tag: TAG,
    targetCommitish: COMMIT,
    title: "Testing Runner 1.1.2",
    assets: ASSETS,
  });

  assert.equal(result.releaseId, 77);
  assert.equal(result.createdOrReused, "reused");
  assert.equal(createCalls, 0);
  assert.equal(uploadCalls, 0);
});

test("fails closed with every id when more than one matching draft exists", async () => {
  let createCalls = 0;
  const client = {
    async listReleases() {
      return [legalDraft(356357581), legalDraft(356358812)];
    },
    async createDraft() {
      createCalls += 1;
    },
  };

  await assert.rejects(
    prepareDraft({ client, tag: TAG, targetCommitish: COMMIT, title: "Runner", assets: ASSETS }),
    /multiple draft releases.*356357581.*356358812/i,
  );
  assert.equal(createCalls, 0);
});

test("refuses to create or modify a draft when a public release already exists", async () => {
  let createCalls = 0;
  const client = {
    async listReleases() {
      return [{ ...legalDraft(91), draft: false }];
    },
    async createDraft() {
      createCalls += 1;
    },
  };

  await assert.rejects(
    prepareDraft({ client, tag: TAG, targetCommitish: COMMIT, title: "Runner", assets: ASSETS }),
    /public release already exists.*91/i,
  );
  assert.equal(createCalls, 0);
});

test("rejects a draft whose tag, target commit, state, or asset allowlist changed", () => {
  const expectedAssetNames = ASSETS.map(({ name }) => name);
  const cases = [
    [{ ...legalDraft(), tag_name: "wrong-tag" }, /tag/i],
    [{ ...legalDraft(), target_commitish: "wrong-commit" }, /target commit/i],
    [{ ...legalDraft(), draft: false }, /draft/i],
    [{ ...legalDraft(), prerelease: true }, /prerelease/i],
    [{ ...legalDraft(), assets: [{ id: 1, name: "unexpected.zip", size: 1 }] }, /asset allowlist/i],
  ];

  for (const [release, message] of cases) {
    assert.throws(
      () => validateDraft({ release, tag: TAG, targetCommitish: COMMIT, expectedAssetNames }),
      message,
    );
  }
});

test("downloads every draft asset by asset id and verifies exact trusted bytes", async () => {
  const release = legalDraft(51);
  const downloadedIds = [];
  const client = {
    async getRelease(releaseId) {
      assert.equal(releaseId, 51);
      return release;
    },
    async downloadAsset(assetId) {
      downloadedIds.push(assetId);
      const asset = release.assets.find(({ id }) => id === assetId);
      return ASSETS.find(({ name }) => name === asset.name).bytes;
    },
  };

  const result = await downloadAndVerifyDraft({
    client,
    releaseId: 51,
    tag: TAG,
    targetCommitish: COMMIT,
    expectedAssets: ASSETS,
  });

  assert.deepEqual(downloadedIds, release.assets.map(({ id }) => id));
  assert.deepEqual(result.assets.map(({ name }) => name).sort(), ASSETS.map(({ name }) => name).sort());
});

test("rejects draft asset size, digest, or downloaded byte drift", async () => {
  const cases = [
    [{ ...legalDraft(), assets: legalDraft().assets.map((asset, index) => index === 0 ? { ...asset, size: 999 } : asset) }, null, /size/i],
    [{ ...legalDraft(), assets: legalDraft().assets.map((asset, index) => index === 0 ? { ...asset, digest: "sha256:deadbeef" } : asset) }, null, /sha-256/i],
    [legalDraft(), Buffer.from("evil"), /bytes/i],
  ];

  for (const [release, replacement, message] of cases) {
    const client = {
      async getRelease() {
        return release;
      },
      async downloadAsset(assetId) {
        const asset = release.assets.find(({ id }) => id === assetId);
        if (replacement && asset.name === ASSETS[0].name) return replacement;
        return ASSETS.find(({ name }) => name === asset.name).bytes;
      },
    };
    await assert.rejects(
      downloadAndVerifyDraft({ client, releaseId: release.id, tag: TAG, targetCommitish: COMMIT, expectedAssets: ASSETS }),
      message,
    );
  }
});

test("publishes the validated draft by release id", async () => {
  const calls = [];
  const client = {
    async getRelease(releaseId) {
      calls.push({ get: releaseId });
      return legalDraft(releaseId);
    },
    async publishRelease(releaseId) {
      calls.push({ publish: releaseId });
      return publicRelease(releaseId, false);
    },
  };

  const release = await publishDraft({
    client,
    releaseId: 81,
    tag: TAG,
    targetCommitish: COMMIT,
    expectedAssetNames: ASSETS.map(({ name }) => name),
  });

  assert.equal(release.id, 81);
  assert.equal(release.draft, false);
  assert.deepEqual(calls, [{ get: 81 }, { publish: 81 }]);
});

test("warns for false or missing public immutability without weakening identity or bytes", async () => {
  for (const immutable of [false, undefined]) {
    const warnings = [];
    const release = publicRelease(72, immutable);
    const client = {
      async getReleaseByTag(tag) {
        assert.equal(tag, TAG);
        return release;
      },
      async downloadPublicAsset(url) {
        const name = decodeURIComponent(url.split("/").at(-1));
        return ASSETS.find((asset) => asset.name === name).bytes;
      },
    };

    await verifyPublicRelease({
      client,
      releaseId: 72,
      tag: TAG,
      targetCommitish: COMMIT,
      expectedAssets: ASSETS,
      onWarning: (message) => warnings.push(message),
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /immutable/i);
  }
});

test("keeps public release id, tag, commit, allowlist, size, SHA-256, and bytes as hard failures", async () => {
  const mutations = [
    [release => ({ ...release, id: 999 }), /release id/i],
    [release => ({ ...release, tag_name: "wrong-tag" }), /tag/i],
    [release => ({ ...release, target_commitish: "wrong-commit" }), /target commit/i],
    [release => ({ ...release, assets: release.assets.slice(1) }), /asset allowlist/i],
    [release => ({ ...release, assets: release.assets.map((asset, index) => index === 0 ? { ...asset, size: 999 } : asset) }), /size/i],
    [release => ({ ...release, assets: release.assets.map((asset, index) => index === 0 ? { ...asset, digest: "sha256:deadbeef" } : asset) }), /sha-256/i],
  ];

  for (const [mutate, message] of mutations) {
    const release = mutate(publicRelease(72, true));
    const client = {
      async getReleaseByTag() {
        return release;
      },
      async downloadPublicAsset(url) {
        const name = decodeURIComponent(url.split("/").at(-1));
        return ASSETS.find((asset) => asset.name === name)?.bytes ?? Buffer.alloc(0);
      },
    };
    await assert.rejects(
      verifyPublicRelease({ client, releaseId: 72, tag: TAG, targetCommitish: COMMIT, expectedAssets: ASSETS }),
      message,
    );
  }

  const release = publicRelease(72, true);
  const client = {
    async getReleaseByTag() {
      return release;
    },
    async downloadPublicAsset(url) {
      const name = decodeURIComponent(url.split("/").at(-1));
      if (name === ASSETS[0].name) return Buffer.from("evil");
      return ASSETS.find((asset) => asset.name === name).bytes;
    },
  };
  await assert.rejects(
    verifyPublicRelease({ client, releaseId: 72, tag: TAG, targetCommitish: COMMIT, expectedAssets: ASSETS }),
    /bytes/i,
  );
});

test("GitHub client uses release and asset ids for every draft operation", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, method: options.method ?? "GET", accept: options.headers?.Accept });
    const payload = url.includes("/assets/900") ? Buffer.from("asset") : Buffer.from("{}");
    return {
      ok: true,
      status: 200,
      headers: new Map(),
      async json() { return JSON.parse(payload.toString()); },
      async arrayBuffer() { return payload; },
    };
  };
  const client = createGitHubReleaseClient({ repository: "owner/repo", token: "token", fetchImpl });

  await client.getRelease(42);
  await client.downloadAsset(900);
  await client.publishRelease(42);

  assert.deepEqual(calls, [
    { url: "https://api.github.com/repos/owner/repo/releases/42", method: "GET", accept: "application/vnd.github+json" },
    { url: "https://api.github.com/repos/owner/repo/releases/assets/900", method: "GET", accept: "application/octet-stream" },
    { url: "https://api.github.com/repos/owner/repo/releases/42", method: "PATCH", accept: "application/vnd.github+json" },
  ]);
});

test("prepare command writes the create response id and uploads each trusted asset once", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "release-draft-command-"));
  const assetsDir = path.join(root, "assets");
  const output = path.join(root, "github-output.txt");
  const uploaded = [];
  const originalFetch = globalThis.fetch;
  try {
    await import("node:fs/promises").then(({ mkdir }) => mkdir(assetsDir));
    for (const asset of ASSETS) writeFileSync(path.join(assetsDir, asset.name), asset.bytes);
    globalThis.fetch = async (url, options = {}) => {
      let value;
      if (url.includes("/releases?per_page=100&page=1")) {
        value = [];
      } else if (url === "https://api.github.com/repos/owner/repo/releases" && options.method === "POST") {
        value = { id: 42, html_url: "https://github.test/releases/42" };
      } else if (url.startsWith("https://uploads.github.com/repos/owner/repo/releases/42/assets?name=")) {
        const name = decodeURIComponent(url.split("name=")[1]);
        const bytes = Buffer.from(options.body);
        uploaded.push({ name, bytes });
        value = { id: 4200 + uploaded.length, name, size: bytes.length };
      } else if (url === "https://api.github.com/repos/owner/repo/releases/42") {
        value = {
          id: 42,
          html_url: "https://github.test/releases/42",
          tag_name: TAG,
          target_commitish: COMMIT,
          draft: true,
          prerelease: false,
          assets: uploaded.map(({ name, bytes }, index) => ({ id: 4201 + index, name, size: bytes.length })),
        };
      } else {
        throw new Error(`unexpected request: ${options.method ?? "GET"} ${url}`);
      }
      return {
        ok: true,
        status: 200,
        async json() { return value; },
        async arrayBuffer() { return Buffer.from(JSON.stringify(value)); },
      };
    };

    const result = await runLifecycleCommand([
      "prepare", "--tag", TAG, "--target", COMMIT,
      "--title", "Testing Runner 1.1.2", "--assets-dir", assetsDir,
    ], {
      GITHUB_REPOSITORY: "owner/repo",
      GH_TOKEN: "token",
      GITHUB_OUTPUT: output,
    });

    assert.equal(result.releaseId, 42);
    assert.equal(result.createdOrReused, "created");
    assert.deepEqual(uploaded.map(({ name }) => name), ASSETS.map(({ name }) => name).sort());
    assert.equal(readFileSync(output, "utf8"), [
      "release_id=42",
      "release_url=https://github.test/releases/42",
      "created_or_reused=created",
      "",
    ].join("\n"));
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(root, { recursive: true, force: true });
  }
});
