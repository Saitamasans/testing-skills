# js-test-mapper Codex 适配器

本目录是公共 `js-test-mapper` Skill 的可选 Codex 适配器。Plugin 不包含扫描内核，也不在正常运行时安装 npm 依赖；它加载公共 Skill 镜像，由 `scripts/runtime-launcher.mjs` 发现已经过 receipt 和完整性校验的独立 Runtime。

Runtime 默认位于 `%USERPROFILE%/.codex/runtimes/js-test-mapper`，也可以由 `JS_TEST_MAPPER_RUNTIME_ROOT` 或 launcher 的 `--runtime-root` 显式指定。找不到 Runtime 时只报告最小 install/repair 动作，不静默下载或切换执行器。

公共 Skill 与 Plugin 内 Skill 镜像由 `tooling/sync_js_test_mapper.py` 确定性同步并检查漂移。
