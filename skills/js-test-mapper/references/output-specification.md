# 测试地图交付规范

**主交付是可视化 HTML 图。** 没有 `evidence/map.html`，本轮不算完成。聊天摘要只指向图。Word / Excel / Markdown 是附录，不能代替图。不启用旧 Runtime，不写 `run-data.json` / `cognition.json`。

生成方式：先写符合 `schemas/map.schema.json` 的 `evidence/map.json`，再渲染 HTML。

有 Node：

```
node scripts/render-map.mjs evidence/map.json evidence/map.html
```

无 Node：复制 `templates/map.html`，把 `__MAP_DATA_JSON__` 换成 `JSON.stringify(map)`，并把 `<` 替换成 `\u003c`。不要为了渲染去安装 Node。

HTML 必须离线可读，样式内嵌在 `templates/map.html`（定版，禁止另写皮肤）。打开后第一眼是图：默认节点最多的业务流、树形从上往下、节点按 observed/static/inferred/unverified 上色、线上有动词、点节点出卡片。对照 `assets/demo-map.html`。用户无需先读 JSON 或六章底稿。

聊天顺序：完成程度（受限时置顶）→ 图文件链接 → 一句话定位 → 最多 3 条测试重点。禁止在聊天里粘贴系统地图表格或脚本清单。

## 用户先看结果

图上必须能回答：这是什么系统；块与块怎么连；哪条业务怎么走；点开某步后该先验什么。证据索引放在节点卡片底部。

有效边：「提交后预占库存」。无效边：「订单—库存」。  
有效测试建议：“页面分别有账号余额与收益余额，所以要确认操作影响哪个账户”。无效：“应进行功能、性能、安全测试”。

没证据画不出状态机时，只交模块/页面关系图，并在流程区标明「证据不够，不编故事」。推测边虚线。

## 证据底稿（附录，不进聊天首页）

内部仍可按结果合同保存范围和缺口。需要归档时再投影到 Word / Excel。不能为填满而造内容。没有 map.html 时这些附录不算完成。

## 交付前复核

- 不打开 HTML 是否就无法理解系统。
- 是否改了定版模板（改了必须回退）。
- 每条边是否有含义；虚线是否都标了待验证/推测。
- 图上是否交叉、边字是否盖住节点。
- 缺 status 的节点是否被画成「看见了」（必须否，应为待验证）。
- 每个“实际发生”是否真有运行证据。
- 附件是否混入认证凭据或测试口令明文。
