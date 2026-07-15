import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const demoRoot = path.join(root, "demo", "skillmart");

const subdirs = [
  "01-输入资料",
  "02-调用口令",
  "03-完整输出",
  "04-生成文件",
  "05-关键截图",
  "06-验证记录",
];

const skills = [
  {
    dir: "01-需求澄清_Requirement-Clarification",
    skill: "requirement-clarification-test",
    input: "PRD v0",
    prompt: "用 requirement-clarification-test 审查 SkillMart PRD v0，判断能否开测，只输出需求缺口、P0 阻塞项和产品核对问题，不生成测试用例（Test Cases）。",
  },
  {
    dir: "02-需求工作台_Requirement-Workbench",
    skill: "requirement-test-workbench",
    input: "PRD v1 + 产品确认记录",
    prompt: "用 requirement-test-workbench 基于 SkillMart PRD v1 生成正式测试设计和十列测试用例（Test Cases），同时输出 Excel 与 HTML。",
  },
  {
    dir: "03-单接口完整版_Single-API-Full",
    skill: "single-api-test-full",
    input: "POST /api/orders 契约",
    prompt: "用 single-api-test-full 按完整版审查 POST /api/orders，重点覆盖幂等、库存锁定、权限、副作用和异常路径，并生成十列测试用例（Test Cases）。",
  },
  {
    dir: "04-单接口精炼版_Single-API-Concise",
    skill: "single-api-test-concise",
    input: "GET /api/orders/{id} 契约",
    prompt: "用 single-api-test-concise 精炼版快速生成 GET /api/orders/{id} 的接口测试用例（Test Cases），保持低上下文但可执行。",
  },
  {
    dir: "05-多接口链路_Multi-API-Flow",
    skill: "multi-api-flow-test",
    input: "商品、优惠券、下单、支付、查询、取消链路",
    prompt: "用 multi-api-flow-test 设计 SkillMart 多接口链路测试用例（Test Cases），覆盖字段传递、状态流转、清理策略和跨接口一致性。",
  },
  {
    dir: "06-正式服验证_Production-Verification",
    skill: "production-verification-test",
    input: "本地只读 L0 验证目标",
    prompt: "用 production-verification-test 设计 SkillMart 上线后只读验证方案。不要猜测环境性质，不满足写入门禁时只生成 L0 只读测试用例（Test Cases）。",
  },
  {
    dir: "07-测试用例审计_Test-Case-Audit",
    skill: "test-case-quality-audit",
    input: "需求工作台主测试用例（Test Cases）",
    prompt: "用 test-case-quality-audit 审计需求工作台生成的主测试用例（Test Cases），检查可执行性、漏测、冗余、需求证据和修订建议。",
  },
  {
    dir: "08-自动执行与证据_Automated-Execution-Evidence",
    skill: "web-api-test-execution-evidence",
    input: "五套正式测试用例（Test Cases）+ execution-profile.json",
    prompt: "用 web-api-test-execution-evidence 执行 SkillMart 的标准十列测试用例（Test Cases）。先展示执行预览，确认后运行，输出 Excel、HTML、run-result.json、日志、API 证据、PNG 截图和 Trace。",
  },
];

const cases = [
  {
    "用例 ID": "SM-WB-001",
    "所属模块": "订单主流程",
    "用例标题": "使用有效优惠券创建订单后库存被锁定",
    "验证功能点": "商品库存、优惠券、创建订单",
    "前置条件": "SKU-BOOK-001 库存为 3，SKILL20 可用",
    "测试步骤": "查询商品 -> 校验优惠券 -> 创建订单 -> 查询商品库存",
    "预期结果": "订单创建成功，库存从 3 变为 2",
    "优先级": "P0",
    "执行结果": "未执行",
    "备注": "用于展示通过状态",
  },
  {
    "用例 ID": "SM-IDEMP-001",
    "所属模块": "订单幂等",
    "用例标题": "相同幂等键重复提交不能创建两张订单",
    "验证功能点": "幂等键、库存锁定、副作用",
    "前置条件": "同一用户、同一商品、同一幂等键",
    "测试步骤": "连续两次提交相同订单请求 -> 查询订单与库存",
    "预期结果": "只产生一张订单，只锁定一次库存",
    "优先级": "P0",
    "执行结果": "未执行",
    "备注": "演示系统故意保留缺陷，执行后应为不通过",
  },
  {
    "用例 ID": "SM-COUPON-BOUNDARY-001",
    "所属模块": "优惠券边界",
    "用例标题": "优惠券过期边界存在产品与接口口径冲突",
    "验证功能点": "需求歧义、边界时间",
    "前置条件": "客户端点击时间未过期，服务端收到时间已过期",
    "测试步骤": "按两个时间来源执行优惠券校验",
    "预期结果": "记录双方证据，状态标记为待定",
    "优先级": "P1",
    "执行结果": "未执行",
    "备注": "待定不是研发 Bug，也不是未执行",
  },
];

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

async function copyText(source, target) {
  await writeFile(target, await readFile(source, "utf8"), "utf8");
}

