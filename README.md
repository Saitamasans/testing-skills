# testing-skills

面向中文测试工作的通用 Agent Skill，覆盖需求澄清、测试设计、用例审计、正式服验证、多源测试审计和浏览器 UI 执行。

[选择 Skill](#skills) · [安装文档](docs/installation.md) · [使用指南](docs/skill-guides.md) · [开发与发布](docs/development.md)

<a id="skills"></a>

## 选择 Skill

| Skill | 适合任务 | 安装 |
|---|---|---|
| 单接口用例生成-完整版<br>`single-api-test-full` | 完整分析单个接口的契约、参数、鉴权、异常和业务风险。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-full.cmd) |
| 单接口用例生成-精炼版<br>`single-api-test-concise` | 明确要求精炼、快速或低上下文时提取接口核心风险。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-concise.cmd) |
| 多接口链路用例生成<br>`multi-api-flow-test` | 梳理多接口依赖、业务链路、联合用例和回归范围。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-multi-api-flow-test.cmd) |
| 测试工作台-生成用例<br>`requirement-test-workbench` | 根据 PRD、用户故事或需求变更完成测试分析和用例设计。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-test-workbench.cmd) |
| 测试工作台-用例执行<br>`workbench-ui-acceptance-execution` | 执行浏览器 UI 验收，截图留证并输出聊天结论与 HTML 报告。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/workbench-ui-acceptance-execution-v0.1.0/install-workbench-ui-acceptance-execution.cmd) |
| 正式服-主流程用例生成<br>`production-verification-test` | 为上线后、灰度或生产环境设计低影响验证和安全门禁。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-production-verification-test.cmd) |
| 用例质量审计<br>`test-case-quality-audit` | 审计已有用例的可执行性、需求一致性、遗漏风险和冗余。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-test-case-quality-audit.cmd) |
| 需求澄清-需求评审<br>`requirement-clarification-test` | 在写用例前找出需求缺口并判断是否具备开测条件。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-clarification-test.cmd) |
| 多源测试-审计<br>`multi-source-test-audit` | 关联需求、接口、客户端、后端和 Admin 材料，生成静态审计线索。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/multi-source-test-audit-v0.1.4/install-multi-source-test-audit.cmd) |
| 无需求-UI逆向测试工作台<br>`reverse-test-workbench` | 只有 Web UI 时，使用官方 Playwright MCP 做探索、留证和测试资产沉淀。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/reverse-test-workbench-v0.1.0/install-reverse-test-workbench.cmd) |
| 无需求-Web JS逆向测试建图<br>`js-test-mapper` | 只有 Web Test URL 或需求资料不完整时，用只读 JS / Runtime 逆向恢复 Route、代表调用链、接口引用、权限和状态线索。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/v0.1.0/js-test-mapper-0.1.0.zip) |

一个任务选择一个主 Skill；只有在分工清晰时再增加辅助 Skill。完整选择建议见[使用指南](docs/skill-guides.md)。

## 快速使用

安装后，直接向你的 Agent 说明目标、材料或 URL。例如：

```text
调用 reverse-test-workbench，对这个测试后台进行探索性测试：
https://example.test/admin
```

## 能力边界

- Skill 核心规则跨宿主、跨 Windows/macOS/Linux，不要求使用某个固定 Agent。
- 浏览器探索优先使用官方 Playwright MCP；宿主支持视觉模型时补充视觉观察，不支持时继续 DOM/ARIA 探索。
- 无需求探索默认从只读、可证据化的路径开始；高影响写入动作必须经过风险门禁。
- 结论只代表实际执行、当前账号、当前状态和已留证范围，不把阶段结果包装成全量测试完成。

## 文档

- [安装与宿主接入](docs/installation.md)
- [Skill 使用指南](docs/skill-guides.md)
- [开发、构建与发布](docs/development.md)
- [发布说明与验证记录](docs/release/)

## 许可

[MIT](LICENSE)
