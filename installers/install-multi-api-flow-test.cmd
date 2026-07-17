@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) -Skill 'multi-api-flow-test'"
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"
if not "%INSTALL_EXIT_CODE%"=="0" (
  echo.
  echo Installation failed with exit code %INSTALL_EXIT_CODE%.
  if /I not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
  exit /b %INSTALL_EXIT_CODE%
)
echo.
echo Installation completed successfully.
if /I not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
exit /b 0
