# testing-skills

面向中文功能测试用户的 8 个 Agent Skill，覆盖需求澄清、测试设计、用例审计、正式服验证，以及已有 Web/API 用例的自动执行和证据回填。

[选择 Skill](#skills) · [安装](#install) · [第 1–7 个 Skill 使用指南](#usage-guides) · [第 8 个 Skill 专项指南](#execution-guide) · [输出文件](#outputs)

<a id="skills"></a>

## 选择 Skill

| Skill | 适合任务 | Windows 安装 |
|---|---|---|
| 单接口完整版<br>`single-api-test-full` | 完整分析单个接口的契约、参数、鉴权、异常和业务风险。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-full.cmd) |
| 单接口精炼版<br>`single-api-test-concise` | 在明确要求精炼、快速或低上下文时提取单接口核心风险。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-single-api-test-concise.cmd) |
| 多接口链路测试<br>`multi-api-flow-test` | 梳理多接口依赖、业务调用链、联合用例和回归范围。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-multi-api-flow-test.cmd) |
| 需求测试工作台<br>`requirement-test-workbench` | 根据 PRD、用户故事或需求变更完成测试分析和用例设计。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-test-workbench.cmd) |
| 正式服验证<br>`production-verification-test` | 为上线后、灰度或生产环境设计低影响验证和安全门禁。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-production-verification-test.cmd) |
| 用例质量审计<br>`test-case-quality-audit` | 审计已有用例的可执行性、需求一致性、遗漏风险和冗余。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-test-case-quality-audit.cmd) |
| 需求澄清<br>`requirement-clarification-test` | 在写用例前找出需求缺口并判断是否具备开测条件。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/skill-installers-v1/install-requirement-clarification-test.cmd) |
| 自动执行与证据回填<br>`web-api-test-execution-evidence` | 自动执行已有 Web/API 正式用例并回填 Excel、HTML 和证据。 | [![Install](https://img.shields.io/badge/Install-2ea44f)](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/install-web-api-test-execution-evidence.cmd) |

选择时以当前交付目标为准：一个任务只选择一个主 Skill，最多建议一个辅助 Skill；调用辅助 Skill 前先说明分工并等待确认，最终只生成一套结果。

<a id="install"></a>

## 安装

### 推荐方式：Windows 安装按钮

适合普通功能测试人员。Windows 10/11 自带的 Windows PowerShell 即可，**无需管理员权限**。安装 8 个 Skill 无需安装 Node.js、npm、npx 或 Git。前 7 个 Skill 可以用下方通用安装器安装；其中前 5 个用例生成 Skill 实际生成 `.xlsx` 和 `.html` 文件时，仍需要可用的 Node.js 运行环境。

第 8 个 `web-api-test-execution-evidence` 的最终用户必须使用 GitHub Release 完整安装器。完整安装不提供轻量版、API-only 或可选浏览器模式，安装时已交付 portable Node 22.23.1、Runner 1.1.2、Playwright 1.61.1、Chromium 1228、headless shell 1228 和 FFmpeg 1011；无需系统安装 Node.js、npm、Git、Chrome、Excel 或 Python。安装器完成下载、SHA-256 校验、解压、bundle 清单校验和本地完整 smoke test 后才显示“安装完成，可以执行 Web/API 自动化测试”。

发布状态说明：远端 tag `testing-runner-v1.1.1` 仅为未发布/作废发布目标，不对应可安全公开的 Runner Release，自动化不得再次尝试发布它，也不得删除或移动该 tag。首个可发布目标为 `testing-runner-v1.1.2`。

[![Install All 8 Skills](https://img.shields.io/badge/Install-All_8_Skills-2ea44f?style=for-the-badge&logo=github)](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/install-all.cmd)

第 8 个 Skill 的执行就绪安装器：`install-web-api-test-execution-evidence.cmd` 或 `install-web-api-test-execution-evidence.ps1`。它使用固定版本的 GitHub Release 完整安装器，显示下载进度、速度、ETA、重试、续传、校验、解压和 smoke test；安装已损坏或不完整时，用同一安装器加 `-Repair`，不要在执行过程中下载或替换任何组件。

### Windows x64 三步使用

1. 下载并双击 [install-web-api-test-execution-evidence.cmd](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/install-web-api-test-execution-evidence.cmd)。安装阶段会下载一次完整 Runtime，并校验 SHA-256、清单和本地 smoke；无需管理员权限或系统 Node、npm、Git、Chrome。
2. 安装完成后重启 Codex。
3. 上传十列 Excel 测试用例并输入：`调用第八个 Skill 执行`。

正常执行阶段不会下载 Node、Runner、Playwright 或 Chromium，也不会访问 GitHub Release、npm 或浏览器下载源获取运行依赖。完整离线/审计包可下载 [web-api-test-execution-evidence-1.0.2-windows-x64.zip](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/web-api-test-execution-evidence-1.0.2-windows-x64.zip)，公开校验值见 [SHA256SUMS.txt](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/SHA256SUMS.txt)。

安装损坏时，下载同一 Release 中的 `install-web-api-test-execution-evidence.ps1`，在其所在目录运行 `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-web-api-test-execution-evidence.ps1 -Repair`。默认 receipt 位于 `%USERPROFILE%\.testing-skills\installations\web-api-test-execution-evidence.json`，诊断目录位于 `%USERPROFILE%\.testing-skills\diagnostics\web-api-test-execution-evidence`。

点击按钮会下载纯文本 `.cmd` 启动器；下载后双击并完成 Windows 安全确认即可安装。GitHub 不能静默执行访问者电脑上的程序，也不会绕过浏览器或 Windows 的确认步骤。前 7 个独立安装按钮来自固定且不可变的 `skill-installers-v1` Release；全部 8 个 Skill 和第 8 个执行就绪按钮只从不可变的 `web-api-test-execution-evidence-v1.0.2` Release 提供。Release 资产发布后按钮才生效；如果下载返回 404，请使用下面的命令兜底。

`.cmd` 可以先在 GitHub 查看，或下载后右键用文本编辑器检查。Windows 可能显示“来自互联网”或 SmartScreen 提示，这是正常安全机制。启动器只读取本仓库的 HTTPS 安装脚本，默认写入当前用户的 `.agents\skills`，不写系统目录。

### 命令兜底：Windows 零 Node 安装

以下命令可以直接粘贴到 PowerShell 或命令提示符（CMD）。

安装全部 8 个 Skill：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$url='https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/install-all.cmd'; $installer=Join-Path ([IO.Path]::GetTempPath()) ('testing-skills-'+[guid]::NewGuid().ToString('N')+'.cmd'); $exitCode=1; try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $installer; $env:TESTING_SKILLS_NO_PAUSE='1'; & $env:ComSpec /d /c ('call '+[char]34+$installer+[char]34); $exitCode=$LASTEXITCODE } finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }; exit $exitCode"
```

只安装“需求测试工作台”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -Skill 'requirement-test-workbench'"
```

把命令末尾的名称换成总览中的 Package 即可安装前 7 个单个 Skill。`web-api-test-execution-evidence` 需要其专用 GitHub Release 完整安装器，通用安装器不提供执行所需的 Node、Runner 或 Chromium。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$url='https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/install-web-api-test-execution-evidence.cmd'; $installer=Join-Path ([IO.Path]::GetTempPath()) ('testing-skills-'+[guid]::NewGuid().ToString('N')+'.cmd'); $exitCode=1; try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $installer; $env:TESTING_SKILLS_NO_PAUSE='1'; & $env:ComSpec /d /c ('call '+[char]34+$installer+[char]34); $exitCode=$LASTEXITCODE } finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }; exit $exitCode"
```

默认安装到当前用户的 `.agents\skills`。目标 Skill 已存在时会保留原文件并提示跳过；确认需要替换时，在命令末尾增加 `-Force`。从仓库的 Source ZIP 或 npx 安装第 8 个 Skill 仅供开发者检查和修改源代码，不能执行 Web/API 自动化测试。

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
npx skills add Saitamasans/testing-skills@web-api-test-execution-evidence -g -y
```

