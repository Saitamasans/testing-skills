const state = { products: [], orders: [], runtime: null, selectedSku: "SKU-BOOK-001" };

const descriptions = {
  "SKU-BOOK-001": "测试设计与质量分析手册",
  "SKU-MUG-002": "哑光陶瓷团队周边",
  "SKU-DEVICE-003": "接口联调与响应检查设备",
  "SKU-KIT-004": "自动化执行工具收纳套件",
};
const artClasses = {
  "SKU-BOOK-001": "art-book",
  "SKU-MUG-002": "art-mug",
  "SKU-DEVICE-003": "art-device",
  "SKU-KIT-004": "art-kit",
};
const errorMessages = {
  content_type_invalid: "请求格式不正确",
  invalid_json: "请求内容不是有效 JSON",
  user_identity_required: "缺少用户身份",
  idempotency_key_required: "请输入幂等键",
  user_identity_mismatch: "请求用户身份不一致",
  sku_invalid: "商品 SKU 无效",
  coupon_code_invalid: "优惠券格式无效",
  quantity_invalid: "数量必须是正整数",
  stock_not_enough: "库存不足",
  order_not_found: "订单不存在",
  order_forbidden: "当前用户无权查看该订单",
  order_status_not_cancelable: "当前订单状态不可取消",
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function request(url, options) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
}

function renderProducts() {
  const grid = document.querySelector("#product-grid");
  const select = document.querySelector("#product-sku");
  if (state.products.length === 0) {
    grid.innerHTML = '<div class="empty-state"><strong>暂无商品</strong><span>刷新后重试。</span></div>';
    select.innerHTML = "";
    return;
  }
  grid.innerHTML = state.products.map((product) => `
    <article class="product-card" data-testid="product-${escapeHtml(product.sku)}">
      <div class="product-art ${artClasses[product.sku] || "art-kit"}" role="img" aria-label="${escapeHtml(product.name)} 商品图"></div>
      <div class="product-info">
        <span class="product-sku">${escapeHtml(product.sku)}</span>
        <h3 class="product-name">${escapeHtml(product.name)}</h3>
        <p class="product-description">${escapeHtml(descriptions[product.sku] || "本地演示商品")}</p>
        <div class="product-metrics"><strong class="price">￥${product.price}</strong><span class="stock">库存 ${product.stock}</span></div>
        <button class="select-product" type="button" data-select-sku="${escapeHtml(product.sku)}">选择商品</button>
      </div>
    </article>`).join("");
  select.innerHTML = state.products.map((product) => `<option value="${escapeHtml(product.sku)}">${escapeHtml(product.name)} · 库存 ${product.stock}</option>`).join("");
  select.value = state.products.some((item) => item.sku === state.selectedSku) ? state.selectedSku : state.products[0].sku;
}

function renderOrders() {
  const body = document.querySelector("#orders-body");
  const empty = document.querySelector("#orders-empty");
  body.innerHTML = state.orders.map((order) => `
    <tr><td><strong>${escapeHtml(order.order_id)}</strong></td><td>${escapeHtml(order.user_id)}</td><td>${escapeHtml(order.sku)}</td><td>${order.quantity}</td><td><span class="order-status ${order.status === "PAID" ? "paid" : order.status === "CANCELLED" ? "cancelled" : ""}">${escapeHtml(order.status)}</span></td></tr>`).join("");
  empty.hidden = state.orders.length > 0;
}

