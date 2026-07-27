import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("登录主流程");

sheet.addRow([
  "用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件",
  "测试步骤", "预期结果", "优先级", "实际结果", "执行结果", "备注",
]);
sheet.addRow([
  "LOGIN-MINI-001", "登录", "登录页面控件可见", "登录表单基础可用性",
  "从全新匿名 BrowserContext 打开登录页",
  "打开测试工作台登录页",
  "用户名输入框可见\n密码输入框可见\n登录按钮可见\n密码框为 password 类型",
  "P0", "", "未执行", "只读检查",
]);
sheet.addRow([
  "LOGIN-MINI-002", "登录", "有效账号和正确密码登录", "有效凭据登录成功",
  "从全新匿名 BrowserContext 打开登录页；凭据从环境变量读取",
  "打开测试工作台登录页\n输入有效用户名\n输入正确密码\n点击登录",
  "进入“测试工作台”\n登录表单消失",
  "P0", "", "未执行", "禁止添加退出登录",
]);
sheet.addRow([
  "LOGIN-MINI-003", "登录", "有效账号和错误密码登录失败", "错误密码隔离验证",
  "保持固定执行顺序，但无 LOGIN-MINI-002 业务依赖；从全新匿名 BrowserContext 打开登录页；凭据从环境变量读取",
  "打开测试工作台登录页\n输入有效用户名\n输入错误密码\n点击登录",
  "显示语义明确的错误反馈\n仍停留在登录页\n登录表单可见",
  "P0", "", "未执行", "不得点击退出登录",
]);

sheet.views = [{ state: "frozen", ySplit: 1 }];
sheet.columns.forEach((column) => { column.width = 24; });
await workbook.xlsx.writeFile(path.join(root, "login-mini.xlsx"));
