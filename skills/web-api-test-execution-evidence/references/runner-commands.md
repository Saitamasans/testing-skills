# Runner 命令

## 本地

```bash
npm install --save-dev @saitamasans/testing-runner@1.0.0
npx @saitamasans/testing-runner@1.0.0 plan --input report.json --profile execution-profile.json --output-dir .testing-run
npx @saitamasans/testing-runner@1.0.0 approve --manifest .testing-run/run-manifest.json --out .testing-run/approval.json --expires-at 2999-01-01T00:00:00.000Z --confirmed-by reviewer-name
npx @saitamasans/testing-runner@1.0.0 run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result --mode interactive
```

## CI

CI 使用同一 manifest 和 approval，但加 `--mode ci`。CI 不新增动作、不修定位器、不等待人工登录、不读取本地文件外的临时口径。

## 验证报告

```bash
npx @saitamasans/testing-runner@1.0.0 verify-report --report .testing-run/result/projected-report.json --run-result .testing-run/result/run-result.json
```
