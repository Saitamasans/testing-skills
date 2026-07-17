# testing-skills

面向测试工程师的 8 个标准 Agent Skill：5 个用于生成正式测试用例，2 个用于需求澄清和用例质量审计，1 个用于自动执行已有 Web/API 用例并回填证据报告。原 7 个中文源文件保留在根目录，第 8 个执行类 Skill 的源文件独立放在 `skill-sources/web-api-test-execution-evidence/`，`skills/` 是自动生成的 Codex / Claude Code 标准安装包。

> Production-ready testing skills for Codex and Claude Code, with deterministic Excel, offline HTML, and Web/API execution evidence support.

## 8 个 Skill

| 中文名称 | Package | 类型 | 适用场景 | 安装 |
|---|---|---|---|---|
| 单接口测试用例生成（完整版） | `single-api-test-full` | 生成正式用例 | 普通单接口测试、契约审查、完整用例 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-full.cmd) |
| 单接口测试用例生成（精炼版） | `single-api-test-concise` | 生成正式用例 | 用户明确要求精炼、快速、短版或低上下文 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-concise.cmd) |
| 多接口链路测试用例生成 | `multi-api-flow-test` | 生成正式用例 | 多接口依赖、调用链、业务流与回归范围 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-multi-api-flow-test.cmd) |
| 需求测试分析工作台 | `requirement-test-workbench` | 生成正式用例 | 根据 PRD、用户故事或需求变更设计测试 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-test-workbench.cmd) |
| 正式服验证用例生成 | `production-verification-test` | 生成正式用例 | 线上、生产、上线后验证与安全门禁 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-production-verification-test.cmd) |
| 测试用例质量审计 | `test-case-quality-audit` | 不生成正式用例 | 审计已有用例的证据、覆盖和可执行性 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-test-case-quality-audit.cmd) |
| 测试视角需求澄清 | `requirement-clarification-test` | 不生成正式用例 | 只澄清需求、反向要产品核对歧义点，暂不写用例 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-clarification-test.cmd) |
| Web/API 测试用例自动执行与证据回填 | `web-api-test-execution-evidence` | 执行已有用例 | 自动执行已有 Web/API 用例，生成证据并回填 Excel/HTML | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-web-api-test-execution-evidence.cmd) |

## 安装

### 推荐方式：Windows 安装按钮

适合普通功能测试人员。Windows 10/11 自带的 Windows PowerShell 即可，**无需管理员权限，也无需安装 Node.js、npm、npx 或 Git**。

