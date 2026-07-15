# Runner 命令

## 本地

```bash
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs plan --input report.json --profile execution-profile.json --output-dir .testing-run
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at <ISO_EXPIRES_AT> --confirmed-by reviewer-name
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive --browser auto --slow-mo 200
```

`<ABSOLUTE_SKILL_ROOT>` 必须替换为已安装 Skill 的绝对目录，路径含空格时正确加引号。首次运行会自动下载并校验固定 Runner；无需 npm 账号或手工安装。Web 用例按需自动准备 Chromium，API-only 不准备浏览器。`<ISO_EXPIRES_AT>` 使用本次执行窗口内的短期过期时间，不使用长期或永久审批。

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```bash
node <ABSOLUTE_SKILL_ROOT>/scripts/testing-runner.mjs verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
