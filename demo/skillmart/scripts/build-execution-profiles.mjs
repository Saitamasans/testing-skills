import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SUITE_IDS = {
  requirementWorkbench: [
    "WB-PROD-001", "WB-PROD-002", "WB-CPN-001", "WB-CPN-002", "WB-CPN-003", "WB-ORD-001",
    "WB-ORD-002", "WB-ORD-003", "WB-ORD-004", "WB-AUTH-001", "WB-AUTH-002", "WB-STATE-001",
    "WB-STATE-002", "WB-STATE-003", "WB-PAY-001", "WB-PAY-002", "WB-CONS-001", "WB-CONS-002",
  ],
  singleApiFull: [
    "API-FULL-001", "API-FULL-002", "API-FULL-003", "API-FULL-005", "API-FULL-017", "API-FULL-004",
    "API-FULL-006", "API-FULL-007", "API-FULL-008", "API-FULL-013", "API-FULL-014", "API-FULL-015",
    "API-FULL-016", "API-FULL-019", "API-FULL-009", "API-FULL-010", "API-FULL-011", "API-FULL-012",
    "API-FULL-018", "API-FULL-020",
  ],
  singleApiConcise: [
    "API-CONCISE-001", "API-CONCISE-004", "API-CONCISE-005", "API-CONCISE-002", "API-CONCISE-003",
    "API-CONCISE-006", "API-CONCISE-007",
  ],
  multiApiFlow: [
    "FLOW-001", "FLOW-002", "FLOW-003", "FLOW-004", "FLOW-005", "FLOW-009", "FLOW-011", "FLOW-010",
    "FLOW-006", "FLOW-007", "FLOW-012", "FLOW-008",
  ],
  productionVerification: ["PROD-L0-001", "PROD-L0-002", "PROD-L0-003", "PROD-L0-004", "PROD-L0-005"],
};

const DATA = {
  user_a: "user-a",
  user_b: "user-b",
  blank: "   ",
  idem_primary: "skillmart-idem-primary",
  idem_secondary: "skillmart-idem-secondary",
  idem_tertiary: "skillmart-idem-tertiary",
  content_json: "application/json",
  content_text: "text/plain",
  raw_valid_order: "{\"user_id\":\"user-a\",\"sku\":\"SKU-BOOK-001\",\"quantity\":1}",
  raw_invalid_json: "{\"sku\":",
  amount_120: 120,
  amount_99: 99,
  client_before_expiry: "2026-07-15T23:59:59.900Z",
  server_after_expiry: "2026-07-16T00:00:00.100Z",
  order_user_a_qty1: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: "SKILL20" },
  order_user_a_qty2: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 2, coupon_code: "SKILL20" },
  order_user_a_qty3: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 3 },
  order_user_a_qty4: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 4 },
  order_user_b_qty1: { user_id: "user-b", sku: "SKU-BOOK-001", quantity: 1 },
  order_defaults: { sku: "SKU-BOOK-001" },
  order_no_user_qty1: { sku: "SKU-BOOK-001", quantity: 1 },
  order_identity_mismatch: { user_id: "user-b", sku: "SKU-BOOK-001", quantity: 1 },
  order_qty_zero: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 0 },
  order_qty_negative: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: -1 },
  order_qty_decimal: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1.5 },
  order_qty_string: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: "1" },
  order_sku_missing: { user_id: "user-a", quantity: 1 },
  order_sku_blank: { user_id: "user-a", sku: "   ", quantity: 1 },
  order_sku_number: { user_id: "user-a", sku: 1001, quantity: 1 },
  order_coupon_number: { user_id: "user-a", sku: "SKU-BOOK-001", quantity: 1, coupon_code: 20 },
  order_unknown_sku: { user_id: "user-a", sku: "SKU-NOT-FOUND", quantity: 1 },
  expected_true: true,
  expected_discount_20: 20,
  expected_stock_3: 3,
  expected_stock_2: 2,
  expected_stock_1: 1,
  expected_stock_0: 0,
  expected_qty_1: 1,
  expected_qty_3: 3,
  expected_user_a: "user-a",
  expected_user_b: "user-b",
  expected_pending_payment: "PENDING_PAYMENT",
  expected_paid: "PAID",
  expected_cancelled: "CANCELLED",
  expected_pending_verdict: "待定",
  expected_skillmart: "SkillMart",
  expected_config_policy: "conflicting-sources-demo",
  expected_error_content_type: "content_type_invalid",
  expected_error_invalid_json: "invalid_json",
  expected_error_idempotency: "idempotency_key_required",
  expected_error_quantity: "quantity_invalid",
  expected_error_identity_required: "user_identity_required",
  expected_error_identity_mismatch: "user_identity_mismatch",
  expected_error_sku: "sku_invalid",
  expected_error_coupon: "coupon_code_invalid",
  expected_error_stock: "stock_not_enough",
  expected_error_forbidden: "order_forbidden",
  expected_error_not_found: "order_not_found",
  expected_error_not_cancelable: "order_status_not_cancelable",
};