[![Install All 8 Skills](https://img.shields.io/badge/Install-All_8_Skills-2ea44f?style=for-the-badge&logo=github)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-all.cmd)

点击按钮会下载纯文本 `.cmd` 启动器；下载后双击并完成 Windows 安全确认即可安装。GitHub 不能静默执行访问者电脑上的程序，也不会绕过浏览器或 Windows 的确认步骤。按钮在固定的 `skill-installers-v1` Release 资产发布后生效；如果下载返回 404，请使用下面的命令兜底。

`.cmd` 可以先在 GitHub 查看，或下载后右键用文本编辑器检查。Windows 可能显示“来自互联网”或 SmartScreen 提示，这是正常安全机制。启动器只读取本仓库的 HTTPS 安装脚本，默认写入当前用户的 `.agents\skills`，不写系统目录。

### 命令兜底：Windows 零 Node 安装

下面同一条命令可以直接粘贴到 PowerShell 或命令提示符（CMD）。

安装全部 8 个 Skill：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -All"
```

只安装“需求测试分析工作台”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -Skill 'requirement-test-workbench'"
```

把上面命令最后的名称换成表格中的 Package 即可安装其他单个 Skill。例如只安装第 8 个执行类 Skill：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -Skill 'web-api-test-execution-evidence'"
```

默认安装到当前用户的 `.agents\skills`。目标 Skill 已存在时会保留原文件并提示跳过；确认需要替换时，在命令末尾增加 `-Force`。

安装成功后会看到每个 Skill 的名称和实际路径。请重启 Codex、Claude Code 或 CC Switch，再在 Skills 列表中确认，或直接发送“调用需求测试分析工作台，根据这份 PRD 生成测试用例”进行验证。

如果提示无法访问 `raw.githubusercontent.com` 或 `codeload.github.com`，属于网络或代理问题；安装器不会把网络失败伪装成安装成功。仓库下载到本地后，也可以运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -All -SourceDirectory .
```

### 高级方式：npx

此方式只适合已经安装 Node.js 的开发者。执行安装命令前先检查：

```powershell
node -v
npm -v
npx -v
```

三条命令都能输出版本号后，才能使用：

```powershell
npx skills add Saitamasans/testing-skills
npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y
```

如果出现“无法将 `npx` 识别为命令”，不要反复执行；直接改用上面的“Windows 零 Node 安装”。macOS/Linux 开发者也可以在已安装 Node.js 的前提下运行 `scripts/install-all.sh`。

### 安装依赖与运行依赖

- 安装这 8 个 Skill：推荐方式只需要 Windows PowerShell 和访问 GitHub 的网络，不需要 Node.js、npm、npx 或 Git。
- 生成用例、需求澄清和用例审计：安装后由支持 Skill 的 AI 客户端调用，不因为安装方式不同而改变。
- 第 8 个 `web-api-test-execution-evidence` 真正执行 Web/API 用例时，其 Runner 需要 Node.js 20+；不要求 npm、npx 或 npm 账号，也不需要手工安装 Runner。这个运行依赖与“安装 Skill”是两件事。

## 第 8 个 Skill 使用前要准备什么

第 8 个 Skill 负责执行**已有正式测试用例**，不是从需求直接生成用例。全新用户按下面三档准备即可：

| 资料 | 级别 | 什么时候需要 |
|---|---|---|
| 正式测试用例、目标 Web/API 地址、环境性质和执行授权、可执行步骤与预期结果、执行前确认、Node.js 20+ | 强制资料 | 每次实际执行都需要；用例可以是标准十列 `.xlsx`、原生 `report.json`，或已确认字段映射的非标准 Excel |
| 测试账号或凭据来源 | 条件强制资料 | 目标需要登录或鉴权时需要；秘密值只放环境变量或 Secrets，不写进用例和报告 |
| 接口文档、OpenAPI、Swagger 或 Postman | 条件强制资料 | 接口用例没有写全方法、路径、参数、请求体、鉴权或断言细节时需要 |
| 测试数据和清理方案 | 条件强制资料 | 用例会新增、修改或删除数据时需要 |
| 稳定的 Web 控件定位信息 | 条件强制资料 | 执行 Web 用例且页面语义不足以可靠定位时需要 |
| 数据库只读账号和只读证明 | 条件强制资料 | 用例包含数据库断言时需要，且只允许 `SELECT` |
| 前后端源码、启动命令、依赖和配置 | 条件强制资料 | 本地应用尚未运行、需要由执行方启动时才需要；已有可访问测试地址时通常不需要前后端源码 |
| CI 配置和 Secrets | 条件强制资料 | 要在 CI 中执行时需要，且 CI 只允许低风险 R0/R1 动作 |
| 需求文档、需求截图、原型、流程图、历史报告和旧证据 | 辅助资料 | 用于核对业务口径或回归对比，不是自动执行入口 |

需求文档、需求截图、原型和流程图不能代替正式测试用例。只有需求资料时，先调用 `requirement-test-workbench` 生成 Excel 正式用例，再调用第 8 个 Skill 执行；只有已部署地址时，也不强制提供前后端代码。

## 自动执行 Runner

第 8 个 Skill 已内置一键启动器。用户只需要安装 Skill；首次执行时会先显示来源、固定版本、体积和缓存位置，再从项目 GitHub Release 自动下载并校验 Runner。无需 npm 账号，也无需手工输入 Runner 安装命令。包含 Web 动作时才按需自动准备 Playwright Chromium，API-only 不下载浏览器；交互执行默认打开可见浏览器，CI 固定无界面。

Runner 产物包括 `run-result.json`、`.xlsx`、`.html`、证据目录和事件日志。`run-result.json` 是唯一判定来源，Excel/HTML 只从同一份结果投影生成。

## 如何调用

安装后直接用自然语言表达目标即可，Codex / Claude Code 会根据 `SKILL.md` 的 description 自动发现。示例：

```text
帮我按完整版测一下这个单接口，并生成 Excel 和 HTML 文件。
用精炼版快速测一下这个接口。
分析这五个接口的调用链并生成链路用例。
根据这份 PRD 生成正式测试用例。
先只澄清需求，不要写测试用例。
审计这批已有测试用例。
为本次上线设计正式服验证用例。
执行这批 Web/API 测试用例，生成证据并回填报告。
```

## 路由与组合规则

- 一个任务只选择一个主 Skill。
- 最多建议一个辅助 Skill。
- 调用辅助 Skill 前先展示两者名称和分工，并等待用户确认。
- 用户确认前不加载辅助 Skill、不执行辅助分析、不生成最终文件。
- 用户拒绝后主 Skill 继续，并说明覆盖限制。
- 最终只生成一套结果，不让两个 Skill 各写一套互相冲突的内容。

## Excel + HTML 双格式执行报告

5 个正式用例生成 Skill 在用户明确要求文件时，默认基于同一份报告数据同时交付：

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
- CC Switch：打开 Skills 管理页，可读取 8 个包中的 `SKILL.md` 名称和 description，并分别管理 8 个 Skill。

## 本地开发

```bash
python tooling/build_skills.py
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest discover -s tests -v
npm run build --workspace @saitamasans/testing-runner
npm test --workspace @saitamasans/testing-runner
node --test tests/test-case-renderer.test.mjs tests/html_behavior.test.mjs
```

请不要直接编辑自动生成的 `skills/*/SKILL.md`；应修改对应源文件后运行 builder。原 7 个源文件在根目录，第 8 个源文件在 `skill-sources/web-api-test-execution-evidence/`。

## License

[MIT](LICENSE)
