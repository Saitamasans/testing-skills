import { copyFile, mkdir, rm } from "node:fs/promises";

const knowledgeFiles = [
  "technical-rules.json",
  "high-risk-heuristics.json",
];

const sourceDirectory = new URL("../../../knowledge/", import.meta.url);
const destinationDirectory = new URL("../dist/knowledge/", import.meta.url);

await rm(destinationDirectory, { recursive: true, force: true });
await mkdir(destinationDirectory, { recursive: true });

for (const fileName of knowledgeFiles) {
  await copyFile(new URL(fileName, sourceDirectory), new URL(fileName, destinationDirectory));
}
