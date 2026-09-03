<a id="install"></a>

# 安装与宿主接入

## 通用 Skill：无需求-UI逆向测试工作台

`reverse-test-workbench` 的主产品是跨宿主、跨 Windows/macOS/Linux 的公共 Skill。适用于能够加载 Skill 风格指令并提供 MCP/浏览器工具的 Agent；不要求使用 Codex、Claude Code、Cursor 或其他指定产品。

已有 Node.js/Skills CLI 时，直接安装单个公共 Skill：

```text
npx skills add Saitamasans/testing-skills@reverse-test-workbench -g -y
```

也可以把仓库中的 `skills/reverse-test-workbench` 目录放入当前宿主支持的 Skill 目录。不同宿主的目录和安装命令可能不同，但核心文件、执行规则和资源不变。

浏览器执行首选官方 `@playwright/mcp`。如果宿主已经提供该 MCP，Skill 直接进行能力门禁并使用；如果没有，由宿主的插件、扩展或 MCP 管理界面完成一次性连接。宿主无法提供官方 Playwright MCP 时，Skill 会明确停在执行器门禁并给出一个最小恢复动作，不会静默换成 Selenium、桌面控制或不可靠的点击方式。

宿主支持自定义 MCP 配置时，可参考下面的语义配置；命令、传输和安装方式由宿主决定，不要把这段示例当作核心 Skill 的固定启动脚本：

```json
{
  "playwright": {
    "command": "npx",
    "args": ["-y", "@playwright/mcp@0.0.79", "--browser", "chrome", "--isolated"]
  }
}
```

多模态视觉不是硬依赖。模型支持图像时补充布局、图表、Canvas 和遮挡判断；不支持时继续 DOM/ARIA 探索，并把视觉范围列为未覆盖。

> 互操作边界：完全不支持 Skill 指令、MCP 或等价浏览器能力的普通聊天产品，无法执行这个交互式测试 Skill。这是宿主能力边界，不是操作系统限制。

## 可选 Codex 适配器

Codex 用户可以安装可选适配器，一次获得同一份公共 Skill 和锁定版本的官方 Playwright MCP 配置。适配器只负责宿主接线，不拥有独立测试规则。

```powershell
codex plugin marketplace add Saitamasans/testing-skills --ref main
codex plugin add reverse-test-workbench@reverse-test-workbench
```

安装完成后请**新建任务**，再提供目标 URL 开始探索。首次运行时，Codex 按适配器配置获取锁定版本的官方 Playwright MCP；仓库不保存浏览器执行器安装包。详细说明见 [`plugins/reverse-test-workbench/README.md`](../plugins/reverse-test-workbench/README.md)。

## 推荐方式：Windows 安装按钮

适合普通功能测试人员。Windows 10/11 自带的 Windows PowerShell 即可，**无需管理员权限**。公开展示的常用 Skill 可以直接点击首页 Install 按钮安装；前 5 个用例生成 Skill 实际生成 `.xlsx` 和 `.html` 文件时，仍需要可用的 Node.js 运行环境。

第 7 个 `requirement-clarification-test` 实际生成需求澄清 `.xlsx` 文件时，需要可用的 Node.js 运行环境。

`workbench-ui-acceptance-execution` 是浏览器 UI 验收执行 Skill，本身不内置独立 runner，不强制下载额外执行器或浏览器安装包；安装只复制 Skill 文件，执行时复用当前 AI 环境已有的浏览器控制能力。

`reverse-test-workbench` 使用独立的不可变 Release 安装资产：
`reverse-test-workbench-v0.1.0/install-reverse-test-workbench.cmd`。它不依赖已经冻结的
`skill-installers-v1`，避免新增 Skill 后主页按钮指向不存在的旧 Release 资产。

## Web JS 逆向测试建图

`js-test-mapper` 是 Runtime 型 Skill。普通 Windows 用户点击首页 **Install RC**，只下载
`install-js-test-mapper.cmd`，然后双击并等待安装完成。安装器使用锁定的 Skills CLI，从固定的
`v0.1.1-rc.2` tag 安装标准 Skill；随后由 Skill 内本地 bootstrap 校验并准备固定 SHA-256 的 Runtime TGZ。公开 CMD 不下载或执行远程脚本。要求 Node.js 20 或更高版本。