const ref = (name, source = "fixture") => ({ source, name });
const action = (type, id, values = {}) => ({ type, action_id: id, target_alias: type.startsWith("web.") ? "web" : "api", risk: "R0", ...values });
const request = (id, method, requestPath, values = {}) => action("api.request", id, { method, path: requestPath, risk: method === "GET" ? "R0" : "R1", ...values });
const concurrent = (id, method, requestPath, concurrency, values = {}) => action("api.concurrent", id, { method, path: requestPath, concurrency, risk: method === "GET" ? "R0" : "R1", ...values });
const apiAssert = (id, assertion, values = {}) => action("api.assert", id, { assertion, ...values });
const bodyAssert = (id, pointer, expected, values = {}) => apiAssert(id, `body ${pointer} equals fixture:${expected}`, values);
const extract = (id, pointer, name) => action("api.extract", id, { from: pointer, as: name });
const blocked = (id, reason) => action("execution.blocked", id, { reason });
const web = (type, id, values = {}) => action(type, id, values);

function headers(user = "user_a", idem = "idem_primary", contentType) {
  const result = {};
  if (user) result["x-user-id"] = ref(user);
  if (idem) result["x-idempotency-key"] = ref(idem);
  if (contentType) result["content-type"] = ref(contentType);
  return result;
}

function reset(id) {
  return [
    request(`${id}-reset`, "POST", "/__test/reset"),
    apiAssert(`${id}-reset-200`, "status is 200"),
  ];
}

function products(id, expectedStock) {
  return [
    request(`${id}-products`, "GET", "/api/products"),
    apiAssert(`${id}-products-200`, "status is 200"),
    bodyAssert(`${id}-stock`, "/body/products/0/stock", expectedStock),
  ];
}

function createOrder(id, {
  payload = "order_user_a_qty1",
  user = "user_a",
  idem = "idem_primary",
  variable = "order_id",
  suffix = "create",
} = {}) {
  return [
    request(`${id}-${suffix}`, "POST", "/api/orders", { input_ref: ref(payload), header_refs: headers(user, idem) }),
    apiAssert(`${id}-${suffix}-201`, "status is 201"),
    extract(`${id}-${suffix}-id`, "/body/order_id", variable),
  ];
}

function queryOrder(id, variable, user, statusName, suffix = "query") {
  return [
    request(`${id}-${suffix}`, "GET", `/api/orders/{{${variable}}}`, { header_refs: headers(user, null) }),
    apiAssert(`${id}-${suffix}-200`, "status is 200"),
    bodyAssert(`${id}-${suffix}-user`, "/body/user_id", user === "user_b" ? "expected_user_b" : "expected_user_a"),
    bodyAssert(`${id}-${suffix}-status`, "/body/status", statusName),
  ];
}

function payOrder(id, variable, suffix = "pay") {
  return [
    request(`${id}-${suffix}`, "POST", "/api/payments/callback", { json_body_refs: { order_id: ref(variable, "output") } }),
    apiAssert(`${id}-${suffix}-200`, "status is 200"),
    bodyAssert(`${id}-${suffix}-status`, "/body/status", "expected_paid"),
  ];
}

function cancelOrder(id, variable, user = "user_a", suffix = "cancel") {
  return [
    request(`${id}-${suffix}`, "POST", `/api/orders/{{${variable}}}/cancel`, { header_refs: headers(user, null) }),
    apiAssert(`${id}-${suffix}-200`, "status is 200"),
    bodyAssert(`${id}-${suffix}-status`, "/body/status", "expected_cancelled"),
  ];
}

function coupon(id, amount, suffix = "coupon") {
  return [
    request(`${id}-${suffix}`, "GET", "/api/coupons/SKILL20/eligibility", { query_refs: { amount: ref(amount) } }),
    apiAssert(`${id}-${suffix}-200`, "status is 200"),
  ];
}

function errorResponse(id, suffix, requestAction, status, expectedError) {
  return [
    requestAction,
    apiAssert(`${id}-${suffix}-${status}`, `status is ${status}`),
    bodyAssert(`${id}-${suffix}-error`, "/body/error", expectedError),
  ];
}

function serialIdempotencyFailure(id, suffix = "idem") {
  return [
    ...reset(id),
    ...createOrder(id, { variable: "first_order_id", suffix: `${suffix}-first` }),
    request(`${id}-${suffix}-second`, "POST", "/api/orders", { input_ref: ref("order_user_a_qty1"), header_refs: headers() }),
    apiAssert(`${id}-${suffix}-second-201`, "status is 201"),
    extract(`${id}-${suffix}-second-id`, "/body/order_id", "second_order_id"),
    ...products(`${id}-${suffix}`, "expected_stock_2").map((item) =>
      item.type === "api.assert" && item.action_id.endsWith("-stock")
        ? { ...item, root_cause_key: "idempotency-duplicate-order" }
        : item
    ),
  ];
}

function concurrentIdempotencyFailure(id) {
  return [
    ...reset(id),
    concurrent(`${id}-concurrent`, "POST", "/api/orders", 2, {
      input_ref: ref("order_user_a_qty1"),
      header_refs: headers(),
    }),
    apiAssert(`${id}-concurrent-status`, "batch status all 201"),
    apiAssert(`${id}-concurrent-order-id`, "batch body /body/order_id all equal", {
      root_cause_key: "idempotency-duplicate-order",
    }),
  ];
}

