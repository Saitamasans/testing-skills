# 开发、构建与发布

## 构建 Skill 包

源文件位于根目录 `skill-sources/`，公共安装包生成到 `skills/`，可选 Codex 适配器再从公共包同步。不要直接编辑自动生成的 `skills/*/SKILL.md`。

```bash
python tooling/build_skills.py
python tooling/build_skills.py --check
python tooling/validate_skills.py
python tooling/sync_reverse_test_workbench.py --check
```

## 测试

```bash
python -m unittest discover -s tests -v
npm run build --workspace @saitamasans/testing-runner
npm test --workspace @saitamasans/testing-runner
node --test tests/test-case-renderer.test.mjs tests/html_behavior.test.mjs
```

完整发布前验证记录见 [`docs/release/`](release/)。
