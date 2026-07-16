# 真实桌面录制版八 Skill 演示实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Codex 桌面中真实录制七次 Skill 调用和第八个 Skill 的执行过程，并交付可核验的原始录屏与 20 分钟内精剪版。

**Architecture:** 保留现有 `build/skillmart-demo` 真实材料和执行证据，新增 `11-真实桌面录制_Real-Desktop-Recording` 作为录制产物目录。录制控制层使用 Codex 线程、内置终端、内置浏览器和 Windows 屏幕捕获；验证层使用 FFmpeg、现有材料门禁和 Runner 测试。

**Tech Stack:** Codex App thread tools、Codex 内置终端、Playwright、Windows GDI screen capture、FFmpeg、Node.js、TypeScript、Python。

## Global Constraints

- 不覆盖旧视频；旧视频只作为材料导航版保留。
- 七个 Skill 仍分七次独立调用，不改名、不合并、不拆分。
- 测试用例（Test Case/Test Cases）和四状态规则保持现有中文表达与十列顺序。
- 第八个 Skill 的执行必须出现预览、审批、真实 Web/API 动作和证据回填。
- 只使用本地隔离演示系统，不接触真实线上数据或个人敏感窗口。
- 原始桌面录屏连续、1920×1080、30 FPS；精剪版不超过 1200 秒。

---

### Task 1: 建立真实桌面录制入口和屏幕捕获验证

**Files:**
- Create: `demo/skillmart/scripts/record-real-desktop-demo.mjs`
- Create: `demo/skillmart/scripts/desktop-recording-manifest.json`
- Test: `packages/testing-runner/tests/demo-skillmart.test.ts`

**Interfaces:**
- `record-real-desktop-demo.mjs --output-dir <dir> --ffmpeg <path> --thread-id <id>` starts one continuous capture, writes a raw video and operation timeline, and stops only after the approved chapter sequence completes.
- `desktop-recording-manifest.json` records chapter IDs, visible action labels, local origin, privacy allowlist and output paths.

- [ ] **Step 1:** Add a failing test asserting the new manifest contains chapters `00` through `10`, records `codex_prompt`, `approval_confirmed`, `web_click`, `api_request` and `report_backfill`, and rejects `file://` or absolute user paths.
- [ ] **Step 2:** Run the focused test and confirm it fails because the real-desktop manifest does not exist.
- [ ] **Step 3:** Implement the manifest validator and screen-capture process wrapper using FFmpeg `gdigrab`, with explicit output dimensions and a stop marker file.
- [ ] **Step 4:** Run the focused test and a 5-second capture smoke test; expect the manifest and capture metadata to pass.

### Task 2: Create a clean Codex demo thread and live chapter script

**Files:**
- Create: `demo/skillmart/scripts/live-skillmart-demo-script.json`
- Create: `demo/skillmart/scripts/live-skillmart-demo-runner.mjs`
- Output: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/01-现场口令`

**Interfaces:**
- `live-skillmart-demo-script.json` stores the exact Chinese prompts, expected response markers and the one-primary-Skill route for chapters 01–08.
- `live-skillmart-demo-runner.mjs` drives only the approved local demo task and writes `live-operation-log.jsonl`; it must not synthesize response text or skip a missing marker.

- [ ] **Step 1:** Write a failing test requiring every live chapter to contain a prompt, a response marker and one visible artifact path.
- [ ] **Step 2:** Run the focused test and confirm it fails before the live script exists.
- [ ] **Step 3:** Implement the script with the seven exact Skill names and the approved local inputs from `build/skillmart-demo`.
- [ ] **Step 4:** Run the script in dry-run mode and verify it prints the exact prompts without creating fake outputs.

### Task 3: Record the eighth Skill execution with visible approval and actions

**Files:**
- Modify: `demo/skillmart/scripts/live-skillmart-demo-runner.mjs`
- Create: `demo/skillmart/scripts/real-execution-capture.mjs`
- Output: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/08-第八个Skill执行`

**Interfaces:**
- The execution chapter must call the existing `web-api-test-execution-evidence` Skill against the five locked local execution profiles.
- It must persist `approval.json`, `run-result.json`, visible PNGs, API request/response JSON, `event-log.jsonl`, `execution-overview.html` and a chapter-specific screen timeline.

- [ ] **Step 1:** Add a failing test requiring `approval_confirmed` before the first `run_started` event and at least one Web screenshot after a `web_click` event.
- [ ] **Step 2:** Run the test and confirm it fails for the old static-player flow.
- [ ] **Step 3:** Implement the live execution wrapper so the approval prompt is visible and the local runner is executed only after confirmation.
- [ ] **Step 4:** Run one Web success, one Web failure and one API chain in the local fixture; confirm the report, evidence and event order.

### Task 4: Produce raw desktop recording and human-readable evidence

**Files:**
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/完整未剪辑桌面录屏_Raw-Desktop-Session.mp4`
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/操作时间线_Operation-Timeline.md`
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/现场截图_Screen-Captures/*.png`
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/录制检查_Recording-Inspection.json`

- [ ] **Step 1:** Start the local SkillMart server and the clean Codex demo thread; verify only allowlisted windows are visible.
- [ ] **Step 2:** Start one continuous 1920×1080/30 FPS FFmpeg capture.
- [ ] **Step 3:** Run chapters 00–10 with visible prompts, responses, approvals, Web/API actions and report opening.
- [ ] **Step 4:** Stop capture, export exact-time PNGs from the desktop recording, and run FFprobe plus a full decode check.

### Task 5: Create the edited video and final gates

**Files:**
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/20分钟内精剪版_Edited-Real-Demo.mp4`
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/中文字幕_Subtitles.srt`
- Create: `build/skillmart-demo/11-真实桌面录制_Real-Desktop-Recording/证据索引_Evidence-Index.json`
- Modify: `docs/release/v1.1.0-execution-skill-verification.md`

- [ ] **Step 1:** Compress only idle waits and repeated file browsing; do not remove the first visible prompt, approval, Web click, API assertion or report transition from any chapter.
- [ ] **Step 2:** Add Chinese chapter subtitles and export a 1920×1080/30 FPS H.264 MP4 under 1200 seconds.
- [ ] **Step 3:** Run `validate-demo-materials.mjs --phase video`, Runner regression, Python Skill tests, typecheck, FFmpeg decode, privacy scan and `git diff --check`.
- [ ] **Step 4:** Reject the video if any chapter lacks live input/output or if the eighth Skill lacks approval and action evidence.
