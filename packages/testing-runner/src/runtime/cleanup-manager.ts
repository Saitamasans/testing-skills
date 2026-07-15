import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface CleanupItem {
  case_id: string;
  data_id: string;
  target_alias: string;
  created_at: string;
  strategy: "cleanup.api" | "cleanup.web";
}

export interface ManualCleanupItem extends CleanupItem {
  reason: string;
}

export interface CleanupInput {
  runDir: string;
  items: readonly CleanupItem[];
  execute(item: CleanupItem): Promise<void>;
}

export interface CleanupResult {
  status: "completed" | "manual_required";
  completed: CleanupItem[];
  manual: ManualCleanupItem[];
}

export async function executeCleanup(input: CleanupInput): Promise<CleanupResult> {
  const completed: CleanupItem[] = [];
  const manual: ManualCleanupItem[] = [];
  const ordered = [...input.items].sort((left, right) =>
    left.strategy === right.strategy ? 0 : left.strategy === "cleanup.api" ? -1 : 1,
  ).reverse();
  for (const item of ordered) {
    try {
      await input.execute(item);
      completed.push(item);
    } catch (error) {
      manual.push({
        ...item,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  if (manual.length > 0) {
    await mkdir(input.runDir, { recursive: true });
    await writeFile(path.join(input.runDir, "manual-cleanup.json"), `${JSON.stringify(manual, null, 2)}\n`, "utf8");
  }
  return { status: manual.length > 0 ? "manual_required" : "completed", completed, manual };
}
