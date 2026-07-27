@echo off
setlocal DisableDelayedExpansion
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0multi-source-test-audit.ps1" %*
exit /b %ERRORLEVEL%
