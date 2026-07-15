---
name: web-api-test-execution-evidence
description: Use when users want to automatically execute existing Web/API test cases, run locked local or CI test manifests, generate execution evidence, backfill results into Excel/HTML reports, or verify Web/API execution artifacts; do not use merely to generate test cases, clarify requirements, or audit case quality.
---

# Web/API 测试用例自动执行与证据回填

硬规则：本 Skill 只执行和回填已有 Web/API 测试用例，不生成测试用例，不替用户猜测环境，不静默转换非标准输入，不把密钥写入任何产物。

## 一、互斥路由

- 用户要生成单接口、多接口、需求或正式服验证用例时，使用原有生成类 Skill，本 Skill 不生成正式测试用例。
- 用户要审计已有用例质量时，使用 `test-case-quality-audit`；只有发现用例不可执行、预期缺失或口径冲突时才建议先审计。
- 用户要自动执行已有 Web/API 测试用例、生成证据、回填 Excel/HTML、跑本地或 CI 闭环时，使用本独立第 8 个 Skill。
- 最多一个主 Skill 和最多一个辅助 Skill 同时参与。用户确认前，只展示主/辅 Skill 名称、分工和原因，不加载辅助 Skill。

Do not trigger this Skill merely to generate test cases, clarify requirements, or audit case quality.

## 二、工作入口

- 先说明：当前调用的是 `web-api-test-execution-evidence`，它独立工作，也兼容 `Saitamasans/testing-skills` 生成的十列用例。
- 如果用户提供的是兼容十列 Excel/JSON，可以继续执行；如果用例来自 Saitamasans/testing-skills，效果会更好。
- 如果用户只给截图、口头描述、PRD 或接口文档，说明这些不是正式执行输入，建议先用原 7 个 Skill 生成或整理用例。

## 三、准备材料清点

先列三类材料：

- 已具备：用例文件、目标地址、账号/密钥来源、测试数据、审批文件、运行模式。
- 缺失材料：阻塞执行的文件、环境变量、字段映射确认、审批确认。
- 可选材料：只读数据库账号、清理接口、CI 配置、历史证据。

缺失材料只问与当前输入有关的内容，给出可复制示例。完整规则按需读取 `references/input-and-readiness.md`。

## 四、输入和准备度

- 原生 `report.json` 和标准十列 `.xlsx` 可以进入准备度判断。
- 非标准 Excel 必须确认字段映射，任何 AI 置信度都不能静默转换。
- E0 到 E4 用来表达准备度，不代表业务通过。
- 不要猜测正式服或测试服，也不要用域名、库名或数据特征自行判断环境性质。

需要展开输入识别、E0-E4、字段映射和材料提示时，读取 `references/input-and-readiness.md`。

## 五、风险、凭据和数据

- 优先使用用户提供的账号、密码、测试数据和数据库只读账号；其次使用已配置环境变量；不能把密钥写进 manifest、报告、日志、截图或 HTML。
- R0/R1 可进入普通审批；R2/R3 必须显式说明风险，CI 模式拒绝 R2/R3。
- 数据库只允许 SELECT，只读能力不能证明时阻塞执行。

需要处理 R0-R3、凭据优先级、测试数据、数据库只读账号或缺密钥 blocked 结果时，读取 `references/risk-credentials-and-data.md`。

## 六、定位器、断言和规则

- 定位器失败不能静默自愈；只能提出修复建议，用户确认后才应用。
- 断言准确性优先于覆盖面；行业经验只做少量候选判断，并标明自动判定来源。
- 预期口径冲突、三方解释不一致或需求口径异常时，标记为待定，交给测试人工审核。

需要处理定位器修复、断言来源、知识规则、重试边界和待定判定时，读取 `references/locators-assertions-and-rules.md`。

## 七、执行预览和确认

执行前必须展示：

- 主 Skill：`web-api-test-execution-evidence`
- 辅助 Skill：无，或一个用户确认后的辅助 Skill
- 分工：本 Skill 负责准备度、执行预览、Runner 调用、证据和报告；辅助 Skill 只负责其明确范围
- manifest hash、目标 origin、风险等级、动作数量、将要读取的环境变量名

