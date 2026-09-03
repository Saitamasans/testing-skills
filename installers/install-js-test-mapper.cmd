@echo off
setlocal EnableExtensions
set "INSTALL_EXIT_CODE=1"
rem brand:display:start
echo 埼玉 AI 测试 - js-test-mapper installer
rem brand:display:end
where node.exe >nul 2>nul || (echo ERROR: Node.js 20 or newer is required.& goto finish)
where npm.cmd >nul 2>nul || (echo ERROR: npm is required.& goto finish)
where npx.cmd >nul 2>nul || (echo ERROR: npx is required.& goto finish)
for /f "delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto node_error
if %NODE_MAJOR% LSS 20 goto node_error
echo Installing js-test-mapper as a standard Skill...
call npx.cmd -y skills@1.5.23 add Saitamasans/testing-skills@v0.1.1-rc.2 --skill js-test-mapper --agent codex --global --yes --copy
if errorlevel 1 (echo ERROR: Standard Skill installation failed.& goto finish)
set "SKILL_PATH=%USERPROFILE%\.agents\skills\js-test-mapper"
if not exist "%SKILL_PATH%\SKILL.md" (echo ERROR: Installed Skill was not found.& goto finish)
if not exist "%SKILL_PATH%\agents\openai.yaml" (echo ERROR: Skill discovery metadata is missing.& goto finish)
if not exist "%SKILL_PATH%\scripts\runtime-bootstrap.mjs" (echo ERROR: Runtime bootstrap is missing.& goto finish)
node "%SKILL_PATH%\scripts\runtime-bootstrap.mjs"
if errorlevel 1 (echo ERROR: Internal Runtime preparation failed.& goto finish)
set "INSTALL_EXIT_CODE=0"
echo.
echo Installation completed successfully.
echo Node version:
node -v
echo Skill path: %SKILL_PATH%
echo Runtime path: %USERPROFILE%\.codex\runtimes\js-test-mapper
echo Runtime version: 0.1.1-rc.2
echo Restart CC Switch / Codex, then say:
echo Call js-test-mapper to build a read-only JS test map for this test URL.
goto finish
:node_error
echo ERROR: Node.js 20 or newer is required.
:finish
if not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
exit /b %INSTALL_EXIT_CODE%