function retryIdempotencyFailure(id) {
  return [
    ...reset(id),
    ...createOrder(id, { variable: "first_order_id", suffix: "lost-response" }),
    request(`${id}-retry`, "POST", "/api/orders", { input_ref: ref("order_user_a_qty1"), header_refs: headers() }),
    apiAssert(`${id}-retry-201`, "status is 201"),
    apiAssert(`${id}-same-order`, "body /body/order_id equals output:first_order_id", {
      root_cause_key: "idempotency-duplicate-order",
    }),
  ];
}

function boundaryPending(id) {
  return [
    request(`${id}-boundary`, "GET", "/api/coupons/SKILL20/eligibility", {
      query_refs: {
        amount: ref("amount_120"),
        client_clicked_at: ref("client_before_expiry"),
        server_received_at: ref("server_after_expiry"),
      },
    }),
    apiAssert(`${id}-boundary-200`, "status is 200"),
    bodyAssert(`${id}-boundary-pending`, "/body/verdict", "expected_pending_verdict", { verdict_policy: "pending_only" }),
  ];
}

function requirementWorkbenchPlans(origin) {
  return {
    "WB-PROD-001": [
      ...reset("WB-PROD-001"),
      web("web.goto", "WB-PROD-001-open", { url: `${origin}/shop` }),
      web("web.assert", "WB-PROD-001-visible", { assertion: "visible:[data-testid=\"product-SKU-BOOK-001\"]" }),
      ...products("WB-PROD-001", "expected_stock_3"),
    ],
    "WB-PROD-002": [
      ...reset("WB-PROD-002"),
      ...createOrder("WB-PROD-002", { payload: "order_user_a_qty3", variable: "stock_zero_order_id" }),
      ...products("WB-PROD-002-zero", "expected_stock_0"),
      web("web.goto", "WB-PROD-002-open", { url: `${origin}/shop` }),
      web("web.click", "WB-PROD-002-click", { locator: "data-testid=create-order", risk: "R1" }),
      web("web.wait", "WB-PROD-002-wait-error", { condition: "business-state:stock_not_enough" }),
      web("web.assert", "WB-PROD-002-error-visible", { assertion: "text=stock_not_enough" }),
      ...errorResponse("WB-PROD-002", "api", request("WB-PROD-002-api-create", "POST", "/api/orders", {
        input_ref: ref("order_user_a_qty1"), header_refs: headers("user_a", "idem_secondary"),
      }), 409, "expected_error_stock"),
      ...products("WB-PROD-002-final", "expected_stock_0"),
    ],
    "WB-CPN-001": [blocked("WB-CPN-001-blocked", "订单响应未提供原金额、优惠金额和实付金额，无法完整判定该测试用例（Test Case）")],
    "WB-CPN-002": [blocked("WB-CPN-002-blocked", "资料未提供 99 元订单的稳定准备方式，且订单响应没有金额字段")],
    "WB-CPN-003": boundaryPending("WB-CPN-003"),
    "WB-ORD-001": [
      ...reset("WB-ORD-001"),
      ...createOrder("WB-ORD-001"),
      ...queryOrder("WB-ORD-001", "order_id", "user_a", "expected_pending_payment"),
      ...products("WB-ORD-001", "expected_stock_2"),
    ],
    "WB-ORD-002": serialIdempotencyFailure("WB-ORD-002"),
    "WB-ORD-003": [
      ...reset("WB-ORD-003"),
      web("web.goto", "WB-ORD-003-open", { url: `${origin}/shop` }),
      web("web.click", "WB-ORD-003-click-1", { locator: "data-testid=create-order", risk: "R1" }),
      web("web.click", "WB-ORD-003-click-2", { locator: "data-testid=create-order", risk: "R1" }),
      request("WB-ORD-003-products", "GET", "/api/products"),
      apiAssert("WB-ORD-003-products-200", "status is 200"),
      bodyAssert("WB-ORD-003-stock", "/body/products/0/stock", "expected_stock_2", { root_cause_key: "idempotency-duplicate-order" }),
    ],
    "WB-ORD-004": [
      ...reset("WB-ORD-004"),
      ...errorResponse("WB-ORD-004", "missing-key", request("WB-ORD-004-create", "POST", "/api/orders", {
        input_ref: ref("order_user_a_qty1"), header_refs: headers("user_a", null),
      }), 400, "expected_error_idempotency"),
      ...products("WB-ORD-004", "expected_stock_3"),
    ],
    "WB-AUTH-001": [blocked("WB-AUTH-001-blocked", "查询响应未提供金额字段，无法完成‘状态和金额与创建结果一致’的完整断言")],
    "WB-AUTH-002": [
      ...reset("WB-AUTH-002"), ...createOrder("WB-AUTH-002"),
      ...errorResponse("WB-AUTH-002", "cross-user", request("WB-AUTH-002-query", "GET", "/api/orders/{{order_id}}", {
        header_refs: headers("user_b", null),
      }), 403, "expected_error_forbidden"),
      ...products("WB-AUTH-002", "expected_stock_2"),
    ],
    "WB-STATE-001": [
      ...reset("WB-STATE-001"), ...createOrder("WB-STATE-001"), ...cancelOrder("WB-STATE-001", "order_id"),
      ...queryOrder("WB-STATE-001", "order_id", "user_a", "expected_cancelled", "query-after-cancel"),
      ...products("WB-STATE-001", "expected_stock_3"),
    ],
    "WB-STATE-002": [
      ...reset("WB-STATE-002"), ...createOrder("WB-STATE-002"), ...payOrder("WB-STATE-002", "order_id"),
      ...errorResponse("WB-STATE-002", "cancel-paid", request("WB-STATE-002-cancel", "POST", "/api/orders/{{order_id}}/cancel", {
        header_refs: headers("user_a", null),
      }), 409, "expected_error_not_cancelable"),
      ...queryOrder("WB-STATE-002", "order_id", "user_a", "expected_paid"), ...products("WB-STATE-002", "expected_stock_2"),
    ],
    "WB-STATE-003": [
      ...reset("WB-STATE-003"), ...createOrder("WB-STATE-003"), ...cancelOrder("WB-STATE-003", "order_id"),
      ...errorResponse("WB-STATE-003", "cancel-again", request("WB-STATE-003-cancel-again", "POST", "/api/orders/{{order_id}}/cancel", {
        header_refs: headers("user_a", null),
      }), 409, "expected_error_not_cancelable"),
      ...queryOrder("WB-STATE-003", "order_id", "user_a", "expected_cancelled"), ...products("WB-STATE-003", "expected_stock_3"),
    ],
    "WB-PAY-001": [
      ...reset("WB-PAY-001"), ...createOrder("WB-PAY-001"), ...payOrder("WB-PAY-001", "order_id"),
      ...queryOrder("WB-PAY-001", "order_id", "user_a", "expected_paid"), ...products("WB-PAY-001", "expected_stock_2"),
    ],
    "WB-PAY-002": [
      ...reset("WB-PAY-002"), ...createOrder("WB-PAY-002"), ...payOrder("WB-PAY-002", "order_id", "pay-first"),
      ...payOrder("WB-PAY-002", "order_id", "pay-second"), ...queryOrder("WB-PAY-002", "order_id", "user_a", "expected_paid"),
      ...products("WB-PAY-002", "expected_stock_2"),
    ],
    "WB-CONS-001": [blocked("WB-CONS-001-blocked", "订单金额、优惠结果和订单总数缺少受控只读核验入口")],
    "WB-CONS-002": [blocked("WB-CONS-002-blocked", "原用例未固定失败请求，且缺少订单计数入口；需先按审计修订映射确认")],
  };
}

