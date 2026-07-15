import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { redact, type SecretFingerprint } from "../security/redactor.js";

export interface RunEvent {
  run_id: string;
  case_id?: string;
  action_id?: string;
  attempt: number;
  type: string;
  timestamp?: string;
  data?: unknown;
}

export type PersistedRunEvent = RunEvent & {
  sequence: number;
  timestamp: string;
};

export class EventWriter {
  #sequence = 0;

  constructor(
    readonly file: string,
    readonly fingerprints: readonly SecretFingerprint[] = [],
  ) {}

  async appendEvent(event: RunEvent): Promise<PersistedRunEvent> {
    await mkdir(path.dirname(this.file), { recursive: true });
    const persisted: PersistedRunEvent = {
      ...event,
      sequence: ++this.#sequence,
      timestamp: event.timestamp ?? new Date().toISOString(),
      data: event.data === undefined ? undefined : redact(event.data, { fingerprints: this.fingerprints }),
    };
    await appendFile(this.file, `${JSON.stringify(persisted)}\n`, "utf8");
    return persisted;
  }
}