如果出现“无法将 `npx` 识别为命令”，请改用上面的“Windows 零 Node 安装”。macOS/Linux 开发者可在已有 Node.js 环境中运行 `scripts/install-all.sh`。

### 安装后查看

- Codex：在 Skills 管理界面或 `$CODEX_HOME/skills` 下查看。
- Claude Code：在 Skills 目录或技能列表中查看。
- CC Switch：打开 Skills 管理页，读取各包的 `SKILL.md` 名称和 description，并分别管理 8 个 Skill。

<a id="usage-guides"></a>

## 第 1–7 个 Skill 使用指南

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

适合在写测试点或用例前找出需求缺口，并判断当前需求能否开测。

**最少准备：** PRD、用户故事、原型说明、验收标准、需求变更或口头需求中的一种，以及本轮澄清范围。

**按场景补充：** 产品回答、更新后的规则、接口文档、状态说明、权限矩阵、数据口径和明确不纳入项。

**调用示例：**

```text
调用 `requirement-clarification-test`：先不要写测试点或用例，请从测试视角评审这份 PRD，列出 P0/P1/P2 问题并判断能否开测。
```

<a id="execution-guide"></a>

## 8. 自动执行web用例skill 即 第 8 个 Skill 专项指南

对应 Package：`web-api-test-execution-evidence`。

