# testing-skills

面向测试工程师的七个标准 Agent Skill：覆盖需求澄清、需求测试设计、单接口、多接口链路、正式服验证和已有用例审计。七个中文源文件保持为唯一正文真源，`skills/` 是自动生成的 Codex / Claude Code 标准安装包。

> Seven production-ready testing skills for Codex and Claude Code, with deterministic Excel and offline HTML execution reports.

## 七个 Skill

| 中文名称 | Package | 适用场景 |
|---|---|---|
| 单接口测试用例生成（完整版） | `single-api-test-full` | 普通单接口测试、契约审查、完整用例 |
| 单接口测试用例生成（精炼版） | `single-api-test-concise` | 用户明确要求精炼、快速、短版或低上下文 |
| 多接口链路测试用例生成 | `multi-api-flow-test` | 多接口依赖、调用链、业务流与回归范围 |
| 需求测试分析工作台 | `requirement-test-workbench` | 根据 PRD、用户故事或需求变更设计测试 |
| 正式服验证用例生成 | `production-verification-test` | 线上、生产、上线后验证与安全门禁 |
| 测试用例质量审计 | `test-case-quality-audit` | 审计已有用例的证据、覆盖和可执行性 |
| 测试视角需求澄清 | `requirement-clarification-test` | 只澄清需求、判断能否开测，暂不写用例 |

## 安装

安装全部七个 Skill：

```bash
npx skills add Saitamasans/testing-skills
```

单独安装一个 Skill：

```bash
npx skills add Saitamasans/testing-skills --path skills/single-api-test-full
npx skills add Saitamasans/testing-skills --path skills/single-api-test-concise
npx skills add Saitamasans/testing-skills --path skills/multi-api-flow-test
npx skills add Saitamasans/testing-skills --path skills/requirement-test-workbench
npx skills add Saitamasans/testing-skills --path skills/production-verification-test
npx skills add Saitamasans/testing-skills --path skills/test-case-quality-audit
npx skills add Saitamasans/testing-skills --path skills/requirement-clarification-test
```

仓库会持续校验七个 `--path` 均指向真实标准包；也可使用 `scripts/install-all.ps1` 或 `scripts/install-all.sh` 顺序安装全部七个 Skill。

## 如何调用

安装后直接用自然语言表达目标即可，Codex / Claude Code 会根据 `SKILL.md` 的 description 自动发现。例如：

```text
帮我按完整版测一下这个单接口，并生成 Excel 和 HTML 文件。
用精炼版快速测一下这个接口。
分析这五个接口的调用链并生成链路用例。
根据这份 PRD 生成正式测试用例。
先只澄清需求，不要写测试用例。
审计这批已有测试用例。
为本次上线设计正式服验证用例。
```

也可以在客户端支持显式 Skill 选择时直接选择对应名称。

## 路由与组合规则

- 一个任务只选择一个主 Skill。
- 最多建议一个辅助 Skill。
- 调用辅助 Skill 前先展示两者名称和分工，并等待用户确认。
- 用户确认前不加载辅助 Skill、不执行辅助分析、不生成最终文件。
- 用户拒绝后主 Skill 继续，并说明覆盖限制。
- 最终只生成一套结果，不让两个 Skill 各写一套互相冲突的内容。

## Excel + HTML 双格式执行报告

五个正式用例生成 Skill 在用户明确要求文件时，默认基于同一份报告数据同时交付：

- `.xlsx`：Excel 2016+ / 主流 WPS 可编辑执行版；
- `.html`：单文件、离线、可交互执行版。

统一十列为：用例 ID、所属模块、用例标题、验证功能点、前置条件、测试步骤、预期结果、优先级、执行结果、备注。

执行结果支持四种状态：

| 状态 | 含义 | 行颜色 |
|---|---|---|
| 未执行 | 尚未开始执行 | 保留原模块色/优先级色 |
| 通过 | 已执行且符合预期 | 保留原模块色/优先级色 |
| 不通过 | 已执行且确认不符合预期 | 淡红 |
| 待定 | 已执行，但多方口径有歧义，暂时不能定性为缺陷 | 淡灰 |

HTML 包含搜索、模块/优先级/执行状态筛选、冻结表头、状态统计、四状态下拉和按报告隔离的本地自动保存，不请求外部资源。

## 在 Codex / Claude Code / CC Switch 中查看

- Codex：安装后在 Codex 的 Skills 管理界面或 `$CODEX_HOME/skills` 下查看。
- Claude Code：安装后在 Claude Code 的 Skills 目录或技能列表中查看。
- CC Switch：打开 Skills 管理页，可读取七个包中的 `SKILL.md` 名称与 description，并分别管理七个 Skill。

## 本地开发

```bash
python tooling/build_skills.py
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest discover -s tests -v
node --test tests/test-case-renderer.test.mjs
```

根目录七个中文文件是唯一正文真源，请勿直接编辑自动生成的 `skills/*/SKILL.md`。

## License

[MIT](LICENSE)
