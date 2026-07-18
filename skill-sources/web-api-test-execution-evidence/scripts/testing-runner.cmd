@echo off
setlocal DisableDelayedExpansion
set "PS_EXE=%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe"
if exist "%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe" set "PS_EXE=%SystemRoot%\Sysnative\WindowsPowerShell\v1.0\powershell.exe"
if not exist "%PS_EXE%" (
  echo installation_incomplete: Windows PowerShell 5.1 is unavailable. Rerun the GitHub Release installer with -Repair. 1>&2
  exit /b 20
)
"%PS_EXE%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0testing-runner.ps1"
exit /b %ERRORLEVEL%
