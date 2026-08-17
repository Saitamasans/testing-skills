# 统一运行数据与固定生成器

创建、续写或生成测试资产时使用本契约。浏览器探索只维护 `evidence/run-data.json`；DOCX、XLSX 和 `_run-state.json` 都由固定脚本派生。

## 目录

- 单一事实源
- 运行方式
- 顶层结构
- 规范化嵌套对象
- 更新纪律
- 生成生命周期与降级
- 展示映射

## 单一事实源

```text
evidence/run-data.json
  -> scripts/preflight_artifacts.py
  -> scripts/validate_run_data.py
  -> scripts/build_artifacts.py
     -> 过程小结.docx
     -> 测试资产表.xlsx
     -> evidence/_run-state.json
     -> evidence/_artifact-build.json
```

禁止分别手写 Word、Excel 和续跑状态，也禁止在每次运行中临时创建新的报告生成器。`run-data.json` 保存完整结构化事实；`_run-state.json` 只是恢复浏览器上下文所需的派生投影，不能反向覆盖事实源。

默认目录：

```text
<系统名>_无需求UI逆向测试/
  过程小结.docx
  测试资产表.xlsx
  evidence/
    run-data.json
    _run-state.json
    _artifact-build.json
    batch-00/
    batch-01/
```

## 运行方式

先调用当前宿主可用的运行时能力，优先使用宿主提供的 Python/文档表格运行时；若宿主允许且能提供兼容 Python 依赖，也可使用 Skill 自带脚本。核心 Skill 不要求系统必须存在 `python`、`py`、Node、npm 或某个固定运行时。

```text
<runtime> scripts/init_run_data.py --output <run-root>/evidence/run-data.json --run-id <id> --system-name <name> --target-url <url> --skill-version <version> --executor-version <version> --started-at <iso-time> --budget-minutes <minutes>
<runtime> scripts/validate_run_data.py <run-root>/evidence/run-data.json
<runtime> scripts/build_artifacts.py --input <run-root>/evidence/run-data.json --output-dir <run-root>
<runtime> scripts/record_artifact_validation.py --run-root <run-root> --status passed|failed|skipped [--pages <页数>] [--evidence <相对证据路径>]
<runtime> scripts/check_artifact_consistency.py --run-root <run-root>
```

脚本如需生成 DOCX/XLSX，依赖可选的 `python-docx` 和 `openpyxl` 能力。所有路径通过参数和 `pathlib` 处理；不得在运行数据、脚本或 Skill 中硬编码盘符、用户目录或操作系统分隔符。缺少生成依赖时保留 JSON/evidence，并将 DOCX/XLSX 标记为降级，不阻塞浏览器探索。

## 顶层结构

`schema_version` 当前固定为 `1.0`。顶层集合不得缺失；没有记录时使用空数组：

```text
schema_version
run
summary
coverage
batches
navigation
page_inventory
paths
test_cases
issues
risks
test_data
evidence
knowledge
```

含义：

- `run`：系统、账号、四维声明、运行定位、执行器、产物预检、阶段耗时和续跑游标。
- `summary`：一句话结论、已回答/未回答问题、关键发现、建议和结论边界。
- `coverage`：导航、页面深度、路径、批次和未覆盖范围的同口径数量。
- `batches`：批次状态、信息增量、时间、游标、阻塞和下一步。
- `navigation`：可见入口与处置状态。
- `page_inventory`：页面/功能面、对象、控件、状态和行为指纹。
- `paths`：实际执行或观察的路径关系。
- `test_cases`：从探索中沉淀的可复用测试资产，不等同于复跑脚本。
- `issues`：缺陷、疑似缺陷、阻塞和工具阻塞。
- `risks`：风险、待确认和探索债务。
- `test_data`：AI 创建或使用的可追踪测试数据。
- `evidence`：证据索引，路径相对于运行根目录。
- `knowledge`：事实、假设、基线和确认规则。

顶层机器结构见 Skill 自带的 `assets/run-data.schema.json`，完整可执行约束见 `scripts/validate_run_data.py`。

## 规范化嵌套对象

`run.executor` 使用固定 ASCII 键，至少包含：

```json
{
  "protocol": "official-playwright-mcp",
  "version": "0.0.79",
  "browser_channel": "chrome",
  "session_mode": "managed-isolated-headed",
  "model_vision_capability": "available",
  "capability_state": "READY_DOM_VISUAL"
}
```

不要改写成 `executor_protocol`、`executor_version` 等展示层列名；固定生成器会自行映射中文列。

显式时间预算使用 `run.budget_control`：

