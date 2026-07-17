@echo off
setlocal
set "INSTALL_SELECTOR=-Skill production-verification-test"
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%POWERSHELL_EXE%" goto powershell_found
set "POWERSHELL_EXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if exist "%POWERSHELL_EXE%" goto powershell_found
for %%P in (powershell.exe pwsh.exe) do (
  if not "%%~$PATH:P"=="" (
    set "POWERSHELL_EXE=%%~$PATH:P"
    goto powershell_found
  )
)
echo PowerShell was not found. Install Windows PowerShell 5.1 or PowerShell 7, then run this installer again.
exit /b 9009

:powershell_found
if defined TESTING_SKILLS_INSTALLER_SCRIPT (
  "%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%TESTING_SKILLS_INSTALLER_SCRIPT%" %INSTALL_SELECTOR%
) else (
  "%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "& ([scriptblock]::Create(([string]((Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/Saitamasans/testing-skills/main/scripts/install.ps1').Content)).TrimStart([char]0xFEFF))) %INSTALL_SELECTOR%"
)
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
