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
