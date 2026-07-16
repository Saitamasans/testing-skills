import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startSkillMartApp } from "./fixtures/skillmart-app.js";

const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const builderPath = path.join(repoRoot, "demo", "skillmart", "scripts", "build-demo-materials.mjs");
const validatorPath = path.join(repoRoot, "demo", "skillmart", "scripts", "validate-demo-materials.mjs");

function runNode(args: string[]) {
  return spawnSync(process.execPath, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

test("SkillMart exposes products, coupons, orders and resettable seed data", async () => {
  const app = await startSkillMartApp();
  try {
    const products = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number; price: number }>;
    };
    assert.equal(products.products[0]?.sku, "SKU-BOOK-001");
    assert.equal(products.products[0]?.stock, 3);

    const coupon = await fetch(`${app.baseUrl}/api/coupons/SKILL20/eligibility?amount=120`).then((response) => response.json()) as {
      eligible: boolean;
      discount: number;
    };
    assert.deepEqual(coupon, { eligible: true, discount: 20 });

    const first = await fetch(`${app.baseUrl}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "same-key" },
      body: JSON.stringify({ user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: "SKILL20" }),
    }).then((response) => response.json()) as { order_id: string };
    const second = await fetch(`${app.baseUrl}/api/orders`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-idempotency-key": "same-key" },
      body: JSON.stringify({ user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: "SKILL20" }),
    }).then((response) => response.json()) as { order_id: string };

    assert.notEqual(first.order_id, second.order_id, "fixture intentionally keeps the idempotency defect");
    const afterDuplicate = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number }>;
    };
    assert.equal(afterDuplicate.products[0]?.stock, 1);

    const boundary = await fetch(
      `${app.baseUrl}/api/coupons/SKILL20/eligibility?amount=120&client_clicked_at=2026-07-15T23:59:59.900Z&server_received_at=2026-07-16T00:00:00.100Z`,
    ).then((response) => response.json()) as { verdict: string; conflict_sources: string[] };
    assert.equal(boundary.verdict, "待定");
    assert.deepEqual(boundary.conflict_sources, ["product-confirmation", "api-contract"]);

    await fetch(`${app.baseUrl}/__test/reset`, { method: "POST" });
    const reset = await fetch(`${app.baseUrl}/api/products`).then((response) => response.json()) as {
      products: Array<{ sku: string; stock: number }>;
    };
    assert.equal(reset.products[0]?.stock, 3);
  } finally {
    await app.close();
  }
});

test("SkillMart material skeleton cannot pass real Skill or execution gates", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "skillmart-materials-"));
  const outputRoot = path.join(tempRoot, "demo-output");
  try {
    const build = runNode([builderPath, "--out", outputRoot]);
    assert.equal(build.status, 0, build.stderr);

    const skeleton = runNode([validatorPath, "--root", outputRoot, "--phase", "skeleton", "--json"]);
    assert.equal(skeleton.status, 0, skeleton.stderr || skeleton.stdout);
    const skeletonResult = JSON.parse(skeleton.stdout) as { valid: boolean; phase: string; issues: unknown[] };
    assert.equal(skeletonResult.valid, true);
    assert.equal(skeletonResult.phase, "skeleton");
    assert.deepEqual(skeletonResult.issues, []);

    const skills = runNode([validatorPath, "--root", outputRoot, "--phase", "skills", "--json"]);
    assert.equal(skills.status, 2, skills.stderr || skills.stdout);
    const skillResult = JSON.parse(skills.stdout) as { valid: boolean; issues: Array<{ code: string }> };
    assert.equal(skillResult.valid, false);
    const codes = new Set(skillResult.issues.map((issue) => issue.code));
    assert.equal(codes.has("placeholder_skill_output"), true);
    assert.equal(codes.has("missing_invocation_record"), true);
    assert.equal(codes.has("missing_dual_delivery"), true);

    for (const phase of ["execution", "video"]) {
      const result = runNode([validatorPath, "--root", outputRoot, "--phase", phase, "--json"]);
      assert.equal(result.status, 2, `${phase}: ${result.stderr || result.stdout}`);
      const parsed = JSON.parse(result.stdout) as { valid: boolean; phase: string };
      assert.equal(parsed.valid, false);
      assert.equal(parsed.phase, phase);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("SkillMart skeleton index records reproducible SHA-256 file evidence", async () => {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "skillmart-index-"));
  const outputRoot = path.join(tempRoot, "demo-output");
  try {
    const build = runNode([builderPath, "--out", outputRoot]);
    assert.equal(build.status, 0, build.stderr);
    const index = JSON.parse(await readFile(path.join(outputRoot, "material-index.json"), "utf8")) as {
      files?: Array<{ path: string; sha256: string }>;
    };
    assert.ok(index.files && index.files.length > 20);
    for (const file of index.files) {
      assert.match(file.path, /^[^\\]+(?:\/[^\\]+)*$/);
      assert.match(file.sha256, /^[a-f0-9]{64}$/);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
