import { parse as parseSfc } from "@vue/compiler-sfc";

export function extractVueScriptBlocks(source, filename = "component.vue") {
  const result = parseSfc(source, { filename, sourceMap: false });
  if (result.errors.length) return { status: "parse_failed", scripts: [], errors: result.errors.map((error) => String(error.message || error)) };
  const scripts = [];
  if (result.descriptor.script) scripts.push({ kind: "script", language: result.descriptor.script.lang || "js", content: result.descriptor.script.content, offset: result.descriptor.script.loc.start.offset });
  if (result.descriptor.scriptSetup) scripts.push({ kind: "script_setup", language: result.descriptor.scriptSetup.lang || "js", content: result.descriptor.scriptSetup.content, offset: result.descriptor.scriptSetup.loc.start.offset });
  return { status: scripts.length ? "extracted" : "no_script", scripts, errors: [] };
}
