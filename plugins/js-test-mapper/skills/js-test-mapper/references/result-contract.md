# 结果合同 host-native-1

**主交付是 `map`。** 没有符合 `schemas/map.schema.json` 的 map、或没有渲染出 `map.html`，不得声称建图完成。

`run-data` / `cognition` / `playwright_version` 不是本 skill 的输出。旧 Runtime 合同不要填。

下面字段仅在用户明确要求归档时作为附录 JSON；日常交付只写 `map.json` + `map.html`。

可选附录顶级字段：contract（host-native-1）、run_id、status、capabilities、navigation、evidence、findings、metrics、gaps、stop_reason、map。

- `map`：见 `schemas/map.schema.json`。渲染必须用定版 `templates/map.html`，对照 `assets/demo-map.html`。可仅有模块关系，但必须写明没有恢复业务流程。边的 `label` 必须是动词短语。`dashed` 仅用于 inferred/unverified。会交叉的非树边不要放进 edges。
- status：connectivity_blocked/structure_only/partial_js/js_evidence。无 verified inline_js/external_js 不能标 partial_js/js_evidence。
- capabilities：id/status/evidence/limitation，列 page_read/navigation/interaction/inline_js/external_js/source_map/passive_network。
- navigation：visited/skipped/blocked；H5 无 href 的只读入口按导航合同 H5 节。
- findings：observed/static/inferred/unverified。
- metrics：active_business_api_calls 恒为 0。
- gaps：能力、动态页面、范围缺口。未画出的汇合边也记这里。

本项目报告允许保留分析所需业务记录原值，不默认脱敏。密码/Cookie/Token/Authorization 不入文件。仅存本地。
