# 自动安全只读导航

## 分类顺序

采集 label/href/onclick/data-method/data-action/data-url/data-confirm/formaction/role/class/target、父菜单和深度。支持 Dcat/AdminLTE main-sidebar/nav-sidebar/nav-treeview/nav-link；普通 .nav 既非直接放行也非直接拒绝依据。

1. URL 解析失败 → skipped invalid_url；非 http(s)（javascript/mailto/tel 等）拒绝，同页 hash 按 tab 处理；跨源 → skipped cross_origin。此检查必须先于 tab 放行。
2. label、路径、查询参数、data-url 及其他动作属性有危险语义 → blocked dangerous_action。GET 也不例外。
3. onclick、data-method、data-action、data-confirm、formaction 有未知动作/表单语义 → blocked action_semantics。不提交表单或自动下载；不发 HEAD/OPTIONS/API 探测安全。
4. 有正面证据才允许：同源列表/日志/统计只读视图、该列表分页、明确只读 View/查看详情且无动作属性、已核实只切换视图的本地 hash tab。data-toggle=pill + role=tab 只是线索，handler 不明仍跳过。
5. 其余 skipped readonly_intent_not_proven。菜单容器本身不证明只读。

危险语义：新增/新建/创建/create/add/new、编辑/修改/edit/update、保存/提交/save/submit、删除/移除/delete/remove、审核/审批/approve/review、发布/publish、启用/停用/enable/disable、导入/import、上传/upload、导出/下载/export/download、支付/pay、批量/batch/bulk、重置/reset、清理/清空/clear/clean/purge、同步/sync、重算/recalculate、发送/send、退款/refund、撤销/取消/revoke/cancel、生成/regenerate/generate、执行/运行/execute/run。按词和路径段识别，歧义默认跳过。

## 队列

- 默认覆盖当前账号可见的全站安全菜单，深入关键业务链。每列表先采样当前页+下一页，每类详情先采样 1 个；有新状态或结构证据时追加代表样本，不爬取全部记录。不设固定 20 页/10 分钟为完成标准；外部预算耗尽必须报告剩余范围，不可放宽危险规则。
- visited 必须核验正文；HTTP >=400（能观测时）记 skipped navigation_http_error 和实际状态；超时/导航错误记 navigation_failed。未知 HTTP 写 null，不猜 200。
- 单页失败在仍可用上下文继续队列，整体连接故障遵守恢复协议。
- 稳定 identity 保留有意义的 path/query，认证秘密移除，业务记录原值按已授权范围保留；tab 使用 page+hash/稳定 tab key。按 identity+reason 去重，保存 parent_id/menu_depth/entry_label/discovered_from/target_url。
- tab 成功后重新 discover，分页只采样。隐藏 modal/form 不代表可见入口，不 force-click。
- 使用宿主支持的有界加载等待和 DOM 复查，依据页面加载证据设置有限单页等待与复查上限；有自然网络 quiet 能力则结合使用，不无限 networkidle，不以 150ms 认定完成。至少复查一次延迟 DOM；不支持则记录遗漏风险。

仅观察自然请求，不构造、重放、fuzz，active_business_api_calls 保持 0。不确定入口记录未覆盖，不让用户手工代点。
