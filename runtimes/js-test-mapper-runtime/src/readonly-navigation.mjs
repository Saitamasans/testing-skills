import { redactSensitive, redactSensitiveUrl } from "./security.mjs";

const DANGEROUS = /(?:\b(?:add|create|new|edit|save|delete|remove|approve|audit|publish|enable|disable|import|upload|export|download|pay|payment|batch|bulk|submit|logout|sign\s*out|reset|clear|clean|sync|recalculate|send|refund|revoke|cancel|regenerate|generate|execute|run)\b|新增|新建|创建|编辑|修改|保存|提交|删除|移除|审核|审批|发布|启用|停用|导入|上传|导出|下载|支付|批量|重置|清理|清空|同步|重算|重新计算|发送|退款|撤销|取消|生成|执行|运行)/i;
const READONLY_DETAIL = /(?:\b(?:view|detail|details|show|inspect|preview|read|list|index)\b|查看|详情|明细|预览|列表)/i;
const PAGINATION = /^(?:\d+|next|previous|prev|first|last|下一页|上一页|首页|末页|›|‹|»|«)$/i;
const MAX_PAGINATION_PER_LIST = 2;

function safeText(value) { return redactSensitive(String(value || "").replace(/\s+/g, " ").trim()).slice(0, 200); }
function canonicalUrl(value, base) { try { const url = new URL(value, base); url.hash = ""; return url.href; } catch { return null; } }
function uniqueRecords(records) { const seen = new Set(); return records.filter((record) => { const key = JSON.stringify(record); if (seen.has(key)) return false; seen.add(key); return true; }); }

export function classifyReadonlyEntry(entry, currentUrl) {
  const label = safeText([entry.text, entry.ariaLabel, entry.title, entry.dataAction, entry.dataMethod, entry.onclick, entry.formaction, entry.dataUrl].filter(Boolean).join(" "));
  const href = String(entry.href || "");
  if (DANGEROUS.test(label) || DANGEROUS.test(href) || entry.dataMethod || entry.dataAction || entry.onclick || entry.dataConfirm || entry.formaction || /(?:button|submit|dropdown-item)/i.test(entry.className || "")) return { decision: "blocked", reason: "dangerous_action_or_event_semantics" };
  if (entry.disabled) return { decision: "skipped", reason: "disabled_entry" };
  if (entry.kind === "tab") {
    let tabUrl;
    try { tabUrl = new URL(href, currentUrl); } catch { return { decision: "skipped", reason: "invalid_url" }; }
    if (!/^https?:$/.test(tabUrl.protocol)) return { decision: "skipped", reason: "unsupported_protocol" };
    if (tabUrl.origin !== new URL(currentUrl).origin) return { decision: "skipped", reason: "cross_origin" };
    if (DANGEROUS.test(label) || entry.dataMethod || entry.dataAction || entry.dataConfirm || entry.onclick || entry.formaction) return { decision: "blocked", reason: "dangerous_tab_semantics" };
    if (!tabUrl.hash) return { decision: "skipped", reason: "readonly_intent_not_proven" };
    return { decision: "visit", category: "safe_tab" };
  }
  const target = canonicalUrl(href, currentUrl);
  if (!target) return { decision: "skipped", reason: "invalid_url" };
  const parsedCurrent = new URL(currentUrl); const parsedTarget = new URL(target);
  if (!/^https?:$/.test(parsedTarget.protocol)) return { decision: "skipped", reason: "unsupported_protocol" };
  if (parsedTarget.origin !== parsedCurrent.origin) return { decision: "skipped", reason: "cross_origin" };
  const explicitReadOnly = entry.inReadonlyContainer || READONLY_DETAIL.test(label) || entry.inPagination || PAGINATION.test(label);
  if (!explicitReadOnly) return { decision: "skipped", reason: "readonly_intent_not_proven", url: target };
  return { decision: "visit", category: entry.inPagination || PAGINATION.test(label) ? "pagination" : entry.inReadonlyContainer && entry.menuDepth <= 2 ? "navigation" : "readonly_detail", url: target };
}

