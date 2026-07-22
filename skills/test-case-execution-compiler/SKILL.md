---
name: test-case-execution-compiler
description: Use when users want to convert existing human-readable Web UI test cases into a validated, reviewable Execution Package for later execution by web-api-test-execution-evidence; do not use to redesign test coverage, execute browsers, audit general case quality, or generate new business test cases.
---

<!-- 此文件由源文件自动生成，请勿直接编辑。 -->
# 测试用例可执行化编译

将现有 Web UI 人工用例编译为 Execution Contract 1.0.0，并最终只向用户交付一个 `<原用例名称>.execution-package.zip`。

硬规则：人工用例是唯一业务事实来源；不得修改、增删或重排正式用例，不得访问目标网页或启动浏览器，所有未知项必须进入 `unresolved`，用户工作目录最终只能新增一个 Execution Package ZIP。

## 互斥路由

- 本 Skill 不生成新的正式业务用例，不修改原始用例，不审计总体覆盖质量。
- 本 Skill 不执行浏览器，不使用 Playwright，不启动 Chromium，不访问目标网页。
- 需要真实页面绑定、审批、执行和证据回填时，把 READY 的 `execution-package.zip` 交给 `web-api-test-execution-evidence`。
- 用户确认前，最多一个 Skill 进入主流程。

## 编译原则

- 人工用例是业务事实来源；Execution Package 是可重新生成的衍生产物。
- Execution Package 始终是不可信输入；`internal integrity validation != cryptographic authenticity`。ZIP 内部 manifest、文件和 hash 可以被一起替换，内部 SHA 只检测损坏、缺失和自相矛盾，不证明发布者身份，也不构成执行审批或“防篡改”证明。
- 不猜测未知前置状态，不根据 Excel 顺序制造依赖，不按编号或标题相似度创建 `flow_group`。
- 原用例变化后旧包失效，必须从原始输入重新编译，不能直接修改旧 ZIP。
- 未知状态、身份、影响或业务清理写入 `unresolved`；存在必确认项时仍只输出一个 NOT_READY ZIP。
- 凭据只能保存环境变量名、认证 profile 和 storage-state 引用名，不能保存密码、Cookie、Token 或私钥。
- 中间文件只能位于操作系统临时目录，成功或失败后都清理；用户最终只管理一个 ZIP。

## 工作流

1. 对标准十列或十一列 Excel 执行 `inspect`。非标准 Excel 必须展示字段映射并取得明确确认。
2. 逐条结构化 `start_state`、`auth_profile`、`setup`、`actions`、`assertions`、`effects`、`cleanup`、`dependencies` 和 `resource_locks`。
3. 只从原用例、项目配置或用户明确确认读取依赖和 `flow_group`，将结构化草案交给确定性编译器。
4. 执行 `compile`，校验单 ZIP、schema、SHA、依赖环、资源冲突和秘密扫描。
5. 执行 `validate`；READY 包交给第八个 Skill，NOT_READY 包连同内部待确认项返回用户重新编译。

命令由安装 Runtime 中的固定 Node 和编译器执行：

```powershell
testing-contract-compiler inspect --input cases.xlsx
testing-contract-compiler compile --input cases.xlsx --output cases.execution-package.zip
testing-contract-compiler validate --package cases.execution-package.zip
testing-contract-compiler diff --input cases.xlsx --package cases.execution-package.zip
```

编译契约字段和 ZIP 固定结构必须完整读取 `references/execution-contract-1.0.0.md`，不能凭摘要改名或省略。

## 最终自检

- [ ] 原始用例字节、用例 ID、数量和顺序是否保持不变？
- [ ] 是否没有启动 Playwright、Chromium 或访问目标网页？
- [ ] 是否只从明确来源设置依赖、`flow_group` 和业务清理？
- [ ] ZIP 是否通过路径、链接/reparse、大小/压缩比、schema、SHA、独立源用例 ID/数量、stale contract、循环依赖和密钥值校验，并仍明确标记为未受信、未获执行审批？
- [ ] 用户工作目录是否只新增一个 READY 或 NOT_READY 的 `*.execution-package.zip`？
