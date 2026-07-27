---
name: web-api-test-execution-evidence
description: Use when users want to automatically execute existing Web/API test cases, run locked local or CI test manifests, generate execution evidence, backfill results into Excel/HTML reports, or verify Web/API execution artifacts; do not use merely to generate test cases, clarify requirements, or audit case quality.
---

# Web/API 测试用例自动执行与证据回填

硬规则：本 Skill 的正式默认输入只能是 `*.execution-package.zip`，且必须 `package_status=READY`。它只执行和回填已有用例，不生成测试用例，不重新做语义编译，不替用户猜测环境，不把密钥写入任何产物。普通十列测试用例（Test Cases）只描述测试意图，不等于机器执行清单；普通 Excel/JSON 不是本 Skill 的正式默认输入。收到 raw Excel 时停止并返回 `code=execution_contract_required`，提示“请先调用 test-case-execution-compiler 生成 Execution Package。”不得为了生成可运行 manifest 而删除契约动作、临时补写缺失动作、猜测目标页定位器或把核心业务链路整体降级为 blocked。

## 一、互斥路由

- 用户要生成单接口、多接口、需求或正式服验证用例时，使用原有生成类 Skill，本 Skill 不生成正式测试用例。
- 用户要审计已有用例质量时，使用 `test-case-quality-audit`；只有发现用例不可执行、预期缺失或口径冲突时才建议先审计。
- 用户要自动执行已有 Web/API 测试用例、生成证据、回填 Excel/HTML、跑本地或 CI 闭环时，使用本独立第 8 个 Skill。
- 最多一个主 Skill 和最多一个辅助 Skill 同时参与。用户确认前，只展示主/辅 Skill 名称、分工和原因，不加载辅助 Skill。

Do not trigger this Skill merely to generate test cases, clarify requirements, or audit case quality.

## 二、工作入口

- 先说明：当前调用的是 `web-api-test-execution-evidence`，正式流程消费第九个 Skill 生成的 READY Execution Package。
- 如果用户提供普通十列/十一列或非标准 Excel，返回 `execution_contract_required`；raw Excel 不能真实执行，不得调用底层 deprecated legacy parser 绕过门禁。
- 如果用户只给截图、口头描述、PRD 或接口文档，说明这些不是正式执行输入；已有人工用例先交给 `test-case-execution-compiler`。

## 三、准备材料清点

先列三类材料：

- 已具备：用例文件、目标地址、账号/密钥来源、测试数据、可观察的预期结果、清理方式、运行模式。
- 缺失材料：阻塞执行的字段映射、Web 定位确认、API 接口契约、数据库连接与只读凭据、显式断言、审批确认。
- 可选材料：只读数据库账号、清理接口、CI 配置、历史证据。

缺失材料只问与当前输入有关的内容，给出可复制示例。完整规则按需读取 `references/input-and-readiness.md`。

## 四、输入和准备度

- `*.execution-package.zip` 先完成路径、完整性、源 SHA、READY 和 Contract 1.0.0 schema 校验，再进入准备度判断。
- 非标准 Excel 必须由第九个 Skill 展示并确认字段映射；第八个不再执行字段映射或语义编译。
- E0 到 E4 用来表达准备度，不代表业务通过。
- 不要猜测正式服或测试服，也不要用域名、库名或数据特征自行判断环境性质。
- 测试用例（Test Case）只有动作没有业务断言时，固定停在 E2；不能用“页面没报错”“请求已发送”或“SQL 查询成功”替代断言。

### 黑盒 Web 输入

用户只提供测试用例（Test Cases）和公开页面地址、且禁止查看源码或预写定位器时，先运行只读页面探测。探测只允许打开目标页、读取实时 DOM 与无障碍树、统计可见候选，不允许点击、输入、提交或调用内部 API。先展示 `web-discovery.json` 中的候选定位器、匹配数、可见数和置信度，再结合测试用例（Test Cases）的步骤与预期结果形成逐条动作和断言方案。

