import { fingerprintSecret, type SecretFingerprint } from "./redactor.js";

export type CredentialSource =
  | "session_env"
  | "configured_env"
  | "approved_storage_state"
  | "manual_handoff";

export interface CredentialRef {
  alias: string;
  source: CredentialSource;
  name?: string;
  storageStatePath?: string;
  approved?: boolean;
  expiresAt?: string;
}

export interface ResolveCredentialOptions {
  now?: string | Date;
}

export class ManualCredentialRequiredError extends Error {
  constructor(alias: string) {
    super(`Manual credential handoff required for ${alias}`);
    this.name = "ManualCredentialRequiredError";
  }
}

export class CredentialResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialResolutionError";
  }
}

interface ResolvedCredential {
  alias: string;
  source: CredentialSource;
  value?: string;
}

const PRIORITY: Record<CredentialSource, number> = {
  session_env: 0,
  configured_env: 1,
  approved_storage_state: 2,
  manual_handoff: 3,
};

export class RuntimeSecretStore {
  readonly #values = new Map<string, string>();
  readonly #sources = new Map<string, CredentialSource>();
  readonly #fingerprints: SecretFingerprint[] = [];

  constructor(resolved: readonly ResolvedCredential[]) {
    for (const item of resolved) {
      this.#sources.set(item.alias, item.source);
      if (item.value !== undefined) {
        this.#values.set(item.alias, item.value);
        if (item.source !== "approved_storage_state") {
          this.#fingerprints.push(fingerprintSecret(item.value, item.alias));
        }
      }
    }
  }

  aliases(): string[] {
    return [...this.#sources.keys()];
  }

  selectedSource(alias: string): CredentialSource | undefined {
    return this.#sources.get(alias);
  }

  get(alias: string): string {
    const source = this.#sources.get(alias);
    if (source === "manual_handoff") throw new ManualCredentialRequiredError(alias);
    const value = this.#values.get(alias);
    if (value === undefined) throw new CredentialResolutionError(`Credential ${alias} is not resolved`);
    return value;
  }

  fingerprints(): SecretFingerprint[] {
    return [...this.#fingerprints];
  }

  toJSON(): never {
    throw new CredentialResolutionError("RuntimeSecretStore is not serializable");
  }
}

function assertAlias(alias: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(alias)) {
    throw new CredentialResolutionError(`Invalid credential alias: ${alias}`);
  }
}

function assertEnvName(name: string | undefined, alias: string): string {
  if (!name || !/^[A-Z][A-Z0-9_]*$/.test(name)) {
    throw new CredentialResolutionError(`Credential ${alias} must reference a valid environment variable`);
  }
  return name;
}

function isUnexpired(expiresAt: string | undefined, now: Date): boolean {
  if (!expiresAt) return false;
  const expiryMs = Date.parse(expiresAt);
  return Number.isFinite(expiryMs) && expiryMs > now.getTime();
}

function candidateValue(
  candidate: CredentialRef,
  env: NodeJS.ProcessEnv,
  now: Date,
): ResolvedCredential | undefined {
  if (candidate.source === "session_env" || candidate.source === "configured_env") {
    const name = assertEnvName(candidate.name, candidate.alias);
    const value = env[name];
    if (!value) return undefined;
    return { alias: candidate.alias, source: candidate.source, value };
  }
  if (candidate.source === "approved_storage_state") {
    if (!candidate.approved || !candidate.storageStatePath || !isUnexpired(candidate.expiresAt, now)) {
      return undefined;
    }
    return {
      alias: candidate.alias,
      source: candidate.source,
      value: candidate.storageStatePath,
    };
  }
  return { alias: candidate.alias, source: "manual_handoff" };
}

export function resolveCredentials(
  refs: readonly CredentialRef[],
  env: NodeJS.ProcessEnv,
  options: ResolveCredentialOptions = {},
): RuntimeSecretStore {
  const now = options.now instanceof Date ? options.now : new Date(options.now ?? Date.now());
  const byAlias = new Map<string, CredentialRef[]>();
  for (const ref of refs) {
    assertAlias(ref.alias);
    const group = byAlias.get(ref.alias) ?? [];
    group.push(ref);
    byAlias.set(ref.alias, group);
  }

  const resolved: ResolvedCredential[] = [];
  for (const [alias, candidates] of byAlias) {
    const sorted = [...candidates].sort((left, right) => PRIORITY[left.source] - PRIORITY[right.source]);
    const selected = sorted
      .map((candidate) => candidateValue(candidate, env, now))
      .find((candidate): candidate is ResolvedCredential => candidate !== undefined);
    if (!selected) throw new CredentialResolutionError(`No usable credential source for ${alias}`);
    resolved.push(selected);
  }
  return new RuntimeSecretStore(resolved);
}
