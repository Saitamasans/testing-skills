# Execution State Transition Discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 `web-api-test-execution-evidence` 对跨页面核心业务链路的规划缺口，禁止将已确认的迁移动作连同整条用例压缩为 `execution.blocked`，并在正式执行前暴露和纠正同类覆盖问题。

**Architecture:** 只修改第八个 Skill 的中文单一事实源和契约测试，通过现有构建器生成标准安装包；不修改固定 Runner 1.1.0。新增的流程契约把 Web 用例建模为“起始状态—迁移动作—目标状态—终态断言”，目标状态未探测时进入独立、需审批的迁移探测，再重新生成正式 manifest。

**Tech Stack:** Markdown Skill 源、Python `unittest` 契约测试、`tooling/build_skills.py`、现有 Node/Python 验证命令。

## Global Constraints

- 不修改 `skill-sources/web-api-test-execution-evidence/scripts/testing-runner.mjs`、Runner 包或 Runner 协议。
- 不覆盖用户已有的百度执行产物。
- 只编辑第八个 Skill 中文源和对应测试；`skills/web-api-test-execution-evidence/**` 必须由构建器生成。
- 保留其他七个 Skill 的用户修改；不重置脏工作树。
- 迁移探测产物与正式运行目录隔离，不回填正式 Excel/HTML，不作为正式测试通过。
- 未经用户确认不得执行迁移动作；R2/R3、验证码、扫码、MFA 和不可逆动作不得自动迁移探测。
- 当前任务不创建提交，避免把工作树中无关修改带入提交。

---

### Task 1: Add failing state-transition and coverage contracts

**Files:**
- Modify: `tests/test_execution_skill_contracts.py`

**Interfaces:**
- Consumes: `ExecutionSkillContractsTest.text`, `.body`, `.generated_text` 和已生成 references。
- Produces: 针对状态图、动作守恒、迁移探测、E4 核心覆盖和报告措辞的可重复契约测试。

- [ ] **Step 1: Write the failing tests**

新增测试，要求源文件与生成包包含以下不可替代契约：

```python
def test_cross_state_web_cases_require_transition_discovery(self):
    required = [
        "起始状态 → 迁移动作 → 目标状态 → 终态业务断言",
        "transition_discovery_required",
        "状态迁移探测预览",
        "不回填正式 Excel/HTML",
        "重新生成 discovery/proposal hash",
        "重新经过第二次确认门禁",
    ]
    for document in [self.text, self.generated_text]:
        for phrase in required:
            self.assertIn(phrase, document)

def test_action_conservation_and_core_path_gate_are_required(self):
    required = [
        "动作守恒矩阵",
        "mapped",
        "禁止把包含已确认迁移动作的整条用例",
        "完整可执行核心路径数",
        "不能进入 E4",
        "普通的“确认执行”不得被解释为接受核心业务目标降级",
    ]
    for document in [self.text, self.generated_text]:
        for phrase in required:
            self.assertIn(phrase, document)

def test_partial_execution_cannot_claim_core_business_completion(self):
    required = [
        "部分执行",
        "核心流程未执行",
        "产物一致，只证明产物一致",
        "不证明核心业务目标已覆盖",
    ]
    for document in [self.text, self.generated_text]:
        for phrase in required:
            self.assertIn(phrase, document)
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest tests.test_execution_skill_contracts -v
```

Expected: 新增测试以缺少 `transition_discovery_required`、动作守恒或核心覆盖措辞失败；既有测试保持通过。

### Task 2: Implement the state-transition planning contract

**Files:**
- Modify: `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md`
- Generated: `skills/web-api-test-execution-evidence/SKILL.md`
- Generated: `skills/web-api-test-execution-evidence/references/input-and-readiness.md`
- Generated: `skills/web-api-test-execution-evidence/references/locators-assertions-and-rules.md`
- Generated: `skills/web-api-test-execution-evidence/references/runner-commands.md`

**Interfaces:**
- Consumes: 测试用例步骤、初始 `discover-web`、定位器唯一性、风险等级和两次既有确认门禁。
- Produces: 状态图、动作守恒矩阵、独立迁移探测预览、目标状态只读 discovery、重新锁定的正式 manifest。

- [ ] **Step 1: Add the minimal workflow needed by the failing contracts**

在正文中新增核心规则，并把详细模板放入内嵌 reference 区块：

