# Runner 命令

## 本地

```bash
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs plan --input report.json --profile execution-profile.json --output-dir .testing-run
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive --browser auto --slow-mo 200 --progress auto
```

`<ABSOLUTE_SKILL_ROOT>` 必须替换为已安装 Skill 的绝对目录，路径含空格时正确加引号。首次运行会自动下载并校验固定 Runner；无需 npm 账号或手工安装。Web 用例和 API-only 交互可视执行按需自动准备 Chromium。`<ISO_EXPIRES_AT>` 使用本次执行窗口内的短期过期时间，不使用长期或永久审批。

## 可视执行

- `--progress auto`：默认值。interactive 且浏览器可见时最大化窗口，依次展示执行准备、用例预告、实时执行、证据收集和结果中心。
- 执行准备展示输入范围、测试用例（Test Cases）总数、动作数量、目标地址和交付物；用例预告逐条展示测试用例（Test Case）的验证意图与预期结果。
- 实时执行中，Web/混合场景显示自动让位的页面浮层与当前目标高亮；API-only 使用全屏执行看板，API 流水展示方法、路径、响应状态、响应摘要和断言。
- 证据收集展示 PNG、请求响应、Excel/HTML/JSON、日志与 Trace 的整理状态；结果中心展示四状态统计、逐条结果和产物入口。
- `--progress off`：关闭执行面板。API-only 不再为可视化额外启动或下载浏览器；Web 动作仍按原逻辑使用浏览器。
- `--browser headless` 或 `--mode ci`：不显示面板、不停留等待，也不为 API-only 可视化准备浏览器。
- 驾驶舱只消费 Runner 的真实执行事件，不参与定位器、点击、断言或结果计算；正式 Web 证据 PNG 临时隐藏驾驶舱和目标高亮，桌面录屏保持显示。

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```bash
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
