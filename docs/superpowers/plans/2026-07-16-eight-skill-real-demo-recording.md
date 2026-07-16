# 八个测试 Skill 真实演示与录屏实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 基于 SkillMart，从 PRD v0 开始真实调用七个测试 Skill，再由第八个 Skill 执行五套正式测试用例（Test Cases），交付可核验材料、完整未剪辑录屏和 20 分钟以内精剪版。

**Architecture:** 以 `demo/skillmart` 为唯一输入源，以 `build/skillmart-demo` 为唯一公开交付根目录。七个 Skill 各自保留原始输入、调用口令、完整输出和验证记录；五个生成类 Skill 使用同一份结构化数据生成 `.xlsx` 与 `.html`，随后由第八个 Skill 分套编译、审批、执行和归档证据。视频只展示已经通过文件与执行门禁的真实流程，视频不是唯一证据。

**Tech Stack:** Codex Skills、Node.js 20+、TypeScript、Playwright、Python、ExcelJS、HTML/CSS/JavaScript、FFmpeg 或等价的本地无声录制与剪辑工具。

## Global Constraints

- 不重命名、合并、拆分或删除原七个 Skill。
- 保留用户原有中文表达习惯和正式十列顺序。
- 单条统一显示为 `测试用例（Test Case）`，多条统一显示为 `测试用例（Test Cases）`。
- 五个生成类 Skill 同时交付同源 `.xlsx` 和 `.html`；需求澄清与测试用例审计不强制双交付。
- 业务状态固定为 `未执行 / 通过 / 不通过 / 待定`。
- `待定` 表示已经执行并取得证据，但产品、接口、研发或测试口径冲突；不得统计为研发 Bug，也不得视为未执行。
- 七个 Skill 必须分七次独立调用，每次只使用一个主 Skill。
- 第八个 Skill 分别执行需求工作台、单接口完整版、单接口精炼版、多接口链路、正式服 L0 只读五套测试用例（Test Cases）。
- 不访问真实正式服，不录制真实账号、密码、Token、个人聊天、私人路径或无关窗口。
- 原始视频 `1920x1080`、30 FPS、全程静音、连续未剪辑；精剪版必须小于等于 20 分钟并带中文字幕。

---

### Task 1: 建立真实演示材料门禁

**Files:**
- Modify: `demo/skillmart/scripts/build-demo-materials.mjs`
- Create: `demo/skillmart/scripts/validate-demo-materials.mjs`
- Modify: `packages/testing-runner/tests/demo-skillmart.test.ts`
- Output: `build/skillmart-demo/**`

**Interfaces:**
- `build-demo-materials.mjs --out <dir>` 只创建稳定目录、复制输入资料和生成材料索引，不伪造 Skill 输出。
- `validate-demo-materials.mjs --root <dir> --phase <skeleton|skills|execution|video>` 按阶段检查必需文件、空占位、双语名称、十列顺序、双交付和视频属性。

- [ ] **Step 1:** 为四阶段门禁补充失败测试，证明现有骨架无法通过 `skills`、`execution` 和 `video` 阶段。
- [ ] **Step 2:** 运行 `tsx --test packages/testing-runner/tests/demo-skillmart.test.ts`，确认新增测试先失败。
- [ ] **Step 3:** 实现阶段化校验器和材料索引 SHA-256 记录，禁止把 README 占位当成真实输出。
- [ ] **Step 4:** 运行材料构建与 `--phase skeleton` 校验，确认骨架阶段通过，后续阶段仍按预期阻塞。

### Task 2: 七次真实调用与五套同源双交付

**Files:**
- Create: `build/skillmart-demo/01-需求澄清_Requirement-Clarification/03-完整输出/requirement-clarification.md`
- Create: `build/skillmart-demo/02-需求工作台_Requirement-Workbench/03-完整输出/requirement-workbench.md`
- Create: `build/skillmart-demo/03-单接口完整版_Single-API-Full/03-完整输出/single-api-full.md`
- Create: `build/skillmart-demo/04-单接口精炼版_Single-API-Concise/03-完整输出/single-api-concise.md`
- Create: `build/skillmart-demo/05-多接口链路_Multi-API-Flow/03-完整输出/multi-api-flow.md`
- Create: `build/skillmart-demo/06-正式服验证_Production-Verification/03-完整输出/production-verification.md`
- Create: `build/skillmart-demo/07-测试用例审计_Test-Case-Audit/03-完整输出/test-case-audit.md`
- Create: `build/skillmart-demo/{02,03,04,05,06}-*/04-生成文件/*.{json,xlsx,html}`

**Interfaces:**
- 每章的 `02-调用口令/prompt.md` 是该次调用的原始提示词，`03-完整输出/*.md` 是完整回答，`06-验证记录/invocation.json` 记录 Skill 名称、输入 SHA-256、输出 SHA-256、开始/完成时间和主 Skill 数量。
- 每套 `report.json` 是 `.xlsx` 与 `.html` 的唯一数据源，十列固定为 `模块 / 用例编号 / 用例标题 / 优先级 / 前置条件 / 测试步骤 / 测试数据 / 预期结果 / 实际结果 / 执行状态`。

