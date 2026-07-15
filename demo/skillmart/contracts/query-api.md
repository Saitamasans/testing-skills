# SkillMart Query and Coupon API

## GET /api/products

Returns products, price and current stock.

Seed product:

```json
{
  "sku": "SKU-BOOK-001",
  "name": "SkillMart 测试书",
  "price": 120,
  "stock": 3
}
```

## GET /api/coupons/{code}/eligibility

Normal case:

- `SKILL20`
- amount greater than or equal to 100
- expected discount: 20

Boundary ambiguity:

- product confirmation uses client click time;
- API contract uses server receive time;
- when the two sources conflict, execution result is `待定`.

## POST /__test/reset

Local-only reset endpoint. Restores seed products and clears orders.

