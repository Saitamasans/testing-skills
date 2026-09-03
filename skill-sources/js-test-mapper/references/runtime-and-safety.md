# Runtime 与安全合同

## 分发拓扑

```text
公共 Skill -> Codex Plugin 镜像 -> runtime launcher -> 独立 Node Runtime
```

Runtime 最低 Node 20，官方 CI/开发 Node 22.23.1，Playwright 固定 1.61.1。Runtime 的 npm 依赖在 bundle 构建时按独立 lock 准备并随 bundle 分发；正常扫描不得执行 npm install、pnpm dlx 或下载浏览器。

launcher 优先读取 `JS_TEST_MAPPER_RUNTIME_ROOT`，也允许显式 `--runtime-root`；找不到或完整性失败时只调用 Skill 内固定的 bootstrap 一次。bootstrap 仅获取 runtime lock 指定的 GitHub Release TGZ，完成 SHA-256 校验并以 `npm --offline --ignore-scripts` 安装；不下载或执行远程脚本。

## 网络边界

- 浏览器自然导航和页面自然请求只做被动观察。
- 只有同时满足“来源在正式白名单、方法为 GET、URL 具有 JS/MJS/Chunk/Map 技术资源类型、business deny 未命中”时，才可主动获取技术资源；所有此类请求必须经过唯一 Runtime Guard。
- `/api`、GraphQL、RPC、业务 action、导出/下载/report/data 路径、敏感查询参数和 URL userinfo 均属于 deny 信号；不能因为 URL 以 `.js` 结尾就放行。
- 只可主动 GET 由 HTML、import、`sourceMappingURL`、`SourceMap` / `X-SourceMap` Header 明确指向的 JS/MJS/Chunk/Map 技术资源。
- 不手工拼 Authorization，不复用业务请求体，不主动 POST/PUT/PATCH/DELETE。
- 每个 Run 分开记录 `technical_resource_gets`、`blocked_business_api_attempts` 与 `active_business_api_calls`；被拦截尝试不等于实际调用，后者必须为 0。

## 证据边界

正式事实源只有 `evidence/run-data.json`。target URL、asset URL、passive request URL、Source Map pointer、snippet、degradation/evidence URL 都必须经过同一安全 URL/文本入口。长期仅保存脱敏 canonical URL、SHA-256、分类证据、最小脱敏 snippet、位置、结构事实和降级；不保存完整 JS/Map/sourcesContent 或业务 Response Body。

Runtime 使用独立敏感 detector 校验最终 run-data，不以“redactor 是否改变字符串”作为唯一安全证明。至少阻断 quoted JSON/object key、URL query、URL userinfo、Bearer、邮箱、手机号、身份标识和支付字段的原始值；核心 `assets[]`、`technical_facts[]`、`evidence[]` 必须满足 Schema required 字段和无悬空引用合同。

L1 只产生 E1 技术候选。`status === 2` 的表达只能是“状态值 2 参与条件判断，具体业务语义待确认”。
