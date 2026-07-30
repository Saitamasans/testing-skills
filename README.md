# testing-skills

面向中文功能测试用户的常用 Agent Skill，覆盖需求澄清、测试设计、用例审计、正式服验证、多源测试审计，以及需求工作台用例驱动的浏览器 UI 验收执行。

[选择 Skill](#skills) · [安装](#install) · [基础 Skill 使用指南](#usage-guides) · [测试工作台-用例执行指南](#workbench-ui-acceptance-guide) · [多源测试审计指南](#multi-source-audit-guide) · [输出文件](#outputs)

<a id="skills"></a>

## 选择 Skill

| Skill | 适合任务 | Windows 安装 |
|---|---|---|
| 单接口用例生成-完整版<br>`single-api-test-full` | 完整分析单个接口的契约、参数、鉴权、异常和业务风险。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-full.cmd) |
| 单接口用例生成-精炼版<br>`single-api-test-concise` | 在明确要求精炼、快速或低上下文时提取单接口核心风险。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-concise.cmd) |
| 多接口链路用例生成<br>`multi-api-flow-test` | 梳理多接口依赖、业务调用链、联合用例和回归范围。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-multi-api-flow-test.cmd) |
| 需求测试工作台<br>`requirement-test-workbench` | 根据 PRD、用户故事或需求变更完成测试分析和用例设计。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-test-workbench.cmd) |
| 测试工作台-用例执行<br>`workbench-ui-acceptance-execution` | 执行测试工作台/需求工作台生成的浏览器 UI 用例，按 Playwright 风格半 UI 半元素验收、关键截图留证，并输出聊天结论与 HTML 报告。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/workbench-ui-acceptance-execution-v0.1.0/install-workbench-ui-acceptance-execution.cmd) |
| 正式服-主流程用例生成<br>`production-verification-test` | 为上线后、灰度或生产环境设计低影响验证和安全门禁。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-production-verification-test.cmd) |
| 用例质量审计<br>`test-case-quality-audit` | 审计已有用例的可执行性、需求一致性、遗漏风险和冗余。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-test-case-quality-audit.cmd) |
| 需求澄清<br>`requirement-clarification-test` | 在写用例前找出需求缺口、导出产品核对 Excel 并判断是否具备开测条件。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-clarification-test.cmd) |
| 多源测试审计<br>`multi-source-test-audit` | 关联需求、接口文档、客户端、后端和 Admin 等多源材料，完成能力分级、候选业务链、静态审计线索和阶段 B 审批计划；v0.1 不执行接口或数据库。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/multi-source-test-audit-v0.1.4/install-multi-source-test-audit.cmd) |

选择时以当前交付目标为准：一个任务只选择一个主 Skill，最多建议一个辅助 Skill；调用辅助 Skill 前先说明分工并等待确认，最终只生成一套结果。

<a id="install"></a>

## 安装

### 推荐方式：Windows 安装按钮

适合普通功能测试人员。Windows 10/11 自带的 Windows PowerShell 即可，**无需管理员权限**。公开展示的常用 Skill 可以直接点击上方 Install 按钮安装；前 5 个用例生成 Skill 实际生成 `.xlsx` 和 `.html` 文件时，仍需要可用的 Node.js 运行环境。

第 7 个 `requirement-clarification-test` 实际生成需求澄清 `.xlsx` 文件时，需要可用的 Node.js 运行环境。

`workbench-ui-acceptance-execution` 是浏览器 UI 验收执行 Skill，本身不内置独立 runner，不强制下载额外执行器或浏览器安装包；安装只复制 Skill 文件，执行时复用当前 AI 环境已有的浏览器控制能力。

### 多源测试审计

点击上方 Install 按钮只需下载一个 `install-multi-source-test-audit.cmd`。双击它后，CMD 会自动下载并校验固定版本的安装脚本；安装脚本再下载并校验完整离线 Runtime。安装完成后请重启 Codex。

该按钮已按普通用户主流程验收：下载目录中只放 CMD，不需要预先下载 PS1、ZIP、Python、Git、Node 或 npm。安装器支持 `-Force` 和 `-Repair`；若失败会显示错误码、日志位置和建议操作。

点击按钮会下载纯文本 `.cmd` 启动器；下载后双击并完成 Windows 安全确认即可安装。GitHub 不能静默执行访问者电脑上的程序，也不会绕过浏览器或 Windows 的确认步骤。Release 资产发布后按钮才生效；如果下载返回 404，请使用下面的命令兜底。

