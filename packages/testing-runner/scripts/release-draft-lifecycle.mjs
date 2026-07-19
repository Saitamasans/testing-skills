import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const API_VERSION = "2022-11-28";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readError(response) {
  try {
    return JSON.stringify(await response.json());
  } catch {
    return `HTTP ${response.status}`;
  }
}

export function createGitHubReleaseClient({ repository, token, fetchImpl = globalThis.fetch }) {
  if (!repository || !repository.includes("/")) throw new Error("repository must be owner/name");
  if (!token) throw new Error("GitHub token is required");

  async function request(url, { method = "GET", accept = "application/vnd.github+json", body, binary = false } = {}) {
    const headers = {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      "User-Agent": "testing-skills-release-draft-lifecycle",
    };
    if (body !== undefined && !Buffer.isBuffer(body)) headers["Content-Type"] = "application/json";
    if (Buffer.isBuffer(body)) headers["Content-Type"] = "application/octet-stream";
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body === undefined || Buffer.isBuffer(body) ? body : JSON.stringify(body),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`GitHub API ${method} ${url} failed: ${await readError(response)}`);
    if (binary) return Buffer.from(await response.arrayBuffer());
    return response.json();
  }

  const api = `https://api.github.com/repos/${repository}`;
  return {
    listReleases(page, perPage) {
      return request(`${api}/releases?per_page=${perPage}&page=${page}`);
    },
    getRelease(releaseId) {
      return request(`${api}/releases/${releaseId}`);
    },
    getReleaseByTag(tag) {
      return request(`${api}/releases/tags/${encodeURIComponent(tag)}`);
    },
    createDraft({ tag, targetCommitish, title }) {
      return request(`${api}/releases`, {
        method: "POST",
        body: {
          tag_name: tag,
          target_commitish: targetCommitish,
          name: title,
          draft: true,
          prerelease: false,
        },
      });
    },
    uploadAsset(releaseId, asset) {
      return request(`https://uploads.github.com/repos/${repository}/releases/${releaseId}/assets?name=${encodeURIComponent(asset.name)}`, {
        method: "POST",
        body: asset.bytes,
      });
    },
    downloadAsset(assetId) {
      return request(`${api}/releases/assets/${assetId}`, {
        accept: "application/octet-stream",
        binary: true,
      });
    },
    publishRelease(releaseId) {
      return request(`${api}/releases/${releaseId}`, {
        method: "PATCH",
        body: { draft: false },
      });
    },
    downloadPublicAsset(url) {
      return request(url, { accept: "application/octet-stream", binary: true });
    },
  };
}

export async function discoverReleases({ client, tag }) {
  const matching = [];
  const perPage = 100;

  for (let page = 1; ; page += 1) {
    const releases = await client.listReleases(page, perPage);
    matching.push(...releases.filter((release) => release.tag_name === tag));
    if (releases.length < perPage) break;
  }

  return {
    drafts: matching.filter((release) => release.draft === true),
    publicReleases: matching.filter((release) => release.draft !== true),
  };
}

function sortedAssetNames(assets) {
  return assets.map(({ name }) => name).sort();
}

