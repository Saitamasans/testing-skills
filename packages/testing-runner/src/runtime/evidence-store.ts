import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface EvidenceItem {
  runDir: string;
  case_id: string;
  attempt: number;
  relativePath: string;
  content: string | Buffer;
}

export interface EvidenceIndexEntry {
  case_id: string;
  attempt: number;
  path: string;
  sha256: string;
  size: number;
}

function normalizeRelativePath(relativePath: string): string {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\/+/, "");
  if (normalized.includes("..")) throw new Error(`Invalid evidence path: ${relativePath}`);
  return normalized;
}

async function readIndex(file: string): Promise<EvidenceIndexEntry[]> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as EvidenceIndexEntry[];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function storeEvidence(item: EvidenceItem): Promise<EvidenceIndexEntry> {
  const content = typeof item.content === "string" ? Buffer.from(item.content, "utf8") : item.content;
  const relative = path.join("evidence", item.case_id, `attempt-${item.attempt}`, normalizeRelativePath(item.relativePath));
  const absolute = path.join(item.runDir, relative);
  await mkdir(path.dirname(absolute), { recursive: true });
  try {
    await writeFile(absolute, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Evidence path already exists and will not be overwritten: ${relative}`);
    }
    throw error;
  }
  const entry: EvidenceIndexEntry = {
    case_id: item.case_id,
    attempt: item.attempt,
    path: relative.replaceAll("\\", "/"),
    sha256: createHash("sha256").update(content).digest("hex"),
    size: content.byteLength,
  };
  const indexFile = path.join(item.runDir, "evidence-index.json");
  const index = await readIndex(indexFile);
  index.push(entry);
  await writeFile(indexFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return entry;
}
