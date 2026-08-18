# Skill 来源与适配器镜像验收场景

## 目标

验证 `reverse-test-workbench` 只有一个通用规则事实源，同时允许不同宿主提供可选适配器，避免公共 Skill 与适配器中的规则漂移。

## 场景 A：通用安装

现状：用户在任意支持 Skill 指令和 MCP 的宿主中安装 `skills/reverse-test-workbench`。

期望：不需要 Codex、特定操作系统或特定安装目录；宿主能提供官方 Playwright MCP 时直接完成能力门禁并运行。

## 场景 B：Codex 适配器安装

现状：Codex 用户安装 `plugins/reverse-test-workbench`。

期望：适配器提供 `.codex-plugin/plugin.json` 和 `.mcp.json`，其 Skill 内容与公共包逐文件一致；适配器只负责接线，不拥有独立测试规则。

## 场景 C：公共包与适配器同时存在

现状：宿主同时发现无命名空间公共 Skill 和带命名空间的适配器 Skill。

期望：两者核心内容完全一致，不会产生行为差异；安装文档应建议用户在同一宿主中选择一种安装方式，避免重复触发。

## 场景 D：源码迭代

现状：开发者修改 `skill-sources/reverse-test-workbench`。

期望：先生成公共 `skills/reverse-test-workbench`，再确定性同步到 Codex 适配器；CI 对公共包漂移和适配器镜像漂移分别失败。

## 通用验收

- 通用 Skill 是主产品和唯一规则事实源。
- 宿主适配器是可选分发层，不改变核心规则。
- 核心不包含 Codex、Windows、macOS、固定用户目录或固定运行时前提。
- 官方 Playwright MCP 是首选执行协议，由当前宿主发现或配置。
- 不支持 Skill/MCP/等价浏览器能力的普通聊天产品明确不在可执行范围内。
