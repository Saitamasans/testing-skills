import http from "node:http";

export interface SkillMartApp {
  baseUrl: string;
  close(): Promise<void>;
}

export interface SkillMartAppOptions {
  port?: number;
}

interface Product {
  sku: string;
  name: string;
  price: number;
  stock: number;
}

interface Order {
  order_id: string;
  user_id: string;
  sku: string;
  quantity: number;
  status: "PENDING_PAYMENT" | "PAID" | "CANCELLED";
  idempotency_key: string;
}

function seedProducts(): Product[] {
  return [
    { sku: "SKU-BOOK-001", name: "SkillMart 测试书", price: 120, stock: 3 },
    { sku: "SKU-MUG-002", name: "SkillMart 马克杯", price: 59, stock: 8 },
  ];
}

async function readJsonBody(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  return JSON.parse(text) as Record<string, unknown>;
}

function writeJson(response: http.ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function writeHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
}

export async function startSkillMartApp(options: SkillMartAppOptions = {}): Promise<SkillMartApp> {
  let products = seedProducts();
  const orders = new Map<string, Order>();
  let orderCounter = 0;

  function reset(): void {
    products = seedProducts();
    orders.clear();
    orderCounter = 0;
  }

  function productBySku(sku: string): Product | undefined {
    return products.find((product) => product.sku === sku);
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://127.0.0.1");

      if (request.method === "GET" && url.pathname === "/api/health") {
        writeJson(response, 200, { ok: true, service: "SkillMart" });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/config/public") {
        writeJson(response, 200, { coupon_boundary_policy: "conflicting-sources-demo" });
        return;
      }

      if (request.method === "POST" && url.pathname === "/__test/reset") {
        reset();
        writeJson(response, 200, { reset: true });
        return;
      }

      if (request.method === "GET" && url.pathname === "/api/products") {
        writeJson(response, 200, { products });
        return;
      }

      const couponMatch = url.pathname.match(/^\/api\/coupons\/([^/]+)\/eligibility$/);
      if (request.method === "GET" && couponMatch) {
        const code = couponMatch[1]!;
        const amount = Number(url.searchParams.get("amount") ?? "0");
        const clientClickedAt = url.searchParams.get("client_clicked_at");
        const serverReceivedAt = url.searchParams.get("server_received_at");
        if (
          code === "SKILL20"
          && clientClickedAt
          && serverReceivedAt
          && clientClickedAt < "2026-07-16T00:00:00.000Z"
          && serverReceivedAt >= "2026-07-16T00:00:00.000Z"
        ) {
          writeJson(response, 200, {
            verdict: "待定",
            conflict_sources: ["product-confirmation", "api-contract"],
            product_rule: "按用户点击提交的客户端时间",
            api_rule: "按服务端收到请求的时间",
          });
          return;
        }
        writeJson(response, 200, {
          eligible: code === "SKILL20" && amount >= 100,
          discount: code === "SKILL20" && amount >= 100 ? 20 : 0,
        });
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/orders") {
        const contentType = String(request.headers["content-type"] ?? "")
          .split(";", 1)[0]!
          .trim()
          .toLowerCase();
        if (contentType !== "application/json") {
          writeJson(response, 400, { error: "content_type_invalid" });
          return;
        }
        let body: Record<string, unknown>;
        try {
          body = await readJsonBody(request);
        } catch {
          writeJson(response, 400, { error: "invalid_json" });
          return;
        }
        const sku = body.sku;
        const quantity = body.quantity ?? 1;
        const requestUserId = String(request.headers["x-user-id"] ?? "").trim();
        const bodyUserId = String(body.user_id ?? requestUserId);
        const idempotencyKey = String(request.headers["x-idempotency-key"] ?? "");
        if (!requestUserId) {
          writeJson(response, 401, { error: "user_identity_required" });
          return;
        }
        if (!idempotencyKey.trim()) {
          writeJson(response, 400, { error: "idempotency_key_required" });
          return;
        }
        if (bodyUserId !== requestUserId) {
          writeJson(response, 400, { error: "user_identity_mismatch" });
          return;
        }
        if (typeof sku !== "string" || !sku.trim()) {
          writeJson(response, 400, { error: "sku_invalid" });
          return;
        }
        if (body.coupon_code !== undefined && typeof body.coupon_code !== "string") {
          writeJson(response, 400, { error: "coupon_code_invalid" });
          return;
        }
        if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
          writeJson(response, 400, { error: "quantity_invalid" });
          return;
        }
        const product = productBySku(sku);
        if (!product || product.stock < quantity) {
          writeJson(response, 409, { error: "stock_not_enough" });
          return;
        }

        product.stock -= quantity;
        const order: Order = {
          order_id: `ORD-${String(++orderCounter).padStart(4, "0")}`,
          user_id: requestUserId,
          sku,
          quantity,
          status: "PENDING_PAYMENT",
          idempotency_key: idempotencyKey,
        };
        orders.set(order.order_id, order);
        writeJson(response, 201, order);
        return;
      }

      const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/);
      if (request.method === "GET" && orderMatch) {
        const order = orders.get(orderMatch[1]!);
        if (!order) {
          writeJson(response, 404, { error: "order_not_found" });
          return;
        }
        const requestUserId = String(request.headers["x-user-id"] ?? "").trim();
        if (!requestUserId) {
          writeJson(response, 401, { error: "user_identity_required" });
          return;
        }
        if (requestUserId !== order.user_id) {
          writeJson(response, 403, { error: "order_forbidden" });
          return;
        }
        writeJson(response, 200, order);
        return;
      }

      const cancelMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/cancel$/);
      if (request.method === "POST" && cancelMatch) {
        const order = orders.get(cancelMatch[1]!);
        if (!order) {
          writeJson(response, 404, { error: "order_not_found" });
          return;
        }
        const requestUserId = String(request.headers["x-user-id"] ?? "").trim();
        if (!requestUserId) {
          writeJson(response, 401, { error: "user_identity_required" });
          return;
        }
        if (requestUserId !== order.user_id) {
          writeJson(response, 403, { error: "order_forbidden" });
          return;
        }
        if (order.status !== "PENDING_PAYMENT") {
          writeJson(response, 409, { error: "order_status_not_cancelable" });
          return;
        }
        order.status = "CANCELLED";
        const product = productBySku(order.sku);
        if (product) product.stock += order.quantity;
        writeJson(response, 200, order);
        return;
      }

      if (request.method === "POST" && url.pathname === "/api/payments/callback") {
        const body = await readJsonBody(request);
        const order = orders.get(String(body.order_id ?? ""));
        if (!order) {
          writeJson(response, 404, { error: "order_not_found" });
          return;
        }
        order.status = "PAID";
        writeJson(response, 200, order);
        return;
      }

      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/shop")) {
        const productRows = products
          .map((product) => `<li data-testid="product-${product.sku}">${product.name} / 库存 ${product.stock} / ￥${product.price}</li>`)
          .join("");
        writeHtml(response, `<!doctype html>
          <meta charset="utf-8" />
          <title>SkillMart</title>
          <h1>SkillMart 电商订单演示系统</h1>
          <ul>${productRows}</ul>
          <label>优惠券 <input data-testid="coupon-code" value="SKILL20" /></label>
          <button data-testid="create-order">创建订单</button>
          <p data-testid="status">待操作</p>
          <script>
            document.querySelector('[data-testid="create-order"]').addEventListener('click', async () => {
              const response = await fetch('/api/orders', {
                method: 'POST',
                headers: { 'content-type': 'application/json', 'x-idempotency-key': 'web-demo-key', 'x-user-id': 'user-a' },
                body: JSON.stringify({ user_id: 'user-a', sku: 'SKU-BOOK-001', quantity: 1, coupon_code: 'SKILL20' })
              });
              const json = await response.json();
              document.querySelector('[data-testid="status"]').textContent = json.order_id ? '订单已创建 ' + json.order_id : json.error;
            });
          </script>`);
        return;
      }

      response.writeHead(404);
      response.end("not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve) => server.listen(options.port ?? 0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("SkillMart failed to bind a TCP port");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}
