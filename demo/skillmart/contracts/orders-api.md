# SkillMart Orders API

Base URL: local `http://127.0.0.1:<port>`

## POST /api/orders

Headers:

- `content-type: application/json`
- `x-idempotency-key: <string>`

Body:

```json
{
  "user_id": "user-a",
  "sku": "SKU-BOOK-001",
  "quantity": 1,
  "coupon_code": "SKILL20"
}
```

Expected rule: same user + same idempotency key + same order content must return the same order and lock stock once.

Known defect in demo fixture: it creates two orders and locks stock twice.

## GET /api/orders/{id}

Returns the order for verification.

## POST /api/orders/{id}/cancel

Only `PENDING_PAYMENT` orders may be cancelled. Cancellation releases locked stock.

## POST /api/payments/callback

Marks the order as `PAID`. Repeated callbacks must not create duplicate side effects.

