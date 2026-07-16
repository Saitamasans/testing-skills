# SkillMart Demo

SkillMart 是八个测试 Skill 的公开演示素材。它从 PRD v0 的需求缺口开始，经过产品确认形成 PRD v1，再围绕本地 Web/API 系统生成和执行测试用例（Test Cases）。

生成演示材料：

```powershell
node demo/skillmart/scripts/build-demo-materials.mjs --out build/skillmart-demo
```

注意：builder 只生成可复现的演示素材骨架、输入资料、调用口令和示例数据。正式录制时仍需要在 Codex 中分别调用七个原始 Skill，再用第八个 Skill 执行其中五套正式测试用例（Test Cases）。

