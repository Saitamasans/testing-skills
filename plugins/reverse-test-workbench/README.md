# 无需求-UI逆向测试工作台

这是 `reverse-test-workbench` 的 Codex Plugin 版本。它把探索工作法和官方 Playwright MCP 打包在一起，面向只有可访问 Web UI、缺少需求文档、接口文档、源码或可靠预期结果的场景。

## 用户需要做什么

从 GitHub marketplace 安装后，新建一个任务并提供目标 URL 即可。首次使用时，Plugin 会通过 Codex 自带的 `pnpm` 从 npm 获取锁定版本的官方 Playwright MCP；仓库不保存 Playwright 安装包。

示例：

```text
使用无需求-UI逆向测试工作台，从这个 URL 开始做探索性测试：https://example.test/admin
```

用户不需要手工编写 Playwright 脚本、配置 Chrome 调试端口或安装浏览器扩展。目标进入登录页时，从 B00 开始；用户提供凭据后继续登录后的探索。

## 安装

仓库发布到 GitHub 后：

```powershell
codex plugin marketplace add <GitHub用户名>/<仓库名>
codex plugin add reverse-test-workbench@reverse-test-workbench
```

安装完成后新建任务，使 Skill 和 MCP 工具进入新的任务上下文。

## 唯一运行来源与旧版迁移

Plugin 是唯一活动分发和运行来源。正常安装后，新任务应只使用 `reverse-test-workbench:reverse-test-workbench`，Skill、官方 Playwright MCP 和版本信息由同一次 Plugin 安装提供。

如果升级前曾把纯 Skill 安装到 `~/.codex/skills/reverse-test-workbench`，应将该目录完整移出 Skill 扫描目录并保留备份；不要同时保留纯 Skill 与 Plugin Skill，也不要把新版源码再次复制到全局 Skills 目录。开发源码是修改事实源，Plugin 缓存只代表当前已安装版本；不得直接修改 Plugin 缓存或 `config.toml` 来同步代码。

迁移或重新安装后需要新建任务验证，因为已打开任务可能仍保留启动时发现的旧 Skill 清单。

## 执行环境

- 浏览器执行协议：官方 `@playwright/mcp`。
- 锁定版本：见 `.mcp.json`，不使用 `@latest`。
- 浏览器：Playwright 管理的隔离 Chrome 会话，默认可见运行。
- 视觉：多模态模型可用时进入 DOM + 视觉模式；不可用时自动进入 DOM/ARIA 模式，不阻塞普通 UI 探索。
- 安全边界：不静默切换 Selenium、Chrome 扩展或桌面控制；默认禁止主动调用业务接口。

## 默认产物

```text
过程小结.docx
测试资产表.xlsx
evidence/
```

过程和结论只代表当前账号、当前运行计划和已留证范围，不把批次完成率包装成系统全量覆盖。

## 开发校验

Plugin 清单：`.codex-plugin/plugin.json`

MCP 配置：`.mcp.json`

Skill：`skills/reverse-test-workbench/SKILL.md`

发布前应完成：Plugin 结构校验、MCP 握手、核心工具清单、浏览器导航/快照/截图冒烟，以及一次从登录页或后台首页开始的前向试跑。