跨页面或跨业务状态的 Web 用例必须逐条建模为“起始状态 → 迁移动作 → 目标状态 → 终态业务断言”。目标状态尚未探测时，不得把整条用例直接压成 blocked；把对应动作标为 `transition_discovery_required`，在第一次确认门禁展示独立的“状态迁移探测预览”。用户确认后才允许使用已有用例中的 R0/R1 动作到达目标状态并执行新的只读 discovery；探测结果必须隔离，不回填正式 Excel/HTML，也不作为正式测试通过。目标状态 discovery 结果必须与正式 manifest 预览在第二次确认门禁一并确认：先重新生成 discovery/proposal hash、manifest hash、动作数和断言预览，并重新经过第二次确认门禁；不得额外虚构第三次确认，也不得跳过第二次确认。

同一审查必须覆盖“搜索首页 → 搜索结果页”“登录页 → 登录后工作台”“SPA 页面 → 弹窗或异步结果区域”“当前页 → 新标签页”“提交页 → 下载或确认页”。R2/R3、验证码、扫码、MFA 和不可逆动作不能自动迁移探测；Enter 不受支持时不得用点击替代。发现动作或终态缺口时必须在第一次确认门禁前纠正，不能留到录屏或正式执行后才说明。

需要展开输入识别、E0-E4、字段映射和材料提示时，读取 `references/input-and-readiness.md`。

### Execution Package 快速流程

固定顺序：package validate → source hash validate → readiness validate → contract load → runtime doctor → read-only discovery → semantic binding → 必要状态的 transition discovery → final manifest assembly → approval → Runner execution → evidence and report。

日志必须写明 `semantic_compilation=skipped`、`semantic_compiler=test-case-execution-compiler`、`contract_version=1.0.0`，并输出 `package_validation_ms`、`contract_loading_ms`、`runtime_doctor_ms`、`web_discovery_ms`、`binding_ms`、`transition_discovery_ms`、`manifest_assembly_ms`、`approval_wait_ms`、`execution_ms`、`report_ms` 的真实耗时。契约动作或断言缺失、未绑定或出现来源外动作时返回 `contract_incomplete`，不能临时补写。

默认每条 `isolation_scope=case` 用例使用全新 BrowserContext，并记录 `browser_id`、`context_id`、`context_created_at`、`context_closed_at`、`context_close_status`；只有显式 `flow_group` 可共享 Context。

目标状态只能由当前进程持有的 Testing Runtime 会话 capability 在规范 `.testing-run` 根目录内签发的 discovery receipt 证明。进程内随机 secret/MAC 是本会话证据的授权来源；落盘的 receipt 与 `runtime-session.json` 仅供审计，即使同时改写也不能恢复授权，单独执行 `plan` 并只传路径必须失败关闭。禁止使用 `target_state_discovered=true`、`rule_versions` 中的手写 target-state 标记、ZIP 内预置 receipt 或运行目录外的文件。Runtime 先从当前 package 和 profile 确定性生成 `discovery_tasks`；去重键绑定 target state、动作 SHA、origin、完整 auth profile、start state、isolation scope 和 flow group，不同账号、起始状态、origin 或隔离规则绝不合并。每个任务使用全新 BrowserContext 并独立签发 receipt；每个 required task ID 必须恰好对应一个当前会话有效 receipt，重复、未知、多余或缺失 task receipt 均拒绝，只有完整 quorum 通过当前 run nonce、approval、页面指纹、Runtime/Runner 版本和 active-session MAC 校验后才能生成 final manifest。任一任务失败必须报告 task ID 与 case ID，不伪造 receipt、不删除用例。receipt 只是当前会话证据，既不声明发布者或外部真实性，也不证明业务用例通过。

## 五、风险、凭据和数据

