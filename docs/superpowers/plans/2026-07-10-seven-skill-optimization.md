# Seven Test Skills In-Place Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 原位优化七个测试 Skill，同时保持文件名、文件数量、独立职责、完整版/精炼版定位和作者中文表达习惯不变。

**Architecture:** 每个现有 Markdown 文件仍是独立、完整、可复制使用的 Skill。修改只发生在文件内部：增加可发现元数据、铁律、进度清单和阻塞门禁，合并内部重复规则，并通过跨文件验证统一测试用例十列顺序；不创建替代 Skill、不拆出正文资源。

**Tech Stack:** Markdown、YAML frontmatter、PowerShell、Git、Codex 多代理行为回归测试。

## Global Constraints

- 七个原 Skill 文件一个不少，文件名保持不变。
- 不合并 Skill，不删除完整版或精炼版，不将正文拆到 `references/`、`scripts/` 或其他 Skill。
- 保留中文测试工程师语气、编号层级、表格优先、P0/P1/P2、待确认、合理假设、置信度等既有表达。
- 优先移动、合并和删重；只有冲突、歧义或门禁缺失时才改写句子。
- 测试用例十列统一为：用例 ID、所属模块、用例标题、验证功能点、前置条件、测试步骤、预期结果、优先级、执行结果（通过 / 不通过 / 未执行）、备注。
- 用户明确要求文件时才生成 Excel、Word 或 WPS；否则先交付聊天内容。
- 正式服写库、发奖、扣资产、修改配置、越权验证或影响真实用户的操作必须先获得明确授权。
- 不推送、不创建 PR、不修改 GitHub 远端。

---

### Task 1: 建立修改前基线

**Files:**
- Inspect: `单接口用例生成与对齐_完整版Skill_v0.3.md`
- Inspect: `多接口链路测试用例生成skill_v0.6_精炼执行版.md`
- Inspect: `根据需求-用例生成_skill.md`
- Inspect: `正式服验证-用例生成 Skill.md`
- Inspect: `测试用例-审计与评_Skill_V1.md`
- Inspect: `测试视角-需求澄清 Skill.md`
- Inspect: `精炼版_单接口用例与对齐skill_v0.3.md`

**Interfaces:**
- Consumes: Git commit `18fca376066baaae760ac0a3323031e8daa38900` 中的七个原始文件。
- Produces: 文件名、行数、标题、核心术语、表格数量和行为场景的修改前基线。

- [ ] **Step 1: 记录静态基线**

Run:

```powershell
$files = Get-ChildItem -File -Filter '*.md' | Where-Object Name -ne 'README.md'
$files | ForEach-Object {
  $content = Get-Content -LiteralPath $_.FullName -Encoding UTF8
  [pscustomobject]@{
    Name = $_.Name
    Lines = $content.Count
    Tables = @($content | Where-Object { $_ -match '^\|' }).Count
    HasFrontmatter = $content[0] -eq '---'
    Checkboxes = @($content | Where-Object { $_ -match '^\s*- \[[ xX]\]' }).Count
  }
}
```

Expected: 恰好 7 个 Skill；frontmatter 和复选清单均为 0；文件名与设计文档一致。

- [ ] **Step 2: 执行修改前行为基线**

分别用原始 Skill 运行以下场景并保留输出用于前后对照：

```text
1. 单接口：用户只说“帮我测获取余额接口”，检查是否先澄清而非写正式用例。
2. 多接口：用户只给接口列表，检查是否避免接口全排列和伪正式链路。
3. 需求工作台：用户只给一句口头需求，检查是否停在 L0 澄清。
4. 正式服：用户要求在线上批量并发抽奖但未提供授权，检查是否明确阻断。
5. 用例审计：用户只给用例、不提供需求，检查是否降级审计。
6. 需求澄清：用户要求“先澄清，不写用例”，检查是否严格保持边界。
7. 单接口精炼版：与完整版使用相同 L1 输入，检查核心结论是否一致且输出更短。
```

Expected: 记录实际偏差，不在本步骤修改文件。

---

### Task 2: 优化单接口完整版

**Files:**
- Modify: `单接口用例生成与对齐_完整版Skill_v0.3.md`

**Interfaces:**
- Consumes: Task 1 的单接口基线和统一十列规范。
- Produces: 保留完整解释深度、但执行入口清晰且内部重复减少的单接口完整版。

- [ ] **Step 1: 增加可发现元数据**

在原一级标题前增加：

