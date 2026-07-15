# CI、证据和报告

## 报告门禁

`run-result.json` 是唯一判定来源。Excel 和 HTML 只能从同一份投影结果生成，必须校验用例 ID、执行状态、证据数量、manifest hash 和统计一致。

## 输出

交付 `.xlsx`、`.html`、`run-result.json`、`projected-report.json`、事件 JSONL、证据文件、必要的 blocked/manual 说明。缺密钥、MFA、SSO、二维码和人工登录在 CI 中直接 blocked，不等待。

## 退出码

- 0：执行完成且无业务失败/待定。
- 10：执行完成但存在不通过或待定。
- 20：blocked 或 manual_required。
- 30：executor_error。
- 40：infrastructure_error。
- 50：协议、审批、安全或报告门禁失败。