- [ ] **Step 1:** 使用 `requirement-clarification-test` 读取 PRD v0，输出 `P0 ⛔ BLOCKING`，不生成正式测试用例（Test Cases）。
- [ ] **Step 2:** 使用 `requirement-test-workbench` 读取 PRD v1 与产品确认，生成主测试设计及同源 JSON、XLSX、HTML。
- [ ] **Step 3:** 使用 `single-api-test-full` 读取创建订单契约，生成完整版同源 JSON、XLSX、HTML。
- [ ] **Step 4:** 使用 `single-api-test-concise` 读取订单查询契约并显式使用精炼版口令，生成精炼版同源 JSON、XLSX、HTML。
- [ ] **Step 5:** 使用 `multi-api-flow-test` 读取真实接口顺序与字段依赖，生成链路同源 JSON、XLSX、HTML。
- [ ] **Step 6:** 使用 `production-verification-test` 在缺少生产四项门禁时只生成本地执行的 L0 只读集合及同源 JSON、XLSX、HTML。
- [ ] **Step 7:** 使用 `test-case-quality-audit` 审计需求工作台主测试用例（Test Cases），按明确授权的问题 ID 生成修订映射，不改名、不合并原七个 Skill。
- [ ] **Step 8:** 运行 `node demo/skillmart/scripts/validate-demo-materials.mjs --root build/skillmart-demo --phase skills`，检查七次调用、五套双交付和十列契约。

### Task 3: 第八个 Skill 五套执行与四状态证据

**Files:**
- Create: `build/skillmart-demo/08-自动执行与证据_Automated-Execution-Evidence/04-生成文件/<suite>/**`
- Create: `build/skillmart-demo/08-自动执行与证据_Automated-Execution-Evidence/05-关键截图/*.png`
- Create: `build/skillmart-demo/08-自动执行与证据_Automated-Execution-Evidence/06-验证记录/execution-summary.md`

**Interfaces:**
- 每套执行目录包含 `run-manifest.json`、`approval.json`、`run-result.json`、`result.xlsx`、`result.html`、`event-log.jsonl`、`evidence-index.json`、`evidence/**` 和适用时的 Playwright Trace。
- 五套执行前均调用 `POST /__test/reset`；任一套清理失败时停止后续套件。
- `run-result.json` 是 Excel、HTML 和 JSON 状态的一致性判定源。

- [ ] **Step 1:** 启动只监听 `127.0.0.1` 的 SkillMart Web/API 演示服务并保存启动信息。
- [ ] **Step 2:** 使用 `web-api-test-execution-evidence` 展示五套执行预览、Manifest Hash、目标 Origin、风险级别和动作数。
- [ ] **Step 3:** 使用演示审批身份生成五份限时审批文件，再分别运行五套测试用例（Test Cases）。
- [ ] **Step 4:** 验证通过、不通过、待定、未执行四状态；幂等问题只聚合为一个根因，优惠券边界不计研发 Bug。
- [ ] **Step 5:** 为 Web 成功、Web 失败、待定、API 请求响应、清理结果和报告一致性分别导出可直接打开的证据。
- [ ] **Step 6:** 运行 `node demo/skillmart/scripts/validate-demo-materials.mjs --root build/skillmart-demo --phase execution`。

### Task 4: 可见验收材料与完整未剪辑录屏

**Files:**
- Create: `build/skillmart-demo/00-演示导航与视频材料/验收导航.html`
- Create: `build/skillmart-demo/00-演示导航与视频材料/证据索引.json`
- Create: `build/skillmart-demo/10-视频_Video/完整未剪辑录屏_Raw-Full-Session.mp4`
- Create: `build/skillmart-demo/10-视频_Video/原始录屏检查.json`

**Interfaces:**
- 验收导航可逐项打开需求、测试用例（Test Cases）、临时网页、执行报告、PNG、日志和视频。
- 原始录屏必须是一段连续文件；不得将多个片段拼接后命名为未剪辑版。

- [ ] **Step 1:** 生成中文验收导航和文件哈希索引，所有链接使用相对路径。
- [ ] **Step 2:** 在录制前执行隐私扫描，确认画面只包含公开演示任务、SkillMart、正式测试用例（Test Cases）和报告。
- [ ] **Step 3:** 连续录制从 PRD v0、七次 Skill 调用、五套执行到最终报告验收的 1080p/30 FPS 静音原始视频。
- [ ] **Step 4:** 用 `ffprobe` 或等价工具验证分辨率、帧率、音轨缺失、时长和连续可解码性，保存检查 JSON。

### Task 5: 20 分钟内精剪、字幕与最终门禁

**Files:**
- Create: `build/skillmart-demo/10-视频_Video/20分钟精剪版_Edited-Demo.mp4`
- Create: `build/skillmart-demo/10-视频_Video/字幕_Subtitles.srt`
- Create: `build/skillmart-demo/10-视频_Video/时间点与剪辑清单_Timeline.md`
- Modify: `docs/release/v1.1.0-execution-skill-verification.md`

**Interfaces:**
- 精剪版保留九个已批准章节，目标约 19 分钟，硬上限 20 分钟；只压缩等待、下载和重复浏览。
- SRT 与画面时间轴一致，不包含 AI 旁白或音频。

- [ ] **Step 1:** 从原始录屏生成章节片段、中文字幕和时间点清单。
- [ ] **Step 2:** 自动剪辑并导出 1080p 静音精剪版，验证总时长小于等于 1200 秒。
- [ ] **Step 3:** 抽帧检查开头、七 Skill、第五套执行、四状态和结尾画面，确认无空白、重叠、截字和敏感信息。
- [ ] **Step 4:** 运行 `node demo/skillmart/scripts/validate-demo-materials.mjs --root build/skillmart-demo --phase video`。
- [ ] **Step 5:** 运行 Skill 构建、Schema、Runner、Excel/HTML/JSON 一致性、链接、文件哈希、视频解码和 `git diff --check` 全量门禁。
- [ ] **Step 6:** 更新发布验证记录，只记录真实命令、结果、产物路径和剩余限制。