```yaml
---
name: single-api-test-full
description: "Use when 用户提供单个接口资料并要求完整接口测试用例、接口契约审查、参数规则分析、鉴权权限校验、异常场景设计，或提到‘单接口测试’‘接口用例’‘接口契约审查’‘按完整版生成’。"
---
```

- [ ] **Step 2: 增加铁律和进度清单**

在“Skill 定位”之后加入：

```markdown
## 最高优先级铁律

**资料未明确的业务规则、错误码、枚举、权限边界和状态流转，不得写成确定事实或确定预期。**

## 执行进度

- [ ] 1. 识别是否为单接口任务 ⚠️ REQUIRED
- [ ] 2. 判断资料等级并输出门禁结论 ⚠️ REQUIRED
- [ ] 3. 如存在阻塞型缺口，停止生成正式用例 ⛔ BLOCKING
- [ ] 4. 完成八维分析和接口类型专项
- [ ] 5. 区分事实、合理假设、待确认与禁止内容
- [ ] 6. 生成聊天速览；用户明确要求文件时再生成表格文件
- [ ] 7. 完成覆盖、可执行性和字段顺序自检 ⚠️ REQUIRED
```

- [ ] **Step 3: 统一十列顺序和文件生成条件**

将 `06_测试用例` 的第 4 列调整为“验证功能点”，其余字段依次后移；将“默认必须双产出”改为“聊天版必需，用户明确要求文件时生成表格文件”。保留原有 Sheet、命名、黑体、编号和风险规则。

- [ ] **Step 4: 合并内部重复内容**

只合并以下重复主题：错误码缺失固定表达、双产出说明、最终输出要求、最终自检与禁止事项。保留每个主题最完整的一处，其他位置改成一句明确引用，不删除八维分析、接口类型、Sheet 字段、资料等级或业务风险。

- [ ] **Step 5: 运行单文件验证**

Run:

```powershell
$p = '单接口用例生成与对齐_完整版Skill_v0.3.md'
rg -n '^---$|^name:|^description:|最高优先级铁律|执行进度|BLOCKING|验证功能点|最终自检' $p
rg -n '用例 ID.*所属模块.*用例标题.*验证功能点.*前置条件.*测试步骤.*预期结果.*优先级.*执行结果.*备注' $p
```

Expected: frontmatter、铁律、清单、阻塞门禁和统一十列均存在。

- [ ] **Step 6: Commit**

```bash
git add "单接口用例生成与对齐_完整版Skill_v0.3.md"
git commit -m "refactor: optimize full single-api skill"
```

---

### Task 3: 优化单接口精炼版

**Files:**
- Modify: `精炼版_单接口用例与对齐skill_v0.3.md`

**Interfaces:**
- Consumes: Task 2 的核心口径。
- Produces: 结论与完整版一致、指令更短、更线性的精炼版。

- [ ] **Step 1: 增加 frontmatter**

```yaml
---
name: single-api-test-concise
description: "Use when 用户需要用精炼、低上下文负担的方式，根据单个接口资料生成接口测试点或测试用例，或提到‘单接口测试’‘精炼版接口用例’‘快速生成接口用例’。"
---
```

- [ ] **Step 2: 增加短版铁律与执行清单**

```markdown
## 最高优先级铁律

**不编造资料未明确的规则；阻塞项未确认时，不生成正式用例。**

## 执行进度

- [ ] 1. 确认是单接口并判断资料等级 ⚠️ REQUIRED
- [ ] 2. 输出门禁；阻塞项存在时停止正式用例 ⛔ BLOCKING
- [ ] 3. 完成八维分析和接口类型专项
- [ ] 4. 标注依据、置信度和确认状态
- [ ] 5. 输出聊天结果；用户明确要求时生成表格文件
- [ ] 6. 完成最终自检 ⚠️ REQUIRED
```

- [ ] **Step 3: 统一字段和输出条件**

按全局十列顺序调整字段表；保留短句、现有表格和固定异常表达，不把完整版说明复制进来。

- [ ] **Step 4: 验证完整版/精炼版差异**

Run:

```powershell
$full = (Get-Content '单接口用例生成与对齐_完整版Skill_v0.3.md').Count
$short = (Get-Content '精炼版_单接口用例与对齐skill_v0.3.md').Count
if ($short -ge $full) { throw '精炼版不得长于完整版' }
rg -n '资料等级|BLOCKING|八维|依据|置信度|验证功能点|最终自检' '精炼版_单接口用例与对齐skill_v0.3.md'
```

Expected: 精炼版明显短于完整版，核心门禁与输出字段一致。

