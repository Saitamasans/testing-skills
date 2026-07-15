# 第八个 Skill 一键安装、自动引导安装与可见执行设计

日期：2026-07-15  
目标 Skill：`web-api-test-execution-evidence`  
Runner：`@saitamasans/testing-runner@1.0.0`

## 1. 背景与问题

当前 GitHub 安装包只包含第八个 Skill 的 `SKILL.md`、`agents/` 和 `references/`，配套 Runner 仍要求用户额外执行尚未生效的 npm 安装命令。该状态存在两个实际问题：

1. 用户执行一条 Skill 安装命令后，无法直接运行 Web/API 用例；
2. Runner 把 Playwright 固定为 `headless: true`，交互执行时看不到浏览器窗口和页面点击。

因此，现有交付不满足“安装一次 Skill，提供用例和资料后直接执行”的产品目标。

## 2. 设计目标

外部用户只需执行一次：

```powershell
npx skills add Saitamasans/testing-skills --path skills/web-api-test-execution-evidence
```

安装后，用户把测试用例、被测地址、账号和测试数据等资料交给 Codex、Claude Code 或兼容客户端，并用自然语言要求执行。Skill 必须自动完成 Runner 准备、执行预览、确认门禁、真实运行和报告输出。

必须满足：

- 用户不注册、不登录 npm；
- 用户不手动安装 Runner、依赖或浏览器组件；
- 首次运行前明确告知下载内容、来源、固定版本、缓存位置和预估体积；
- 下载自动开始，不额外要求用户输入 npm 命令；
- 后续运行优先复用已校验缓存；
- 交互执行默认打开可见浏览器，CI 默认无界面；
- 不允许交互模式静默降级为无界面执行；
- 原七个 Skill 的名称、职责、文件名和表达习惯不变。

## 3. 不在本次范围内

- 不合并、拆分或重命名原七个 Skill；
- 不把第八个 Skill 改成测试用例生成器；
- 不取消现有执行预览、用户确认、风险分级、凭据脱敏和数据清理门禁；
- 不要求普通使用者理解 Runner CLI；
- 不发布到 npm Registry，本次采用 GitHub Release 分发 Runner；
- 不把全部 `node_modules` 或浏览器二进制直接提交进 Skill 仓库。

## 4. 方案选择

采用“轻量 Skill + GitHub Release Runner + 首次运行自动引导安装”。

未采用的方案：

- 把 Runner、依赖和浏览器全部塞入 Skill：体积大、跨平台困难、每次安装都重复下载；
- 依赖 Codex/Claude 各自的浏览器工具：不同客户端的动作、断言和证据能力不一致，无法保证统一准确性；
- 继续使用独立 npm 包手动安装：不满足一条 Skill 安装命令后直接使用的要求。

## 5. 安装包结构

第八个标准 Skill 包新增：

```text
skills/web-api-test-execution-evidence/
├── SKILL.md
├── agents/openai.yaml
├── scripts/
│   └── testing-runner.mjs
├── assets/
│   └── runner-release.json
└── references/
    ├── input-and-readiness.md
    ├── risk-credentials-and-data.md
    ├── locators-assertions-and-rules.md
    ├── ci-evidence-and-reporting.md
    └── runner-commands.md
```

`testing-runner.mjs` 只使用 Node.js 20+ 内置模块，负责下载、校验、缓存、依赖准备、浏览器准备和转发 Runner 命令。`runner-release.json` 固定记录 Runner 版本、GitHub Release 地址、SHA-256、最低 Node.js 版本和缓存协议版本。

这些文件的真源放在 `skill-sources/web-api-test-execution-evidence/`，由现有 builder 生成到标准 Skill 包，禁止只手工修改生成目录。

## 6. 首次运行流程

Skill 被调用后必须先运行启动器。启动器按以下顺序工作：

1. 检查 Node.js、npm、网络和缓存目录是否可用；
2. 读取固定版本的 `runner-release.json`；
3. 输出首次运行告知，内容至少包括：
   - Runner 固定版本；
   - Runner 与锁定生产依赖来源为项目 GitHub Release；
   - Chromium 来源为 Playwright 官方浏览器源；
   - 本地缓存绝对路径；
   - Runner/依赖和浏览器的大致下载体积；
4. 下载 Runner `.tgz` 到临时文件；
5. 计算 SHA-256 并与发布清单比较，不一致立即删除临时文件并阻断；
6. 使用当前 npm 在版本化缓存目录离线安装本地 `.tgz`；该包已包含锁定的生产依赖，不访问 npm Registry，也不要求登录；
7. 原子写入安装完成标记；
8. 转发 `plan`、`approve`、`run` 或 `verify-report` 命令。

缓存目录默认使用：

```text
~/.testing-skills/runtime/testing-runner/1.0.0/
```

允许通过 `TESTING_SKILLS_HOME` 修改根目录。不同 Runner 版本并存，升级不覆盖旧版本。并发首次运行通过文件锁或原子目录防止重复安装。

第二次及以后运行必须验证版本、发布清单哈希和完成标记；全部一致时直接复用缓存，不重复下载。

## 7. 浏览器组件准备

- API-only 用例不下载、不启动 Chromium；
- 执行清单包含 Web 动作且本地没有兼容浏览器时，启动器自动运行固定 Playwright 版本的 Chromium 安装；
- 下载前使用同一份首次运行告知说明浏览器来源、缓存位置和预估体积；
- 下载失败时输出具体失败阶段、可复制的诊断信息和重试方式，不宣称 Runner 已就绪；
- 不自动安装数据库驱动；用例明确需要数据库只读断言时，继续按现有 readiness 规则报告缺失项。

## 8. 可见执行设计

Runner 的浏览器策略调整为：

