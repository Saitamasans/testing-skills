@echo off
setlocal
if "%~3"=="" (
  echo Usage: %~nx0 ^<runtime.tgz^> ^<runtime.manifest.json^> ^<install-root^> [--repair]
  exit /b 2
)
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required to install js-test-mapper.
  exit /b 9009
)
node "%~dp0..\runtimes\js-test-mapper-runtime\scripts\install-bundle.mjs" --bundle "%~f1" --manifest "%~f2" --install-root "%~f3" %4
exit /b %ERRORLEVEL%