function singleApiFullPlans() {
  const plans = {};
  plans["API-FULL-001"] = [
    ...reset("API-FULL-001"), ...createOrder("API-FULL-001"),
    bodyAssert("API-FULL-001-user", "/body/user_id", "expected_user_a"),
    bodyAssert("API-FULL-001-status", "/body/status", "expected_pending_payment"),
    ...products("API-FULL-001", "expected_stock_2"),
  ];
  plans["API-FULL-002"] = [
    ...reset("API-FULL-002"), request("API-FULL-002-wrong-method", "GET", "/api/orders"),
    apiAssert("API-FULL-002-not-201", "status is not 201"), apiAssert("API-FULL-002-not-500", "status is not 500"),
    ...products("API-FULL-002", "expected_stock_3"),
  ];
  plans["API-FULL-003"] = [
    ...reset("API-FULL-003"),
    ...errorResponse("API-FULL-003", "missing-content-type", request("API-FULL-003-missing-content-type", "POST", "/api/orders", {
      raw_body_ref: ref("raw_valid_order"), header_refs: headers("user_a", "idem_primary"),
    }), 400, "expected_error_content_type"),
    ...errorResponse("API-FULL-003", "wrong-content-type", request("API-FULL-003-wrong-content-type", "POST", "/api/orders", {
      raw_body_ref: ref("raw_valid_order"), header_refs: headers("user_a", "idem_secondary", "content_text"),
    }), 400, "expected_error_content_type"),
    ...products("API-FULL-003", "expected_stock_3"),
  ];
  plans["API-FULL-005"] = [
    ...reset("API-FULL-005"), ...errorResponse("API-FULL-005", "invalid-json", request("API-FULL-005-invalid-json", "POST", "/api/orders", {
      raw_body_ref: ref("raw_invalid_json"), header_refs: headers("user_a", "idem_primary", "content_json"),
    }), 400, "expected_error_invalid_json"), ...products("API-FULL-005", "expected_stock_3"),
  ];
  plans["API-FULL-017"] = [
    ...reset("API-FULL-017"), ...createOrder("API-FULL-017", { payload: "order_defaults" }),
    bodyAssert("API-FULL-017-user", "/body/user_id", "expected_user_a"),
    bodyAssert("API-FULL-017-quantity", "/body/quantity", "expected_qty_1"),
    bodyAssert("API-FULL-017-status", "/body/status", "expected_pending_payment"), ...products("API-FULL-017", "expected_stock_2"),
  ];
  plans["API-FULL-004"] = [
    ...reset("API-FULL-004"),
    ...errorResponse("API-FULL-004", "missing", request("API-FULL-004-missing", "POST", "/api/orders", {
      input_ref: ref("order_user_a_qty1"), header_refs: headers("user_a", null),
    }), 400, "expected_error_idempotency"),
    ...errorResponse("API-FULL-004", "blank", request("API-FULL-004-blank", "POST", "/api/orders", {
      input_ref: ref("order_user_a_qty1"), header_refs: headers("user_a", "blank"),
    }), 400, "expected_error_idempotency"), ...products("API-FULL-004", "expected_stock_3"),
  ];
  plans["API-FULL-006"] = [...reset("API-FULL-006")];
  for (const [suffix, payload] of [["zero", "order_qty_zero"], ["negative", "order_qty_negative"], ["decimal", "order_qty_decimal"], ["string", "order_qty_string"]]) {
    plans["API-FULL-006"].push(...errorResponse("API-FULL-006", suffix, request(`API-FULL-006-${suffix}`, "POST", "/api/orders", {
      input_ref: ref(payload), header_refs: headers(),
    }), 400, "expected_error_quantity"));
  }
  plans["API-FULL-006"].push(...products("API-FULL-006", "expected_stock_3"));
  plans["API-FULL-007"] = [
    ...reset("API-FULL-007"), ...createOrder("API-FULL-007", { payload: "order_user_a_qty3" }),
    bodyAssert("API-FULL-007-quantity", "/body/quantity", "expected_qty_3"), ...products("API-FULL-007", "expected_stock_0"),
  ];
  plans["API-FULL-008"] = [
    ...reset("API-FULL-008"), ...errorResponse("API-FULL-008", "stock", request("API-FULL-008-create", "POST", "/api/orders", {
      input_ref: ref("order_user_a_qty4"), header_refs: headers(),
    }), 409, "expected_error_stock"), ...products("API-FULL-008", "expected_stock_3"),
  ];
  plans["API-FULL-013"] = [
    ...reset("API-FULL-013"), ...errorResponse("API-FULL-013", "identity", request("API-FULL-013-create", "POST", "/api/orders", {
      input_ref: ref("order_no_user_qty1"), header_refs: headers(null, "idem_primary"),
    }), 401, "expected_error_identity_required"), ...products("API-FULL-013", "expected_stock_3"),
  ];
  plans["API-FULL-014"] = [
    ...reset("API-FULL-014"), ...errorResponse("API-FULL-014", "mismatch", request("API-FULL-014-create", "POST", "/api/orders", {
      input_ref: ref("order_identity_mismatch"), header_refs: headers(),
    }), 400, "expected_error_identity_mismatch"), ...products("API-FULL-014", "expected_stock_3"),
  ];
  plans["API-FULL-015"] = [...reset("API-FULL-015")];
  for (const [suffix, payload] of [["missing", "order_sku_missing"], ["blank", "order_sku_blank"], ["number", "order_sku_number"]]) {
    plans["API-FULL-015"].push(...errorResponse("API-FULL-015", suffix, request(`API-FULL-015-${suffix}`, "POST", "/api/orders", {
      input_ref: ref(payload), header_refs: headers(),
    }), 400, "expected_error_sku"));
  }
  plans["API-FULL-015"].push(...products("API-FULL-015", "expected_stock_3"));
  plans["API-FULL-016"] = [
    ...reset("API-FULL-016"), ...errorResponse("API-FULL-016", "coupon", request("API-FULL-016-create", "POST", "/api/orders", {
      input_ref: ref("order_coupon_number"), header_refs: headers(),
    }), 400, "expected_error_coupon"), ...products("API-FULL-016", "expected_stock_3"),
  ];
  plans["API-FULL-019"] = [
    ...reset("API-FULL-019"), ...errorResponse("API-FULL-019", "sku", request("API-FULL-019-create", "POST", "/api/orders", {
      input_ref: ref("order_unknown_sku"), header_refs: headers(),
    }), 409, "expected_error_stock"), ...products("API-FULL-019", "expected_stock_3"),
  ];
  plans["API-FULL-009"] = serialIdempotencyFailure("API-FULL-009");
  plans["API-FULL-010"] = concurrentIdempotencyFailure("API-FULL-010");
  plans["API-FULL-011"] = retryIdempotencyFailure("API-FULL-011");
  plans["API-FULL-012"] = [
    ...reset("API-FULL-012"), ...createOrder("API-FULL-012", { variable: "first_order_id" }),
    request("API-FULL-012-different-body", "POST", "/api/orders", { input_ref: ref("order_user_a_qty2"), header_refs: headers() }),
    apiAssert("API-FULL-012-evidence-pending", "status is 201", { verdict_policy: "pending_only" }),
  ];
  plans["API-FULL-018"] = [
    ...reset("API-FULL-018"), ...createOrder("API-FULL-018", { user: "user_a", variable: "user_a_order_id", suffix: "user-a" }),
    ...createOrder("API-FULL-018", { payload: "order_user_b_qty1", user: "user_b", variable: "user_b_order_id", suffix: "user-b" }),
    bodyAssert("API-FULL-018-user-b", "/body/user_id", "expected_user_b"), ...products("API-FULL-018", "expected_stock_1"),
  ];
  plans["API-FULL-020"] = [
    ...reset("API-FULL-020"), ...createOrder("API-FULL-020"),
    bodyAssert("API-FULL-020-success-user", "/body/user_id", "expected_user_a"),
    bodyAssert("API-FULL-020-success-status", "/body/status", "expected_pending_payment"),
    ...errorResponse("API-FULL-020", "failure", request("API-FULL-020-failure", "POST", "/api/orders", {
      input_ref: ref("order_qty_zero"), header_refs: headers("user_a", "idem_secondary"),
    }), 400, "expected_error_quantity"),
  ];
  return plans;
}