`.cmd` 可以先在 GitHub 查看，或下载后右键用文本编辑器检查。Windows 可能显示“来自互联网”或 SmartScreen 提示，这是正常安全机制。启动器只读取本仓库的 HTTPS 安装脚本，默认写入当前用户的 `.agents\skills`，不写系统目录。

### 命令兜底：Windows 零 Node 安装

以下命令可以直接粘贴到 PowerShell 或命令提示符（CMD）。

只安装“需求测试工作台”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -Skill 'requirement-test-workbench'"
```

只安装“测试工作台-用例执行”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$url='https://github.com/Saitamasans/testing-skills/releases/download/workbench-ui-acceptance-execution-v0.1.0/install-workbench-ui-acceptance-execution.cmd'; $installer=Join-Path ([IO.Path]::GetTempPath()) ('testing-skills-'+[guid]::NewGuid().ToString('N')+'.cmd'); $exitCode=1; try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $installer; $env:TESTING_SKILLS_NO_PAUSE='1'; & $env:ComSpec /d /c ('call '+[char]34+$installer+[char]34); $exitCode=$LASTEXITCODE } finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }; exit $exitCode"
```

把命令末尾的名称换成总览中的 Package，即可安装其他公开展示的单个 Skill。

默认安装到当前用户的 `.agents\skills`。目标 Skill 已存在时会保留原文件并提示跳过；确认需要替换时，在命令末尾增加 `-Force`。