- [ ] **Step 5: Commit**

```bash
git add "精炼版_单接口用例与对齐skill_v0.3.md"
git commit -m "refactor: optimize concise single-api skill"
```

---

### Task 4: 优化多接口链路精炼版

**Files:**
- Modify: `多接口链路测试用例生成skill_v0.6_精炼执行版.md`

**Interfaces:**
- Consumes: 统一十列规范和 Task 1 的低资料链路基线。
- Produces: 保留 M1–M7、链路准入和可观测性规则的精炼链路 Skill。

- [ ] **Step 1: 增加 frontmatter**

```yaml
---
name: multi-api-flow-test
description: "Use when 用户提供多个接口、业务流程、调用顺序、增量接口变更或源码，并要求链路测试、接口依赖分析、回归范围、灰度验证或多接口联合用例。"
---
```

- [ ] **Step 2: 增加铁律和执行清单**

铁律明确“没有业务对象、字段依赖、状态流转或真实调用依据时，不得把接口名称相似当作正式链路”。清单覆盖模式判断、资产盘点、依赖分析、链路置信度、可观测性、数据准备清理、用例输出和自检；接口全排列标记为 `⛔ BLOCKING`。

- [ ] **Step 3: 压缩重复并统一字段**

保留 M1–M7、正式链路准入、确定/推断/候选/断点链路、源码增强、增量影响和最终自检。合并重复的待确认、表格样式、配色和输出说明；用例表改为全局十列顺序；文件生成改为显式需求触发。

- [ ] **Step 4: 验证核心内容未丢失**

Run:

```powershell
$p = '多接口链路测试用例生成skill_v0.6_精炼执行版.md'
rg -n 'M1|M2|M3|M4|M5|M6|M7|正式链路用例准入线|确定链路|推断链路|候选链路|断点链路|可观测|数据准备|清理|接口全排列|BLOCKING' $p
```

Expected: 所有模式、链路类型和关键门禁仍存在。

- [ ] **Step 5: Commit**

```bash
git add "多接口链路测试用例生成skill_v0.6_精炼执行版.md"
git commit -m "refactor: optimize multi-api flow skill"
```

---

### Task 5: 优化需求用例工作台

**Files:**
- Modify: `根据需求-用例生成_skill.md`

**Interfaces:**
- Consumes: 统一十列规范和 L0 基线。
- Produces: 保留多模式工作台定位、但默认不会机械执行全量流程的 Skill。

- [ ] **Step 1: 增加 frontmatter**

```yaml
---
name: requirement-test-workbench
description: "Use when 用户提供 PRD、用户故事、口头需求、需求变更或接口需求，并要求需求评审、测试设计、测试点、测试用例、精简执行集、接口专项、回归集或完整分析。"
---
```

- [ ] **Step 2: 增加模式选择铁律和清单**

铁律保持“先判断输入质量，再选择输出模式；L0 未确认不得生成正式用例”。清单先识别输入等级和用户口令，再只执行命中的模式；“全量模式”只在用户明确说完整版、完整分析或按六个 Skill 跑时启用。

- [ ] **Step 3: 统一十列并保护原触发习惯**

保留“按六个 Skill 跑一遍”“这是一句话需求”“先不要写用例”“提测试点”“接口专项”等原口令；十列使用全局顺序；文件输出遵循全局条件。

- [ ] **Step 4: 验证模式边界**

Run:

```powershell
$p = '根据需求-用例生成_skill.md'
rg -n 'L0|微需求澄清|需求评审|测试设计|用例生成|精简执行集|接口专项|回归模式|全量模式|按六个 Skill|BLOCKING' $p
```

Expected: 原有模式和口令全部保留，L0 阻塞规则更醒目。

- [ ] **Step 5: Commit**

```bash
git add "根据需求-用例生成_skill.md"
git commit -m "refactor: optimize requirement test workbench"
```

---

### Task 6: 优化正式服验证 Skill

**Files:**
- Modify: `正式服验证-用例生成 Skill.md`

**Interfaces:**
- Consumes: Task 1 的未授权生产写操作基线。
- Produces: 未明确授权时默认只读，授权后仍按最小风险执行的正式服验证 Skill。

- [ ] **Step 1: 增加 frontmatter**

```yaml
---
name: production-verification-test
description: "Use when 用户要求正式服验证、线上验证、生产环境冒烟、上线后验证、灰度验证、线上回归，或强调正式服不能大量造数和执行破坏性测试。"
---
```

- [ ] **Step 2: 增加生产安全铁律和阻塞清单**

