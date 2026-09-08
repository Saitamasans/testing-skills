# 宿主能力协议

先读取当前浏览器工具文档，只用明确支持的操作。不通过终端、另起 Playwright、抓浏览器配置或 Cookie 绕过能力限制。协议描述行为，不虚构工具 API。

每项记录 id/status/evidence/limitation。status 为 verified/unavailable/untested/unstable；verified 必须附本轮证据，未探测不能写 unavailable。

| 能力 ID | 验证证据 | 不足的证据 |
|---|---|---|
| page_read | 目标正文/DOM | 标题/URL |
| navigation | 安全导航后核验目标正文 | goto 返回、URL 改变 |
| interaction | 安全 tab/分页后核验选中状态和新内容 | 发出 click、旧 DOM |
| inline_js | 读 script 文本并定位片段 | script 数量 |
| external_js | 取得外部 JS 正文及来源 | src URL |
| source_map | 读取 Map 并验证原始位置映射 | sourceMappingURL 注释 |
| passive_network | 自然请求的方法/类型记录 | console 日志、DOM 链接 |

先读页面，再测一次安全导航；需要交互遍历才验证 tab/分页。不逐页重复所有探针。inventory 支持不等于 bundle 支持 JS。

动作超时是结果未知：先读取状态，不立刻重放。debugger 未绑定或读取失败则标 unstable，按宿主文档尝试有依据的恢复路径（例如新鲜句柄或独立任务标签），逐项记录尝试及结果；同一失败操作无新证据时不重复。不动其他用户标签，不刷新未保存页面。恢复后验证正文和安全导航才算稳定；合理的受支持恢复路径用尽后，输出已证实部分及未覆盖，不反复要求重启/扩大权限/重新输入凭据。根本读不到页面则 connectivity_blocked。

用户明确指定浏览器优先；否则优先可用 Google Chrome，Edge 仅兼容备选，再考虑宿主已有受管浏览器。不安装浏览器、不改默认设置、不读 profile。切换改变登录上下文时先说明并取得必要授权。
DOM 有、JS 正文无：只能 structure_only；内嵌 JS 有、外部不可读：partial_js。没有网络观察接口，指标为 null，不填 0。静态请求代码不证明请求实际发生。
