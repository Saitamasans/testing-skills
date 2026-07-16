import { startSkillMartApp } from "../../../packages/testing-runner/tests/fixtures/skillmart-app.js";

const configuredPort = process.env.SKILLMART_PORT === undefined
  ? 0
  : Number.parseInt(process.env.SKILLMART_PORT, 10);
if (!Number.isInteger(configuredPort) || configuredPort < 0 || configuredPort > 65535) {
  throw new Error("SKILLMART_PORT must be an integer between 0 and 65535");
}

const app = await startSkillMartApp({ port: configuredPort });

console.log(JSON.stringify({
  service: "SkillMart",
  origin: app.baseUrl,
  pid: process.pid,
  bound_host: "127.0.0.1",
}));

let closing = false;
async function close(): Promise<void> {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}

process.once("SIGINT", () => { void close(); });
process.once("SIGTERM", () => { void close(); });