加入：

```markdown
## 最高优先级铁律

**未获得正式服写入授权、测试账号、执行时间窗和风险联系人前，只能输出只读验证方案。**

⛔ BLOCKING：写库、发奖、扣资产、修改配置、越权验证、并发请求或任何可能影响真实用户的操作，必须先得到明确授权。
```

清单覆盖目标、范围、授权、账号、数据、监控、最小执行、收尾和归档。

- [ ] **Step 3: 收紧高风险文字并统一十列**

将“受控单例越权验证”“轻量连点”“单次非法参数请求”等场景明确限定为已授权、指定账号、指定时间窗；十列使用全局顺序；保留 L0–L3、不建议正式服执行、执行前后清单和结果判断。

- [ ] **Step 4: 验证授权门禁**

Run:

```powershell
$p = '正式服验证-用例生成 Skill.md'
rg -n '最高优先级铁律|BLOCKING|明确授权|只读验证|L0|L1|L2|L3|不建议正式服执行|执行前检查|执行后收尾' $p
```

Expected: 未授权默认只读，高风险操作均有明确授权条件。

- [ ] **Step 5: Commit**

```bash
git add "正式服验证-用例生成 Skill.md"
git commit -m "refactor: strengthen production verification gates"
```

---

### Task 7: 优化测试用例审计 Skill

**Files:**
- Modify: `测试用例-审计与评_Skill_V1.md`

**Interfaces:**
- Consumes: Task 1 的只有用例、没有需求场景。
- Produces: 审计级别清晰、默认不重写、问题可追踪的用例质量审计 Skill。

- [ ] **Step 1: 增加 frontmatter**

```yaml
---
name: test-case-quality-audit
description: "Use when 用户要求评审、审计、检查或评价测试用例，判断用例能否执行、是否漏测、是否冗余、是否符合需求，或要求根据评审结果给出修订建议。"
---
```

- [ ] **Step 2: 增加证据铁律和审计清单**

铁律使用原文核心：“没有需求地基时，不能强行判断覆盖率、漏测、需求冲突或预期正确性。”清单覆盖输入完整性、审计级别、版本口径、结构、覆盖、方法、风险、冗余、结论；“用户未明确要求修订时不得重写整批用例”标记 `⛔ BLOCKING`。

- [ ] **Step 3: 调整文件输出条件**

聊天版默认交付；用户明确要求 Excel/WPS、归档或评审流转文件时生成表格文件。保留 8 个 Sheet 的建议结构，不将其设为每次都必须生成。

- [ ] **Step 4: 验证降级审计边界**

Run:

```powershell
$p = '测试用例-审计与评_Skill_V1.md'
rg -n '完整审计|标准审计|降级审计|不进入用例评审|不能审什么|漏测.*依据|冗余判断.*保守|默认不重写|BLOCKING|门禁结论' $p
```

Expected: 四种输入级别、证据约束和默认不重写均清晰存在。

- [ ] **Step 5: Commit**

```bash
git add "测试用例-审计与评_Skill_V1.md"
git commit -m "refactor: optimize test-case audit skill"
```

---

### Task 8: 优化需求澄清 Skill

**Files:**
- Modify: `测试视角-需求澄清 Skill.md`

**Interfaces:**
- Consumes: Task 1 的“只澄清、不写用例”场景。
- Produces: 一级标题、元数据、澄清清单和复审门禁完整的需求澄清 Skill。

- [ ] **Step 1: 增加 frontmatter 并修正一级标题**

```yaml
---
name: requirement-clarification-test
description: "Use when 用户提供 PRD、用户故事、原型、口头需求、需求变更或验收标准，并要求从测试视角澄清需求、判断能否开测、找出缺失规则，且暂时不要生成测试用例。"
---
```

将首行 `## 测试视角需求澄清 Skill（开测前需求补全分析）` 调整为同文案的一级标题，不改变标题文字。

- [ ] **Step 2: 增加边界铁律和清单**

铁律保持“只做需求澄清，不生成测试用例；P0 未确认时不得进入用例生成”。清单覆盖准入结论、当前理解、已明确内容、具体问题、本轮不纳入、产品回答复审和最终准入；P0 未确认标记 `⛔ BLOCKING`。

- [ ] **Step 3: 压缩重复模板但保留具体问法**

保留错误/正确问题对比，以及抽奖、导出、支付/订单/库存三类高价值模板。只合并通用核对维度与重复清单，不删除产品能够直接回答的具体问题。