### 什么时候使用

已有正式 Web/API 测试用例，需要自动执行、收集证据、回填 Excel/HTML，或在本地和 CI 中校验执行产物时使用。

### 什么时候不应使用

不用于生成测试用例、澄清需求、审计用例质量或执行非 Web/API 测试。只有 PRD、截图、原型、流程图、HTML、CSV、Markdown 或口头描述时，尚不具备自动执行入口。

### 每次执行都要准备

- **正式测试用例：** 标准十列 `.xlsx`、原生 `report.json`，或已确认字段映射的非标准 Excel；用例必须有可执行步骤和预期结果。
- **目标 Web/API 地址：** 当前执行环境必须能够访问。
- **环境性质和执行授权：** 明确测试、预发或正式环境，并取得对应授权，不能根据域名猜测。
- **执行前确认：** 先核对执行预览、目标、风险、动作数量和将读取的环境变量名。
- **运行环境：** 已通过 GitHub Release 完整安装器交付的内置 runtime；不需要系统 Node.js。

### 按场景补充

| 场景 | 还需要 |
|---|---|
| 登录或鉴权 | 测试账号或凭据来源 |
| 接口步骤缺少调用细节 | 接口文档、OpenAPI、Swagger 或 Postman，补齐方法、路径、参数、请求体、鉴权和断言 |
| 新增、修改或删除数据 | 隔离的测试数据和清理方案 |
| Web 控件难以稳定定位 | 稳定的 role、label 或 test id 等定位信息 |
| 包含数据库断言 | 数据库只读账号、只读证明和驱动 |
| 本地应用尚未运行 | 前后端源码、启动命令、依赖和配置 |
| 在 CI 中执行 | CI 配置和 CI Secrets |

已有可访问测试地址时，不强制提供前后端源码。

### 可选参考

- 需求文档、需求截图、原型和流程图，用于核对业务口径。
- 历史报告、旧证据、发布记录、日志和监控入口，用于回归对比或排障。

需求文档、需求截图、原型和流程图不能代替正式测试用例。只有需求资料时，先调用 `requirement-test-workbench` 生成正式用例，再调用第 8 个 Skill 执行。

### 运行与安全注意事项

- 先安装 GitHub Release 完整安装器交付的 Node 22.23.1、Runner 1.1.2、Playwright 1.61.1、Chromium 1228、headless shell 1228 和 FFmpeg 1011。正式执行只快速验证安装回执、回执绑定的 bundle 清单、固定组件身份和关键可执行/证据标记，不会下载、安装或修改运行时。
- Windows 只通过 `<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1` 调用内置 runtime；若报告 `installation_incomplete` 或 `installation_corrupt`，重新运行完整安装器并带 `-Repair`。无需 npm 账号，也无需手工安装 Runner。
- 凭据只放环境变量或 CI Secrets，不写入用例、命令、日志、报告或截图。
- 非标准 Excel 字段映射需要用户确认，不能静默转换。
- CI 只执行低风险 R0/R1 动作；需要人工登录、MFA、SSO 或扫码时应阻塞。
- 数据库只允许 `SELECT`；无法证明只读能力时阻塞执行。
- 正式服写操作必须叠加生产门禁，并逐项确认授权、账号、时间窗和风险联系人。

### 调用示例

```text
调用 `web-api-test-execution-evidence`：请执行附件中的十列 Excel 正式测试用例；目标是测试环境 `https://example.test`，凭据从环境变量读取。先展示执行预览，等待确认；确认后再运行并回填报告和证据。
```

<a id="outputs"></a>

## 输出文件

单接口完整版、单接口精炼版、多接口链路和正式服验证这 4 个 Skill 在用户明确请求文件时，基于同一份报告数据交付 `.xlsx` 和 `.html`。

`requirement-test-workbench` 在实际产出统一十列用例时，默认生成并验证 `.xlsx` 和 `.html`；只有用户明确要求“不要文件”或“只在聊天中展示”时才跳过。

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

第 8 个 Skill 的 Runner 产物包括 `run-result.json`、回填后的 `.xlsx`、离线 `.html`、证据目录和事件日志。`run-result.json` 是唯一判定来源，Excel、HTML 和 JSON 的用例 ID、状态、证据数与统计一致后才能交付。

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

## 许可协议

[MIT](LICENSE)
