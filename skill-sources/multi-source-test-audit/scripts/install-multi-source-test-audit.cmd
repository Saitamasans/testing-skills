@echo off
chcp 65001 >nul
setlocal EnableExtensions DisableDelayedExpansion
set "PSModulePath=%SystemRoot%\System32\WindowsPowerShell\v1.0\Modules"

set "BOOTSTRAP_VERSION=0.1.5"
set "PS1_URL=https://github.com/Saitamasans/testing-skills/releases/download/multi-source-test-audit-v0.1.5/install-multi-source-test-audit.ps1"
set "EXPECTED_PS1_SHA256=__INSTALLER_SHA256__"
set "UNPUBLISHED_SENTINEL=__"
set "UNPUBLISHED_SENTINEL=%UNPUBLISHED_SENTINEL%INSTALLER_SHA256__"
set "BOOTSTRAP_ID=%RANDOM%-%RANDOM%-%RANDOM%"
set "BOOTSTRAP_ROOT=%TEMP%\multi-source-test-audit-bootstrap-%BOOTSTRAP_ID%"
set "PS1_PATH=%BOOTSTRAP_ROOT%\install-multi-source-test-audit.ps1"
set "HASH_PATH=%BOOTSTRAP_ROOT%\install-multi-source-test-audit.ps1.sha256"
set "LOG_PATH=%TEMP%\multi-source-test-audit-bootstrap-%BOOTSTRAP_ID%.log"
set "MSA_BOOTSTRAP_URL=%PS1_URL%"
set "MSA_BOOTSTRAP_OUTPUT=%PS1_PATH%"
set "EXIT_CODE=1"

if not exist "%BOOTSTRAP_ROOT%" mkdir "%BOOTSTRAP_ROOT%" >nul 2>&1
call :main %* >>"%LOG_PATH%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if "%EXIT_CODE%"=="0" goto :success
echo.
echo 安装失败
echo 错误码: %EXIT_CODE%
echo 日志位置: %LOG_PATH%
echo 建议操作: 查看日志后重试；必要时联系维护者并提供日志位置。
if exist "%LOG_PATH%" type "%LOG_PATH%"
goto :finish

:main
if "%EXPECTED_PS1_SHA256%"=="%UNPUBLISHED_SENTINEL%" (
    echo release_not_published: CMD 尚未绑定正式 PS1 SHA-256。
    exit /b 30
)

where.exe powershell.exe >nul 2>&1
if errorlevel 1 (
    echo 找不到 Windows PowerShell，无法下载或执行安装脚本。
    exit /b 10
)

echo 正在下载并校验 multi-source-test-audit %BOOTSTRAP_VERSION% 安装脚本...
where.exe curl.exe >nul 2>&1
if errorlevel 1 goto :download_with_powershell
curl.exe --fail --location --silent --show-error --retry 3 --connect-timeout 20 --output "%PS1_PATH%" "%PS1_URL%"
if not errorlevel 1 goto :verify_download
echo curl.exe 下载 PS1 失败，回退 Windows PowerShell。

:download_with_powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing -Uri $env:MSA_BOOTSTRAP_URL -OutFile $env:MSA_BOOTSTRAP_OUTPUT"
if errorlevel 1 (
    echo Windows PowerShell 下载 PS1 失败。
    exit /b 11
)

:verify_download
if not exist "%PS1_PATH%" (
    echo 下载完成后找不到临时 PS1 文件。
    exit /b 12
)

where.exe certutil.exe >nul 2>&1
if errorlevel 1 (
    echo 找不到 certutil.exe，无法计算 PS1 SHA-256。
    exit /b 13
)
set "ACTUAL_PS1_SHA256="
for /f "skip=1 delims=" %%H in ('certutil.exe -hashfile "%PS1_PATH%" SHA256') do if not defined ACTUAL_PS1_SHA256 set "ACTUAL_PS1_SHA256=%%H"
set "ACTUAL_PS1_SHA256=%ACTUAL_PS1_SHA256: =%"
if not defined ACTUAL_PS1_SHA256 (
    echo 无法计算 PS1 SHA-256。
    exit /b 13
)
if /i not "%ACTUAL_PS1_SHA256%"=="%EXPECTED_PS1_SHA256%" (
    echo PS1 SHA-256 校验失败。
    echo 预期 SHA-256: %EXPECTED_PS1_SHA256%
    echo 实际 SHA-256: %ACTUAL_PS1_SHA256%
    exit /b 14
)

echo PS1 SHA-256 校验通过，开始执行安装...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1_PATH%" %*
set "PS1_EXIT_CODE=%ERRORLEVEL%"
if not "%PS1_EXIT_CODE%"=="0" (
    echo 安装脚本返回失败码: %PS1_EXIT_CODE%
    exit /b %PS1_EXIT_CODE%
)
exit /b 0

:success
echo.
echo multi-source-test-audit %BOOTSTRAP_VERSION% 安装成功
for /f "delims=" %%L in ('findstr /b /c:"installed:" "%LOG_PATH%" 2^>nul') do echo 安装目录: %%L
echo 请重启 Codex
goto :finish

:finish
del /f /q "%HASH_PATH%" >nul 2>&1
del /f /q "%PS1_PATH%" >nul 2>&1
rmdir /s /q "%BOOTSTRAP_ROOT%" >nul 2>&1
if not "%EXIT_CODE%"=="0" if /i not "%TESTING_SKILLS_NO_PAUSE%"=="1" pause
exit /b %EXIT_CODE%