async function pageSnapshot(page, category, relation = {}) {
  return page.evaluate(({ pageCategory, pageRelation }) => {
    const text = (node) => (node?.textContent || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const unique = (items) => [...new Set(items.filter(Boolean))].slice(0, 100);
    return { category: pageCategory, ...pageRelation, url: location.href, title: document.title || text(document.querySelector("h1, .content-header h1")), breadcrumbs: unique([...document.querySelectorAll(".breadcrumb a, .breadcrumb-item, [aria-label*=breadcrumb]")].map(text)), table_fields: unique([...document.querySelectorAll("table thead th")].map(text)), filters: unique([...document.querySelectorAll("form input, form select, form textarea")].map((el) => el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("name"))), page_state: document.readyState };
  }, { pageCategory: category, pageRelation: relation });
}

async function discover(page) {
  return page.evaluate(() => [...document.querySelectorAll("a[href], [role=tab], button[data-toggle=tab], button[data-bs-toggle=tab]")].map((el, index) => {
    const container = el.closest(".main-sidebar, .nav-sidebar, .nav-treeview, .sidebar, .menu-tree, .navigation-tree, .nav-tree, .side-menu, .admin-menu, aside[role=navigation], [role=navigation]");
    const depth = container ? [...container.querySelectorAll("ul, ol")].filter((node) => node.contains(el)).length : 0;
    return { index, kind: el.matches("[role=tab], button[data-toggle=tab], button[data-bs-toggle=tab]") ? "tab" : "link", text: (el.textContent || "").trim(), ariaLabel: el.getAttribute("aria-label") || "", title: el.getAttribute("title") || "", href: el.href || el.getAttribute("href") || "", disabled: el.matches(":disabled, [aria-disabled=true], .disabled"), inReadonlyContainer: Boolean(container), menuDepth: depth, parentMenu: el.closest(".nav-treeview")?.previousElementSibling?.textContent?.trim() || container?.querySelector(".active, .selected, .open, .current")?.textContent?.trim() || container?.getAttribute("aria-label") || null, entryLabel: (el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "").trim(), discoveredFrom: location.href, inPagination: Boolean(el.closest(".pagination, [aria-label*=pagination], [class*=pagination]")), onclick: el.getAttribute("onclick") || "", dataMethod: el.getAttribute("data-method") || "", dataAction: el.getAttribute("data-action") || "", dataUrl: el.getAttribute("data-url") || "", dataConfirm: el.getAttribute("data-confirm") || "", formaction: el.getAttribute("formaction") || "", role: el.getAttribute("role") || "", className: el.className?.toString() || "", target: el.getAttribute("target") || "" };
  }));
}

async function settle(page, timeoutMs = 1200) {
  await page.waitForLoadState("domcontentloaded", { timeout: timeoutMs }).catch(() => {});
  const started = Date.now();
  let stableSince = Date.now();
  let lastSignature = "";
  while (Date.now() - started < timeoutMs) {
    const signature = await page.evaluate(() => document.body?.innerText?.length + ":" + document.body?.querySelectorAll("*").length).catch(() => "");
    if (signature !== lastSignature) { lastSignature = signature; stableSince = Date.now(); }
    if (Date.now() - started >= 360 && Date.now() - stableSince >= 120) return;
    await page.waitForTimeout(40);
  }
}

export async function traverseReadonlyNavigation({ page, onPage = null, maxPages = 100, settleMs = 150 } = {}) {
  const origin = new URL(page.url()).origin;
  const queue = [{ url: page.url(), category: "authenticated_entry", parentMenu: null, menuDepth: 0, discoveredFrom: page.url() }];
  const queued = new Set([canonicalUrl(page.url(), page.url())]); const visitedUrls = new Set(); const visitedKeys = new Set(); const visited = []; const skipped = []; const blocked = []; const paginationCounts = new Map();
  const record = (bucket, entry, decision, extra = {}) => bucket.push({ label: safeText(entry.entryLabel || entry.text || entry.ariaLabel || entry.title), href: canonicalUrl(entry.href, page.url()) ? redactSensitiveUrl(canonicalUrl(entry.href, page.url())) : null, reason: decision.reason || null, category: decision.category || null, parent_menu: entry.parentMenu || null, menu_depth: entry.menuDepth || 0, discovered_from: entry.discoveredFrom || page.url(), target_url: canonicalUrl(entry.href, page.url()) ? redactSensitiveUrl(canonicalUrl(entry.href, page.url())) : null, ...extra });
  while (queue.length && visited.length < maxPages) {
    const next = queue.shift(); const target = canonicalUrl(next.url, page.url());
    if (!target || new URL(target).origin !== origin || visitedUrls.has(target)) continue;
    try {
      if (canonicalUrl(page.url(), page.url()) !== target) { const response = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 5000 }); if (response && response.status() >= 400) { skipped.push({ label: next.entryLabel || "", href: redactSensitiveUrl(target), reason: "navigation_http_error", http_status: response.status(), category: next.category }); continue; } }
      await settle(page, Math.max(500, settleMs));
    } catch {
      skipped.push({ label: next.entryLabel || "", href: redactSensitiveUrl(target), reason: "navigation_failed", category: next.category });
      continue;
    }
    visitedUrls.add(target);
    const snapshot = await pageSnapshot(page, next.category, { parent_menu: next.parentMenu, menu_depth: next.menuDepth, discovered_from: next.discoveredFrom, target_url: redactSensitiveUrl(target) });
    snapshot.url = redactSensitiveUrl(snapshot.url); visited.push(snapshot); if (onPage) await onPage({ page, snapshot });
    const entries = await discover(page);
    for (const entry of entries) {
      const decision = classifyReadonlyEntry(entry, page.url());
      if (decision.decision === "blocked") { record(blocked, entry, decision); continue; }
      if (decision.decision === "skipped") { record(skipped, entry, decision); continue; }
      if (decision.category === "safe_tab") {
        try { await page.locator("a[href], [role=tab], button[data-toggle=tab], button[data-bs-toggle=tab]").nth(entry.index).click(); await settle(page); const tabTarget = entry.href || `#${entry.entryLabel}`; const tabKey = `${canonicalUrl(page.url(), page.url())}#tab:${entry.entryLabel}:${tabTarget}`; const tabSnapshot = await pageSnapshot(page, "safe_tab", { parent_menu: entry.parentMenu, menu_depth: entry.menuDepth, entry_label: entry.entryLabel, discovered_from: entry.discoveredFrom, target_url: redactSensitiveUrl(page.url()), tab_identity: tabKey }); tabSnapshot.url = redactSensitiveUrl(tabSnapshot.url); if (!visitedKeys.has(tabKey)) { visitedKeys.add(tabKey); visited.push(tabSnapshot); if (onPage) await onPage({ page, snapshot: tabSnapshot }); const fresh = await discover(page); for (const child of fresh) { const childDecision = classifyReadonlyEntry(child, page.url()); if (childDecision.decision === "blocked") record(blocked, child, childDecision); else if (childDecision.decision === "skipped") record(skipped, child, childDecision); else if (childDecision.url && !queued.has(childDecision.url)) { queued.add(childDecision.url); queue.push({ url: childDecision.url, category: childDecision.category, parentMenu: entry.entryLabel, menuDepth: (entry.menuDepth || 0) + 1, discoveredFrom: page.url() }); } } } } catch { record(skipped, entry, { reason: "tab_navigation_failed" }); } continue; }
      if (decision.category === "pagination") { const base = new URL(page.url()); base.search = ""; const count = paginationCounts.get(base.href) || 0; if (count >= MAX_PAGINATION_PER_LIST) { record(skipped, entry, { reason: "pagination_sample_limit" }); continue; } paginationCounts.set(base.href, count + 1); }
      if (decision.url && !queued.has(decision.url)) { queued.add(decision.url); queue.push({ url: decision.url, category: decision.category, entryLabel: entry.entryLabel, parentMenu: entry.parentMenu || entry.entryLabel || null, menuDepth: (entry.menuDepth || 0) + 1, discoveredFrom: page.url() }); }
    }
  }
  if (queue.length) skipped.push({ label: "", href: null, reason: "navigation_limit_reached", category: null });
  return { visited: uniqueRecords(visited), skipped: uniqueRecords(skipped), blocked: uniqueRecords(blocked), policy: "default_deny_uncertain_readonly_navigation", pagination_policy: "max_two_representative_pages_per_list" };
}