- 凭据真实值只能在运行时从用户已设置的环境变量或 storage state 解析；ZIP、manifest、报告、日志、截图和 HTML 只记录引用名，不能记录密码、Cookie 或 Token。密码、错误密码、Token、Cookie 和 storage state 的 artifact 扫描保持严格零匹配；用户名命中必须在不输出实际值的前提下记录文件、字段和来源，credential/runtime 字段命中视为泄密，域名、项目名、公开元数据、locator 或页面标签中的低熵自然碰撞不得仅凭字面命中判泄密，未知来源仍失败关闭。
- R0/R1 可进入普通审批；R2/R3 必须显式说明风险，CI 模式拒绝 R2/R3。
- 数据库只允许 SELECT，只读能力不能证明时阻塞执行。
- 数据库地址、库名、用户名/密码环境变量别名、参数顺序、查询语句或业务预期任一缺失时阻塞；不从网页、测试用例标题或字段名猜数据库结构。

需要处理 R0-R3、凭据优先级、测试数据、数据库只读账号或缺密钥 blocked 结果时，读取 `references/risk-credentials-and-data.md`。

## 六、定位器、断言和规则

- 陌生网页先用 `discover-web` 只读探测；定位器失败不能静默自愈，只能提出修复建议，用户确认后才应用。
- 第一次确认门禁前逐用例展示动作守恒矩阵；每个测试步骤动作必须标为 `mapped`、`transition_discovery_required`、`blocked` 或 `manual_required`。禁止把包含已确认迁移动作的整条用例压缩成一个笼统的 `execution.blocked`，除非已证明状态迁移探测也不可执行并写明具体能力缺口。
- 断言准确性优先于覆盖面；行业经验只做少量候选判断，并标明自动判定来源。
- 每条可执行测试用例（Test Case）至少包含一个 `web.assert`、`api.assert` 或 `db.assert`。`web.goto`、点击、输入、`api.request`、`db.select` 和清理动作都不算业务断言；Runner 不得生成“动作完成即通过”的兜底结论。
- Web 断言使用明确可观察值：URL 相等/包含、输入值、可见文本、元素可见/隐藏/不存在、可见数量；精确文本必须真实可见，隐藏 DOM 文本不能通过。
- 数据库先 `db.select` 收集有界证据，再由 `db.assert` 判断行数或字段值；查询成功本身不能判定业务通过。
- 预期口径冲突、三方解释不一致或需求口径异常时，标记为待定，交给测试人工审核。

需要处理定位器修复、断言来源、知识规则、重试边界和待定判定时，读取 `references/locators-assertions-and-rules.md`。

## 七、执行预览和确认

执行前必须展示：

- 主 Skill：`web-api-test-execution-evidence`
- 辅助 Skill：无，或一个用户确认后的辅助 Skill
- 分工：本 Skill 负责准备度、执行预览、Runner 调用、证据和报告；辅助 Skill 只负责其明确范围
- discovery/proposal hash、manifest hash、目标 origin、风险等级、动作数量、每条业务断言、将要读取的环境变量名
- 测试用例总数、完整可执行用例数、blocked/manual 数、核心业务路径数、完整可执行核心路径数，以及每个核心目标的终态断言覆盖情况

用户请求完整执行时，只要任一核心业务目标没有至少一条包含迁移动作、目标状态和终态断言的完整可执行路径，就不能进入 E4，也不能生成供正式执行确认的最终 manifest。普通的“确认执行”不得被解释为接受核心业务目标降级；降级确认必须逐项列出未覆盖目标及影响。用户确认前不执行 Web/API/数据库动作。

## 八、Runner 固定入口

最终用户必须先使用 GitHub Release 完整安装器。完整安装不提供轻量版或可选浏览器，安装时已交付 portable Node 22.23.1、Runner 1.1.2、Playwright 1.61.1、Chromium 1228、headless shell 1228 和 FFmpeg 1011。无需系统安装 Node.js、npm、Git、Chrome、Excel 或 Python。

Windows 只使用已验证的 PowerShell 安全入口：`powershell.exe -NoProfile -ExecutionPolicy Bypass -File <ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1 <Runner args...>`。`.cmd` 桥接器不接收原始 Runner 参数；不要文档化或调用 Node MJS 入口、latest 或本地仓库 Runner。

