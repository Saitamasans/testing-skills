import { checkRuntime } from "../src/runtime-install.mjs";

const index = process.argv.indexOf("--install-root");
if (index < 0 || !process.argv[index + 1]) throw new Error("missing --install-root");
console.log(JSON.stringify(await checkRuntime(process.argv[index + 1])));