function simpleHtmlReport(rows) {
  const headers = Object.keys(rows[0]);
  const head = headers.map((item) => `<th>${item}</th>`).join("");
  const body = rows
    .map((row) => `<tr>${headers.map((item) => `<td>${String(row[item] ?? "")}</td>`).join("")}</tr>`)
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8" />
<title>SkillMart 测试用例（Test Cases）示例</title>
<style>
body { font-family: system-ui, "Microsoft YaHei", sans-serif; margin: 24px; }
table { border-collapse: collapse; width: 100%; font-size: 13px; }
th, td { border: 1px solid #d0d7de; padding: 8px; text-align: left; vertical-align: top; }
th { background: #f6f8fa; position: sticky; top: 0; }
</style>
<h1>SkillMart 测试用例（Test Cases）示例</h1>
<p>这是演示素材骨架，不冒充真实 Skill 调用结果。正式录制时由对应 Skill 生成并替换。</p>
<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
`;
}

async function writeSkillFolder(outDir, item) {
  const folder = path.join(outDir, item.dir);
  for (const subdir of subdirs) await mkdir(path.join(folder, subdir), { recursive: true });
  await writeFile(path.join(folder, "02-调用口令", "prompt.md"), `# ${item.skill}\n\n${item.prompt}\n`, "utf8");
  await writeFile(path.join(folder, "03-完整输出", "README.md"), `# ${item.skill} 输出区\n\n当前目录是演示素材骨架。真实录制时，应在 Codex 中单独调用 \`${item.skill}\`，再把完整输出放入这里。\n\n输入范围：${item.input}\n`, "utf8");
  await writeFile(path.join(folder, "05-关键截图", "README.md"), "真实录制时放入该 Skill 调用前、调用中、输出完成后的关键截图 PNG。\n", "utf8");
  await writeFile(path.join(folder, "06-验证记录", "README.md"), "记录结构检查、人工审阅和与需求/接口资料的一致性核对。\n", "utf8");
}

async function main() {
  const outDir = path.resolve(argValue("--out", path.join(root, "build", "skillmart-demo")));
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await mkdir(path.join(outDir, "00-演示导航与视频材料"), { recursive: true });
  await writeFile(path.join(outDir, "00-演示导航与视频材料", "README.md"), `# SkillMart 八 Skill 演示导航\n\n本目录用于公开演示八个测试 Skill 的完整链路。提到测试资产时统一展示为测试用例（Test Case）或测试用例（Test Cases）。\n\n注意：当前产物是可复现素材骨架，真实视频录制时需要分别调用七个原始 Skill，再由第八个 Skill 执行五套正式测试用例（Test Cases）。\n`, "utf8");

  for (const item of skills) await writeSkillFolder(outDir, item);

  const requirementDir = path.join(outDir, "01-需求澄清_Requirement-Clarification", "01-输入资料");
  await copyText(path.join(demoRoot, "requirements", "prd-v0.md"), path.join(requirementDir, "prd-v0.md"));

  const workbenchInput = path.join(outDir, "02-需求工作台_Requirement-Workbench", "01-输入资料");
  await copyText(path.join(demoRoot, "requirements", "prd-v1.md"), path.join(workbenchInput, "prd-v1.md"));
  await copyText(path.join(demoRoot, "requirements", "product-confirmation.md"), path.join(workbenchInput, "product-confirmation.md"));

  const contracts = [
    ["03-单接口完整版_Single-API-Full", "orders-api.md"],
    ["04-单接口精炼版_Single-API-Concise", "query-api.md"],
    ["05-多接口链路_Multi-API-Flow", "orders-api.md"],
    ["05-多接口链路_Multi-API-Flow", "query-api.md"],
  ];
  for (const [folder, file] of contracts) {
    await copyText(path.join(demoRoot, "contracts", file), path.join(outDir, folder, "01-输入资料", file));
  }

  const generated = path.join(outDir, "08-自动执行与证据_Automated-Execution-Evidence", "04-生成文件");
  await writeFile(path.join(generated, "skillmart-standard-test-cases.json"), `${JSON.stringify(cases, null, 2)}\n`, "utf8");
  await writeFile(path.join(generated, "skillmart-standard-test-cases.html"), simpleHtmlReport(cases), "utf8");
  await writeFile(path.join(generated, "execution-profile.json"), `${JSON.stringify({
    protocol_version: "1.0.0",
    profile_id: "skillmart-local-demo",
    targets: {
      web: { kind: "web", origin: "http://127.0.0.1:<runtime-port>" },
      api: { kind: "api", origin: "http://127.0.0.1:<runtime-port>" },
    },
    credentials: {},
    data: {
      user_id: "user-a",
      sku: "SKU-BOOK-001",
      coupon_code: "SKILL20",
    },
  }, null, 2)}\n`, "utf8");

  await writeFile(path.join(outDir, "material-index.json"), `${JSON.stringify({
    generated_at: new Date().toISOString(),
    demo: "SkillMart",
    skills: skills.map(({ skill, dir, input }) => ({ skill, dir, input })),
    formal_case_generators: [
      "requirement-test-workbench",
      "single-api-test-full",
      "single-api-test-concise",
      "multi-api-flow-test",
      "production-verification-test",
    ],
    execution_skill: "web-api-test-execution-evidence",
    note: "This is a reproducible material skeleton. It does not claim static files are real Skill invocation outputs.",
  }, null, 2)}\n`, "utf8");

  console.log(`SkillMart demo materials generated: ${outDir}`);
}

await main();

