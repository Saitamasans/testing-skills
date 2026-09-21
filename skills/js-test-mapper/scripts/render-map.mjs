#!/usr/bin/env node
/**
 * Render a visual test map HTML from map.json.
 * Usage: node render-map.mjs <map.json> <out.html>
 * Template is VISUAL LOCK — do not restyle; only inject JSON.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [,, inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error("usage: node render-map.mjs <map.json> <out.html>");
  process.exit(2);
}

const map = JSON.parse(readFileSync(inPath, "utf8"));
if (!map.title || !Array.isArray(map.modules) || !Array.isArray(map.flows)) {
  console.error("map.json needs title, modules[], flows[]");
  process.exit(1);
}
if (!map.flows.length) {
  console.error("at least one flow is required; if business flow is unknown, emit a page-relation flow, do not invent one");
  process.exit(1);
}
const unlabeled = [];
for (const f of map.flows) {
  for (const e of f.edges || []) {
    if (!e.label || !String(e.label).trim()) unlabeled.push(f.id + ":" + e.from + "->" + e.to);
  }
}
for (const e of map.module_edges || []) {
  if (!e.label || !String(e.label).trim()) unlabeled.push("modules:" + e.from + "->" + e.to);
}
if (unlabeled.length) {
  console.error("every edge needs a verb label: " + unlabeled.join(", "));
  process.exit(1);
}

function embed(obj) {
  return JSON.stringify(obj)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const template = readFileSync(join(here, "..", "templates", "map.html"), "utf8");
if (!template.includes("__MAP_DATA_JSON__")) {
  console.error("template missing __MAP_DATA_JSON__ placeholder");
  process.exit(1);
}
const html = template.replace("__MAP_DATA_JSON__", embed(map));
writeFileSync(outPath, html, "utf8");
console.log(outPath);
