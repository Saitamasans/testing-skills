import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { SourceSnapshot } from "../types.js";
import { detectInputFromBytes, type DetectedInput } from "./detect-input.js";

export type { SourceSnapshot } from "../types.js";

export interface InspectedSource {
  bytes: Buffer;
  detected: DetectedInput;
  snapshot: SourceSnapshot;
}

export async function inspectSource(file: string): Promise<InspectedSource> {
  const absolutePath = path.resolve(file);
  const [bytes, sourceStat] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  const detected = await detectInputFromBytes(absolutePath, bytes);
  return {
    bytes,
    detected,
    snapshot: {
      absolute_path: absolutePath,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      size: bytes.byteLength,
      modified_at: sourceStat.mtime.toISOString(),
      input_kind: detected.input_kind,
      sheet_names: [...detected.sheet_names],
    },
  };
}

export async function snapshotSource(file: string): Promise<SourceSnapshot> {
  return (await inspectSource(file)).snapshot;
}
