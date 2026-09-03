@echo off
setlocal EnableExtensions
set "INSTALL_EXIT_CODE=1"
set "CLI_LOG=%TEMP%\js-test-mapper-skills-%RANDOM%-%RANDOM%.log"
set "RUNTIME_LOG=%TEMP%\js-test-mapper-runtime-%RANDOM%-%RANDOM%.log"
rem brand:display:start
echo 埼玉 AI 测试
echo 无需求-Web JS逆向测试建图
rem brand:display:end
echo.
where node.exe >nul 2>nul || (echo ERROR: Node.js 20 or newer is required.& goto finish)
where npm.cmd >nul 2>nul || (echo ERROR: npm is required.& goto finish)
where npx.cmd >nul 2>nul || (echo ERROR: npx is required.& goto finish)
for /f "delims=." %%V in ('node -p "process.versions.node"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto node_error
if %NODE_MAJOR% LSS 20 goto node_error
echo [1/3] 正在安装标准 Skill...
call npx.cmd -y skills@1.5.23 add Saitamasans/testing-skills@v0.1.1-rc.3 --skill js-test-mapper --agent codex --global --yes --copy >"%CLI_LOG%" 2>&1
set "CLI_EXIT_CODE=%ERRORLEVEL%"
if not "%CLI_EXIT_CODE%"=="0" (
  set "INSTALL_EXIT_CODE=%CLI_EXIT_CODE%"
  echo [ERROR] 标准 Skill 安装失败
  type "%CLI_LOG%"
  goto finish
)
del /q "%CLI_LOG%" >nul 2>nul
echo [OK] 标准 Skill 已安装
echo.
set "SKILL_PATH=%USERPROFILE%\.agents\skills\js-test-mapper"
if not exist "%SKILL_PATH%\SKILL.md" (echo ERROR: Installed Skill was not found.& goto finish)
if not exist "%SKILL_PATH%\agents\openai.yaml" (echo ERROR: Skill discovery metadata is missing.& goto finish)
if not exist "%SKILL_PATH%\scripts\runtime-bootstrap.mjs" (echo ERROR: Runtime bootstrap is missing.& goto finish)
echo [2/3] 正在准备 JS 分析 Runtime...
node "%SKILL_PATH%\scripts\runtime-bootstrap.mjs" >"%RUNTIME_LOG%" 2>&1
set "RUNTIME_EXIT_CODE=%ERRORLEVEL%"
if not "%RUNTIME_EXIT_CODE%"=="0" (
  set "INSTALL_EXIT_CODE=%RUNTIME_EXIT_CODE%"
  echo [ERROR] JS 分析 Runtime 准备失败
  type "%RUNTIME_LOG%"
  goto finish
)
del /q "%RUNTIME_LOG%" >nul 2>nul
echo [OK] Runtime 已就绪
echo.
echo [3/3] 正在验证安装...
if not exist "%SKILL_PATH%\SKILL.md" (echo [ERROR] Installed Skill was not found.& goto finish)
if not exist "%SKILL_PATH%\agents\openai.yaml" (echo [ERROR] Skill discovery metadata is missing.& goto finish)
if not exist "%SKILL_PATH%\scripts\runtime-bootstrap.mjs" (echo [ERROR] Runtime bootstrap is missing.& goto finish)
echo [OK] 安装验证通过
set "INSTALL_EXIT_CODE=0"
echo.
echo ========================================================
echo.
echo [OK] 安装成功，请到 CC Switch / Codex 等支持 Agent Skills 的客户端中查看。
echo [OK] Installation successful. Open CC Switch / Codex or another Agent Skills client to view the installed Skill.
echo.
echo Skill:
echo %SKILL_PATH%
echo.
echo Runtime:
echo %USERPROFILE%\.codex\runtimes\js-test-mapper
echo.
echo 请完全退出并重新打开 CC Switch / Codex。
echo Please restart CC Switch / Codex before using the Skill.
echo.
echo ========================================================
goto finish
:node_error
echo ERROR: Node.js 20 or newer is required.
:finish
if not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
exit /b %INSTALL_EXIT_CODE%