- [ ] **Step 4: 验证只澄清边界**

Run:

```powershell
$p = '测试视角-需求澄清 Skill.md'
rg -n '^# 测试视角需求澄清|只做需求澄清|不生成测试用例|P0|BLOCKING|产品核对问题表|错误示例|正确示例|复审结论' $p
```

Expected: 一级标题、只澄清边界、P0 阻塞和具体提问模板全部存在。

- [ ] **Step 5: Commit**

```bash
git add "测试视角-需求澄清 Skill.md"
git commit -m "refactor: optimize requirement clarification skill"
```

---

### Task 9: 跨文件静态、风格和行为回归

**Files:**
- Verify: 七个原始 Skill 文件
- Verify: `docs/superpowers/specs/2026-07-10-seven-skill-optimization-design.md`

**Interfaces:**
- Consumes: Tasks 2–8 的七个优化文件。
- Produces: 文件不变、风格保持、规则一致和行为门禁有效的验证证据。

- [ ] **Step 1: 验证文件名和数量**

Run:

```powershell
$expected = @(
  '单接口用例生成与对齐_完整版Skill_v0.3.md',
  '多接口链路测试用例生成skill_v0.6_精炼执行版.md',
  '根据需求-用例生成_skill.md',
  '正式服验证-用例生成 Skill.md',
  '测试用例-审计与评_Skill_V1.md',
  '测试视角-需求澄清 Skill.md',
  '精炼版_单接口用例与对齐skill_v0.3.md'
)
$actual = @(Get-ChildItem -File -Filter '*.md' | Where-Object Name -ne 'README.md' | Select-Object -ExpandProperty Name)
if (Compare-Object ($expected | Sort-Object) ($actual | Sort-Object)) { throw 'Skill 文件名或数量发生变化' }
```

Expected: 无输出、退出码 0。

- [ ] **Step 2: 验证 frontmatter、清单和占位符**

Run:

```powershell
Get-ChildItem -File -Filter '*.md' | Where-Object Name -ne 'README.md' | ForEach-Object {
  $c = Get-Content -LiteralPath $_.FullName -Encoding UTF8
  if ($c[0] -ne '---' -or @($c | Where-Object { $_ -match '^name:' }).Count -ne 1 -or @($c | Where-Object { $_ -match '^description:' }).Count -ne 1) { throw "frontmatter 无效: $($_.Name)" }
  if (@($c | Where-Object { $_ -match '^\s*- \[ \]' }).Count -eq 0) { throw "缺少清单: $($_.Name)" }
}
$placeholderPattern = @('TO' + 'DO', 'FIX' + 'ME', 'T' + 'BD', 'x' + 'xx') -join '|'
rg -n $placeholderPattern --glob '*.md' .
```

Expected: 7 个文件均通过；占位符搜索无匹配。

- [ ] **Step 3: 验证表达风格和核心术语保留**

Run:

```powershell
$terms = 'P0','P1','P2','待确认','合理假设','测试用例','预期结果'
Get-ChildItem -File -Filter '*.md' | Where-Object Name -ne 'README.md' | ForEach-Object {
  $new = Get-Content -LiteralPath $_.FullName -Raw -Encoding UTF8
  $old = git show "18fca376:$($_.Name)"
  foreach ($term in $terms) {
    if ($old -match [regex]::Escape($term) -and $new -notmatch [regex]::Escape($term)) { throw "$($_.Name) 丢失核心术语 $term" }
  }
}
```

Expected: 所有原有核心术语继续存在；完整版行数大于精炼版。

- [ ] **Step 4: 重新执行七个行为场景**

使用 Task 1 的相同输入进行前后对照。验收条件：

```text
1. L0/L1 不生成正式用例。
2. 多接口低资料不做接口全排列。
3. 正式服未授权写操作被明确阻断。
4. 只有用例时执行降级审计，不硬判完整漏测。
5. 需求澄清 Skill 不生成用例。
6. 未要求文件时不擅自创建 Excel。
7. 完整版与精炼版核心结论一致，精炼版明显更短。
```

- [ ] **Step 5: 运行 Git 验证**

Run:

```bash
git diff 18fca376 --check
git status --short
git log --oneline --decorate -10
```

Expected: `diff --check` 退出码 0；只有计划内文件发生变化；没有未跟踪临时产物。

- [ ] **Step 6: 最终提交验证调整**

仅在回归验证发现并修复问题时执行：

```bash
git add -- '*.md'
git commit -m "test: close seven-skill regression gaps"
```

最终不执行 `git push`。