用户确认前不执行 Web/API/数据库动作。

## 八、Runner 固定命令

使用固定版本命令，不使用 latest：

```bash
npx @saitamasans/testing-runner@1.0.0 plan --input report.json --profile execution-profile.json --output-dir .testing-run
npx @saitamasans/testing-runner@1.0.0 approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at 2999-01-01T00:00:00.000Z --confirmed-by reviewer-name
npx @saitamasans/testing-runner@1.0.0 run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive
```

CI、退出码和完整参数读取 `references/runner-commands.md`。

## 九、状态和报告门禁

- 业务四状态：未执行、通过、不通过、待定。
- 运行七状态：planned、running、completed、blocked、executor_error、infrastructure_error、manual_required。
- run-result.json 是唯一判定来源；Excel/HTML/JSON 一致性通过后才能交付。
- 输出必须包含 `.xlsx`、`.html`、`run-result.json`、证据目录和必要的 blocked/manual 说明。

CI 证据、报告一致性、上传产物和失败退出码读取 `references/ci-evidence-and-reporting.md`。

## 十、最终自检

- [ ] 是否只执行已有用例，没有生成新用例？
- [ ] 是否展示主/辅 Skill 名称和分工，并在用户确认后才加载辅助 Skill？
- [ ] 是否完成准备材料清点，且没有猜测正式服或测试服？
- [ ] 是否对非标准 Excel 做了字段映射确认？
- [ ] 是否保护密钥，没有把账号密码、token、连接串写入产物？
- [ ] 是否使用固定 Runner 版本和审批文件？
- [ ] 是否保留未执行、通过、不通过、待定四状态和七个运行状态的区别？
- [ ] 是否通过 Excel/HTML/JSON 一致性门禁后再交付？

## 十一、反模式

- 不要因为用户催促就跳过审批、字段映射或密钥检查。
- 不要把“不通过”和“待定”混在一起。
- 不要把环境猜测写成事实。
- 不要在 CI 中等待人工登录、MFA、扫码或补充数据。

<!-- reference: references/input-and-readiness.md -->
# 输入与准备度

## 输入类型

- 正式输入：原生 `report.json`、标准十列 `.xlsx`、经确认映射的非标准 `.xlsx`。
- 非正式输入：HTML、CSV、Markdown、截图、PRD、接口文档、口头描述。非正式输入只能用于提示用户补齐材料，不能直接执行。

## 准备度 E0-E4

- E0：没有可执行用例或执行目标。
- E1：有用例，但缺目标、账号、数据、审批或字段映射。
- E2：材料基本齐，但存在执行风险或环境/数据疑点。
- E3：可以生成执行预览，等待用户确认。
- E4：manifest、approval、凭据来源和输出目录已锁定，可以执行。

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

数据库断言只允许 SELECT。必须证明账号只读；不能证明时 blocked。查询结果要限行、限体积、脱敏，并作为证据引用。
<!-- /reference -->

<!-- reference: references/locators-assertions-and-rules.md -->
# 定位器、断言和规则

## 定位器

定位器失败时，收集失败证据和候选修复。只生成 proposal，不自动修改 manifest；用户确认后才应用。

## 断言

断言来源优先级：用例预期 > 产品确认口径 > 接口契约 > 技术规则 > 少量行业经验候选。行业经验必须标明自动判定来源，不能大量占比。

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

```bash
npm install --save-dev @saitamasans/testing-runner@1.0.0
npx @saitamasans/testing-runner@1.0.0 plan --input report.json --profile execution-profile.json --output-dir .testing-run
npx @saitamasans/testing-runner@1.0.0 approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at 2999-01-01T00:00:00.000Z --confirmed-by reviewer-name
npx @saitamasans/testing-runner@1.0.0 run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive
```

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```bash
npx @saitamasans/testing-runner@1.0.0 verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
<!-- /reference -->