function singleApiConcisePlans() {
  return {
    "API-CONCISE-001": [
      ...reset("API-CONCISE-001"), ...createOrder("API-CONCISE-001"),
      ...queryOrder("API-CONCISE-001", "order_id", "user_a", "expected_pending_payment"), ...products("API-CONCISE-001", "expected_stock_2"),
    ],
    "API-CONCISE-004": [
      ...reset("API-CONCISE-004"),
      ...errorResponse("API-CONCISE-004", "not-found", request("API-CONCISE-004-query", "GET", "/api/orders/ORD-9999", {
        header_refs: headers("user_a", null),
      }), 404, "expected_error_not_found"), ...products("API-CONCISE-004", "expected_stock_3"),
    ],
    "API-CONCISE-005": [
      ...reset("API-CONCISE-005"),
      ...createOrder("API-CONCISE-005", { variable: "pending_order_id", suffix: "pending" }),
      ...createOrder("API-CONCISE-005", { idem: "idem_secondary", variable: "paid_order_id", suffix: "paid" }),
      ...payOrder("API-CONCISE-005", "paid_order_id"),
      ...createOrder("API-CONCISE-005", { idem: "idem_tertiary", variable: "cancelled_order_id", suffix: "cancelled" }),
      ...cancelOrder("API-CONCISE-005", "cancelled_order_id"),
      ...queryOrder("API-CONCISE-005", "pending_order_id", "user_a", "expected_pending_payment", "query-pending"),
      ...queryOrder("API-CONCISE-005", "paid_order_id", "user_a", "expected_paid", "query-paid"),
      ...queryOrder("API-CONCISE-005", "cancelled_order_id", "user_a", "expected_cancelled", "query-cancelled"),
    ],
    "API-CONCISE-002": [
      ...reset("API-CONCISE-002"), ...createOrder("API-CONCISE-002"),
      ...errorResponse("API-CONCISE-002", "missing", request("API-CONCISE-002-missing", "GET", "/api/orders/{{order_id}}"), 401, "expected_error_identity_required"),
      ...errorResponse("API-CONCISE-002", "blank", request("API-CONCISE-002-blank", "GET", "/api/orders/{{order_id}}", {
        header_refs: headers("blank", null),
      }), 401, "expected_error_identity_required"),
    ],
    "API-CONCISE-003": [
      ...reset("API-CONCISE-003"), ...createOrder("API-CONCISE-003"),
      ...errorResponse("API-CONCISE-003", "forbidden", request("API-CONCISE-003-user-b", "GET", "/api/orders/{{order_id}}", {
        header_refs: headers("user_b", null),
      }), 403, "expected_error_forbidden"),
      ...queryOrder("API-CONCISE-003", "order_id", "user_a", "expected_pending_payment", "owner-recheck"),
      ...products("API-CONCISE-003", "expected_stock_2"),
    ],
    "API-CONCISE-006": [
      ...reset("API-CONCISE-006"), ...createOrder("API-CONCISE-006"),
      ...[1, 2, 3].flatMap((index) => [
        request(`API-CONCISE-006-query-${index}`, "GET", "/api/orders/{{order_id}}", { header_refs: headers("user_a", null) }),
        apiAssert(`API-CONCISE-006-query-${index}-200`, "status is 200"),
        apiAssert(`API-CONCISE-006-query-${index}-same`, "body /body/order_id equals output:order_id"),
      ]), ...products("API-CONCISE-006", "expected_stock_2"),
    ],
    "API-CONCISE-007": [
      ...reset("API-CONCISE-007"), ...createOrder("API-CONCISE-007"),
      concurrent("API-CONCISE-007-concurrent", "GET", "/api/orders/{{order_id}}", 5, { header_refs: headers("user_a", null) }),
      apiAssert("API-CONCISE-007-statuses", "batch status all 200"),
      apiAssert("API-CONCISE-007-order-ids", "batch body /body/order_id all equal"),
      apiAssert("API-CONCISE-007-created-id", "body /body/order_id equals output:order_id"),
      ...products("API-CONCISE-007", "expected_stock_2"),
    ],
  };
}

