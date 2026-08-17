# Skill 来源去重验收场景

## 目标

验证 `reverse-test-workbench` 在 Codex 中只有一个活动运行时来源，避免旧纯 Skill 与 Plugin Skill 同时触发、执行规则不一致或选中旧版本。

## 场景 A：首次安装 Plugin

现状：用户从 marketplace 安装 Plugin，本机不存在旧纯 Skill。

期望：唯一活动来源为 Plugin 提供的 `reverse-test-workbench:reverse-test-workbench`；Skill 与官方 Playwright MCP 由同一 Plugin 版本管理。

## 场景 B：本机遗留旧纯 Skill

现状：`~/.codex/skills/reverse-test-workbench` 与 Plugin 缓存同时存在。

期望：把旧纯 Skill 完整移动到 Skill 扫描目录之外的备份位置，不直接删除；新任务中不再出现无命名空间的重复 Skill。

## 场景 C：Plugin 源码迭代

现状：开发目录中的 Plugin Skill 已修改，但已安装缓存仍是旧版本。

期望：源码目录是开发事实源，缓存目录只代表当前已安装版本；完成统一修改前不手工覆盖缓存，也不把源码复制回 `~/.codex/skills`。

## 场景 D：重新安装后验证

现状：Plugin 已按 cachebuster 流程重新安装并启动新任务。

期望：只发现 Plugin 命名空间 Skill；MCP、Skill、manifest 和缓存版本属于同一次安装，不允许从不同来源拼接执行环境。

## 通用验收

- Plugin 是唯一活动分发和运行来源。
- 旧纯 Skill 只允许作为扫描目录外的备份存在。
- 不通过修改 `config.toml` 或直接改 Plugin 缓存解决重复问题。
- 不删除旧版本历史，不影响当前已安装 `v0.1.0` 对照基线。
- 当前任务可能仍保留启动时的旧 Skill 清单；最终验证必须在新任务中进行。
