@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-multi-source-test-audit.ps1" %*
exit /b %ERRORLEVEL%
