import { installBundle } from "../src/runtime-install.mjs";

const args = new Map();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === "--repair") args.set(key, true);
  else args.set(key, process.argv[++index]);
}
for (const required of ["--bundle", "--manifest", "--install-root"]) if (!args.get(required)) throw new Error(`missing ${required}`);
const result = await installBundle({ bundlePath: args.get("--bundle"), manifestPath: args.get("--manifest"), installRoot: args.get("--install-root"), repair: Boolean(args.get("--repair")) });
console.log(JSON.stringify(result));