正式执行只快速验证安装回执、回执绑定的 bundle 清单、固定组件身份和关键可执行/证据标记，并使用安装包内置运行时；不会下载、安装或修改运行时。若报告 `installation_incomplete` 或 `installation_corrupt`，重新运行 GitHub Release 完整安装器并带 `-Repair`。安装完成后，调用 Skill 直接进入准备度、只读 discovery、审批和执行；无需 npm 账号或手工安装步骤。

交互可见执行默认最大化浏览器并开启五阶段执行驾驶舱：

1. 执行准备：展示输入范围、测试用例（Test Cases）总数、动作数量、目标 origin 和预期交付物。
2. 用例预告：逐条展示即将执行的测试用例（Test Case）序号、ID、中文标题、模块、验证点、前置条件和预期结果。
3. 实时执行：展示当前测试用例（Test Case）的 Web 点击、输入、查询和断言；API 流水同步展示方法、路径、响应状态、响应摘要与断言结果。页面目标位于驾驶舱一侧时，驾驶舱自动让位并高亮“正在操作”的控件。
4. 证据收集：明确展示 Web PNG、API 请求响应、Excel/HTML/JSON 一致性、日志和 Trace 的整理状态。
5. 结果中心：从 `run-result.json` 展示未执行、通过、不通过、待定四状态统计、逐条结果和已生成产物入口。