如果提示无法访问 `raw.githubusercontent.com` 或 `codeload.github.com`，说明当前网络或代理无法访问下载地址；安装器不会把网络失败伪装成安装成功。把仓库下载到本地后，可用本地目录兜底：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -All -SourceDirectory .
```

### 高级方式：npx

已经配置 Node.js 工具链的开发者，可以先检查：

```powershell
node -v
npm -v
npx -v
```

三条命令都能输出版本号后，再执行：

```powershell
npx skills add Saitamasans/testing-skills
```

如果出现“无法将 `npx` 识别为命令”，请改用上面的“Windows 零 Node 安装”。macOS/Linux 开发者可在已有 Node.js 环境中运行 `scripts/install-all.sh`。

### 安装后查看

- Codex：在 Skills 管理界面或 `$CODEX_HOME/skills` 下查看。
- Claude Code：在 Skills 目录或技能列表中查看。
- CC Switch：打开 Skills 管理页，读取各包的 `SKILL.md` 名称和 description，并分别管理公开展示的 Skill。

<a id="usage-guides"></a>

## 基础 Skill 使用指南

### 1. 单接口用例生成-完整版（`single-api-test-full`）

适合普通单接口测试、契约审查和完整用例设计。

**最少准备：** 一个接口和测试目标；要生成正式可执行用例，至少提供 URL、Method 和请求参数。

**按场景补充：** 鉴权与 Header、字段规则、响应 Schema、错误码、权限边界、业务口径、幂等和数据副作用。

**调用示例：**

```text
调用 `single-api-test-full`：请按完整版审查这个单接口，分析契约、参数、鉴权、越权、幂等、并发和数据副作用；未明确规则全部标为待确认。
```

### 2. 单接口用例生成-精炼版（`single-api-test-concise`）

适合明确要求精炼版、快速版、短版或低上下文的单接口任务。

**最少准备：** 明确说出精炼或快速诉求，并提供一个接口；正式用例仍至少需要 URL、Method 和请求参数。

**按场景补充：** curl、抓包、鉴权、枚举、错误码、响应示例、业务规则和副作用。

**调用示例：**

```text
调用 `single-api-test-concise`：请用精炼版快速分析 `POST /orders`，输出准入结论、核心风险、待确认项和 P0/P1 用例速览。
```

### 3. 多接口链路用例生成（`multi-api-flow-test`）

适合两个及以上接口、业务调用链、接口增量变更和联合回归任务。

**最少准备：** 多个接口资料、业务流程/PRD、增量变更或相关源码中的任一种，并说明测试目标和期望交付；资料不足时可以启动，但降级输出缺口与方向。

**按场景补充：** 生成正式链路用例还需业务对象、调用顺序、传递字段、可观测结果、测试数据准备方式、可判定预期和可控数据影响；正式服写操作另叠加生产门禁。

**调用示例：**

```text
调用 `multi-api-flow-test`：请根据 OpenAPI、PRD 和前端抓包，梳理创建订单、支付、查询详情链路，输出联合用例和最小回归集；环境是预发。
```

### 4. 需求澄清与用例生成skill-工作台（`requirement-test-workbench`）

适合根据 PRD、用户故事或需求变更做需求评审、测试设计、正式用例或回归分析。

**最少准备：** 需求材料和目标交付物；生成正式用例前，应关闭核心流程、规则、预期和数据结果中的 P0 缺口。

**按场景补充：** 原型、接口契约、状态机、权限矩阵、变更清单、历史规则、测试数据和验收标准。

**调用示例：**

```text
调用 `requirement-test-workbench`：请根据这份 PRD 生成可执行测试用例，先判断输入等级和 P0 缺口，再输出去冗余后的十列用例。
```

### 5. 正式服用例生成skill（`production-verification-test`）

适合已上线、灰度或生产环境中的低影响验证和上线后检查。

**最少准备：** 验证目标、版本、范围、指定对象、请求或数据上限，以及对应的合法只读访问条件。

**按场景补充：** 写操作或副作用需要逐项书面授权、内部账号、执行时间窗、风险联系人、监控、停止和清理方案。

**调用示例：**

```text
调用 `production-verification-test`：版本 2.3.0 已灰度到 10%，目前没有写入授权，请只设计正式服低影响验证方案和不建议线上执行清单。
```

### 6. 用例质量审计skill（`test-case-quality-audit`）

适合在人工评审或执行前检查已有用例的可执行性、可判定性、遗漏和冗余。

**最少准备：** 现有测试用例；要判断覆盖、漏测或预期正确性，还需提供对应需求依据。

**按场景补充：** 需求和用例版本、产品确认、接口契约、状态与权限规则、变更记录、历史缺陷和追踪矩阵。

**调用示例：**

```text
调用 `test-case-quality-audit`：请对照这份 PRD 审计这批用例，只输出问题清单、准入结论和修订建议，先不要重写。
```

### 7. 测试角度需求澄清skill（`requirement-clarification-test`）

适合在写测试点或用例前找出需求缺口，并判断当前需求能否开测。默认会输出开测准入总结、产品核对轻表、可直接复制给产品的问题，并在需要文件时生成可填写的 Excel。

**最少准备：** PRD、用户故事、原型说明、验收标准、需求变更或口头需求中的一种，以及本轮澄清范围。

**按场景补充：** 产品回答、更新后的规则、接口文档、状态说明、权限矩阵、数据口径和明确不纳入项。

**调用示例：**

```text
调用 `requirement-clarification-test`：先不要写测试点或用例，请从测试视角评审这份 PRD，输出开测准入总结、产品核对轻表、可直接复制给产品的问题，并生成可填写 Excel。
```

<a id="workbench-ui-acceptance-guide"></a>

## 测试工作台-用例执行专项指南

对应 Package：`workbench-ui-acceptance-execution`。

### 什么时候使用

适合已经有需求工作台生成的测试用例，需要 AI 直接打开浏览器执行 UI 验收、关键步骤截图、记录实际结果，并输出类似 WorkBuddy 的聊天结论和离线 HTML 验收报告。

它走的是 Playwright 风格的浏览器控制思路：DOM snapshot/ref 优先，role、text、aria、CSS selector 和 JS eval 辅助；截图用于证据和关键视觉复核，不把 OCR、坐标点击或“看起来像”作为主要定位方式。

### 什么时候不应使用

不用于生成测试用例、需求澄清、纯后端接口黑盒验收、纯视觉设计稿比对，也不用于需要固定 Runner、CI 批量回放或专用执行包的场景。

### 最少准备

- 需求工作台生成的测试用例。
- 已确认的需求口径或验收口径。
- 测试环境地址。
- 用例需要登录态、角色态或特定数据时，提供账号、权限和前置数据；测试登录页、匿名页、注册页等场景时，账号不是硬性前置。
- 关键步骤截图要求。

### 执行与报告规则

固定流程为：读取用例 → 判断前置 → 执行浏览器 UI 验收 → 关键节点截图 → 逐用例判定通过/不通过/待定/阻塞 → 先输出聊天结论 → 再生成离线 HTML 报告。

聊天回复必须先给结论、统计、关键验证点和风险，不输出报告预览截图；HTML 报告必须包含任务信息、统计卡片、逐用例结果、阻塞/待定/不通过说明、截图证据区和最终结论。

本 Skill 默认不内置独立 runner，不强制下载执行器，不要求额外浏览器安装包；优先复用当前 AI 环境已有的浏览器控制能力。遇到验证码、MFA、权限缺失、口径冲突、元素无法可靠定位或继续执行可能污染数据时，必须停止或标记阻塞，不能把阻塞写成通过。

### 调用示例

```text
调用 `workbench-ui-acceptance-execution`：请按需求工作台生成的这批用例执行浏览器 UI 验收，关键步骤截图，最后先给 WorkBuddy 风格聊天结论，再生成离线 HTML 验收报告。
```

<a id="multi-source-audit-guide"></a>

## 多源测试审计专项指南

### 什么时候使用

适合把需求、接口文档、客户端代码、后端代码、Admin 代码等材料关联起来，从测试视角还原业务链、发现静态审计线索和生成后续验证计划。

### 什么时候不应使用

不用于普通单接口用例生成、不用于已有测试用例质量评审，当前 v0.1 不用于直接执行接口、数据库或浏览器操作。

### 最少准备

至少提供需求或业务规则、Apifox/Postman/OpenAPI/Swagger、客户端源码、后端源码、Admin 源码、日志/HAR/抓包中的一种；有源码时优先提供解压后的只读源码目录。

### 按场景补充

- M2：一个或多个源码目录；
- M3：测试环境、测试账号、执行授权；
- M4：数据库、日志、缓存、消息或其他真实副作用证据；
- 高风险副作用：必须单独审批，v0.1 不执行。

### 固定流程

材料盘点 → M1～M4 能力判断 → 项目画像 → 多源关联 → 推荐 3 条候选业务链 → 用户选择 → 只深入选中链 → 静态线索与阶段 B 审批计划 → 聊天摘要与固定四表 Excel。

### 调用示例

调用 `multi-source-test-audit`：请只读分析这份需求、Apifox 导出和三套解压源码，先盘点材料并判断 M 等级，再给出 3 条候选业务链；我选择后只深入该链并生成阶段 A 四表 Excel，不调用接口或数据库。

<a id="outputs"></a>

## 输出文件

单接口完整版、单接口精炼版、多接口链路和正式服验证这 4 个 Skill 在用户明确请求文件时，基于同一份报告数据交付 `.xlsx` 和 `.html`。

`requirement-test-workbench` 在实际产出统一十列用例时，默认生成并验证 `.xlsx` 和 `.html`；只有用户明确要求“不要文件”或“只在聊天中展示”时才跳过。

`requirement-clarification-test` 在用户明确要求文件、Excel、xlsx、留档或发产品时，默认生成并验证可填写的 `.xlsx`；当前版本不生成 HTML。

两类路径生成的文件使用相同格式：

- `.xlsx`：兼容 Excel 2016+ 和主流 WPS 的可编辑执行版。
- `.html`：单文件、离线、可交互执行版。

统一十列为：用例 ID、所属模块、用例标题、验证功能点、前置条件、测试步骤、预期结果、优先级、执行结果、备注。

执行结果保留四种状态：

| 状态 | 含义 | 行颜色 |
|---|---|---|
| 未执行 | 尚未开始执行 | 保留原模块色或优先级色 |
| 通过 | 已执行且符合预期 | 保留原模块色或优先级色 |
| 不通过 | 已执行且确认不符合预期 | 淡红 |
| 待定 | 已执行，但当前口径不足以判定 | 淡灰 |

HTML 支持搜索、模块、优先级和状态筛选、冻结表头、状态统计、四状态下拉及本地自动保存，不请求外部资源。

`multi-source-test-audit` v0.1 输出聊天摘要、固定四表 Excel 和阶段 A 结构化产物。阶段 A 不产生真实接口、数据库或浏览器执行证据。

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

请不要直接编辑自动生成的 `skills/*/SKILL.md`；应修改对应源文件后运行 builder。前 6 个源文件在根目录，部分较新的 Skill 源文件与资源在 `skill-sources/` 下。

## 许可协议

[MIT](LICENSE)
