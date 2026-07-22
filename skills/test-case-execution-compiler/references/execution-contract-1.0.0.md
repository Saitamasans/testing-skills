# Execution Contract 1.0.0

ZIP 固定包含 `source/`、`execution-contract.json`、`execution-readiness.md`、`unresolved-items.xlsx`、`source-mapping.json` 和 `package-manifest.json`。

每条用例固定包含：`case_id`、`source_case_id`、`source_sheet`、`title`、`module`、`priority`、`execution_type`、`automation_status`、`isolation_scope`、`flow_group`、`start_state`、`auth_profile`、`setup`、`actions`、`assertions`、`effects`、`cleanup`、`dependencies`、`resource_locks`、`evidence_policy`、`unresolved`。`priority` 必须守恒为源用例中的 `P0`、`P1` 或 `P2`，不能在 Runner 阶段补猜。

`execution_type` v1 仅为 `web_ui`。`isolation_scope` 默认为 `case`，仅允许 `case`、`flow_group`、`suite`、`external_existing`。`cleanup` 分为 `technical_cleanup` 与 `business_cleanup`；关闭 BrowserContext 是技术清理，退出登录或恢复业务数据不能由模型补写。

`package-manifest.json` 至少记录 schema、包状态与身份、编译器和契约版本、编译时间、源文件及 SHA、sheet、用例数量和 ID、内部文件及 SHA、未解决项数量，并固定 `secret_values_included=false`。

信任边界固定为：`internal integrity validation != cryptographic authenticity`。自包含 ZIP 没有外部信任根；内部 hash 只能发现损坏、缺失或内部不一致，不能证明发布者身份、不能授予执行权限，也不能宣称产物“防篡改”。加载方必须把包继续视为不可信输入，独立解析源用例核对 ID/数量，并将当前 package SHA-256 与最终 manifest SHA-256 绑定到另行取得的执行审批。
