import ExcelJS from "exceljs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const workbook = new ExcelJS.Workbook();
const sheet = workbook.addWorksheet("登录隔离序列");

sheet.addRow([
  "用例 ID", "所属模块", "用例标题", "验证功能点", "前置条件",
  "测试步骤", "预期结果", "优先级", "实际结果", "执行结果", "备注",
]);
sheet.addRow([
  "LOGIN-SEQ-001", "登录", "错误密码登录失败", "匿名错误登录",
  "从全新匿名 BrowserContext 打开登录页；凭据从环境变量读取；无前序用例依赖",
  "打开测试工作台登录页\n输入有效用户名\n输入错误密码\n点击登录",
  "显示语义明确的错误反馈\n仍停留在登录页\n登录表单可见",
  "P0", "", "未执行", "isolation_scope=case；dependencies=[]；flow_group=null；不得退出登录",
]);
sheet.addRow([
  "LOGIN-SEQ-002", "登录", "正确密码登录成功", "匿名正确登录",
  "第一条失败后，从另一个全新匿名 BrowserContext 打开登录页；凭据从环境变量读取；无业务依赖",
  "打开测试工作台登录页\n输入有效用户名\n输入正确密码\n点击登录",
  "进入“测试工作台”\n登录表单消失",
  "P0", "", "未执行", "isolation_scope=case；dependencies=[]；flow_group=null；不得退出登录",
]);
sheet.addRow([
  "LOGIN-SEQ-003", "登录", "错误密码再次登录失败", "成功后的匿名隔离错误登录",
  "第二条成功后，从第三个全新匿名 BrowserContext 打开登录页；凭据从环境变量读取；无业务依赖",
  "打开测试工作台登录页\n输入有效用户名\n输入错误密码\n点击登录",
  "显示语义明确的错误反馈\n仍停留在登录页\n登录表单可见",
  "P0", "", "未执行", "isolation_scope=case；dependencies=[]；flow_group=null；不得退出登录",
]);

sheet.views = [{ state: "frozen", ySplit: 1 }];
sheet.columns.forEach((column) => { column.width = 26; });
await workbook.xlsx.writeFile(path.join(root, "login-seq.xlsx"));
