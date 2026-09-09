@echo off
setlocal EnableExtensions
set "INSTALL_EXIT_CODE=1"
set "CLI_LOG=%TEMP%\js-test-mapper-skills-%RANDOM%-%RANDOM%.log"
rem brand:display:start
echo Saitama AI Testing
echo Web JS Reverse Test Mapper
rem brand:display:end
echo.
where node.exe >nul 2>nul || (echo ERROR: Node.js is required to install the standard Skill.& goto finish)
where npx.cmd >nul 2>nul || (echo ERROR: npx is required to install the standard Skill.& goto finish)
echo [1/1] Installing standard Skill...
call npx.cmd -y skills@1.5.23 add Saitamasans/testing-skills@v0.2.0 --skill js-test-mapper --agent codex --global --yes --copy >"%CLI_LOG%" 2>&1
set "CLI_EXIT_CODE=%ERRORLEVEL%"
if not "%CLI_EXIT_CODE%"=="0" (
  set "INSTALL_EXIT_CODE=%CLI_EXIT_CODE%"
  echo [ERROR] Standard Skill installation failed.
  type "%CLI_LOG%"
  goto finish
)
del /q "%CLI_LOG%" >nul 2>nul
set "SKILL_PATH=%USERPROFILE%\.agents\skills\js-test-mapper"
if not exist "%SKILL_PATH%\SKILL.md" (echo [ERROR] Installed Skill was not found.& goto finish)
if not exist "%SKILL_PATH%\agents\openai.yaml" (echo [ERROR] Skill discovery metadata is missing.& goto finish)
echo [OK] Standard Skill installed
echo.
echo ========================================================
echo.
echo [OK] Installation successful.
echo Open CC Switch / Codex or another Agent Skills client
echo to view the installed Skill.
echo.
echo Skill:
echo %SKILL_PATH%
echo.
echo No separate Runtime or executor is installed.
echo The Skill uses the host agent's existing browser and code tools.
echo.
echo Please fully restart CC Switch / Codex before use.
echo.
echo ========================================================
set "INSTALL_EXIT_CODE=0"
goto finish
:finish
if exist "%CLI_LOG%" if not "%INSTALL_EXIT_CODE%"=="0" echo Log: %CLI_LOG%
if not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
exit /b %INSTALL_EXIT_CODE%
