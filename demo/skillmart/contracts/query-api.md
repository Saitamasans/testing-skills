# SkillMart 查询与优惠券 API 契约

Base URL：本地 `http://127.0.0.1:<port>`

## GET /api/orders/{id}

用于查询一张订单。普通用户只能查询自己的订单；本接口只读，不创建订单、不修改订单状态、不改变库存。

### 请求

- Path 参数 `id`：必填，订单编号，例如 `ORD-0001`。
- Header `x-user-id`：必填，本地演示身份，例如 `user-a`。
- Request Body：无。

示例：

```http
GET /api/orders/ORD-0001
x-user-id: user-a
```

### 成功响应

HTTP `200`：

```json
{
  "order_id": "ORD-0001",
  "user_id": "user-a",
  "sku": "SKU-BOOK-001",
  "quantity": 1,
  "status": "PENDING_PAYMENT",
  "idempotency_key": "query-demo-key"
}
```

字段规则：

| 字段 | 类型 | 规则 |
|---|---|---|
| `order_id` | string | 与 Path 中查询的订单编号一致 |
| `user_id` | string | 必须等于当前 `x-user-id` |
| `sku` | string | 返回创建订单时使用的商品 SKU |
| `quantity` | integer | 大于 0 |
| `status` | string | `PENDING_PAYMENT / PAID / CANCELLED` |
| `idempotency_key` | string | 返回创建订单时使用的幂等键 |

### 失败响应

| HTTP 状态码 | 响应 | 触发条件 |
|---:|---|---|
| `401` | `{"error":"user_identity_required"}` | 缺少或传空 `x-user-id` |
| `403` | `{"error":"order_forbidden"}` | 订单存在，但不属于当前用户 |
| `404` | `{"error":"order_not_found"}` | 订单编号不存在 |

所有失败响应都不得返回订单详情、其他用户信息、内部路径或堆栈。

## GET /api/products

返回商品价格和当前库存。种子商品：

```json
{
  "sku": "SKU-BOOK-001",
  "name": "SkillMart 测试书",
  "price": 120,
  "stock": 3
}
```

## GET /api/coupons/{code}/eligibility

正常规则：

- 优惠券：`SKILL20`；
- `amount >= 100` 时可用；
- 优惠金额为 `20`。

过期边界存在已知口径歧义：产品确认按客户端点击时间，接口契约按服务端收到时间。当两个时间来源冲突时，测试用例（Test Case）执行状态标记为 `待定`，不计为研发 Bug，也不计为未执行。

## POST /__test/reset

仅限本地演示使用。恢复种子商品库存并清空订单；不得用于真实环境。