- `interactive`：默认 `headless: false`，打开可见 Chromium；
- `ci`：固定 `headless: true`；
- API-only：不启动浏览器；
- 交互模式提供受控的 `slowMo`，默认 200ms，确保测试人员能看见主要点击和输入；
- 用户可以明确要求无界面交互执行，但 Runner 不得自行静默切换；
- 可见浏览器启动失败时将本次运行标记为阻断，并提示缺少桌面显示、浏览器组件或权限。

Runner 继续保留现有目标域名、批准文件、风险级别、凭据解析、脱敏、只读数据库和清理策略门禁。

## 9. Skill 调用体验

用户不需要知道 Runner 命令。示例：

```text
用第八个 Skill 执行这份 Web/API 用例。用例文件在 report.xlsx，
目标地址和账号资料在 execution-profile.json。先给我执行预览，确认后打开可见浏览器执行。
```

Skill 的固定行为：

1. 说明当前调用的是第八个 Skill；
2. 自动检查并准备 Runner；
3. 检查用例、地址、凭据引用、测试数据和清理策略；
4. 非标准 Excel 必须先展示字段映射并等待确认；
5. 生成执行预览并等待用户确认；
6. 使用启动器执行锁定命令；
7. 输出 Excel、HTML、`run-result.json`、事件日志和执行证据；
8. 使用 `verify-report` 校验报告一致性后再给结论。

## 10. 证据与状态

`run-result.json` 继续作为唯一执行判定来源。四个业务状态保持：

- `未执行`
- `通过`
- `不通过`
- `待定`

执行证据至少保留请求/响应摘要、断言结果、事件日志和必要截图。交互 Web 执行额外生成 Playwright Trace；视频可以作为可选证据，不作为本次发布门禁。

## 11. 安全与供应链约束

- Runner 下载地址必须指向 `Saitamasans/testing-skills` 的固定 GitHub Release，不使用浮动 `latest`；
- 启动器必须在安装前校验 SHA-256；
- Runner Release `.tgz` 必须捆绑由仓库锁文件解析出的生产依赖，用户侧离线安装不重新解析浮动版本；
- Runner、生产依赖和发布元数据由同一个 `.tgz` SHA-256 统一锁定；
- 下载日志、命令行和缓存标记不得包含用户凭据；
- 缓存目录不得保存明文账号密码；
- 临时文件使用随机文件名，失败后清理；
- 不执行从测试用例正文拼接出的 Shell 命令；
- 自动下载只准备运行环境，不绕过真实执行前的用户确认。

## 12. 错误处理

错误必须按阶段明确区分：

- `bootstrap_runtime_missing`：Node.js/npm 不可用；
- `bootstrap_network_failed`：GitHub 或依赖源不可达；
- `bootstrap_integrity_failed`：Runner 哈希不一致；
- `bootstrap_install_failed`：生产依赖安装失败；
- `browser_install_failed`：Chromium 安装失败；
- `browser_visible_launch_failed`：可见浏览器无法启动；
- 原有 E0–E4 readiness、批准、执行、清理和报告一致性错误保持不变。

启动失败不得伪装成测试用例“不通过”，应保持运行时状态与业务状态分离。

## 13. 测试策略

### 13.1 RED 基线

先增加会失败的测试，证明当前状态无法满足：

- 标准 Skill 包缺少启动器和固定发布清单；
- Skill 仍引用需要手动安装且不存在的 npm 包；
- 干净用户目录只安装 Skill 后无法执行 Runner；
- `interactive` 仍固定使用无界面浏览器。

### 13.2 自动化测试

- builder：启动器和发布清单稳定生成且无漂移；
- bootstrap：首次下载、SHA-256 成功/失败、缓存命中、损坏缓存重建、并发锁、无 npm 登录、npm Registry 不可达时仍能安装；
- browser：API-only 不安装浏览器，Web 用例按需安装；
- visibility：interactive 使用可见浏览器，CI 使用无界面，禁止静默降级；
- regression：现有 16 项 Skill 测试、102 项 Runner 测试和报告测试继续通过；
- packaging：Runner `npm pack --dry-run` 和 GitHub Release `.tgz` 内容一致；
- clean-room：临时 HOME/CODEX_HOME 中只运行公开安装命令，不引用本地仓库路径。

### 13.3 真实可见自测

从零创建临时 Todo Web/API 小系统和标准十列用例，在全新临时 Skill 目录执行：

1. 从 GitHub 默认分支安装第八个 Skill；
2. 删除或隔离本地仓库 Runner 路径，证明无法旁路引用；
3. 通过安装后 Skill 的启动器自动准备 Runner；
4. 生成预览并批准；
5. 打开可见 Chromium，真实执行新增、查询和状态切换；
6. 让用户能在桌面看到浏览器操作；
7. 验证 Excel、HTML、`run-result.json`、Trace、截图和事件日志；
8. 再执行一次，证明缓存命中且不重复下载。

## 14. 发布流程与完成条件

1. 使用仓库锁文件构建包含锁定生产依赖的 `@saitamasans/testing-runner@1.0.0` `.tgz`；
2. 计算 SHA-256；
3. 更新第八个 Skill 的固定发布清单；
4. 创建固定标签和 GitHub Release `testing-runner-v1.0.0`；
5. 上传 `.tgz` 和校验文件；
6. 更新 README 和 Skill 引用，删除普通用户手动安装 Runner 的要求；
7. 从 GitHub `main` 进行全新安装和可见端到端测试；
8. 远端复核 Skill 安装包、Release 资产和哈希；
9. 只有上述门禁全部通过，才能对外宣布“一条 Skill 安装命令后可直接执行”。

完成后，普通用户不需要 npm 账号、不需要第二条安装命令，也不需要知道本地开发仓库路径。
