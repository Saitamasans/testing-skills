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

状态迁移探测结束后，必须由当前 Testing Runtime 会话在当前 `.testing-run` 目录生成 discovery receipt。receipt 至少记录 schema 版本、随机 `run_nonce`、discovery ID、生成器、Runtime/Runner 版本、精确 origin/请求 URL/最终 URL、目标 `page_state_id`、DOM 与无障碍指纹、artifact 路径与 SHA-256、生成与过期时间、当前 package SHA-256、来源用例 ID、迁移用例 ID、实际迁移动作 SHA-256 和 discovery approval reference。Runtime session 只登记本会话生成的 receipt 相对路径与精确 SHA；最终 manifest 只能引用通过当前 session、路径、时效、package、origin、URL、动作和页面指纹复核的 receipt。

`target_state_discovered=true`、`rule_versions` 中的手写 target-state 标记、用户上传布尔值、Execution Package 内预置 receipt、运行目录外 receipt、旧 session/nonce、旧页面 fingerprint 或缺失 artifact 一律无效。没有有效 receipt 时返回 `target_state_not_discovered`。discovery receipt 的 `purpose` 固定为 `target_state_discovery_only`，schema 禁止写入业务通过状态；发现结果只证明页面被探测，不能作为正式用例的通过证据。

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
