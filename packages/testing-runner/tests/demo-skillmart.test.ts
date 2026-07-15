import assert from "node:assert/strict";
import test from "node:test";

import { startSkillMartApp } from "./fixtures/skillmart-app.js";

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