Web/混合场景的实时执行阶段使用不参与定位、点击或断言的页面浮层，API-only 使用全屏执行看板。正式 Web 证据 PNG 不包含执行面板（包括驾驶舱和目标高亮），桌面教程录制保留完整可视过程；CI 和 `--browser headless` 不显示驾驶舱。只有用户显式要求关闭时才传 `--progress off`。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" discover-web --url https://example.test --output-dir .testing-run/discovery --browser visible
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" discover-plan --input cases.execution-package.zip --profile execution-profile.json --output-dir .testing-run --discovery-approval .testing-run/discovery-approval-1.json --discovery-approval .testing-run/discovery-approval-2.json --browser headless
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive --browser auto --slow-mo 200 --progress auto
```

`<ABSOLUTE_SKILL_ROOT>` 必须替换为当前已安装 Skill 的绝对目录，路径含空格时正确加引号。`<ISO_EXPIRES_AT>` 使用本次执行窗口内的短期过期时间，不使用长期或永久审批。CI、退出码和完整参数读取 `references/runner-commands.md`。

## 九、状态和报告门禁

- 业务四状态：未执行、通过、不通过、待定。
- 运行七状态：planned、running、completed、blocked、executor_error、infrastructure_error、manual_required。
- run-result.json 是唯一判定来源；Excel/HTML/JSON 一致性通过后才能交付。
- 输出必须包含 `.xlsx`、`.html`、`run-result.json`、证据目录和必要的 blocked/manual 说明。
- 核心用例 blocked 或未执行时，结论必须先写明未触达的核心动作和业务结果，并使用“部分执行”“准备度验证结果”或“核心流程未执行”；禁止称为“全部测试完成”“核心流程通过”或等价措辞。
- 录屏、Excel、HTML 和 JSON 产物一致，只证明产物一致，不证明核心业务目标已覆盖；准备类用例通过不能抵消核心路径未覆盖。

CI 证据、报告一致性、上传产物和失败退出码读取 `references/ci-evidence-and-reporting.md`。

## 十、最终自检

- [ ] 是否只执行已有用例，没有生成新用例？
- [ ] 是否校验 READY ZIP、源 SHA、内部 SHA、用例数量/ID 和 Contract 1.0.0 schema？
- [ ] 是否记录 `semantic_compilation=skipped` 且没有重新解释动作、依赖、隔离或业务预期？
- [ ] 目标状态是否只引用当前 `.testing-run`、当前 `run_nonce` 和当前 package/actions/page fingerprint 已校验的 Runtime receipt，且没有把 discovery 当作业务通过？
- [ ] 是否展示主/辅 Skill 名称和分工，并在用户确认后才加载辅助 Skill？
- [ ] 是否完成准备材料清点，且没有猜测正式服或测试服？
- [ ] 是否对非标准 Excel 做了字段映射确认？
- [ ] 是否保护密钥，没有把账号密码、token、连接串写入产物？
- [ ] 是否使用本 Skill 内置启动器、固定 Runner 版本和审批文件？
- [ ] 陌生 Web 页面是否先完成只读探测，并由用户确认定位器和断言后才写入执行清单？
- [ ] 是否逐用例完成状态图和动作守恒矩阵，且没有把可探测的迁移动作错误传播为整条 blocked？
- [ ] 每个核心业务目标是否至少有一条完整可执行路径；否则是否阻止进入 E4 或取得明确的逐项目标降级确认？
- [ ] 每条真实执行的测试用例（Test Case）是否至少有一个显式业务断言，且没有“动作完成即通过”？
- [ ] 交互可见执行是否完整展示执行准备、用例预告、实时执行、证据收集和结果中心，且正式 PNG 不含驾驶舱？
- [ ] 是否保留未执行、通过、不通过、待定四状态和七个运行状态的区别？
- [ ] 是否通过 Excel/HTML/JSON 一致性门禁后再交付？

## 十一、反模式

- 不要因为用户催促就跳过审批、字段映射或密钥检查。
- 不要把“不通过”和“待定”混在一起。
- 不要把环境猜测写成事实。
- 不要在 CI 中等待人工登录、MFA、扫码或补充数据。
- 不要用点击冒充 Enter、用直接打开目标 URL 冒充提交、用动作完成冒充业务通过。

<!-- reference: references/input-and-readiness.md -->
# 输入与准备度

## 输入类型

- 正式输入：由 `test-case-execution-compiler` 生成且 `package_status=READY` 的 `*.execution-package.zip`。
- 非正式输入：原生 `report.json`、标准十/十一列 `.xlsx`、非标准 Excel、HTML、CSV、Markdown、截图、PRD、接口文档和口头描述。raw Excel 固定返回 `execution_contract_required`。
- 标准十列测试用例（Test Cases）是人工测试意图输入，但必须先经过第九个 Skill；非标准 Excel 必须确认字段映射。底层 legacy 输入能力仅供 deprecated 回归测试，Skill 默认流程和 README 都不得调用。

## Package 校验

ZIP 必须无目录穿越、绝对路径和大小写重复路径；内部文件 SHA、原用例 SHA、用例数量和 ID 必须一致；`package_status` 必须为 READY；Contract 1.0.0 schema 必须合法。任一失败立即停止，NOT_READY 包不得进入 discovery 或 Runner。

契约动作是业务事实，不得再次把人工步骤拆成另一套业务动作。环境绑定只把契约语义动作映射到实时定位器、页面状态指纹和已探测状态迁移；目标状态尚未探测时不得生成 final manifest。

## BrowserContext 隔离

discovery 阶段每个任务使用独立 BrowserContext 并关闭；正式 execution 阶段重新创建全新 BrowserContext，不能继承 discovery 登录状态。`browser-contexts.json` 对每条记录标记 `phase=discovery|execution`，并记录 `browser_id`、`context_id`、`context_created_at`、`context_closed_at`、`context_close_status`；跨 phase 的 `context_id` 复用必须拒绝。一个正式执行 Browser 下，`isolation_scope=case` 的每条用例使用全新 BrowserContext，并在 finally 关闭。只有显式 `flow_group` 可组内共享 Context；新 Page、点击退出登录、Excel 顺序或前例终态都不能替代隔离。单条失败后保存证据、关闭当前 Context，下一条创建全新 Context；Context 关闭失败时标记失败且绝不复用，只按显式 resource lock 决定局部阻塞。

## 准备度 E0-E4

- E0：没有可执行用例或执行目标。
- E1：有用例，但缺目标、账号、数据、审批或字段映射。
- E2：材料基本齐，但缺少已确认定位器、接口/数据库契约、测试数据、清理方案或显式业务断言。
- E3：可以生成执行预览，等待用户确认；若存在 `transition_discovery_required`，先生成状态迁移探测预览，不生成正式执行结论。
- E4：manifest、approval、凭据来源和输出目录已锁定，且每个核心业务目标至少有一条完整可执行路径，可以执行。

完整执行请求下，任一核心目标缺少“迁移动作 + 目标状态 + 终态断言”时不能进入 E4。不得把普通确认解释成降级确认；用户明确选择部分执行时，必须逐项展示未覆盖目标、原因和影响。

## 字段映射

非标准 Excel 每次都展示字段映射预览，必须由用户确认。AI 置信度再高也不能静默转换。映射确认后再生成 manifest。

## 提示模板

先说“可以继续/暂时不能继续”，再列已具备、缺失材料、可选材料。缺失项给具体例子，如 `TESTING_API_TOKEN`、`execution-profile.json`、只读数据库账号、清理接口。
<!-- /reference -->

<!-- reference: references/risk-credentials-and-data.md -->
# 风险、凭据和数据

## 风险分级

- R0：只读、断言、等待、页面打开。
- R1：低风险造数、可清理 API、普通表单提交。
- R2：可能影响共享数据、库存、余额、权限或租户边界。
- R3：高风险、不可逆、批量、生产敏感动作。

CI 只允许 R0/R1。R2/R3 必须本地交互确认，且 R3 需要逐动作显式批准。

## 凭据优先级

优先使用用户提供的账号、密码、测试数据和数据库只读账号；其次使用环境变量；再考虑已批准的 storage state；最后才是人工接管。密钥只能存在运行时内存和 CI Secrets，不写入 JSON、日志、报告、截图或 HTML。

## 数据库

数据库执行必须由用户提供主机、端口、库名、方言和用户名/密码环境变量别名；不允许猜测连接或表结构。数据库取证只允许 SELECT，必须证明账号只读；不能证明时 blocked。`db.select` 只收集限行、限体积、脱敏证据，必须再用 `db.assert` 对行数或字段值做业务判断。
<!-- /reference -->

<!-- reference: references/locators-assertions-and-rules.md -->
# 定位器、断言和规则

## 定位器

陌生网页先执行 `discover-web`：仅打开页面并读取实时 DOM/无障碍树，输出候选定位器、匹配数、可见数、置信度、证据哈希和截图，不点击、不输入。定位器失败时，收集失败证据和候选修复。只生成 proposal，不自动修改 manifest；用户确认后才应用。

## 状态迁移与动作守恒

逐用例建立状态图：起始状态、迁移动作、目标状态、终态业务断言。为测试步骤中的每个点击、提交、Enter、选择、上传、打开新标签页等动作建立动作守恒矩阵：

- `mapped`：已映射为固定 Runner 支持的明确动作；
- `transition_discovery_required`：起始定位器已确认，但目标状态需要在动作后再次只读探测；
- `blocked`：存在当前权限和固定 Runner 能力内无法消除的明确缺口；
- `manual_required`：验证码、扫码、MFA 或只能人工完成的步骤。

目标状态未知不能自动传播为整条 `execution.blocked`。如果起始定位器唯一、动作来自已有用例、风险为 R0/R1 且无反自动化或不可逆副作用，在第一次确认门禁输出状态迁移探测预览：来源用例 ID、起始/目标状态、前置动作、迁移动作、定位器及匹配数/可见数/置信度、最小迁移断言、目标 origin 集、风险、动作数、环境变量名和独立审批 hash。

用户确认后，在独立 discovery 目录使用现有 Runner 动作执行迁移前缀。该目录可以包含独立的 manifest、approval、run-result、截图、日志和 Trace，但不得合并到正式运行目录，不得回填正式 Excel/HTML，不得把迁移成功判为正式用例通过。取得真实目标 URL 后再运行只读 `discover-web`；目标状态不能通过稳定 URL 重现、候选不唯一、出现反自动化或固定 Runner 无法保留所需 SPA/弹窗状态时，停止并标为具体的 blocked/manual_required，禁止猜定位器。

目标状态 discovery 完成后，把迁移动作、候选目标定位器和终态断言写入待确认的正式 `case_plans`，重新生成 discovery/proposal hash、manifest hash、目标 origin、动作数和断言预览。目标状态 discovery 结果必须与正式 manifest 预览在第二次确认门禁一并确认，并重新经过第二次确认门禁；第二次确认前不能进入 E4 或正式执行，不再增加第三次确认。

状态迁移探测、receipt 签发与 planning 必须由 `discover-plan` 在同一进程、同一个 active RuntimeSession capability 中完成，并使用会话规范化后的 `.testing-run` 根目录。Runner 从 package/profile 输出确定性 `discovery_tasks` 数组；每个任务至少记录 task ID、来源用例、目标状态、迁移动作 SHA、package SHA、origin、isolation scope、flow group、auth profile SHA 和 start state SHA，并使用全新 BrowserContext。相同 transition、target state、origin、auth profile、start state、isolation scope 与 flow group 才可去重。每个任务独立 receipt 至少记录 schema 版本、随机 `run_nonce`、discovery/task ID、生成器、Runtime/Runner 版本、精确 origin/请求 URL/最终 URL、来源用例 ID、目标 `page_state_id`、DOM 与无障碍指纹、artifact 路径与 SHA-256、生成与过期时间、当前 package SHA-256、迁移用例 ID、实际迁移动作 SHA-256、已校验 approval artifact SHA 和 session MAC。`runtime-session.json` 不保存 secret 或授权 ledger；重复、未知、多余或缺少任一 required task receipt 时不得生成 final manifest。

`target_state_discovered=true`、`rule_versions` 中的手写 target-state 标记、用户上传布尔值、Execution Package 内预置 receipt、运行目录外 receipt、旧 session/nonce、旧页面 fingerprint、伪造 approval 或缺失 artifact 一律无效。没有 receipt 时返回 `target_state_not_discovered`；只有路径而没有 live capability 时返回 `runtime_session_required`。discovery receipt 的 `purpose` 固定为 `target_state_discovery_only`，schema 禁止写入业务通过状态；发现结果只证明本会话探测过页面，不能作为正式用例的通过证据。

## 核心链路覆盖审查

第一次确认门禁前统计测试用例总数、完整可执行用例数、blocked/manual 数、核心业务路径数、完整可执行核心路径数和终态断言覆盖。搜索场景至少包含“输入关键词 → 触发搜索 → 到达结果状态 → 观察结果业务断言”；只验证首页或输入不算覆盖搜索目标。

同时审查：动作缺失、终态缺失、未探测的新页面/路由/弹窗/新标签页/回调/下载态、目标状态未知导致的阻塞传播、点击冒充 Enter 或直接 URL 冒充提交、只剩准备类用例却宣称完整执行、R2/R3 风险绕过，以及报告措辞是否把部分执行说成完整完成。发现缺口必须在第一次确认门禁前纠正。

至少对以下状态迁移模式逐项套用该审查：

- 搜索首页 → 搜索结果页；
- 登录页 → 登录后工作台；
- SPA 页面 → 弹窗或异步结果区域；
- 当前页 → 新标签页；
- 提交页 → 下载或确认页。

R2/R3、验证码、扫码、MFA 和不可逆副作用必须保持 blocked/manual_required 安全边界，不能为了覆盖率自动探测。Enter 不受支持时不得用点击替代；目标状态不能由固定 Runner 安全保持或再次只读探测时，准确报告能力缺口。

## 断言

断言来源优先级：用例预期 > 产品确认口径 > 接口契约 > 技术规则 > 少量行业经验候选。行业经验必须标明自动判定来源，不能大量占比。

每条执行用例至少包含一个显式业务断言。动作执行成功、HTTP 请求发送成功、SQL 查询成功都不能替代业务断言。Web 支持 URL、输入值、文本、可见性、数量和不存在断言；API 支持状态码和响应字段断言；数据库使用 `db.assert` 判断有界查询结果。

## 状态

执行成功且断言通过是通过；确定业务不符合预期是不通过；需求口径、三方解释或验收标准冲突是待定；未触达执行点是未执行。

## 重试边界

只对瞬时基础设施问题做有限重试。业务失败不重试，避免把真实缺陷掩盖成网络抖动。
<!-- /reference -->

<!-- reference: references/ci-evidence-and-reporting.md -->
# CI、证据和报告

## 报告门禁

`run-result.json` 是唯一判定来源。Excel 和 HTML 只能从同一份投影结果生成，必须校验用例 ID、执行状态、证据数量、manifest hash 和统计一致。

## 输出

交付 `.xlsx`、`.html`、`run-result.json`、`projected-report.json`、事件 JSONL、证据文件、必要的 blocked/manual 说明。缺密钥、MFA、SSO、二维码和人工登录在 CI 中直接 blocked，不等待。

## 退出码

- 0：执行完成且无业务失败/待定。
- 10：执行完成但存在不通过或待定。
- 20：blocked 或 manual_required。
- 30：executor_error。
- 40：infrastructure_error。
- 50：协议、审批、安全或报告门禁失败。
<!-- /reference -->

<!-- reference: references/runner-commands.md -->
# Runner 命令

## 本地

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" discover-web --url https://example.test --output-dir .testing-run/discovery --browser visible
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" discover-plan --input cases.execution-package.zip --profile execution-profile.json --output-dir .testing-run --discovery-approval .testing-run/discovery-approval-1.json --discovery-approval .testing-run/discovery-approval-2.json --browser headless
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive --browser auto --slow-mo 200 --progress auto
```