function renderRuntime() {
  const runtime = state.runtime;
  if (!runtime) return;
  document.querySelector("#headline-health").textContent = runtime.health === "healthy" ? "正常" : runtime.health;
  document.querySelector("#headline-products").textContent = String(runtime.product_count);
  document.querySelector("#headline-orders").textContent = String(runtime.order_count);
  document.querySelector("#runtime-health").textContent = runtime.health === "healthy" ? "HEALTHY" : runtime.health;
  document.querySelector("#runtime-products").textContent = String(runtime.product_count);
  document.querySelector("#runtime-inventory").textContent = String(runtime.inventory_units);
  document.querySelector("#runtime-orders").textContent = String(runtime.order_count);
  document.querySelector("#runtime-event").textContent = runtime.last_event.detail;
  document.querySelector("#runtime-event-time").textContent = new Date(runtime.last_event.at).toLocaleString("zh-CN", { hour12: false });
  document.querySelector("#runtime-defect").textContent = runtime.known_seeded_defect;
}

function showStatus(kind, title, detail) {
  const element = document.querySelector("#operation-status");
  element.className = `operation-status ${kind}`;
  element.querySelector(".status-symbol").textContent = kind === "success" ? "✓" : kind === "error" ? "×" : "i";
  element.querySelector("strong").textContent = title;
  element.querySelector("small").textContent = detail;
}

async function refreshAll() {
  try {
    const [products, orders, runtime] = await Promise.all([
      request("/api/products"), request("/api/orders"), request("/api/runtime-state"),
    ]);
    state.products = products.products;
    state.orders = orders.orders;
    state.runtime = runtime;
    renderProducts();
    renderOrders();
    renderRuntime();
  } catch (error) {
    showStatus("error", "数据加载失败", error.message);
  }
}

async function createOrder(event) {
  event.preventDefault();
  const button = document.querySelector('[data-testid="create-order"]');
  button.disabled = true;
  showStatus("neutral", "正在创建订单", "POST /api/orders");
  const userId = document.querySelector("#user-id").value;
  const payload = {
    user_id: userId,
    sku: document.querySelector("#product-sku").value,
    quantity: Number(document.querySelector("#quantity").value),
    coupon_code: document.querySelector("#coupon-code").value,
  };
  try {
    const order = await request("/api/orders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": userId,
        "x-idempotency-key": document.querySelector("#idempotency-key").value,
      },
      body: JSON.stringify(payload),
    });
    showStatus("success", `订单已创建 ${order.order_id}`, `${order.sku} · ${order.status}`);
    document.querySelector("#last-order").hidden = false;
    document.querySelector("#last-order-id").textContent = order.order_id;
    document.querySelector("#last-order-state").textContent = `${order.user_id} · ${order.status}`;
    await refreshAll();
  } catch (error) {
    showStatus("error", "订单创建失败", errorMessages[error.message] || error.message);
  } finally {
    button.disabled = false;
  }
}

function selectView(name) {
  document.querySelectorAll("[data-view-target]").forEach((button) => button.classList.toggle("active", button.dataset.viewTarget === name));
  document.querySelectorAll("[data-view]").forEach((view) => {
    const active = view.dataset.view === name;
    view.hidden = !active;
    view.classList.toggle("active", active);
  });
}

document.querySelector("#checkout-form").addEventListener("submit", createOrder);
document.querySelector("#refresh-products").addEventListener("click", refreshAll);
document.querySelector("#refresh-orders").addEventListener("click", refreshAll);
document.querySelector("#reset-data").addEventListener("click", async () => {
  try {
    await request("/__test/reset", { method: "POST" });
    showStatus("neutral", "演示数据已重置", "库存与订单已恢复初始状态");
    document.querySelector("#last-order").hidden = true;
    await refreshAll();
  } catch (error) {
    showStatus("error", "重置失败", error.message);
  }
});
document.querySelector("#product-grid").addEventListener("click", (event) => {
  const button = event.target.closest("[data-select-sku]");
  if (!button) return;
  state.selectedSku = button.dataset.selectSku;
  document.querySelector("#product-sku").value = state.selectedSku;
  document.querySelector("#checkout-title").scrollIntoView({ behavior: "smooth", block: "center" });
});
document.querySelectorAll("[data-view-target]").forEach((button) => button.addEventListener("click", () => selectView(button.dataset.viewTarget)));

refreshAll();
