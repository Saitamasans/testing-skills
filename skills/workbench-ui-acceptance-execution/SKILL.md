---
name: workbench-ui-acceptance-execution
description: "Use when users want to execute demand-workbench-generated browser UI test cases with Playwright-style browser control, or ask in Chinese to 跑需求工作台用例、执行UI验收、关键步骤截图、生成验收报告； capture screenshots and evidence, and produce a WorkBuddy-style chat conclusion plus offline HTML acceptance report; do not use for case generation, requirement clarification, pure API testing, or pure visual design comparison."
---

<!-- 此文件由根目录中文源文件自动生成，请勿直接编辑。 -->
<!-- This skill is Playwright-backed browser-control-first and does not require a standalone runner. -->

# 需求工作台 UI 验收执行

## 1. 硬规则与定位

本 Skill 是一个用例驱动的浏览器 UI 验收执行器。

默认执行方式与产品经理验收链路一致：DOM snapshot/ref 优先，role/text/aria 降级，CSS selector 和 JS eval 辅助；截图只用于证据，不用于 OCR 或坐标找元素。

## 2. 输入

- 需求工作台生成的测试用例
- 已确认的需求口径
- 测试环境地址
- 测试账号、权限、前置数据
- 关键截图要求

## 3. 参考文档

- `references/input-contract.md`
- `references/execution-rules.md`
- `references/report-template.md`
- `references/output-style.md`

## 4. 边界

- 本 Skill 默认不内置独立 runner。
- 本 Skill 默认不强制下载额外执行器或浏览器安装包。
- 本 Skill 默认优先复用现有浏览器控制能力完成执行。
- 不使用 Subagent-Driven 作为用例执行方式；Subagent 只可用于开发实现阶段的任务拆分，不进入验收执行链路。
- 账号不是硬性前置。
- 无账号不等于“不适用”。

## 5. 输出

- 聊天内先输出简洁验收结论，允许少量状态 emoji 增强可读性。
- 默认生成离线 HTML 验收报告，除非用户明确说只要聊天结果。
- 输出执行摘要、逐用例结果、关键截图、风险与待确认项、阻塞项说明和最终结论。
- HTML 报告使用 `scripts/render-acceptance-report.mjs` 生成，零外部网络请求、零额外依赖。

## 6. 执行检查清单

- [ ] ⚠️ REQUIRED：读取用例、需求口径、环境、账号/权限、前置数据、截图要求
- [ ] ⚠️ REQUIRED：按 `input-contract.md` 判断完整、可补全、待定或阻塞
- [ ] ⛔ BLOCKING：缺少用例必须的账号、权限、数据、验证码处理、测试桩或需求口径时，标记阻塞并停止对应用例
- [ ] ⚠️ REQUIRED：按 `execution-rules.md` 执行浏览器 UI 验收
- [ ] ⚠️ REQUIRED：对关键节点截图留证
- [ ] 记录逐用例实际结果、证据编号和阻塞/待定原因
- [ ] ⚠️ REQUIRED：生成 WorkBuddy 风格聊天结论
- [ ] ⚠️ REQUIRED：生成离线 HTML 报告
- [ ] 交付前确认：不输出预览图，不依赖外部资源，报告与截图都已生成

## 7. 反模式

- 不用 OCR 找元素。
- 不用坐标点击。
- 不把阻塞写成通过。
- 不把示例业务词当成通用模板。
