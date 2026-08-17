from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "plugins/reverse-test-workbench/skills/reverse-test-workbench/SKILL.md"
EXPLORATION = SKILL.parent / "references/exploration-design.md"
OUTPUTS = SKILL.parent / "references/output-assets.md"
BROWSER = SKILL.parent / "references/browser-execution.md"
RUN_DATA_CONTRACT = SKILL.parent / "references/run-data-contract.md"
PREFLIGHT_CASES = ROOT / "evals/reverse-test-workbench/preflight-tempo-timing-cases.md"


def require(text: str, fragment: str, source: Path) -> None:
    if fragment not in text:
        raise AssertionError(f"missing {fragment!r} in {source}")


skill = SKILL.read_text(encoding="utf-8")
exploration = EXPLORATION.read_text(encoding="utf-8")
outputs = OUTPUTS.read_text(encoding="utf-8")
browser = BROWSER.read_text(encoding="utf-8")
run_data_contract = RUN_DATA_CONTRACT.read_text(encoding="utf-8")
preflight_cases = PREFLIGHT_CASES.read_text(encoding="utf-8")

for fragment in (
    "## 运行定位与结论等级",
    "执行器/Plugin 验证",
    "可以与一个证据阶段组合",
    "计划批次全部进入终态只触发收口候选",
    "已识别：看见入口或功能线索",
    "初步探索：识别核心对象和主要能力",
    "有效探索：围绕明确未知形成",
    "路径闭环：起点、关键动作/状态",
    "批次结束前执行信息增量门禁",
    "价值恢复批次",
    "本轮回答了什么、没有回答什么",
):
    require(skill, fragment, SKILL)

for fragment in (
    "## 报告价值内核",
    "结论先于过程",
    "已回答问题",
    "未回答问题",
    "观察事实 -> 测试判断 -> 依据 -> 影响 -> 建议动作",
    "没有确认缺陷不等于系统正常",
    "B01 快速地图",
    "B01-N 完整导航台账",
    "快速地图完成后",
):
    require(skill, fragment, SKILL)

for fragment in (
    "WAITING_USER",
    "临时等待",
    "正式暂停",
    "首次可恢复输入阻塞",
    "不生成 DOCX/XLSX",
):
    require(skill, fragment, SKILL)

for fragment in (
    "## 页面处置深度与信息增量门禁",
    "## 页面问题选择与最小证据链",
    "## 低信息增量调度",
    "继续当前页面",
    "切换代表样本",
    "插入可信关联路径",
    "价值恢复批次只用于",
    "不得递归生成新的价值恢复批次",
    "信息平台期",
    "先形成轻量页面模型",
    "一次只选择一个当前主问题",
    "最小证据链",
    "不要为每个页面预制相同异常输入集合",
    "对象：当前管理的实体及其关键标识是什么",
    "以下内容单独出现时通常只属于低信息增量",
    "一次普通查询",
    "预算允许时是否执行了价值恢复",
):
    require(exploration, fragment, EXPLORATION)

for fragment in (
    '"run_positioning"',
    '["执行器/Plugin验证", "初始侦察"]',
    '"information_gain_state"',
    '"low_information_decision"',
    '"active_value_recovery"',
    "页面处置深度和批次价值层级",
    "结论摘要放在批次过程之前",
    "导航清单、字段按钮清单和截图索引属于基础资产",
    "结论用途",
    "影响/意义",
    "建议动作",
    "运行定位, 范围边界",
    "价值层级, 信息增量摘要",
    "初步探索、有效探索、路径闭环",
    "本轮回答了什么、没有回答什么",
    "价值恢复批次没有递归扩张",
):
    require(outputs, fragment, OUTPUTS)

for fragment in (
    "## 两阶段导航建图",
    "## 临时等待与正式暂停",
    "## 证据分级与最小留证",
    "批量结构提取",
    "交互兜底",
    "不得为每个菜单组分别保存快照",
    "B01-N",
    "只读 DOM",
    "同一页面同一状态不重复截图",
    "不得在首次可恢复输入阻塞时生成",
):
    require(browser, fragment, BROWSER)

