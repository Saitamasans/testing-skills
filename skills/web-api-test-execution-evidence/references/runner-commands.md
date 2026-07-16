# Runner 命令

## 本地

```bash
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs plan --input report.json --profile execution-profile.json --output-dir .testing-run
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive --browser auto --slow-mo 200 --progress auto
```

`<ABSOLUTE_SKILL_ROOT>` 必须替换为已安装 Skill 的绝对目录，路径含空格时正确加引号。首次运行会自动下载并校验固定 Runner；无需 npm 账号或手工安装。Web 用例和 API-only 交互可视执行按需自动准备 Chromium。`<ISO_EXPIRES_AT>` 使用本次执行窗口内的短期过期时间，不使用长期或永久审批。

## 可视执行

- `--progress auto`：默认值。interactive 且浏览器可见时最大化窗口并显示实时执行面板；Web/混合场景显示页面浮层，API-only 使用全屏执行看板。
- `--progress off`：关闭执行面板。API-only 不再为可视化额外启动或下载浏览器；Web 动作仍按原逻辑使用浏览器。
- `--browser headless` 或 `--mode ci`：不显示面板、不停留等待，也不为 API-only 可视化准备浏览器。
- 面板只消费 Runner 的真实执行事件，不参与定位器或点击；正式 Web 证据 PNG 临时隐藏面板，桌面录屏保持显示。

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```bash
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
