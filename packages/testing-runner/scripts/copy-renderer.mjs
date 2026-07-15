import { copyFile, mkdir, readFile } from "node:fs/promises";

const source = new URL("../../../tooling/test-case-renderer.mjs", import.meta.url);
const destination = new URL("../vendor/test-case-renderer.mjs", import.meta.url);
const checkMode = process.argv.includes("--check");

async function sameBytes() {
  try {
    const [left, right] = await Promise.all([readFile(source), readFile(destination)]);
    return left.equals(right);
  } catch {
    return false;
  }
}

if (checkMode) {
  if (!(await sameBytes())) {
    throw new Error("packages/testing-runner/vendor/test-case-renderer.mjs is missing or drifted from tooling/test-case-renderer.mjs");
  }
} else {
  await mkdir(new URL("../vendor/", import.meta.url), { recursive: true });
  await copyFile(source, destination);
}