Runtime 继续使用 Playwright Library，优先调用系统 Edge 或 Chrome；rc.2 安装阶段不自动下载浏览器，也不会关闭安全软件、添加白名单或绕过 SmartScreen。

安装成功后请完全退出并重新打开 CC Switch / Codex，在 Skills 中确认
`Web JS 逆向测试建图 / js-test-mapper`，随后在新任务里用自然语言直接调用。完整 ZIP 仅用于离线审计和高级安装，不再是普通用户主入口。

## 多源测试审计

点击首页 Install 按钮只需下载一个 `install-multi-source-test-audit.cmd`。双击它后，CMD 会自动下载并校验固定版本的安装脚本；安装脚本再下载并校验完整离线 Runtime。安装完成后请重启 Codex。

该按钮已按普通用户主流程验收：下载目录中只放 CMD，不需要预先下载 PS1、ZIP、Python、Git、Node 或 npm。安装器支持 `-Force` 和 `-Repair`；若失败会显示错误码、日志位置和建议操作。

点击按钮会下载纯文本 `.cmd` 启动器；下载后双击并完成 Windows 安全确认即可安装。GitHub 不能静默执行访问者电脑上的程序，也不会绕过浏览器或 Windows 的确认步骤。Release 资产发布后按钮才生效；如果下载返回 404，请使用下面的命令兜底。

`.cmd` 可以先在 GitHub 查看，或下载后右键用文本编辑器检查。Windows 可能显示“来自互联网”或 SmartScreen 提示，这是正常安全机制。启动器只读取本仓库的 HTTPS 安装脚本，默认写入当前用户的 `.agents\skills`，不写系统目录。

## 命令兜底：Windows 零 Node 安装

以下命令可以直接粘贴到 PowerShell 或命令提示符（CMD）。

只安装“需求测试工作台”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; & ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -Skill 'requirement-test-workbench'"
```

只安装“测试工作台-用例执行”：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; $url='https://github.com/Saitamasans/testing-skills/releases/download/workbench-ui-acceptance-execution-v0.1.0/install-workbench-ui-acceptance-execution.cmd'; $installer=Join-Path ([IO.Path]::GetTempPath()) ('testing-skills-'+[guid]::NewGuid().ToString('N')+'.cmd'); $exitCode=1; try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $installer; $env:TESTING_SKILLS_NO_PAUSE='1'; & $env:ComSpec /d /c ('call '+[char]34+$installer+[char]34); $exitCode=$LASTEXITCODE } finally { Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue }; exit $exitCode"
```

把命令末尾的名称换成首页总览中的 Package，即可安装其他公开展示的单个 Skill。

默认安装到当前用户的 `.agents\skills`。目标 Skill 已存在时会保留原文件并提示跳过；确认需要替换时，在命令末尾增加 `-Force`。

如果提示无法访问 `raw.githubusercontent.com` 或 `codeload.github.com`，说明当前网络或代理无法访问下载地址；安装器不会把网络失败伪装成安装成功。把仓库下载到本地后，可用本地目录兜底：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -All -SourceDirectory .
```

## 高级方式：npx

已经配置 Node.js 工具链的开发者，可以先检查：

```powershell
node -v
npm -v
npx -v
```

三条命令都能输出版本号后，再执行：

```powershell
npx skills add Saitamasans/testing-skills
```

如果出现“无法将 `npx` 识别为命令”，请改用上面的“Windows 零 Node 安装”。macOS/Linux 开发者可在已有 Node.js 环境中运行 `scripts/install-all.sh`。

## 安装后查看

- Codex：在 Skills 管理界面或 `$CODEX_HOME/skills` 下查看。
- Claude Code：在 Skills 目录或技能列表中查看。
- CC Switch：打开 Skills 管理页，读取各包的 `SKILL.md` 名称和 description，并分别管理公开展示的 Skill。