`<ABSOLUTE_SKILL_ROOT>` 必须替换为已安装 Skill 的绝对目录，路径含空格时正确加引号。正式执行只快速验证安装回执、回执绑定的 bundle 清单、固定组件身份和关键可执行/证据标记，不会下载、安装或修改运行时；若验证失败，重新运行 GitHub Release 完整安装器并带 `-Repair`。无需 npm 账号或手工安装。`<ISO_EXPIRES_AT>` 使用本次执行窗口内的短期过期时间，不使用长期或永久审批。

最终用户必须先使用 GitHub Release 完整安装器。完整安装不提供轻量版或可选浏览器，安装时已交付 portable Node 22.23.1、Runner 1.1.2、Playwright 1.61.1、Chromium 1228、headless shell 1228 和 FFmpeg 1011。无需系统安装 Node.js、npm、Git、Chrome、Excel 或 Python。若报告 `installation_incomplete` 或 `installation_corrupt`，使用 GitHub Release 完整安装器的 `-Repair` 修复；执行期不会下载、安装或修改运行时。

`discover-web` 是执行前的黑盒只读探测，不会生成审批、点击或输入。先查看 `web-discovery.json`、`web-discovery.md` 和 `web-discovery.png`，确认定位器与断言方案后，再生成 `execution-profile.json`。

## 可视执行

- `--progress auto`：默认值。interactive 且浏览器可见时最大化窗口，依次展示执行准备、用例预告、实时执行、证据收集和结果中心。
- 执行准备展示输入范围、测试用例（Test Cases）总数、动作数量、目标地址和交付物；用例预告逐条展示测试用例（Test Case）的验证意图与预期结果。
- 实时执行中，Web/混合场景显示自动让位的页面浮层与当前目标高亮；API-only 使用全屏执行看板，API 流水展示方法、路径、响应状态、响应摘要和断言。
- 证据收集展示 PNG、请求响应、Excel/HTML/JSON、日志与 Trace 的整理状态；结果中心展示四状态统计、逐条结果和产物入口。
- `--progress off`：关闭执行面板。API-only 不再为可视化额外启动浏览器；Web 动作仍按原逻辑使用安装时已具备的浏览器。
- `--browser headless` 或 `--mode ci`：不显示面板、不停留等待，也不为 API-only 可视化准备浏览器。
- 驾驶舱只消费 Runner 的真实执行事件，不参与定位器、点击、断言或结果计算；正式 Web 证据 PNG 临时隐藏驾驶舱和目标高亮，桌面录屏保持显示。

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
<!-- /reference -->
