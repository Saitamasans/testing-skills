# Web/API 测试用例自动执行与证据回填 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 `web-api-test-execution-evidence` Skill 和版本化的 `@saitamasans/testing-runner`，把正式测试用例安全地编译为可确认、可锁定、可执行、可追溯并可回填 Excel/HTML 的 Web/API 自动化执行闭环。

**Architecture:** Skill 负责准备度判断、输入映射、页面/API 上下文理解、执行清单编译与用户确认；Runner 只解释经过 JSON Schema 校验和 SHA-256 锁定的白名单动作，不执行任意脚本、Shell 或 SQL。Runner 以 Playwright 统一执行 Web 与 API，以可选只读数据库适配器补充持久化断言，并从同一 `run-result.json` 投影现有十列 Excel 和离线 HTML，业务结果、运行状态和原始证据严格分离。

**Tech Stack:** Node.js 20+、TypeScript 5、Playwright Test、AJV、ExcelJS、Commander、Node test runner、Python unittest、JSON Schema Draft 2020-12、JSONL、SHA-256。

## Global Constraints

- 新增的是独立第八个 Skill；现有七个 Skill 的名称、正文含义、互斥路由和“五个生成正式用例、两个不生成”的计数不变。
- Skill package 固定为 `web-api-test-execution-evidence`；Runner package 固定为 `@saitamasans/testing-runner`，首个协议和 Runner 版本均为 `1.0.0`。
- 第一版正式输入仅支持标准 `report.json`、标准十列 `.xlsx`、非标准 `.xlsx`；HTML、CSV、Markdown 和纯文本不能作为正式执行输入。
- 非标准 Excel 的字段映射每次都必须展示预览并由用户确认，任何置信度都不能触发静默转换。
- 执行顺序固定为 E0–E4 准备度门禁、清单预览、用户确认、SHA-256 锁定、Runner 执行；E4 之前不得执行正式业务动作。
- 不推断正式服或测试服；只按实际目标、账号权限、数据敏感性、副作用和可恢复性评定 R0–R3。
- 凭据只允许以环境变量、CI Secret 或本次会话临时引用传入；密码、Token、Cookie、数据库连接串不得写入 profile、manifest、事件、证据和报告。
- Web 定位优先级固定为 `data-testid → role+name → label → 稳定业务文本 → 稳定 CSS`；定位失败只产生修复提案，用户确认前不得写回或重跑。
- 页面、API、数据库没有固定优先级；任一“必须断言”失败即用例 `不通过`，未定义的跨层口径冲突才进入 `待定`。
- 用例状态固定为 `未执行 / 通过 / 不通过 / 待定`；运行状态固定为 `planned / running / completed / blocked / executor_error / infrastructure_error / manual_required`。
- 业务断言失败不重试；执行器或基础设施异常最多重试一次，首次失败事件和证据只追加、不覆盖。
- 数据库只允许单条 `SELECT`，数据库不得创建、修改或清理测试数据；测试数据只通过获批的业务 API/UI 创建和清理。
- 准确性优先级固定为 `准确性 > 可追溯性 > 安全性 > 自动化覆盖率 > 执行速度`。
- 第一版不包含移动端、性能压测、数据库写入、远程云执行、完整行业知识包、自动提交 Jira/禅道缺陷、无确认定位自修复、任意 Shell、任意 SQL、任意 AI 临时代码执行。
- 开发节奏固定为四个阶段检查点：协议与规划基础、Runner 核心、证据与报告、Skill 与发布；每阶段一次统一回归，失败集中修正后只复跑受影响测试和一次阶段门禁。

---

## File and responsibility map

### Root protocol and knowledge assets

- `schemas/report.schema.json`: 现有十列报告协议的版本化副本与扩展元数据约束。
- `schemas/execution-profile.schema.json`: 目标别名、凭据引用、策略和逐用例动作草案。
- `schemas/run-manifest.schema.json`: Runner 唯一可执行的声明式白名单清单。
- `schemas/approval.schema.json`: 清单哈希、目标摘要、风险批准、有效期和 CI 限制。
- `schemas/run-result.schema.json`: 业务状态、运行状态、断言、规则来源、证据索引和清理结果。
- `knowledge/technical-rules.json`: 可自动判定的 HTTP、契约、安全和一致性技术规则。
- `knowledge/high-risk-heuristics.json`: 默认仅候选判定的少量幂等、扣减、库存、权限和数据隔离经验。

### Runner package

- `packages/testing-runner/src/types.ts`: 所有跨模块稳定 TypeScript 类型和字符串联合。
- `packages/testing-runner/src/schema-registry.ts`: AJV Schema 注册、版本校验和错误格式化。
- `packages/testing-runner/src/input/*.ts`: report/标准 Excel/非标准 Excel 的识别、读取和来源快照。
- `packages/testing-runner/src/readiness.ts`: E0–E4 计算、具体缺失清单和可复制补充示例。
- `packages/testing-runner/src/compiler/*.ts`: profile 到 manifest 的确定性编译、风险分级和知识规则选择。
- `packages/testing-runner/src/security/*.ts`: 哈希、批准校验、凭据解析、目标允许列表和递归脱敏。
- `packages/testing-runner/src/actions/*.ts`: 白名单动作解释器及 Web/API/数据库执行适配器。
- `packages/testing-runner/src/assertions/*.ts`: 多层断言、规则来源和四状态裁决。
- `packages/testing-runner/src/runtime/*.ts`: 运行编排、重试、JSONL、证据和数据清理。
- `packages/testing-runner/src/reporting/*.ts`: `run-result.json` 到现有报告 JSON 的单向投影和双格式一致性门禁。
- `packages/testing-runner/src/locator/*.ts`: 定位失败证据和待确认修复提案。
- `packages/testing-runner/src/cli.ts`: `plan`、`approve`、`run`、`verify-report` 命令入口。
- `packages/testing-runner/vendor/test-case-renderer.mjs`: 从根目录 canonical renderer 在构建/发布前确定性复制的同源渲染器。
- `packages/testing-runner/tests/**`: 单元、合同、集成和演示站点端到端测试。

### Skill and repository integration

- `Web-API测试用例自动执行与证据回填_Skill.md`: 第八个 Skill 的中文正文真源。
- `skills/web-api-test-execution-evidence/**`: 自动生成的标准安装包。
- `tooling/skills-manifest.json`: 增加第八项并明确 `case_output: false`、`execution_skill: true`。
- `tooling/build_skills.py`: 保留前七个构建规则并增加第八个 references/assets 复制规则。
- `README.md`: 八个 Skill、独立安装、Runner 安装/运行、CC Switch 和安全边界说明。

---

## Phase 1 — Protocol and planning foundation

### Task 1: Establish the npm workspace and versioned protocol contracts

**Files:**
- Modify: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.base.json`
- Create: `packages/testing-runner/package.json`
- Create: `packages/testing-runner/tsconfig.json`
- Create: `packages/testing-runner/src/types.ts`
- Create: `packages/testing-runner/src/schema-registry.ts`
- Create: `schemas/report.schema.json`
- Create: `schemas/execution-profile.schema.json`
- Create: `schemas/run-manifest.schema.json`
- Create: `schemas/approval.schema.json`
- Create: `schemas/run-result.schema.json`
- Create: `packages/testing-runner/tests/schema-contract.test.ts`

**Interfaces:**
- Consumes: existing `tooling/report-schema.json` and exact ten-column report contract.
- Produces: `validateDocument<T>(schemaId: SchemaId, value: unknown): T`, `formatSchemaErrors(error: Error): string[]`, and stable types `ExecutionProfile`, `RunManifest`, `Approval`, `RunResult`, `CaseStatus`, `RunStatus`, `RiskLevel`.
- `SchemaId` is exactly `"report" | "execution-profile" | "run-manifest" | "approval" | "run-result"`.

- [ ] **Step 1: Write failing schema contract tests**

Create table-driven tests that accept one minimal valid fixture for each document and reject: a fifth business status, an unknown action type, a literal password field, a missing manifest protocol version, and a result that mixes `executor_error` into `case_status`.

```ts
test("business and runtime states remain separate", () => {
  const value = structuredClone(validRunResult);
  value.cases[0].case_status = "executor_error";
  assert.throws(() => validateDocument("run-result", value), /case_status/);
});

