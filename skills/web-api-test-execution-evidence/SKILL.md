---
name: web-api-test-execution-evidence
description: Use when users want to automatically execute existing Web/API test cases, run locked local or CI test manifests, generate execution evidence, backfill results into Excel/HTML reports, or verify Web/API execution artifacts; do not use merely to generate test cases, clarify requirements, or audit case quality.
---

<!-- 此文件由源文件自动生成，请勿直接编辑。 -->
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