for fragment in (
    "artifact_preflight",
    "LibreOffice",
    "visual_render_unavailable",
    "预检失败只限制对应产物",
    "不阻塞 Playwright 浏览器探索",
    "空命令",
    "无效目录/进程检查",
    "只在入口完成、B01 目录形成、批次边界",
    "执行器门禁、入口、B00、B01 快速地图",
    "B01-N 完整导航台账",
    "产物生成、产物校验和总耗时",
):
    require(preflight_cases, fragment, PREFLIGHT_CASES)

for fragment in (
    "## 产物能力预检",
    "artifact_preflight",
    "docx_generation",
    "xlsx_generation",
    "libreoffice",
    "visual_render_unavailable",
    "结构检查",
    "预检失败不得阻塞浏览器探索",
    "同一运行只执行一次",
    "## 阶段耗时与播报",
    "入口完成",
    "B01 目录形成",
    "批次边界",
    "风险/等待",
    "正式暂停或收口",
    "执行器门禁",
    "首次业务交互",
    "产物生成",
    "产物校验",
    "总耗时",
    '"timing"',
    '"executor_gate"',
    '"entry"',
    '"first_business_interaction"',
    '"artifact_generation"',
    '"artifact_validation"',
    '"total"',
    "阶段耗时摘要",
    "本批次耗时",
    "任务级总计时",
    "从收到当前测试请求后的第一项实际工作开始",
    "预算截止点",
    "预留收口时间",
    "不得在收口阶段首次拼装完整 `run-data.json`",
    "init_run_data.py",
    "短预算默认预留至少 3 分钟或总预算 30% 中较大者",
    "首次完整生成失败时只允许一次集中修正",
    "仍失败则立即部分交付",
    "check_artifact_consistency.py",
    "成功发布派生产物后禁止再修改 `run-data.json`",
    "若最终事实必须变化，只允许更新后重建一次并重新检查指纹",
):
    require(outputs, fragment, OUTPUTS)

for fragment in (
    "预算到点自动停止新增探索",
    "不得等待用户或外部提醒才停止",
    "总耗时必须覆盖执行器门禁前的必要 Skill 定位",
    "收口阈值 `closeout_at`",
    "硬截止 `deadline_at`",
    "每次启动新业务批次、动态插入路径或新的页面动作前",
    "进入 `closeout_at` 后禁止新的点击、导航、输入和范围扩张",
    "使用固定 `init_run_data.py` 建立规范骨架",
):
    require(skill, fragment, SKILL)

for fragment in (
    "只做一次产物预检",
    "预检失败不得阻塞浏览器探索",
    "禁止空命令",
    "禁止无效目录/进程检查",
    "只在入口完成、B01 目录形成、批次边界、风险/等待、正式暂停或收口时播报",
    "不要为单次点击、截图、快照或目录检查单独播报",
    "evidence/run-data.json",
    "--state-only",
    "不独立维护 `_run-state.json`",
):
    require(browser, fragment, BROWSER)

for fragment in (
    "evidence/run-data.json",
    "单一事实源",
    "build_artifacts.py",
    "validate_run_data.py",
    "--state-only",
    "禁止临时创建新的报告生成器",
    "不得修改输入 JSON",
    "preflight_artifacts.py",
    "record_artifact_validation.py",
    "_artifact-build.json",
    "preserved_previous",
    "unchanged",
    "结构校验通过后",
    "事务性发布",
    "自有 marker",
):
    require(outputs, fragment, OUTPUTS)

for fragment in (
    "## 单一事实源",
    "run-data.schema.json",
    "bundled Python",
    "稳定 ASCII `snake_case` 键",
    "密码、验证码、Cookie、Authorization、token、secret 或 OTP",
    "固定生成器不包含浏览器",
    "preflight_artifacts.py",
    "record_artifact_validation.py",
    "_artifact-build.json",
    "同一数据指纹",
    "部分交付",
    "事务性发布",
    "24 小时",
):
    require(run_data_contract, fragment, RUN_DATA_CONTRACT)

if "当前计划中的批次均已进入终态。" in skill:
    raise AssertionError("old unconditional stop condition is still present")

for source, text in (
    (SKILL, skill),
    (EXPLORATION, exploration),
    (OUTPUTS, outputs),
    (BROWSER, browser),
):
    for obsolete in ("有效功能交互", "路径验证数"):
        if obsolete in text:
            raise AssertionError(f"obsolete term {obsolete!r} remains in {source}")

print("value foundation validation passed")