export function validateDraft({ release, tag, targetCommitish, expectedAssetNames }) {
  if (release.tag_name !== tag) {
    throw new Error(`draft tag mismatch: expected ${tag}, got ${release.tag_name}`);
  }
  if (release.target_commitish !== targetCommitish) {
    throw new Error(`draft target commit mismatch: expected ${targetCommitish}, got ${release.target_commitish}`);
  }
  if (release.draft !== true) {
    throw new Error(`release ${release.id} is not a draft`);
  }
  if (release.prerelease !== false) {
    throw new Error(`draft ${release.id} has an invalid prerelease state`);
  }
  const expected = [...expectedAssetNames].sort();
  const actual = sortedAssetNames(release.assets ?? []);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`draft ${release.id} asset allowlist mismatch: expected ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
  return release;
}

export async function prepareDraft({ client, tag, targetCommitish, title, assets }) {
  const { drafts, publicReleases } = await discoverReleases({ client, tag });
  if (publicReleases.length > 0) {
    throw new Error(`public release already exists for ${tag}: ${publicReleases.map(({ id }) => id).join(", ")}`);
  }
  if (drafts.length > 1) {
    throw new Error(`multiple draft releases exist for ${tag}: ${drafts.map(({ id }) => id).join(", ")}`);
  }

  const expectedAssetNames = assets.map(({ name }) => name);
  if (drafts.length === 1) {
    const release = await client.getRelease(drafts[0].id);
    validateDraft({ release, tag, targetCommitish, expectedAssetNames });
    return {
      releaseId: release.id,
      releaseUrl: release.html_url,
      createdOrReused: "reused",
    };
  }

  const created = await client.createDraft({ tag, targetCommitish, title });
  for (const asset of assets) {
    await client.uploadAsset(created.id, asset);
  }
  const release = await client.getRelease(created.id);
  validateDraft({ release, tag, targetCommitish, expectedAssetNames });
  return {
    releaseId: created.id,
    releaseUrl: created.html_url,
    createdOrReused: "created",
  };
}

function expectedAssetMap(expectedAssets) {
  return new Map(expectedAssets.map((asset) => [asset.name, { ...asset, bytes: Buffer.from(asset.bytes) }]));
}

function validateAssetMetadata(asset, expected) {
  if (asset.size !== expected.bytes.length) {
    throw new Error(`asset ${asset.name} size mismatch: expected ${expected.bytes.length}, got ${asset.size}`);
  }
  const expectedDigest = `sha256:${sha256(expected.bytes)}`;
  if (asset.digest != null && asset.digest !== expectedDigest) {
    throw new Error(`asset ${asset.name} SHA-256 mismatch: expected ${expectedDigest}, got ${asset.digest}`);
  }
}

function verifyDownloadedBytes(asset, expected, actualBytes) {
  const actual = Buffer.from(actualBytes);
  if (actual.length !== asset.size) {
    throw new Error(`asset ${asset.name} downloaded size mismatch: expected ${asset.size}, got ${actual.length}`);
  }
  if (!actual.equals(expected.bytes)) {
    throw new Error(`asset ${asset.name} downloaded bytes differ from the trusted artifact`);
  }
  if (sha256(actual) !== sha256(expected.bytes)) {
    throw new Error(`asset ${asset.name} downloaded SHA-256 differs from the trusted artifact`);
  }
  return actual;
}

export async function downloadAndVerifyDraft({ client, releaseId, tag, targetCommitish, expectedAssets }) {
  const release = await client.getRelease(releaseId);
  validateDraft({
    release,
    tag,
    targetCommitish,
    expectedAssetNames: expectedAssets.map(({ name }) => name),
  });
  const expectedByName = expectedAssetMap(expectedAssets);
  const assets = [];
  for (const asset of release.assets) {
    const expected = expectedByName.get(asset.name);
    validateAssetMetadata(asset, expected);
    const bytes = verifyDownloadedBytes(asset, expected, await client.downloadAsset(asset.id));
    assets.push({ name: asset.name, bytes });
  }
  return { release, assets };
}

function validatePublicRelease({ release, releaseId, tag, targetCommitish, expectedAssetNames }) {
  if (release.id !== releaseId) {
    throw new Error(`public release id mismatch: expected ${releaseId}, got ${release.id}`);
  }
  if (release.tag_name !== tag) {
    throw new Error(`public release tag mismatch: expected ${tag}, got ${release.tag_name}`);
  }
  if (release.target_commitish !== targetCommitish) {
    throw new Error(`public release target commit mismatch: expected ${targetCommitish}, got ${release.target_commitish}`);
  }
  if (release.draft !== false) throw new Error(`release ${release.id} is still a draft`);
  if (release.prerelease !== false) throw new Error(`release ${release.id} has an invalid prerelease state`);
  const expected = [...expectedAssetNames].sort();
  const actual = sortedAssetNames(release.assets ?? []);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`public release asset allowlist mismatch: expected ${expected.join(", ")}; got ${actual.join(", ")}`);
  }
  return release;
}

export async function publishDraft({ client, releaseId, tag, targetCommitish, expectedAssetNames }) {
  const draft = await client.getRelease(releaseId);
  validateDraft({ release: draft, tag, targetCommitish, expectedAssetNames });
  const published = await client.publishRelease(releaseId);
  return validatePublicRelease({ release: published, releaseId, tag, targetCommitish, expectedAssetNames });
}

export async function verifyPublicRelease({
  client,
  releaseId,
  tag,
  targetCommitish,
  expectedAssets,
  onWarning = (message) => console.warn(message),
}) {
  const release = await client.getReleaseByTag(tag);
  validatePublicRelease({
    release,
    releaseId,
    tag,
    targetCommitish,
    expectedAssetNames: expectedAssets.map(({ name }) => name),
  });
  if (release.immutable !== true) {
    onWarning(`published release ${release.id} is not reported as immutable`);
  }
  const expectedByName = expectedAssetMap(expectedAssets);
  const assets = [];
  for (const asset of release.assets) {
    const expected = expectedByName.get(asset.name);
    validateAssetMetadata(asset, expected);
    const bytes = verifyDownloadedBytes(asset, expected, await client.downloadPublicAsset(asset.browser_download_url));
    assets.push({ name: asset.name, bytes });
  }
  return { release, assets };
}

function parseArguments(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const flag = rest[index];
    const value = rest[index + 1];
    if (!flag?.startsWith("--") || value == null) throw new Error(`invalid argument list near ${flag ?? "end"}`);
    options[flag.slice(2)] = value;
  }
  return { command, options };
}

function required(options, name) {
  const value = options[name];
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function readAssets(directory) {
  const root = path.resolve(directory);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, bytes: fs.readFileSync(path.join(root, entry.name)) }))
    .sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
}

function writeAssets(directory, assets) {
  const root = path.resolve(directory);
  fs.mkdirSync(root, { recursive: true });
  for (const asset of assets) fs.writeFileSync(path.join(root, asset.name), asset.bytes, { flag: "wx" });
}

function writeActionOutputs(result, outputPath) {
  if (!outputPath) return;
  fs.appendFileSync(outputPath, [
    `release_id=${result.releaseId}`,
    `release_url=${result.releaseUrl}`,
    `created_or_reused=${result.createdOrReused}`,
    "",
  ].join("\n"));
}

export async function runLifecycleCommand(argv, env = process.env) {
  const { command, options } = parseArguments(argv);
  const repository = options.repository ?? env.GITHUB_REPOSITORY;
  const token = options.token ?? env.GH_TOKEN;
  const client = createGitHubReleaseClient({ repository, token });
  const tag = required(options, "tag");

  if (command === "discover") {
    const result = await discoverReleases({ client, tag });
    return {
      drafts: result.drafts.map(({ id }) => id),
      publicReleases: result.publicReleases.map(({ id }) => id),
    };
  }

  const targetCommitish = required(options, "target");
  if (command === "prepare") {
    const assets = readAssets(required(options, "assets-dir"));
    const result = await prepareDraft({
      client,
      tag,
      targetCommitish,
      title: required(options, "title"),
      assets,
    });
    writeActionOutputs(result, env.GITHUB_OUTPUT);
    return result;
  }

  const releaseId = Number(required(options, "release-id"));
  if (!Number.isSafeInteger(releaseId) || releaseId <= 0) throw new Error("--release-id must be a positive integer");
  const expectedAssets = readAssets(required(options, "trusted-dir"));

  if (command === "validate") {
    const release = await client.getRelease(releaseId);
    validateDraft({
      release,
      tag,
      targetCommitish,
      expectedAssetNames: expectedAssets.map(({ name }) => name),
    });
    return { releaseId: release.id, validated: true };
  }
  if (command === "download") {
    const result = await downloadAndVerifyDraft({ client, releaseId, tag, targetCommitish, expectedAssets });
    writeAssets(required(options, "output-dir"), result.assets);
    return { releaseId: result.release.id, downloaded: result.assets.map(({ name }) => name) };
  }
  if (command === "publish") {
    const release = await publishDraft({
      client,
      releaseId,
      tag,
      targetCommitish,
      expectedAssetNames: expectedAssets.map(({ name }) => name),
    });
    return { releaseId: release.id, published: true };
  }
  if (command === "verify-public") {
    const result = await verifyPublicRelease({
      client,
      releaseId,
      tag,
      targetCommitish,
      expectedAssets,
      onWarning: (message) => console.log(`::warning::${message}`),
    });
    writeAssets(required(options, "output-dir"), result.assets);
    return { releaseId: result.release.id, verified: true };
  }
  throw new Error(`unsupported command: ${command ?? "<missing>"}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  runLifecycleCommand(process.argv.slice(2))
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
