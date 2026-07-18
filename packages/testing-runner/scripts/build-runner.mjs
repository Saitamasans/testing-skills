import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const require = createRequire(import.meta.url);
const commands = [
  [require.resolve("typescript/bin/tsc"), ["-p", path.join(packageRoot, "tsconfig.json")]],
  [path.join(packageRoot, "scripts", "copy-schemas.mjs"), []],
  [path.join(packageRoot, "scripts", "copy-knowledge.mjs"), []],
  [path.join(packageRoot, "scripts", "copy-renderer.mjs"), []],
];

for (const [script, args] of commands) {
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd: packageRoot,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) reject(new Error(`Runner build terminated by ${signal}`));
      else if (code !== 0) reject(new Error(`Runner build step failed with exit code ${code}: ${script}`));
      else resolve();
    });
  });
}