```json
{
  "mode": "time",
  "started_at": "2026-08-15T16:42:00+08:00",
  "closeout_at": "2026-08-15T16:51:00+08:00",
  "deadline_at": "2026-08-15T16:54:00+08:00",
  "last_checked_at": "2026-08-15T16:51:00+08:00",
  "status": "closing",
  "overrun_ms": 0
}
```

`started_at <= closeout_at <= deadline_at`。`status` 只使用 `active`、`closing`、`met`、`overrun` 或 `not_applicable`。批次、范围或自适应预算仍保留同一对象；没有明确时间边界时可将 `closeout_at`、`deadline_at` 留空，并使用对应 `mode`。

`run.timing` 必须保留 `executor_gate`、`entry`、`b00`、`b01_quick_map`、`first_business_interaction`、`b01_navigation_ledger`、`business_batches`、`waiting_user`、`artifact_generation`、`artifact_validation` 和 `total`。每个阶段固定包含：

```json
{
  "started_at": "",
  "ended_at": "",
  "duration_ms": 0,
  "status": "not_started"
}
```

`total.started_at` 在当前请求的第一项实际工作前记录，不晚于 `executor_gate.started_at`；完成收口时，`total.ended_at` 不早于 `artifact_validation.ended_at`。未发生阶段保留上述空时间和零耗时，不得删除键或用缺失字段掩盖。

## 更新纪律

- 页面类型判定并进入 B00/B01 后立即调用 `init_run_data.py` 创建最小规范事实源；入口失败时不创建空数据。
- 每个批次边界、动态路径插入/退出、导航游标变化、临时等待和重要阻塞后更新 JSON。
- 不得在收口阶段首次拼装完整事实源；收口只补齐最后状态、阶段时间、覆盖审计和结论，然后调用固定生成器。
- 使用稳定 ASCII `snake_case` 键；中文只用于值和展示层列名。
- 数字、布尔值和数组保持原始类型，不预先拼接成展示字符串。
- 所有资产编号在各自集合内唯一。
- 证据路径必须相对运行根目录，禁止绝对路径和 `..` 跳转。
- 不保存密码、验证码、Cookie、Authorization、token、secret 或 OTP；目标 URL 也不得内嵌凭据或敏感查询参数。校验器拒绝敏感字段名、认证头、Cookie、JWT 和带标签的高置信凭据值，但无法可靠识别所有无标签任意秘密，因此浏览器探索阶段仍必须阻止凭据进入事实源。
- 新证据推翻旧认知时更新状态与影响资产，不删除历史记录。
- 生成器可以重复运行并覆盖派生文件，但不得修改输入 JSON、截图或其他证据文件。

## 生成生命周期与降级

- `preflight_artifacts.py` 一次检查 DOCX、XLSX、LibreOffice、表格和图片能力；不创建产物。
- 完整模式先在 `.rtw-artifacts-*` 暂存目录生成，结构校验通过后再事务性发布；普通异常必须恢复旧文件。
- `_artifact-build.json` 记录数据指纹、每个正式文件的大小与 SHA-256、请求产物、生成/跳过、结构校验、视觉状态、耗时和清理结果。
- 同一数据指纹和请求范围没有变化，且每个正式文件的大小与 SHA-256 仍匹配时返回 `unchanged`，不重复生成。
- 最终发布后使用 `check_artifact_consistency.py` 核对最新事实源指纹、派生断点关键字段以及 DOCX、XLSX、运行数据和断点文件的大小与 SHA-256。
- 单项能力缺失时部分交付；旧文件可以保留，但标记 `preserved_previous`，不得冒充当前结果。
- LibreOffice 缺失时直接使用结构检查，不尝试失败渲染；视觉结果由 `record_artifact_validation.py` 单独记录，并绑定被检查 DOCX 的 SHA-256 与渲染证据路径。
- 只清理当前运行根目录下含自有 marker 且超过 24 小时的暂存目录；不得删除截图、用户文件、无 marker 或其他运行目录。

## 展示映射

固定生成器将 ASCII 字段映射为 `output-assets.md` 规定的中文报告结构和 10 个 Sheet。固定生成器不包含浏览器点击、行业规则或探索调度逻辑。探索策略、页面动作和结论判断必须在浏览器探索阶段形成；生成器只能展示已有事实，不补测、不推断、不编造。

DOCX 顺序固定为：

```text
运行定位与一句话结论
已回答问题
未回答问题及影响
关键发现：事实 -> 判断 -> 依据 -> 影响 -> 建议
建议动作
批次摘要
覆盖审计
结论边界
```

XLSX 固定保留：

```text
01_批次与运行状态
02_功能菜单清单
03_页面字段按钮清单
04_执行路径清单
05_测试用例清单
06_缺陷疑似问题清单
07_风险与待确认清单
08_测试数据台账
09_截图证据索引
10_认知资产清单
```

没有对应记录时保留表头，不制造占位业务数据。