```text
逐用例建模：起始状态 → 迁移动作 → 目标状态 → 终态业务断言。
每个原始动作必须标为 mapped / transition_discovery_required / blocked / manual_required。
目标状态未探测且迁移动作属于 R0/R1 时，先输出独立的状态迁移探测预览并等待确认。
迁移探测只为到达目标状态；输出隔离，不回填正式 Excel/HTML，不产生正式用例结论。
到达后执行只读 discover-web；候选不唯一或反自动化时停止。
目标状态确认后重新生成 discovery/proposal hash、manifest hash、动作和断言预览，再经过第二次确认。
```

- [ ] **Step 2: Add the core-path E4 gate and reporting contract**

明确：

```text
完整执行请求下，只要任一核心业务目标没有至少一条“迁移动作 + 目标状态 + 终态断言”的完整可执行路径，就不能进入 E4。
普通“确认执行”不等于接受降级；降级确认必须逐项列出未覆盖目标及影响。
只执行首页、输入或准备类用例时，只能报告“部分执行/准备度验证/核心流程未执行”。
Excel/HTML/JSON/录屏一致，只证明产物一致，不证明核心业务目标已覆盖。
```

- [ ] **Step 3: Generate the standard package**

Run:

```powershell
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tooling/build_skills.py
```

Expected: `生成完成`，第八个 Skill 的正文和三个相关 reference 由中文源生成。

- [ ] **Step 4: Run the focused contracts and verify GREEN**

Run:

```powershell
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest tests.test_execution_skill_contracts -v
```

Expected: 全部通过。

### Task 3: Add similar-scenario prevention contracts

**Files:**
- Modify: `tests/test_execution_skill_contracts.py`
- Modify: `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md`

**Interfaces:**
- Consumes: Task 2 的状态迁移分类。
- Produces: 搜索、登录、SPA、弹窗、新标签页、下载及高风险场景的审查清单。

- [ ] **Step 1: Write a failing prevention test**

测试要求 Skill 明确覆盖 `搜索结果页`、`登录后工作台`、`SPA 弹窗或异步结果区域`、`新标签页`、`下载或确认页`，并明确 R2/R3 和人工验证不进入自动迁移探测、Enter 不得用点击替代。

- [ ] **Step 2: Run the focused test and verify RED**

Expected: 缺少至少一个相似场景或安全边界时失败。

- [ ] **Step 3: Add the prevention audit checklist**

在定位器/断言 reference 中加入动作缺失、终态缺失、未探测状态、阻塞传播、替代动作、部分执行、风险和报告措辞八项审查，并要求第一次确认门禁前纠正。

- [ ] **Step 4: Rebuild and verify GREEN**

Expected: 专项契约全部通过。

### Task 4: Validate, install, and compare all three copies

**Files:**
- Source: `skill-sources/web-api-test-execution-evidence/Web-API测试用例自动执行与证据回填_Skill.md`
- Generated: `skills/web-api-test-execution-evidence/**`
- Install target: `C:/Users/Admin/.codex/skills/web-api-test-execution-evidence/**`

**Interfaces:**
- Consumes: 构建完成的第八个 Skill 包。
- Produces: 专项测试、全量 Python/Node 测试、构建漂移检查、安装副本哈希与关键契约核验结果。

- [ ] **Step 1: Run focused and full Python tests**

```powershell
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest tests.test_execution_skill_contracts -v
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -m unittest discover -s tests -p 'test_*.py' -v
```

- [ ] **Step 2: Run Node tests and Runner type/build checks without editing Runner**

```powershell
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' test
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' test:runner
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\fallback\pnpm.cmd' build:runner
```

- [ ] **Step 3: Validate generated drift and Skill structure**

```powershell
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' tooling/build_skills.py --check
& 'C:\Users\Admin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'C:\Users\Admin\.codex\skills\.system\skill-creator\scripts\quick_validate.py' skills/web-api-test-execution-evidence
```

- [ ] **Step 4: Install only the generated eighth Skill**

先比较目标目录和生成包，再以生成包覆盖第八个 Skill 安装目录；不调用其他 Skill 安装器，不修改 Runner 缓存。

- [ ] **Step 5: Verify source, generated package, and installed copy**

计算生成包与安装副本中每个文件的 SHA-256，并验证关键契约在源、生成 `SKILL.md`/references 和安装副本中均存在。若哈希或契约不一致，停止并报告，不宣称完成。

- [ ] **Step 6: Review the final diff**

确认实际源改动仅包含设计范围，生成文件只反映第八个 Skill 及既有构建器的确定性输出；不得覆盖其他七个 Skill 的用户修改。
