import { copyFile, mkdir, rm } from "node:fs/promises";

const schemaFiles = [
  "report.schema.json",
  "execution-profile.schema.json",
  "discovery-receipt.schema.json",
  "run-manifest.schema.json",
  "approval.schema.json",
  "run-result.schema.json",
  "persisted-value.schema.json",
];

const sourceDirectory = new URL("../../../schemas/", import.meta.url);
const destinationDirectory = new URL("../dist/schemas/", import.meta.url);

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });

for (const fileName of schemaFiles) {
  await copyFile(new URL(fileName, sourceDirectory), new URL(fileName, destinationDirectory));
}
