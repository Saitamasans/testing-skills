# Windows Skill Installers v1

## Windows x64 三步使用

1. 下载并双击推荐的一键安装器：[install-web-api-test-execution-evidence.cmd](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.1/install-web-api-test-execution-evidence.cmd)。安装器会下载一次完整 Runtime，执行 SHA-256、清单和本地 smoke 校验，无需管理员权限，也不依赖系统 Node、npm、Git 或 Chrome。
2. 安装成功后重启 Codex。
3. 上传十列 Excel 测试用例并输入：`调用第八个 Skill 执行`。

正常执行阶段不会下载 Node、Runner、Playwright 或 Chromium，也不会访问 GitHub Release、npm 或浏览器下载源获取运行依赖；只使用本地已安装 Runtime，并按用例访问被测目标及必要的本机 loopback 服务。

## 下载与审计

- 推荐一键安装 CMD：[install-web-api-test-execution-evidence.cmd](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.1/install-web-api-test-execution-evidence.cmd)
- 完整 Windows x64 Runtime ZIP：[web-api-test-execution-evidence-1.0.1-windows-x64.zip](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.1/web-api-test-execution-evidence-1.0.1-windows-x64.zip)
- 公开校验清单：[SHA256SUMS.txt](https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.1/SHA256SUMS.txt)
- 不可变 Runtime Release：[web-api-test-execution-evidence-v1.0.1](https://github.com/Saitamasans/testing-skills/releases/tag/web-api-test-execution-evidence-v1.0.1)

## 修复与诊断

安装损坏或 receipt 校验失败时，下载同一不可变 Release 中的 `install-web-api-test-execution-evidence.ps1`，然后在其所在目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-web-api-test-execution-evidence.ps1 -Repair
```

- receipt：`%USERPROFILE%\.testing-skills\installations\web-api-test-execution-evidence.json`
- diagnostics：`%USERPROFILE%\.testing-skills\diagnostics\web-api-test-execution-evidence`
- Skill：`%USERPROFILE%\.agents\skills\web-api-test-execution-evidence`

此不可变历史 Release 仅提供前七个 Skill 的独立启动器和原有 `install-all.cmd` 快照，不再覆盖或替换任何资产。全部 8 个 Skill 和第八个 Skill 的执行就绪入口始终来自上面的不可变 Runtime Release，避免历史入口替换已审计的 Runtime 安装字节。