function multiApiFlowPlans() {
  return {
    "FLOW-001": [
      ...reset("FLOW-001"), ...products("FLOW-001-before", "expected_stock_3"), ...coupon("FLOW-001", "amount_120"),
      bodyAssert("FLOW-001-coupon-eligible", "/body/eligible", "expected_true"),
      bodyAssert("FLOW-001-coupon-discount", "/body/discount", "expected_discount_20"),
      ...createOrder("FLOW-001"), ...queryOrder("FLOW-001", "order_id", "user_a", "expected_pending_payment"),
      ...products("FLOW-001-after", "expected_stock_2"),
    ],
    "FLOW-002": [
      ...reset("FLOW-002"), ...createOrder("FLOW-002"), ...queryOrder("FLOW-002", "order_id", "user_a", "expected_pending_payment", "before-cancel"),
      ...cancelOrder("FLOW-002", "order_id"), ...queryOrder("FLOW-002", "order_id", "user_a", "expected_cancelled", "after-cancel"),
      ...products("FLOW-002", "expected_stock_3"),
    ],
    "FLOW-003": [
      ...reset("FLOW-003"), ...createOrder("FLOW-003"), ...payOrder("FLOW-003", "order_id"),
      ...queryOrder("FLOW-003", "order_id", "user_a", "expected_paid"),
      ...errorResponse("FLOW-003", "cancel-paid", request("FLOW-003-cancel", "POST", "/api/orders/{{order_id}}/cancel", {
        header_refs: headers("user_a", null),
      }), 409, "expected_error_not_cancelable"), ...products("FLOW-003", "expected_stock_2"),
    ],
    "FLOW-004": [
      ...reset("FLOW-004"), ...createOrder("FLOW-004"), ...payOrder("FLOW-004", "order_id", "callback-1"),
      ...payOrder("FLOW-004", "order_id", "callback-2"), ...queryOrder("FLOW-004", "order_id", "user_a", "expected_paid"),
      ...products("FLOW-004", "expected_stock_2"),
    ],
    "FLOW-005": [
      ...reset("FLOW-005"), ...createOrder("FLOW-005"),
      ...errorResponse("FLOW-005", "forbidden", request("FLOW-005-user-b", "GET", "/api/orders/{{order_id}}", {
        header_refs: headers("user_b", null),
      }), 403, "expected_error_forbidden"),
      ...queryOrder("FLOW-005", "order_id", "user_a", "expected_pending_payment", "owner"), ...products("FLOW-005", "expected_stock_2"),
    ],
    "FLOW-009": [
      ...reset("FLOW-009"), ...products("FLOW-009-before", "expected_stock_3"),
      ...errorResponse("FLOW-009", "unknown-sku", request("FLOW-009-create", "POST", "/api/orders", {
        input_ref: ref("order_unknown_sku"), header_refs: headers(),
      }), 409, "expected_error_stock"), ...products("FLOW-009-after", "expected_stock_3"),
      ...errorResponse("FLOW-009", "order-not-found", request("FLOW-009-query", "GET", "/api/orders/ORD-9999", {
        header_refs: headers("user_a", null),
      }), 404, "expected_error_not_found"),
    ],
    "FLOW-011": [
      ...reset("FLOW-011"), ...products("FLOW-011-before", "expected_stock_3"),
      ...errorResponse("FLOW-011", "identity", request("FLOW-011-create", "POST", "/api/orders", {
        input_ref: ref("order_no_user_qty1"), header_refs: headers(null, "idem_primary"),
      }), 401, "expected_error_identity_required"), ...products("FLOW-011-after", "expected_stock_3"),
    ],
    "FLOW-010": [
      ...reset("FLOW-010-before"), ...createOrder("FLOW-010", { variable: "old_order_id" }),
      request("FLOW-010-reset", "POST", "/__test/reset"), apiAssert("FLOW-010-reset-200", "status is 200"),
      bodyAssert("FLOW-010-reset-true", "/body/reset", "expected_true"), ...products("FLOW-010", "expected_stock_3"),
      ...errorResponse("FLOW-010", "old-order", request("FLOW-010-old-order", "GET", "/api/orders/{{old_order_id}}", {
        header_refs: headers("user_a", null),
      }), 404, "expected_error_not_found"),
    ],
    "FLOW-006": serialIdempotencyFailure("FLOW-006"),
    "FLOW-007": concurrentIdempotencyFailure("FLOW-007"),
    "FLOW-012": retryIdempotencyFailure("FLOW-012"),
    "FLOW-008": boundaryPending("FLOW-008"),
  };
}