test("manifest rejects arbitrary executable actions", () => {
  const value = structuredClone(validManifest);
  value.cases[0].steps[0] = { type: "shell.exec", command: "whoami" };
  assert.throws(() => validateDocument("run-manifest", value), /shell\.exec/);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```powershell
npm test --workspace @saitamasans/testing-runner -- schema-contract.test.ts
```

Expected: FAIL because the workspace, schemas and validator do not exist.

- [ ] **Step 3: Add workspace and package configuration**

Set root workspaces to `packages/*`; keep current root renderer commands. Give Runner `type: module`, `bin.testing-runner: dist/cli.js`, `engines.node: >=20`, and scripts `build`, `test`, `typecheck`, `prepack`. Add runtime dependencies for AJV, Commander, ExcelJS and Playwright; add TypeScript, `tsx` and Node types as development dependencies. Commit the resolved versions in `package-lock.json` and never use `latest` in commands or CI.

```json
{
  "workspaces": ["packages/*"],
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "test:runner": "npm test --workspace @saitamasans/testing-runner",
    "build:runner": "npm run build --workspace @saitamasans/testing-runner"
  }
}
```

- [ ] **Step 4: Define exact protocol types and schemas**

Use discriminated unions for only these first-version actions:

```ts
export type ActionType =
  | "web.goto" | "web.fill" | "web.click" | "web.select" | "web.wait" | "web.assert"
  | "api.request" | "api.extract" | "api.assert" | "db.select"
  | "cleanup.api" | "cleanup.web";
export type CaseStatus = "未执行" | "通过" | "不通过" | "待定";
export type RunStatus = "planned" | "running" | "completed" | "blocked" |
  "executor_error" | "infrastructure_error" | "manual_required";
export type RiskLevel = "R0" | "R1" | "R2" | "R3";
export type ReadinessLevel = "E0" | "E1" | "E2" | "E3" | "E4";
```

Every schema uses `additionalProperties: false` at executable and security-sensitive boundaries. `execution-profile` stores only credential references shaped as `{ "source": "env", "name": "TESTING_API_TOKEN" }`; it rejects keys matching password, secret, token value, cookie value or connection string value.

- [ ] **Step 5: Implement the schema registry**

Load the five schemas using `import.meta.url`, register them once with AJV 2020, and throw a `ProtocolValidationError` containing `schemaId` and normalized JSON Pointer messages. Return the validated value without mutation.

```ts
export function validateDocument<T>(schemaId: SchemaId, value: unknown): T {
  const validator = validators.get(schemaId);
  if (!validator?.(value)) {
    throw new ProtocolValidationError(schemaId, normalizeErrors(validator?.errors ?? []));
  }
  return value as T;
}
```

- [ ] **Step 6: Run schema tests, typecheck and commit**

```powershell
npm install
npm test --workspace @saitamasans/testing-runner -- schema-contract.test.ts
npm run typecheck --workspace @saitamasans/testing-runner
git add package.json package-lock.json tsconfig.base.json packages/testing-runner schemas
git commit -m "feat(runner): define versioned execution protocols"
```

Expected: schema contract tests PASS, TypeScript reports zero errors, and the commit contains no Runner behavior beyond validation.

---

### Task 2: Parse native report JSON and standard ten-column Excel

**Files:**
- Create: `packages/testing-runner/src/input/detect-input.ts`
- Create: `packages/testing-runner/src/input/report-reader.ts`
- Create: `packages/testing-runner/src/input/excel-reader.ts`
- Create: `packages/testing-runner/src/input/source-snapshot.ts`
- Create: `packages/testing-runner/tests/fixtures/standard-report.json`
- Create: `packages/testing-runner/tests/fixtures/standard-ten-column.xlsx`
- Create: `packages/testing-runner/tests/input-native.test.ts`

**Interfaces:**
- Consumes: `readInput(path: string): Promise<InputInspection>`.
- Produces: `detectInputKind(path: string): Promise<"native-report" | "standard-excel" | "nonstandard-excel">`, `readNativeReport(path: string): Promise<NormalizedCaseSet>`, `readStandardExcel(path: string): Promise<NormalizedCaseSet>`, `snapshotSource(path: string): Promise<SourceSnapshot>`.
- `SourceSnapshot` contains `absolute_path`, `sha256`, `size`, `modified_at`, `input_kind`, and workbook Sheet names; it never contains credentials.

- [ ] **Step 1: Add real fixture generators and failing input tests**

Generate the `.xlsx` fixture from ExcelJS inside the test setup so the binary remains deterministic at assertion level. Assert exact ten-column order, divider-row preservation, unique IDs, four statuses, source Sheet/row mapping, and native-mode recognition of `skill_invocation`.

```ts
assert.deepEqual(result.columns, [
  "用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件",
  "测试步骤", "预期结果", "优先级", "执行结果", "备注"
]);
assert.equal(result.cases[0].source, "用例!2");
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- input-native.test.ts
```

Expected: FAIL with missing `detect-input.ts` and readers.

- [ ] **Step 3: Implement content-based input detection**

Use extension only as the first filter. JSON must validate against `report.schema.json`; `.xlsx` is standard only when at least one Sheet exactly matches all ten ordered headers after trimming BOM and surrounding whitespace. Reject HTML, CSV, Markdown, encrypted workbooks and macro-enabled files with an explicit supported-input message.

```ts
export async function detectInputKind(file: string): Promise<InputKind> {
  if (path.extname(file).toLowerCase() === ".json") {
    validateDocument("report", JSON.parse(await readFile(file, "utf8")));
    return "native-report";
  }
  if (path.extname(file).toLowerCase() !== ".xlsx") throw new UnsupportedInputError(file);
  return workbookHasExactTenColumns(file) ? "standard-excel" : "nonstandard-excel";
}
```

- [ ] **Step 4: Normalize without losing source data**

Keep `raw_values`, source Sheet/row, divider flag, extension columns and original status in `NormalizedCase`. Missing remarks become an empty string; missing execution result becomes `未执行`; duplicate or empty IDs are validation errors for native/standard inputs rather than silently rewritten.

- [ ] **Step 5: Hash the original source before normalization**

Read the source as bytes once, compute SHA-256, record size and timestamp, and make all later mapping approvals and manifests refer to this snapshot. A changed source hash invalidates an existing mapping confirmation.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- input-native.test.ts schema-contract.test.ts
git add packages/testing-runner
git commit -m "feat(runner): read native reports and standard Excel"
```

Expected: both input modes normalize to the same ordered case data and preserve source provenance.

---

### Task 3: Enforce confirmed mapping for every nonstandard Excel

**Files:**
- Create: `packages/testing-runner/src/input/mapping-proposal.ts`
- Create: `packages/testing-runner/src/input/mapping-approval.ts`
- Create: `packages/testing-runner/src/input/nonstandard-excel.ts`
- Create: `packages/testing-runner/tests/fixtures/nonstandard-cases.xlsx`
- Create: `packages/testing-runner/tests/input-mapping.test.ts`

**Interfaces:**
- Consumes: `proposeMapping(workbook: WorkbookInspection): MappingProposal` and an optional mapping approval file.
- Produces: `applyConfirmedMapping(proposal: MappingProposal, approval?: MappingApproval): Promise<NormalizedCaseSet>`.
- `MappingApproval` contains `source_sha256`, `proposal_sha256`, `confirmed_at`, `confirmed_by`, and exact `column_rules`; confidence is display metadata and never authorization.

- [ ] **Step 1: Write failing mapping-gate tests**

Cover renamed columns, multiple Sheets, merged “步骤与预期”, missing ID, extension columns and a high-confidence proposal without approval. The last case must remain blocked.

```ts
test("high confidence never bypasses mapping approval", async () => {
  const proposal = await proposeMapping(fixture);
  assert.equal(proposal.confidence, 1);
  await assert.rejects(() => applyConfirmedMapping(proposal, undefined), /必须确认字段映射/);
});
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- input-mapping.test.ts
```

Expected: FAIL because no mapping gate exists.

- [ ] **Step 3: Produce a complete mapping preview**

The proposal JSON and human preview must include source Sheet, source column, three sample values, suggested standard field, matching rationale, confidence, missing fields, duplicate/conflicting mappings, unrecognized extension columns, split preview and three normalized sample rows. Generate temporary IDs as `EXT-<source hash first 8>-<zero-padded row>` and retain the original source reference.

- [ ] **Step 4: Validate approval against both hashes**

Canonicalize the proposal with sorted object keys and original array order. Reject approval when the workbook or proposal hash changes, when one source column maps to conflicting targets, or when `测试步骤`/`预期结果` remains absent. Preserve all extra columns under `extensions` and all original rows under the source snapshot.

- [ ] **Step 5: Implement merged-field split as an explicit rule**

Allow only a confirmed rule with exact delimiter/regex and previewed output. Do not infer a split after approval. Store the chosen rule version in normalization metadata.

```ts
type SplitRule = {
  source_column: string;
  strategy: "delimiter" | "labeled-sections";
  separator: string;
  targets: ["测试步骤", "预期结果"];
};
```

- [ ] **Step 6: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- input-mapping.test.ts input-native.test.ts
git add packages/testing-runner
git commit -m "feat(runner): require approval for nonstandard Excel mapping"
```

Expected: nonstandard input cannot produce executable cases until the exact source and proposal are confirmed.

---

### Task 4: Compute E0–E4 readiness and actionable preparation guidance

**Files:**
- Create: `packages/testing-runner/src/readiness.ts`
- Create: `packages/testing-runner/src/preparation-guide.ts`
- Create: `packages/testing-runner/tests/readiness.test.ts`

**Interfaces:**
- Consumes: `NormalizedCaseSet`, `ExecutionProfileDraft`, source/mapping state and local runtime probe results.
- Produces: `assessReadiness(input: ReadinessInput): ReadinessAssessment` and `renderPreparationGuide(assessment): string`.
- `ReadinessAssessment` contains `level`, `available`, `blocking`, `optional`, `reasons`, `copyable_examples`, and `runner_allowed`.

- [ ] **Step 1: Write failing table-driven readiness tests**

Create exact E0–E4 cases: no formal cases; missing address/auth; incomplete data/assertion/cleanup; complete preview awaiting approval; locked approval. Also verify public pages do not request login, API-only cases do not request Web credentials, and no database assertion does not request database credentials.

```ts
const assessment = assessReadiness(e3Input);
assert.equal(assessment.level, "E3");
assert.equal(assessment.runner_allowed, false);
assert.deepEqual(assessment.blocking, ["等待确认整批执行预览"]);
assert.deepEqual(assessment.available.sort(), ["断言", "清理策略", "目标", "正式用例", "测试数据"].sort());
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- readiness.test.ts
```

Expected: FAIL with missing readiness functions.

- [ ] **Step 3: Implement the readiness state machine**

E0 applies when there is no normalized formal case; E1 when a used target or required auth reference is absent; E2 when a case cannot compile because steps, expected results, required data, mandatory assertions or cleanup strategy are incomplete; E3 when the manifest preview can be shown; E4 only after approval validation succeeds. Use the lowest satisfied level and return all concrete blockers in one pass.

- [ ] **Step 4: Add context-aware copyable guidance**

Each blocker includes a minimal JSON fragment the user can supply without embedding secrets. Runtime probes report compatible Runner version, Node version, browser availability, target connectivity and optional DB driver state; missing software lists package, source, version and impact but does not install anything.

```json
{
  "credentials": {
    "api_admin": { "source": "env", "name": "TESTING_API_ADMIN_TOKEN" }
  }
}
```

- [ ] **Step 5: Run Phase 1 gate and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- schema-contract.test.ts input-native.test.ts input-mapping.test.ts readiness.test.ts
npm run typecheck --workspace @saitamasans/testing-runner
git diff --check
git add packages/testing-runner
git commit -m "feat(runner): gate execution by preparation readiness"
```

Expected: Phase 1 tests PASS once, E0–E3 all set `runner_allowed: false`, and E4 alone permits execution.

---

## Phase 2 — Runner core and safe adapters

### Task 5: Compile deterministic manifests, classify R0–R3 and lock approvals

**Files:**
- Create: `packages/testing-runner/src/compiler/canonical-json.ts`
- Create: `packages/testing-runner/src/compiler/risk-classifier.ts`
- Create: `packages/testing-runner/src/compiler/manifest-compiler.ts`
- Create: `packages/testing-runner/src/security/approval.ts`
- Create: `packages/testing-runner/src/security/target-scope.ts`
- Create: `packages/testing-runner/src/commands/plan.ts`
- Create: `packages/testing-runner/src/commands/approve.ts`
- Create: `packages/testing-runner/src/cli.ts`
- Create: `packages/testing-runner/tests/manifest-approval.test.ts`

**Interfaces:**
- Consumes: `compileManifest(cases: NormalizedCaseSet, profile: ExecutionProfile): RunManifest`.
- Produces: `canonicalize(value: unknown): string`, `sha256Canonical(value: unknown): string`, `classifyRisk(action: ManifestAction, context: RiskContext): RiskAssessment`, `createApproval(input: ApprovalInput): Approval`, `verifyApproval(manifest: RunManifest, approval: Approval, mode: "interactive" | "ci"): ApprovalVerification`.
- CLI contracts:
  - `testing-runner plan --input <file> --profile <file> --output-dir <dir> [--mapping-approval <file>]`
  - `testing-runner approve --manifest <file> --out <file> --expires-at <ISO-8601> [--approve-r3 <action-id>]`

- [ ] **Step 1: Write failing determinism and tamper tests**

Assert identical normalized input/profile produces byte-identical canonical manifests; source row order is retained; timestamp fields are supplied by the caller; changing an action, target, assertion, cleanup step, Runner version or rule version invalidates approval. Add explicit cases for “test-like domain plus real/sensitive DB” classified by actual data/side effects rather than environment name.

```ts
assert.equal(
  sha256Canonical(compileManifest(cases, profile, fixedClock)),
  sha256Canonical(compileManifest(structuredClone(cases), structuredClone(profile), fixedClock))
);
assert.match(sha256Canonical(compileManifest(cases, profile, fixedClock)), /^[a-f0-9]{64}$/);
assert.throws(() => verifyApproval(changedManifest, approval, "interactive"), /清单已变化/);
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- manifest-approval.test.ts
```

Expected: FAIL because compiler and approval verification are absent.

- [ ] **Step 3: Implement canonical JSON and source-linked manifest compilation**

Sort object keys recursively, preserve array order, encode UTF-8 with no insignificant whitespace, and exclude no executable fields from the hash. Each case action includes `action_id`, `case_id`, `source_step`, `target_alias`, reference-only inputs, risk, assertions, evidence policy, timeout and retry eligibility. The compiler rejects an action not declared in `profile.case_plans` and never turns free text into arbitrary code.

- [ ] **Step 4: Implement risk classification from actual effects**

Classify reads as R0; identifiable/reversible business test writes as R1; shared, real, sensitive, high-privilege or mixed-target actions as R2; asset deduction, award issuance, configuration changes, external notifications and irreversible actions as R3. Environment labels are retained only as user-provided descriptions and cannot lower risk.

```ts
const riskRank: Record<RiskLevel, number> = { R0: 0, R1: 1, R2: 2, R3: 3 };
return assessments.reduce((max, item) =>
  riskRank[item.level] > riskRank[max.level] ? item : max,
  { level: "R0", reasons: [] }
);
```

- [ ] **Step 5: Create and verify scoped approval**

Approval stores protocol/Runner/rule versions, manifest hash, source hash, normalized target origins, approved risk levels, explicit R3 action IDs, issuer, timestamp and expiry. One batch approval may cover listed R0–R2 actions; every R3 action must be named separately and ordinary CI rejects all R2/R3. Any origin, hash, version or expiry mismatch returns `blocked` before credentials are resolved.

- [ ] **Step 6: Add plan and approve CLI commands**

`plan` writes `input-inspection.json`, optional `mapping-proposal.json`, `readiness.json`, `execution-profile.normalized.json`, `run-manifest.json` and a readable `execution-preview.md`. `approve` refuses E0–E2, prints targets/actions/side effects/assertions/cleanup/evidence, requires interactive confirmation unless `--confirmed-by` is supplied by a trusted wrapper, and never accepts a generic `--yes` for R3.

- [ ] **Step 7: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- manifest-approval.test.ts readiness.test.ts
npm run typecheck --workspace @saitamasans/testing-runner
git add packages/testing-runner
git commit -m "feat(runner): lock risk-scoped execution manifests"
```

Expected: every mutation covered by the fixture invalidates approval; CI approval accepts only locked R0/R1.

---

### Task 6: Resolve credential references and redact every persistence boundary

**Files:**
- Create: `packages/testing-runner/src/security/credential-resolver.ts`
- Create: `packages/testing-runner/src/security/redactor.ts`
- Create: `packages/testing-runner/src/security/runtime-secrets.ts`
- Create: `packages/testing-runner/tests/credentials-redaction.test.ts`

**Interfaces:**
- Consumes: credential references and runtime environment only after approval verification.
- Produces: `resolveCredentials(refs: CredentialRef[], env: NodeJS.ProcessEnv): RuntimeSecretStore`, `redact(value: unknown, policy: RedactionPolicy): unknown`, `assertNoSecrets(value: unknown, fingerprints: SecretFingerprint[]): void`.
- `RuntimeSecretStore` is in-memory, exposes `get(alias): string`, and is never serializable.

- [ ] **Step 1: Write failing leak and priority tests**

Use canary secrets in headers, Cookie, query strings, JSON bodies, nested arrays, console text, screenshots metadata and database rows. Verify user-provided session env references win over configured env references, approved unexpired storage state comes third, and manual SSO/MFA is selected only when automatic options are unavailable.

```ts
for (const artifact of persistedArtifacts) {
  assert.doesNotMatch(JSON.stringify(artifact), /CANARY_PASSWORD|CANARY_TOKEN|session_cookie/);
}
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- credentials-redaction.test.ts
```

Expected: FAIL because secrets currently have no resolver or persistence guard.

- [ ] **Step 3: Implement reference-only credential resolution**

Allow only environment references named by the confirmed profile. Resolve after approval and immediately before adapter creation. Model auth selection as `session_env → configured_env → approved_storage_state → manual_handoff`; saving a new `storageState` requires a separate `persist_storage_state: true` approval property and writes outside evidence by default.

- [ ] **Step 4: Implement recursive structured redaction**

Always mask Authorization, Proxy-Authorization, Cookie, Set-Cookie, API keys, password fields, connection strings, phone numbers, email, identity numbers and configured custom keys. Redact both by key and by hashed fingerprint of resolved values. URL sanitization removes sensitive query values before logging.

- [ ] **Step 5: Add a final no-secret persistence guard**

Before writing manifests, JSONL, results, evidence metadata or reports, scan the serialized bytes for all runtime secret fingerprints and canary variants. Abort persistence with `SecurityBoundaryError` instead of writing a partial unsafe artifact. Screenshot masking uses confirmed CSS/semantic regions; when a sensitive region cannot be reliably masked, omit the screenshot and record the omission.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- credentials-redaction.test.ts manifest-approval.test.ts
git add packages/testing-runner
git commit -m "feat(runner): isolate credentials and redact artifacts"
```

Expected: all canary values are absent from every serialized fixture and credentials are unavailable before approval.

---

### Task 7: Execute the Web/API whitelist with Playwright

**Files:**
- Create: `packages/testing-runner/src/actions/action-registry.ts`
- Create: `packages/testing-runner/src/actions/web-adapter.ts`
- Create: `packages/testing-runner/src/actions/api-adapter.ts`
- Create: `packages/testing-runner/src/actions/locator-resolver.ts`
- Create: `packages/testing-runner/src/actions/variable-store.ts`
- Create: `packages/testing-runner/src/runtime/execution-context.ts`
- Create: `packages/testing-runner/tests/fixtures/demo-app.ts`
- Create: `packages/testing-runner/tests/web-api-actions.test.ts`

**Interfaces:**
- Consumes: approved `ManifestAction`, `ExecutionContext`, target allowlist and `RuntimeSecretStore`.
- Produces: `executeAction(action: ManifestAction, context: ExecutionContext): Promise<ActionOutcome>`.
- `ActionOutcome` contains `action_id`, `started_at`, `finished_at`, `status`, redacted `actual`, `attachments`, and typed `error`; it cannot directly set a case verdict.

- [ ] **Step 1: Create a local demo application and failing action tests**

The in-process demo exposes a login form, accessible labels, a `data-testid` submit button, an item creation API, an item list page, an item detail API and an async status transition. Test a mixed flow: API creates identifiable data, Web logs in and selects it, API reads it, and extracted IDs are reused only through declared variables.

```ts
const outcomes = await executeApprovedCase(manifest.cases[0], context);
assert.deepEqual(outcomes.map(x => x.status), ["passed", "passed", "passed", "passed"]);
assert.equal(context.variables.get("created_item_id").provenance.action_id, "API-001");
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- web-api-actions.test.ts
```

Expected: FAIL because the action registry and adapters do not exist.

- [ ] **Step 3: Implement a closed action registry**

Register exactly the action types in Task 1. Reject unknown properties after schema validation, reject target aliases not in approval, and prevent path/origin changes caused by redirects unless the final origin is also approved. No action accepts JavaScript functions, `eval`, command strings or executable file paths.

- [ ] **Step 4: Implement semantic Web location and waits**

Resolve locators in this exact order: `data-testid`, role plus accessible name, label, stable business text, stable CSS. Require a unique visible match before interaction. Use Playwright conditions and explicit business polling for async state; `web.wait` accepts only `visible`, `hidden`, `url`, `response` or `business-state`, never an arbitrary sleep longer than the configured ceiling.

- [ ] **Step 5: Implement API requests and typed extraction**

Use Playwright `APIRequestContext`, target aliases and allowlisted methods. Variables support JSON Pointer, response header and regex-free exact text extraction. Track provenance and reject use before definition. Redact request/response before persistence while retaining status, timing, selected headers and bounded bodies.

- [ ] **Step 6: Handle automatic login and manual takeover**

Form/token login uses the highest-priority available reference. On SSO, CAPTCHA, QR scan or MFA, emit `manual_required`, pause the affected case without producing `待定`, keep the browser context open in interactive mode, and resume only after explicit user handback. CI reports the same condition as blocked and does not wait indefinitely.

- [ ] **Step 7: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- web-api-actions.test.ts credentials-redaction.test.ts
git add packages/testing-runner
git commit -m "feat(runner): execute approved Web and API actions"
```

Expected: the demo mixed flow passes, off-origin navigation and undeclared actions are blocked, and manual auth remains a runtime state rather than a business failure.

---

### Task 8: Add optional, single-SELECT database adapters

**Files:**
- Modify: `packages/testing-runner/package.json`
- Modify: `package-lock.json`
- Create: `packages/testing-runner/src/actions/database-adapter.ts`
- Create: `packages/testing-runner/src/actions/sql-readonly.ts`
- Create: `packages/testing-runner/src/actions/db-drivers/mysql.ts`
- Create: `packages/testing-runner/src/actions/db-drivers/postgres.ts`
- Create: `packages/testing-runner/tests/database-readonly.test.ts`

**Interfaces:**
- Consumes: confirmed `db.select` actions and reference-only database credentials.
- Produces: `validateReadonlyQuery(sql: string, dialect: "mysql" | "postgresql"): ParsedSelect`, `loadDatabaseAdapter(dialect): Promise<DatabaseAdapter>`, `DatabaseAdapter.select(query, params, limit): Promise<RedactedRowSet>`.
- Driver modules are loaded only from the fixed dialect map; profile values cannot name arbitrary npm modules.

- [ ] **Step 1: Write failing SQL boundary tests**

Accept parameterized single `SELECT` and common table expressions that resolve only to a select. Reject semicolon-separated statements, comments hiding a second statement, `INSERT`, `UPDATE`, `DELETE`, DDL, `CALL`, file functions, locking selects, transaction control and result sets exceeding the configured row/byte ceiling.

```ts
for (const sql of unsafeQueries) {
  assert.throws(() => validateReadonlyQuery(sql, "postgresql"), /只允许单条 SELECT/);
}
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- database-readonly.test.ts
```

Expected: FAIL because the database boundary is absent.

- [ ] **Step 3: Implement AST-based query validation**

Use a maintained SQL parser pinned by `package-lock.json`; parse exactly one statement, require the root and all CTEs to be select-only, reject write-capable clauses/functions and forbid interpolation. Require positional/named parameters, declared purpose, case ID and returned field allowlist.

- [ ] **Step 4: Enforce driver and account constraints**

Provide fixed MySQL/PostgreSQL loaders that return an actionable dependency preview when a driver is absent; do not install it automatically. At connection time, set read-only/session transaction controls where supported and run an account capability probe. If read-only cannot be demonstrated, return `blocked` without running the case query.

- [ ] **Step 5: Bound and redact database evidence**

Default to 100 rows and 1 MB serialized output, with lower manifest limits permitted. Abort on overflow, redact sensitive columns before evidence, and retain only selected fields plus row count and query hash. Never use DB for setup or cleanup.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- database-readonly.test.ts schema-contract.test.ts
git add packages/testing-runner package.json package-lock.json
git commit -m "feat(runner): enforce read-only database assertions"
```

Expected: all unsafe SQL fixtures are blocked before adapter execution and missing DB information only narrows coverage to Web/API.

---

### Task 9: Apply assertion precedence, knowledge rules and exact status semantics

**Files:**
- Create: `knowledge/technical-rules.json`
- Create: `knowledge/high-risk-heuristics.json`
- Create: `packages/testing-runner/src/assertions/assertion-engine.ts`
- Create: `packages/testing-runner/src/assertions/knowledge-registry.ts`
- Create: `packages/testing-runner/src/assertions/verdict.ts`
- Create: `packages/testing-runner/tests/assertions-verdict.test.ts`
- Create: `packages/testing-runner/tests/knowledge-rules.test.ts`

**Interfaces:**
- Consumes: declared expected results, project/API contracts, versioned knowledge rules and redacted actual values.
- Produces: `evaluateAssertions(specs, actuals, rules): AssertionOutcome[]`, `deriveCaseVerdict(input: VerdictInput): CaseVerdict`, `selectKnowledgeRules(context): SelectedRule[]`.
- Every knowledge result records `rule_id`, `version`, `source`, `confidence`, `verdict_policy`, `automatic`, and `needs_human_review`.

- [ ] **Step 1: Write failing precedence and four-state tests**

Cover: all mandatory assertions pass; one mandatory Web/API/DB assertion fails; already-executed undefined cross-layer conflict; executor error; infrastructure error; login failure; locator failure; industry heuristic disagreement. Only the undefined business/product/test wording conflict may produce `待定`.

```ts
assert.equal(deriveCaseVerdict(mandatoryFailure).case_status, "不通过");
assert.equal(deriveCaseVerdict(undefinedCrossLayerConflict).case_status, "待定");
assert.equal(deriveCaseVerdict(locatorFailure).case_status, "未执行");
assert.equal(deriveCaseVerdict(locatorFailure).run_status, "executor_error");
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- assertions-verdict.test.ts knowledge-rules.test.ts
```

Expected: FAIL because assertion and knowledge registries do not exist.

- [ ] **Step 3: Implement assertion source precedence**

Order sources as confirmed case expected results, project rules/API contracts, versioned technical standards, then controlled high-risk heuristics. Page, API and DB assertions are peers; mandatory flags are decided in the locked manifest. Never rewrite the original expected result to fit actual behavior.

- [ ] **Step 4: Add versioned first-release knowledge files**

Technical rules cover HTTP status/body consistency, declared content type, auth leakage, schema required fields and cross-layer identifier consistency with `verdict_policy: auto`. High-risk heuristics cover idempotency, duplicate submission/deduction, inventory, authorization and tenant isolation with `verdict_policy: candidate_only` by default. Every rule contains all fields specified in the design and explicit applicability/exceptions.

- [ ] **Step 5: Enforce the industry-experience ceiling**

Only a rule shown in the preview, explicitly approved, applicable after exceptions, and above the configured confidence may become automatic. Automatic heuristic assertions must remain at or below 10% of all automatic assertions in the batch; exceeding the limit returns E3 with a new confirmation requirement rather than silently dropping or applying rules.

- [ ] **Step 6: Implement verdict separation**

Keep the original case status unchanged on blocked/executor/infrastructure/manual conditions. Set `不通过` only for a definite mandatory business assertion failure; set `待定` only when execution reached a real result but confirmed sources expose an unresolved wording conflict. Record automatic source and human-review need in every verdict.

- [ ] **Step 7: Run Phase 2 gate and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- manifest-approval.test.ts credentials-redaction.test.ts web-api-actions.test.ts database-readonly.test.ts assertions-verdict.test.ts knowledge-rules.test.ts
npm run typecheck --workspace @saitamasans/testing-runner
git diff --check
git add knowledge packages/testing-runner
git commit -m "feat(runner): derive traceable multi-layer verdicts"
```

Expected: Phase 2 gate PASS once; business failures, wording conflicts and runtime faults are distinguishable by machine and human readers.

---

## Phase 3 — Runtime evidence, reports and controlled CI

### Task 10: Orchestrate append-only events, retries, evidence and cleanup

**Files:**
- Create: `packages/testing-runner/src/runtime/event-writer.ts`
- Create: `packages/testing-runner/src/runtime/evidence-store.ts`
- Create: `packages/testing-runner/src/runtime/retry-policy.ts`
- Create: `packages/testing-runner/src/runtime/cleanup-manager.ts`
- Create: `packages/testing-runner/src/runtime/run-orchestrator.ts`
- Create: `packages/testing-runner/tests/runtime-evidence.test.ts`
- Create: `packages/testing-runner/tests/retry-cleanup.test.ts`

**Interfaces:**
- Consumes: verified approval, manifest, adapters, assertion engine and redactor.
- Produces: `runApprovedManifest(input: RunInput): Promise<RunResult>`, `appendEvent(event: RunEvent): Promise<void>`, `storeEvidence(item: EvidenceItem): Promise<EvidenceIndexEntry>`, `executeCleanup(plan, context): Promise<CleanupResult>`.
- Runtime output is rooted at `<output-dir>/<run_id>/`; evidence is under `evidence/<case_id>/<attempt>/` and indexed by SHA-256.

- [ ] **Step 1: Write failing append-only and evidence-scope tests**

Verify passed cases retain summary, mandatory assertions, necessary screenshot, redacted request summary and cleanup result. Failed, pending and runtime-error cases retain full trace, screenshots, redacted request/response, logs, DB result, retries, cleanup and knowledge sources. Attempt 2 must not overwrite attempt 1 paths or events.

```ts
assert.equal(events.filter(x => x.attempt === 1 && x.type === "action.failed").length, 1);
assert.ok(await exists("evidence/CASE-001/attempt-1/failure.png"));
assert.ok(await exists("evidence/CASE-001/attempt-2/trace.zip"));
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- runtime-evidence.test.ts retry-cleanup.test.ts
```

Expected: FAIL because no orchestrator or evidence store exists.

- [ ] **Step 3: Implement append-only JSONL and evidence hashing**

Open `run-events.jsonl` in append mode and write one redacted JSON object per line with monotonic sequence, run/case/action IDs, attempt, event type and timestamps. Evidence files are written once using exclusive creation, then hashed into `evidence-index.json`; an existing path is an error, never a replacement.

- [ ] **Step 4: Implement typed retry policy**

Return `retry: false` for assertion failures, permission failures, invalid manifests, manual auth and deterministic locator ambiguity. Allow exactly one retry for classified page-load timeout, transient network reset, browser crash and service-unavailable infrastructure response. Record the first failure before scheduling retry and retain an “occurred execution anomaly” marker even when attempt 2 succeeds.

```ts
export function retryDecision(error: RunnerError, attempt: number): RetryDecision {
  return {
    retry: attempt === 1 && ["page_load_timeout", "network_reset", "browser_crash", "service_unavailable"].includes(error.kind),
    max_attempts: 2
  };
}
```

- [ ] **Step 5: Implement traceable business data lifecycle**

Generate one `run_id`; require created data to carry an approved identifiable marker; prefer `cleanup.api`, then `cleanup.web`, in reverse dependency order. Shared existing data remains read-only unless explicitly authorized in the manifest. Cleanup failure records data ID, creation time, case, target and reason in `manual-cleanup.json`; it never claims success and never falls back to DB writes.

- [ ] **Step 6: Assemble RunResult without conflating states**

The orchestrator always writes a terminal run status when safe to do so. Per-case results retain original status on blocked/runtime errors, include every assertion outcome and evidence hash, and mark cleanup separately. A process exit code distinguishes business failure, blocked/manual, executor error and infrastructure error without changing the four business statuses.

- [ ] **Step 7: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- runtime-evidence.test.ts retry-cleanup.test.ts assertions-verdict.test.ts credentials-redaction.test.ts
git add packages/testing-runner
git commit -m "feat(runner): preserve execution evidence and cleanup history"
```

Expected: first-attempt evidence survives all retries, cleanup failures produce a truthful manual list, and no runtime error appears as a product defect.

---

### Task 11: Generate locator repair proposals without silent self-healing

**Files:**
- Create: `packages/testing-runner/src/locator/failure-capture.ts`
- Create: `packages/testing-runner/src/locator/proposal.ts`
- Create: `packages/testing-runner/src/locator/approval.ts`
- Create: `packages/testing-runner/src/commands/apply-locator-proposal.ts`
- Create: `packages/testing-runner/tests/locator-repair.test.ts`

**Interfaces:**
- Consumes: failed semantic locator, DOM/accessibility snapshot, approved target and manifest source step.
- Produces: `createLocatorProposal(failure): LocatorProposal`, `applyLocatorApproval(manifest, proposal, approval): RunManifest`.
- A proposal contains old locator, candidate locator, matched element summary, confidence, source evidence hashes and proposal hash; it cannot be executed as approval.

- [ ] **Step 1: Write failing ambiguity and no-mutation tests**

Test zero-match, multi-match and changed-label cases. Calling proposal generation must leave the manifest bytes unchanged, must not click any candidate and must not trigger a rerun. Applying approval to a changed source/manifest hash must fail.

```ts
const before = await readFile(manifestPath);
await createLocatorProposal(failure);
assert.deepEqual(await readFile(manifestPath), before);
assert.equal(demoApp.receivedClicks.length, 0);
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- locator-repair.test.ts
```

Expected: FAIL because locator proposals are not represented.

- [ ] **Step 3: Capture bounded failure evidence**

Store the old locator, screenshot, redacted DOM fragment, accessibility tree fragment, URL origin, unique nearby business identifiers and matched-count. Do not store the whole page when a bounded component is available; run the standard redaction and evidence hash gates.

- [ ] **Step 4: Rank semantic candidates only**

Generate candidates in the established priority order and exclude coordinates, generated nth-child chains and unstable framework classes. A candidate is eligible only when it uniquely identifies the same semantic action and target component; otherwise the proposal states that manual locator input is required.

- [ ] **Step 5: Require a new manifest and approval**

Applying a confirmed proposal creates a new manifest version and hash, archives the prior locator/version, and invalidates the old `approval.json`. The user must review and approve the changed preview before rerun; rerun evidence uses a new attempt/run link and never covers the original failure.

- [ ] **Step 6: Run tests and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- locator-repair.test.ts manifest-approval.test.ts web-api-actions.test.ts
git add packages/testing-runner
git commit -m "feat(runner): gate semantic locator repairs by approval"
```

Expected: no repair or rerun occurs without a new confirmed hash.

---

### Task 12: Project one RunResult into consistent Excel and offline HTML

**Files:**
- Modify: `tooling/report-schema.json`
- Modify: `tooling/test-case-renderer.mjs`
- Modify: `schemas/report.schema.json`
- Modify: `packages/testing-runner/package.json`
- Create: `packages/testing-runner/src/reporting/report-projector.ts`
- Create: `packages/testing-runner/src/reporting/renderer-loader.ts`
- Create: `packages/testing-runner/src/reporting/consistency-gate.ts`
- Create: `packages/testing-runner/scripts/copy-renderer.mjs`
- Create: `packages/testing-runner/tests/report-projection.test.ts`
- Create: `packages/testing-runner/tests/report-consistency.test.ts`

**Interfaces:**
- Consumes: original report/normalized cases, `RunResult`, evidence index and manual cleanup list.
- Produces: `projectExecutionReport(input): TestingSkillsReport`, `renderExecutionReports(report, outputDir): Promise<{xlsx, html}>`, `verifyReportConsistency(input): ConsistencyResult`.
- `TestingSkillsReport` keeps the exact ten test-case columns and adds only overview/supplementary sheets for execution summary, evidence and cleanup.

- [ ] **Step 1: Write failing same-source projection tests**

Assert exact ID/status parity between `run-result.json`, projected report, `.xlsx` and `.html`; separate four-status counts from run-status counts; preserve all original case text and ten-column order; append run status, automatic-decision marker, retry, relative evidence links and review note only to the remarks value.

```ts
assert.deepEqual(extractStatusesFromXlsx(xlsx), extractStatusesFromHtml(html));
assert.deepEqual(extractStatusesFromHtml(html), statusesFromRunResult(result));
assert.deepEqual(projectedCaseSheet.columns, TEN_COLUMNS);
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- report-projection.test.ts report-consistency.test.ts
```

Expected: FAIL because no result projector or Runner-local renderer exists.

- [ ] **Step 3: Extend the report schema without breaking five generating Skills**

Add optional protocol/Runner/manifest/rule/evidence metadata and supplementary Sheet kinds while retaining all existing required fields and exact test-case validation. Existing `tests/fixtures/sample-report.json` must continue to pass unchanged.

- [ ] **Step 4: Implement one-way result projection**

Use `run-result.json` as the only verdict source. Update execution result and append structured human-readable notes; add overview rows for versions/hash/targets/duration and separate business/run statistics; add evidence and manual-cleanup supplementary sheets. Do not calculate a verdict in either renderer.

- [ ] **Step 5: Vendor the canonical renderer deterministically**

`copy-renderer.mjs` copies `tooling/test-case-renderer.mjs` byte-for-byte into `packages/testing-runner/vendor/` during build/prepack and fails check mode on drift. Runner dynamically imports only that packaged file. Enhance HTML to show evidence links and run metadata without external requests; retain search, filters, frozen header, four-state dropdown and localStorage behavior.

- [ ] **Step 6: Add a cross-format delivery gate**

Read generated XLSX XML and inline HTML data to compare case IDs, status, evidence counts, manifest hash and statistics against JSON. Any mismatch deletes neither raw evidence nor JSON, but marks the report bundle invalid and refuses final delivery of Excel/HTML.

- [ ] **Step 7: Run report regression and commit**

```powershell
npm test --workspace @saitamasans/testing-runner -- report-projection.test.ts report-consistency.test.ts
node --test tests/test-case-renderer.test.mjs tests/html_behavior.test.mjs
npm run build --workspace @saitamasans/testing-runner
git add tooling packages/testing-runner
git commit -m "feat(runner): render consistent execution reports"
```

Expected: original renderer behavior remains green; Runner Excel, HTML and JSON have identical IDs/statuses/counts/hashes.

---

### Task 13: Complete interactive/CI execution and end-to-end acceptance

**Files:**
- Modify: `packages/testing-runner/src/cli.ts`
- Create: `packages/testing-runner/src/commands/run.ts`
- Create: `packages/testing-runner/src/commands/verify-report.ts`
- Create: `packages/testing-runner/src/runtime/exit-codes.ts`
- Create: `packages/testing-runner/tests/cli.test.ts`
- Create: `packages/testing-runner/tests/e2e/mixed-flow.test.ts`
- Create: `packages/testing-runner/tests/e2e/ci-guard.test.ts`
- Create: `packages/testing-runner/examples/local/execution-profile.json`
- Create: `packages/testing-runner/examples/ci/README.md`
- Create: `packages/testing-runner/examples/ci/github-actions.yml`

**Interfaces:**
- Consumes: `testing-runner run --manifest <file> --approval <file> --output-dir <dir> [--mode interactive|ci]`.
- Produces: complete run directory and deterministic exit codes: `0` completed with no business failure, `10` completed with business failure/pending, `20` blocked/manual, `30` executor error, `40` infrastructure error, `50` unsafe or invalid protocol/report.

- [ ] **Step 1: Write failing CLI and end-to-end tests**

Run the CLI in child processes against the local demo app. Cover a passing mixed Web/API/read-only fake-DB flow, a definite failed assertion, a wording conflict, transient network retry, business failure without retry, cleanup failure, MFA manual handoff, modified hash, expired approval, changed target, CI R2 and missing secret.

```ts
const result = await runCli(["run", "--manifest", manifest, "--approval", approval, "--mode", "ci"]);
assert.equal(result.exitCode, 0);
assert.ok(await exists(path.join(out, "run-result.json")));
assert.ok(await exists(path.join(out, "result.xlsx")));
assert.ok(await exists(path.join(out, "result.html")));
```

- [ ] **Step 2: Verify RED**

```powershell
npm test --workspace @saitamasans/testing-runner -- cli.test.ts mixed-flow.test.ts ci-guard.test.ts
```

Expected: FAIL because `run` and report verification commands are incomplete.

- [ ] **Step 3: Implement preflight ordering and CLI exit contracts**

Run command order is schema → version → hash/expiry → target scope → CI risk → local runtime → credential resolution → execution. A failure before execution writes a redacted blocked result when safe, starts no browser/API/DB adapter, and returns the mapped exit code. `verify-report` reruns the consistency and no-secret gates without executing tests.

- [ ] **Step 4: Enforce controlled CI**

CI accepts only unexpired human-approved manifests, exact Runner/rule versions, approved origins and R0/R1 actions. Credentials come only from environment/CI Secrets. CI cannot add actions, assertions, targets, locator patches or rules at runtime and never waits for manual takeover.

- [ ] **Step 5: Add pinned local and GitHub Actions examples**

Examples use `npx @saitamasans/testing-runner@1.0.0`, reference secrets by environment name, upload the full run directory even on nonzero test verdict exit, and never include real domains or credentials. The local profile demonstrates API setup → Web action → API assertion → optional read-only DB assertion → API cleanup.

- [ ] **Step 6: Run Phase 3 gate and commit**

```powershell
npm run build --workspace @saitamasans/testing-runner
npm test --workspace @saitamasans/testing-runner
node --test tests/test-case-renderer.test.mjs tests/html_behavior.test.mjs
npm pack --workspace @saitamasans/testing-runner --dry-run
git diff --check
git add packages/testing-runner
git commit -m "feat(runner): complete controlled local and CI execution"
```

Expected: Phase 3 gate PASS once; package dry-run contains CLI, schemas, rules and vendored renderer but no fixture secret or local run output.

---

## Phase 4 — Skill package, repository integration and release gate

### Task 14: Build, audit and document the independent eighth Skill

**Files:**
- Create: `Web-API测试用例自动执行与证据回填_Skill.md`
- Modify: `tooling/skills-manifest.json`
- Modify: `tooling/build_skills.py`
- Modify: `tooling/validate_skills.py`
- Create: `skills/web-api-test-execution-evidence/SKILL.md` via builder
- Create: `skills/web-api-test-execution-evidence/agents/openai.yaml` via builder
- Create: `skills/web-api-test-execution-evidence/references/input-and-readiness.md` via builder
- Create: `skills/web-api-test-execution-evidence/references/risk-credentials-and-data.md` via builder
- Create: `skills/web-api-test-execution-evidence/references/locators-assertions-and-rules.md` via builder
- Create: `skills/web-api-test-execution-evidence/references/ci-evidence-and-reporting.md` via builder
- Create: `skills/web-api-test-execution-evidence/references/runner-commands.md` via builder
- Modify: `tests/test_build_skills.py`
- Modify: `tests/test_source_contracts.py`
- Modify: `tests/test_readme_and_packages.py`
- Create: `tests/test_execution_skill_contracts.py`
- Modify: `README.md`
- Create: `.github/workflows/validate-runner.yml`
- Create: `docs/release/v1.1.0-execution-skill-verification.md`

**Interfaces:**
- Consumes: Runner `1.0.0`, protocol `1.0.0`, confirmed design and all prior task evidence.
- Produces: an independently installable eighth Skill, unchanged behavior for the original seven packages, verified install/run documentation and a release-readiness report; no GitHub push, npm publish, tag or Release occurs in this task.
- Manifest flags: existing five remain `case_output: true`; original two and the new execution Skill are `case_output: false`; only the new item has `execution_skill: true`.

**Required skills at Task 14 start:** Read and apply `skill-creator` plus `superpowers:writing-skills` before editing the Skill source; read `skill-review` before the audit step. These skills may shape structure and verification, but cannot rename, merge, split or alter the confirmed meaning of the original seven.

- [ ] **Step 1: Write failing build and behavioral contract tests**

Update package-count assertions to eight unique Skills while retaining exactly five case-output renderers. Assert the seven existing source filenames/slugs are unchanged. Add execution-Skill tests for its trigger boundary, independence, nonstandard-mapping confirmation, E0–E4, R0–R3, no environment guessing, credential secrecy, manual auth, four business states, seven runtime states, retry boundary, database SELECT-only rule, dual report gate and pinned Runner command.

```python
self.assertEqual(8, len(items))
self.assertEqual(5, sum(bool(item["case_output"]) for item in items))
self.assertEqual(1, sum(bool(item.get("execution_skill")) for item in items))
for original in ORIGINAL_SEVEN:
    self.assertEqual(original["source"], by_slug[original["slug"]]["source"])
```

- [ ] **Step 2: Verify RED**

```powershell
python -m unittest tests.test_build_skills tests.test_execution_skill_contracts -v
```

Expected: FAIL because the eighth source and build route do not exist.

- [ ] **Step 3: Write the Chinese source with progressive disclosure**

Keep generated `SKILL.md` at or below 500 lines. It contains: trigger/independent positioning; accuracy priority; E0–E4; native/compatible input routing; preparation prompts; one optional recommendation to use `Saitamasans/testing-skills`; execution preview/confirmation; pinned Runner invocation; status/report delivery gates; final self-check. Put full protocols in the five references and require the Skill to load only references needed by the current input/action.

The trigger description begins with `Use when` and covers users asking to automatically execute existing Web/API test cases, generate evidence, or backfill results. It does not trigger merely because a user asks to generate test cases, clarify requirements or audit case quality.

- [ ] **Step 4: Encode the user-facing preparation conversation**

The Skill first inventories available, blocking and optional materials, asks only for relevant missing items, and gives exact examples. At compatible external input it says the task can continue and non-blockingly recommends the seven-Skill repository. It suggests `test-case-quality-audit` only when quality is insufficient, shows primary/secondary names and division first, and waits for confirmation before loading that one auxiliary Skill.

- [ ] **Step 5: Extend the deterministic builder without altering seven-package semantics**

Allow eight unique manifest entries. Split the new Chinese source into focused references using explicit heading markers; copy only new execution assets/references into its package; do not copy the existing case renderer based on `case_output`. Continue generating the original seven byte-for-byte except for unavoidable manifest-count test changes. `agents/openai.yaml` uses:

```yaml
interface:
  display_name: "Web/API 测试用例自动执行与证据回填"
  short_description: "安全执行 Web/API 用例并回填证据与双格式报告"
  default_prompt: "请执行这批 Web/API 测试用例，先检查准备材料并展示执行预览。"
```

- [ ] **Step 6: Document installation, invocation and boundaries**

Change README overview/table from seven to eight Skills while explicitly retaining “五个生成类 Skill”。Add commands:

```bash
npx skills add Saitamasans/testing-skills --path skills/web-api-test-execution-evidence
npm install --save-dev @saitamasans/testing-runner@1.0.0
npx @saitamasans/testing-runner@1.0.0 plan --input report.json --profile execution-profile.json --output-dir .testing-run
npx @saitamasans/testing-runner@1.0.0 run --manifest .testing-run/run-manifest.json --approval .testing-run/approval.json --output-dir .testing-run/result
```

Explain Codex/Claude automatic discovery, CC Switch visibility, inputs to prepare, mapping confirmation, local/CI modes, secret handling, unsupported scope, artifacts and the fact that this Skill works independently but is natively compatible with the existing seven.

- [ ] **Step 7: Add repository CI and package/install checks**

The workflow uses Node 20, Python, `npm ci`, Playwright Chromium, Runner build/tests, existing Node/Python tests, build drift checks, package dry-run, exact README path assertions, placeholder scan assembled from string fragments, and `git diff --check`. Add a clean temporary-home test for the eighth `npx skills add ... --path` command and a tarball CLI smoke test using the packed Runner rather than workspace imports.

- [ ] **Step 8: Run the skill-review audit and fix only evidenced findings**

Read and use `C:\Users\Admin\.codex\skills\skill-review\SKILL.md` at execution time. Audit structure, description, workflow, token efficiency and anti-patterns. Preserve the user’s expression habits and all confirmed meanings; do not merge, split or rename the original seven. Fix Critical/Important findings in one consolidated pass, record accepted/rejected findings and evidence in the release report, then run the final gate once.

- [ ] **Step 9: Run the complete Phase 4/release gate**

```powershell
python tooling/build_skills.py
python tooling/build_skills.py --check
python tooling/validate_skills.py
python -m unittest discover -s tests -v
npm run build --workspace @saitamasans/testing-runner
npm test --workspace @saitamasans/testing-runner
node --test tests/test-case-renderer.test.mjs tests/html_behavior.test.mjs
npm pack --workspace @saitamasans/testing-runner --dry-run
$patterns = @(("TO" + "DO"), ("T" + "BD"), ("FIX" + "ME"), ("implement " + "later"), ("fill in " + "details"))
$hits = Get-ChildItem docs/superpowers/plans,packages,skills,README.md -Recurse -File | Select-String -SimpleMatch -Pattern $patterns
if ($hits) { $hits; exit 1 }
git diff --check
```

Expected: eight discoverable Skill packages, exactly five case-output renderers, all Runner/legacy tests PASS, no generated drift, no placeholder hits, no secret canaries, no formatting errors and a package containing only declared public files.

- [ ] **Step 10: Write release verification and commit**

Record protocol/Runner/rule versions, test commands/counts, demo flow results, security negative cases, source/package hashes, line counts, install commands, package dry-run contents, Excel/HTML/JSON parity, skill-review findings and the explicit statement that no publish/push/tag/Release occurred.

```powershell
git add Web-API测试用例自动执行与证据回填_Skill.md tooling skills packages schemas knowledge tests README.md .github docs/release package.json package-lock.json tsconfig.base.json
git commit -m "feat: add Web API execution evidence skill"
git status --short
```

Expected: commit succeeds and `git status --short` is empty. Stop for user acceptance before any GitHub or npm release action.

---

## Design coverage matrix

| Design section | Implemented by |
|---|---|
| 1–3 goal, independence, inputs and ten columns | Tasks 1–3, 14 |
| 4 preparation and E0–E4 | Task 4, Task 14 |
| 5 Monorepo and independent versions | Task 1, Task 12, Task 14 |
| 6 whitelist Runner and optional adapters | Tasks 7–8 |
| 7–9 artifacts, manifest, approval and CI | Tasks 5, 10, 13 |
| 10 actual-risk R0–R3 without environment guessing | Task 5 |
| 11 credential priority and secrecy | Task 6 |
| 12 read-only database boundary | Task 8 |
| 13 locator priority and confirmed repair | Tasks 7, 11 |
| 14 assertion accuracy and knowledge rules | Task 9 |
| 15 business/run states | Tasks 1, 9–10 |
| 16 data lifecycle and cleanup | Task 10 |
| 17 retry rules | Task 10 |
| 18 evidence strategy | Task 10 |
| 19 same-source Excel/HTML reporting | Task 12 |
| 20 complete workflow | Tasks 2–13 |
| 21 Skill progressive disclosure | Task 14 |
| 22 first-version scope/non-goals | Global Constraints, Tasks 1, 7–8, 14 |
| 23 testing strategy | RED/GREEN steps in Tasks 1–14 |
| 24 acceptance criteria | Tasks 13–14 final gates |
| 25 release strategy | Tasks 1, 12–14 |

## Final implementation discipline

- Every task follows RED → GREEN → REFACTOR and ends in an independently reviewable commit.
- Do not start a later task while an earlier task’s focused test is red.
- At each phase checkpoint, run the listed gate once; consolidate any fixes, rerun only affected focused tests, then rerun the phase gate once.
- Do not change an approved protocol name or interface silently; update schemas, TypeScript types, fixtures, Skill references and README in the same task.
- Do not publish to npm, push GitHub, tag a version or create a Release until the user separately approves the verified local artifacts.
