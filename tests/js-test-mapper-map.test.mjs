import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL = path.join(ROOT, "skill-sources", "js-test-mapper");
const RENDER = path.join(SKILL, "scripts", "render-map.mjs");
const TEMPLATE = readFileSync(path.join(SKILL, "templates", "map.html"), "utf8");

function render(map) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "js-test-mapper-map-"));
  const jsonPath = path.join(dir, "map.json");
  const htmlPath = path.join(dir, "out.html");
  writeFileSync(jsonPath, JSON.stringify(map), "utf8");
  return { ...spawnSync(process.execPath, [RENDER, jsonPath, htmlPath], { encoding: "utf8" }), htmlPath };
}

function runLayout(flow) {
  const start = TEMPLATE.indexOf("function tw(");
  const end = TEMPLATE.indexOf("function bez(");
  const code = TEMPLATE.slice(start, end) + "\nreturn layout(flow);";
  return new Function("flow", code)(flow);
}

const tiny = {
  title: "t",
  one_liner: "o",
  modules: [{ id: "a", label: "A", status: "observed" }],
  module_edges: [],
  flows: [{
    id: "f",
    title: "F",
    nodes: [
      { id: "n1", label: "一步", status: "observed" },
      { id: "n2", label: "二步", status: "unverified" },
    ],
    edges: [{ from: "n1", to: "n2", label: "点下一步" }],
  }],
};

test("unlabeled edge fails render", () => {
  const map = structuredClone(tiny);
  map.flows[0].edges[0].label = "";
  const r = render(map);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /verb label/);
});

test("script-breaking label is escaped in HTML", () => {
  const map = structuredClone(tiny);
  map.flows[0].nodes[0].label = "</script><img>";
  const r = render(map);
  assert.equal(r.status, 0, r.stderr);
  const html = readFileSync(r.htmlPath, "utf8");
  assert.match(html, /\\u003c\/script>\\u003cimg/);
  assert.equal(html.includes("</script><img>"), false);
});

test("diamond merge is dropped by layout, not drawn as a second parent edge", () => {
  const flow = {
    id: "full",
    title: "钻石",
    nodes: [
      { id: "open", label: "开" },
      { id: "sms", label: "验证码" },
      { id: "pwd", label: "密码" },
      { id: "home", label: "首页" },
    ],
    edges: [
      { from: "open", to: "sms", label: "验证码" },
      { from: "open", to: "pwd", label: "密码" },
      { from: "sms", to: "home", label: "登录成功进入" },
      { from: "pwd", to: "home", label: "登录成功进入" },
    ],
  };
  const L = runLayout(flow);
  assert.equal(L.dropped.length, 1);
  assert.equal(L.dropped[0].from, "pwd");
  assert.equal(L.dropped[0].to, "home");
  assert.match(TEMPLATE, /dropKey\.has/);
  assert.match(TEMPLATE, /status: m\.status \|\| "unverified"/);
  assert.match(TEMPLATE, /nodes \|\| \[\]\)\.length/);
});

test("host-native skill does not ship runtime run-data or cognition schemas", () => {
  for (const name of ["run-data.schema.json", "cognition.schema.json"]) {
    assert.equal(existsSync(path.join(SKILL, "schemas", name)), false, name);
    assert.equal(existsSync(path.join(ROOT, "skills", "js-test-mapper", "schemas", name)), false, "public " + name);
    assert.equal(existsSync(path.join(ROOT, "plugins", "js-test-mapper", "skills", "js-test-mapper", "schemas", name)), false, "plugin " + name);
  }
  assert.equal(existsSync(path.join(SKILL, "schemas", "map.schema.json")), true);
});