function productionVerificationPlans() {
  return {
    "PROD-L0-001": [
      request("PROD-L0-001-health", "GET", "/api/health"), apiAssert("PROD-L0-001-200", "status is 200"),
      bodyAssert("PROD-L0-001-ok", "/body/ok", "expected_true"), bodyAssert("PROD-L0-001-service", "/body/service", "expected_skillmart"),
    ],
    "PROD-L0-002": [
      request("PROD-L0-002-config", "GET", "/api/config/public"), apiAssert("PROD-L0-002-200", "status is 200"),
      bodyAssert("PROD-L0-002-policy", "/body/coupon_boundary_policy", "expected_config_policy"),
    ],
    "PROD-L0-003": [
      request("PROD-L0-003-products", "GET", "/api/products"), apiAssert("PROD-L0-003-200", "status is 200"),
      bodyAssert("PROD-L0-003-stock", "/body/products/0/stock", "expected_stock_3"),
    ],
    "PROD-L0-004": [
      ...coupon("PROD-L0-004", "amount_120"), bodyAssert("PROD-L0-004-eligible", "/body/eligible", "expected_true"),
      bodyAssert("PROD-L0-004-discount", "/body/discount", "expected_discount_20"),
    ],
    "PROD-L0-005": [
      ...[1, 2, 3].flatMap((index) => [
        request(`PROD-L0-005-products-${index}`, "GET", "/api/products"), apiAssert(`PROD-L0-005-products-${index}-200`, "status is 200"),
        bodyAssert(`PROD-L0-005-products-${index}-stock`, "/body/products/0/stock", "expected_stock_3"),
      ]),
      ...[1, 2].flatMap((index) => [
        request(`PROD-L0-005-config-${index}`, "GET", "/api/config/public"), apiAssert(`PROD-L0-005-config-${index}-200`, "status is 200"),
        bodyAssert(`PROD-L0-005-config-${index}-policy`, "/body/coupon_boundary_policy", "expected_config_policy"),
      ]),
    ],
  };
}

