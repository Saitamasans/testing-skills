import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256Canonical } from "../src/compiler/canonical-json.js";
import { applyLocatorApproval } from "../src/locator/approval.js";
import { createLocatorProposal } from "../src/locator/proposal.js";
import type { RunManifest } from "../src/types.js";

function manifest(): RunManifest {
  return {
    protocol_version: "1.0.0",
    manifest_id: "manifest-locator",
    runner: { version: "1.0.0" },
    source: { path: "report.json", sha256: "a".repeat(64) },
    cases: [
      {
        case_id: "CASE-001",
        original: {
          "用例 ID": "CASE-001",
          "所属模块": "web",
          "用例标题": "submit",
          "验证功能点": "locator repair",
          "前置条件": "",
          "测试步骤": "click submit",
          "预期结果": "submitted",
          "优先级": "P0",
          "执行结果": "",
          "备注": "",
        },
        steps: [
          {
            type: "web.click",
            action_id: "CASE-001-submit",
            target_alias: "web",
            locator: "text=Submit",
            risk: "R0",
          },
        ],
      },
    ],
  };
}

test("locator proposal ranks semantic candidates without mutating manifest bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "runner-locator-"));
  const manifestFile = path.join(directory, "run-manifest.json");
  const original = manifest();
  await writeFile(manifestFile, JSON.stringify(original, null, 2), "utf8");
  const before = await readFile(manifestFile);

  const proposal = createLocatorProposal({
    manifest_hash: sha256Canonical(original),
    action_id: "CASE-001-submit",
    old_locator: "text=Submit",
    matched_count: 0,
    url_origin: "https://app.example.test",
    dom_fragment: "<button data-testid=\"submit-order\">Submit order</button>",
    accessibility_fragment: "button Submit order",
    candidates: [
      { locator: "css=.primary", strategy: "stable-css", unique: true, element_summary: "button Submit order" },
      { locator: "data-testid=submit-order", strategy: "data-testid", unique: true, element_summary: "button Submit order" },
    ],
  });

  assert.equal((await readFile(manifestFile)).compare(before), 0);
  assert.equal(proposal.candidate_locator, "data-testid=submit-order");
  assert.equal(proposal.confidence > 0.8, true);
  assert.match(proposal.proposal_hash, /^[a-f0-9]{64}$/);
});

test("ambiguous locator proposal requires manual input and cannot be executed as approval", () => {
  const original = manifest();
  const proposal = createLocatorProposal({
    manifest_hash: sha256Canonical(original),
    action_id: "CASE-001-submit",
    old_locator: "text=Submit",
    matched_count: 3,
    url_origin: "https://app.example.test",
    dom_fragment: "<button>Submit</button><button>Submit</button>",
    accessibility_fragment: "two buttons named Submit",
    candidates: [
      { locator: "text=Submit", strategy: "text", unique: false, element_summary: "button Submit" },
    ],
  });

  assert.equal(proposal.candidate_locator, null);
  assert.equal(proposal.requires_manual_input, true);
  assert.throws(
    () => applyLocatorApproval(original, proposal, { proposal_hash: proposal.proposal_hash, approved: false }),
    /approval/i,
  );
});

test("applying locator approval requires unchanged manifest and proposal hashes", () => {
  const original = manifest();
  const proposal = createLocatorProposal({
    manifest_hash: sha256Canonical(original),
    action_id: "CASE-001-submit",
    old_locator: "text=Submit",
    matched_count: 0,
    url_origin: "https://app.example.test",
    dom_fragment: "<button data-testid=\"submit-order\">Submit order</button>",
    accessibility_fragment: "button Submit order",
    candidates: [
      { locator: "data-testid=submit-order", strategy: "data-testid", unique: true, element_summary: "button Submit order" },
    ],
  });
  const changed = structuredClone(original);
  changed.cases[0]!.steps[0]!.risk = "R1";

  assert.throws(
    () => applyLocatorApproval(changed, proposal, { proposal_hash: proposal.proposal_hash, approved: true }),
    /manifest hash/i,
  );

  const updated = applyLocatorApproval(original, proposal, { proposal_hash: proposal.proposal_hash, approved: true });
  assert.equal((updated.cases[0]!.steps[0] as { locator: string }).locator, "data-testid=submit-order");
  assert.notEqual(sha256Canonical(updated), sha256Canonical(original));
});
