# js-test-mapper Codex 适配器

本目录是公共 `js-test-mapper` Skill 的可选 Codex 适配器。它不包含独立扫描内核、Runtime、bootstrap、launcher 或 npm 依赖；分析使用 Codex 已有的浏览器和代码观察能力。

Skill 负责安全只读导航、JS 证据关联、测试视角分析和报告组织。宿主能力不足时输出受限分析和明确缺口，不安装或偷偷下载执行器。

公共 Skill 与 Plugin 内 Skill 镜像由 `tooling/sync_js_test_mapper.py` 确定性同步并检查漂移。
