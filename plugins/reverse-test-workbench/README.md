# Reverse Test Workbench: Codex 适配器

这是通用 `reverse-test-workbench` Skill 的可选 Codex 适配器，不是唯一分发方式。核心规则与公共包 `skills/reverse-test-workbench` 完全一致；本目录只额外提供 Codex manifest 和已验证版本的官方 Playwright MCP 配置。

## 适合谁

- 已使用 Codex，希望安装后自动获得 Skill 与 Playwright MCP 配置的用户。
- 不希望手工连接 MCP、选择浏览器通道或管理执行器版本的用户。

其他支持 Agent Skills/Skill 风格指令和 MCP 的宿主，应直接安装公共 Skill，并通过宿主自己的方式连接官方 `@playwright/mcp`。核心 Skill 不依赖 Codex、Windows、macOS 或某个固定包管理器。

## Codex 安装

```text
codex plugin marketplace add Saitamasans/testing-skills --ref main
codex plugin add reverse-test-workbench@reverse-test-workbench
```

安装完成后新建任务，再提供目标 URL。首次启动时，Codex 按 `.mcp.json` 获取锁定版本的官方 Playwright MCP；仓库不保存 Playwright 安装包。

## 适配器边界

- 通用核心：`skills/reverse-test-workbench/`
- Codex 元数据：`.codex-plugin/plugin.json`
- Codex MCP 配置：`.mcp.json`
- 浏览器执行协议：官方 `@playwright/mcp`
- 视觉：宿主模型支持图像时使用 DOM + 视觉；否则自动进入 DOM/ARIA 模式

适配器不得修改核心测试规则。公共 Skill 与本适配器中的 Skill 镜像由构建工具同步并进行漂移校验。

## 默认产物

```text
过程小结.docx
测试资产表.xlsx
evidence/
```

文档/表格运行时不可用时，浏览器探索仍继续，并至少保留结构化 JSON 与证据。过程和结论只代表当前账号、当前计划和已留证范围。
