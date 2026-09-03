@echo off
setlocal EnableExtensions
set "INSTALL_EXIT_CODE=1"
set "PS1_NAME=install-js-test-mapper.ps1"
set "PS1_SHA256=e5f0f9095cd1378c2fc30cfab79c94488e61daac6092e4c6fe4ccf410743530a"
set "PS1_URL=https://github.com/Saitamasans/testing-skills/releases/download/v0.1.1-rc.1/install-js-test-mapper.ps1"
set "PS1_PATH=%~dp0%PS1_NAME%"
set "TEMP_PS1="
set "POWERSHELL_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%POWERSHELL_EXE%" goto powershell_found
set "POWERSHELL_EXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if exist "%POWERSHELL_EXE%" goto powershell_found
for %%P in (powershell.exe pwsh.exe) do if not "%%~$PATH:P"=="" set "POWERSHELL_EXE=%%~$PATH:P"
if not defined POWERSHELL_EXE (
  echo ERROR: Windows PowerShell 5.1 or PowerShell 7 is required.
  goto finish
)

:powershell_found

if exist "%PS1_PATH%" goto verify_ps1
set "TEMP_PS1=%TEMP%\js-test-mapper-installer-%RANDOM%-%RANDOM%.ps1"
set "PS1_PATH=%TEMP_PS1%"
echo Downloading the verified js-test-mapper installer...
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "(New-Object Net.WebClient).DownloadFile('%PS1_URL%','%PS1_PATH%')"
if errorlevel 1 (
  echo ERROR: Could not download install-js-test-mapper.ps1 from v0.1.1-rc.1.
  goto finish
)

:verify_ps1
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$s=[IO.File]::OpenRead('%PS1_PATH%'); try{$h=([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($s))).Replace('-','').ToLowerInvariant()}finally{$s.Dispose()}; if($h -ne '%PS1_SHA256%'){exit 1}"
if errorlevel 1 (
  echo ERROR: Installer SHA-256 verification failed. Nothing was installed.
  goto finish
)

"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%" %*
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"
goto cleanup

:finish
set "INSTALL_EXIT_CODE=1"

:cleanup
if defined TEMP_PS1 del /f /q "%TEMP_PS1%" >nul 2>nul
if not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
exit /b %INSTALL_EXIT_CODE%
