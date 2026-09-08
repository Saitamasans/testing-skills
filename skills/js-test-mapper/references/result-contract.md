# 结果合同 host-native-1

输出结构化 JSON。仓库开发测试验证该合同，用户不需安装 validator 或执行器。校验只证明结构一致，不证明 Agent 没误点或事实真实。

顶级字段：contract（host-native-1）、run_id、status、capabilities、navigation、evidence、findings、metrics、gaps、stop_reason。

- status：connectivity_blocked/structure_only/partial_js/js_evidence。js_evidence 不等于完整覆盖。无 verified inline_js/external_js 不能标 partial_js/js_evidence；connectivity_blocked 不得有 visited。
- capabilities：id/status/evidence/limitation，必须列 page_read/navigation/interaction/inline_js/external_js/source_map/passive_network。status 为 verified/unavailable/untested/unstable，verified 必须有 evidence。
- navigation：id/parent_id/menu_depth/entry_label/discovered_from/target_url/state/reason/http_status/verification。state 为 visited/skipped/blocked。id 唯一，parent_id 为 null 或已有 id，不能成环；tab 独立 id。visited 需 verification。HTTP >=400 必须 skipped + navigation_http_error；未知 HTTP null。
- evidence：id/kind/source/locator/summary，kind 为 dom/script/network/screenshot；来源、位置、摘要非空。
- findings：id/status/claim/evidence_ids/alternatives。status 为 observed/static/inferred/unverified。除 unverified 外需可解析 evidence_ids；static 至少含 script 证据；inferred 需 alternatives。
- metrics：active_business_api_calls 恒为 0；browser_navigation_requests/page_initiated_requests 未测用 null，只有 passive_network verified 且有实际记录才填非负整数，包括 0。
- gaps：字符串数组，记录能力、动态页面、范围缺口。
- stop_reason：queue_exhausted/budget_reached/connectivity_blocked/user_stopped。

本项目报告允许保留分析所需业务记录原值，不默认脱敏；不收录无关整批记录。密码/Cookie/Token/Authorization 不入文件，URL 中认证秘密必须移除。所有格式与证据仅存本地，不自动上传或分享。