function reportCaseIds(report) {
  const sheet = report.sheets.find((item) => item.kind === "test_cases");
  if (!sheet) throw new Error("报告缺少 test_cases Sheet");
  return sheet.rows.filter((row) => !row.divider).map((row) => row.values[0]);
}

function assertExactCaseIds(suite, report, plans) {
  const reportIds = reportCaseIds(report);
  const expected = SUITE_IDS[suite];
  if (JSON.stringify(reportIds) !== JSON.stringify(expected)) {
    throw new Error(`${suite} 报告用例 ID 与锁定清单不一致：${JSON.stringify(reportIds)}`);
  }
  if (JSON.stringify(Object.keys(plans)) !== JSON.stringify(expected)) {
    throw new Error(`${suite} Profile 未完整覆盖锁定用例 ID`);
  }
  for (const [caseId, actions] of Object.entries(plans)) {
    if (!Array.isArray(actions) || actions.length === 0) throw new Error(`${suite}/${caseId} 没有执行动作`);
  }
}

export async function buildSkillMartExecutionProfiles({ reports, outputRoot, origin }) {
  const planBuilders = {
    requirementWorkbench: () => requirementWorkbenchPlans(origin),
    singleApiFull: singleApiFullPlans,
    singleApiConcise: singleApiConcisePlans,
    multiApiFlow: multiApiFlowPlans,
    productionVerification: productionVerificationPlans,
  };
  const summary = [];
  for (const suite of Object.keys(SUITE_IDS)) {
    const report = JSON.parse(await fs.readFile(reports[suite], "utf8"));
    const plans = planBuilders[suite]();
    assertExactCaseIds(suite, report, plans);
    const directory = path.join(outputRoot, suite);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const profile = {
      protocol_version: "1.0.0",
      profile_id: `skillmart-${suite}`,
      targets: {
        web: { kind: "web", origin },
        api: { kind: "api", origin },
      },
      credentials: {},
      data: DATA,
      case_plans: plans,
      rule_versions: ["1.0.0", "skillmart-demo-2026-07-16"],
    };
    await fs.writeFile(path.join(directory, "execution-profile.json"), `${JSON.stringify(profile, null, 2)}\n`, "utf8");
    summary.push({ suite, case_count: SUITE_IDS[suite].length, action_count: Object.values(plans).flat().length });
  }
  await fs.writeFile(path.join(outputRoot, "profile-build-summary.json"), `${JSON.stringify({ origin, suites: summary }, null, 2)}\n`, "utf8");
  return summary;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const buildRoot = path.resolve(argument("--materials-root") ?? path.join(root, "build", "skillmart-demo"));
  const outputRoot = path.resolve(argument("--output-root") ?? path.join(buildRoot, "08-自动执行与证据_Automated-Execution-Evidence", "04-生成文件"));
  const origin = argument("--origin");
  if (!origin) throw new Error("缺少 --origin http://127.0.0.1:<port>");
  const reports = {
    requirementWorkbench: path.join(buildRoot, "02-需求工作台_Requirement-Workbench", "04-生成文件", "skillmart-requirement-workbench-report.json"),
    singleApiFull: path.join(buildRoot, "03-单接口完整版_Single-API-Full", "04-生成文件", "skillmart-single-api-full-report.json"),
    singleApiConcise: path.join(buildRoot, "04-单接口精炼版_Single-API-Concise", "04-生成文件", "skillmart-single-api-concise-report.json"),
    multiApiFlow: path.join(buildRoot, "05-多接口链路_Multi-API-Flow", "04-生成文件", "skillmart-multi-api-flow-report.json"),
    productionVerification: path.join(buildRoot, "06-正式服验证_Production-Verification", "04-生成文件", "skillmart-production-verification-report.json"),
  };
  console.log(JSON.stringify(await buildSkillMartExecutionProfiles({ reports, outputRoot, origin }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
