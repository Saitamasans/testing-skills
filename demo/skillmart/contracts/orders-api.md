# SkillMart 订单 API 契约

Base URL：本地 `http://127.0.0.1:<port>`

## POST /api/orders

创建一张待支付订单并立即锁定库存。

### 请求 Header

| Header | 必填 | 规则 |
|---|---|---|
| `content-type: application/json` | 是 | 请求体使用 JSON |
| `x-user-id` | 是 | 本地演示身份，例如 `user-a` |
| `x-idempotency-key` | 是 | 去除首尾空白后不能为空 |

### 请求 Body

```json
{
  "user_id": "user-a",
  "sku": "SKU-BOOK-001",
  "quantity": 1,
  "coupon_code": "SKILL20"
}
```

| 字段 | 类型 | 必填 | 规则 |
|---|---|---|---|
| `user_id` | string | 否 | 传入时必须与 `x-user-id` 一致；未传时使用 Header 身份 |
| `sku` | string | 是 | 必须存在且库存足够 |
| `quantity` | integer | 否 | 默认 `1`，必须大于 `0` |
| `coupon_code` | string | 否 | 演示值为 `SKILL20` |

### 成功响应

HTTP `201`，返回：`order_id / user_id / sku / quantity / status / idempotency_key`。初始 `status` 固定为 `PENDING_PAYMENT`。

### 失败响应

| HTTP 状态码 | 响应 | 触发条件 |
|---:|---|---|
| `400` | `{"error":"content_type_invalid"}` | Content-Type 不是 `application/json` |
| `400` | `{"error":"invalid_json"}` | 请求体不是合法 JSON |
| `401` | `{"error":"user_identity_required"}` | 缺少 `x-user-id` |
| `400` | `{"error":"idempotency_key_required"}` | 缺少或传空幂等键 |
| `400` | `{"error":"user_identity_mismatch"}` | Body `user_id` 与 Header 身份不一致 |
| `400` | `{"error":"sku_invalid"}` | `sku` 缺失、为空或不是 string |
| `400` | `{"error":"quantity_invalid"}` | 数量不是正整数 |
| `400` | `{"error":"coupon_code_invalid"}` | `coupon_code` 已传入但不是 string |
| `409` | `{"error":"stock_not_enough"}` | SKU 不存在或库存不足 |

### 幂等规则

相同用户、相同幂等键、相同订单内容重复提交时，必须返回同一张订单，只锁定一次库存。

故意保留的演示缺陷：当前本地 fixture 会创建两张订单并锁定两次库存。它是演示中唯一预设的研发缺陷，对应测试用例（Test Case）执行后应判定为 `不通过`。

同一用户使用相同幂等键但订单内容不同的处理口径未确认；如实际执行到该场景，应完整留证并标记为 `待定`，不得擅自定性为研发 Bug。

## GET /api/orders/{id}

读取规则、响应字段和错误映射见 `query-api.md`。

## POST /api/orders/{id}/cancel

- Header `x-user-id` 必填；缺失返回 `401 user_identity_required`。
- 只能取消当前用户自己的订单；跨用户返回 `403 order_forbidden`。
- 订单不存在返回 `404 order_not_found`。
- 只有 `PENDING_PAYMENT` 可以取消；其他状态返回 `409 order_status_not_cancelable`。
- 取消成功返回 HTTP `200`，订单状态变为 `CANCELLED`，并释放该订单锁定的库存。

## POST /api/payments/callback

请求体携带 `order_id`。订单不存在返回 `404 order_not_found`；存在时返回 HTTP `200` 并将订单状态更新为 `PAID`。重复回调不得产生重复业务副作用。
