# Runner 命令

## 本地

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" discover-web --url https://example.test --output-dir .testing-run/discovery --browser visible
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" discover-plan --input cases.execution-package.zip --profile execution-profile.json --output-dir .testing-run --discovery-approval .testing-run/discovery-approval-1.json --discovery-approval .testing-run/discovery-approval-2.json --browser headless
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive --browser auto --slow-mo 200 --progress auto
```

`<ABSOLUTE_SKILL_ROOT>` 必须替换为已安装 Skill 的绝对目录，路径含空格时正确加引号。正式执行只快速验证安装回执、回执绑定的 bundle 清单、固定组件身份和关键可执行/证据标记，不会下载、安装或修改运行时；若验证失败，重新运行 GitHub Release 完整安装器并带 `-Repair`。无需 npm 账号或手工安装。`<ISO_EXPIRES_AT>` 使用本次执行窗口内的短期过期时间，不使用长期或永久审批。

最终用户必须先使用 GitHub Release 完整安装器。完整安装不提供轻量版或可选浏览器，安装时已交付 portable Node 22.23.1、Runner 1.1.2、Playwright 1.61.1、Chromium 1228、headless shell 1228 和 FFmpeg 1011。无需系统安装 Node.js、npm、Git、Chrome、Excel 或 Python。若报告 `installation_incomplete` 或 `installation_corrupt`，使用 GitHub Release 完整安装器的 `-Repair` 修复；执行期不会下载、安装或修改运行时。

`discover-web` 是执行前的黑盒只读探测，不会生成审批、点击或输入。先查看 `web-discovery.json`、`web-discovery.md` 和 `web-discovery.png`，确认定位器与断言方案后，再生成 `execution-profile.json`。

## 可视执行

- `--progress auto`：默认值。interactive 且浏览器可见时最大化窗口，依次展示执行准备、用例预告、实时执行、证据收集和结果中心。
- 执行准备展示输入范围、测试用例（Test Cases）总数、动作数量、目标地址和交付物；用例预告逐条展示测试用例（Test Case）的验证意图与预期结果。
- 实时执行中，Web/混合场景显示自动让位的页面浮层与当前目标高亮；API-only 使用全屏执行看板，API 流水展示方法、路径、响应状态、响应摘要和断言。
- 证据收集展示 PNG、请求响应、Excel/HTML/JSON、日志与 Trace 的整理状态；结果中心展示四状态统计、逐条结果和产物入口。
- `--progress off`：关闭执行面板。API-only 不再为可视化额外启动浏览器；Web 动作仍按原逻辑使用安装时已具备的浏览器。
- `--browser headless` 或 `--mode ci`：不显示面板、不停留等待，也不为 API-only 可视化准备浏览器。
- 驾驶舱只消费 Runner 的真实执行事件，不参与定位器、点击、断言或结果计算；正式 Web 证据 PNG 临时隐藏驾驶舱和目标高亮，桌面录屏保持显示。

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<ABSOLUTE_SKILL_ROOT>\scripts\testing-runner.ps1" verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
