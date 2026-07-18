@echo off
setlocal
set "INSTALL_SELECTOR=-Skill web-api-test-execution-evidence"
set "INSTALLER_URL=https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.0/install-web-api-test-execution-evidence.ps1"
set "INSTALLER_SHA256=844cf38e7acdfe1d94ef571373493805e718876d8be7930088d413b0565ce22b"
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
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $proxy=[Net.WebRequest]::DefaultWebProxy; if($proxy){$proxy.Credentials=[Net.CredentialCache]::DefaultNetworkCredentials}; $directory=Join-Path ([IO.Path]::GetTempPath()) ('testing-skills-installer-'+[Guid]::NewGuid().ToString('N')); $installer=Join-Path $directory 'install-web-api-test-execution-evidence.ps1'; try { New-Item -ItemType Directory -Path $directory | Out-Null; if($env:TESTING_SKILLS_INSTALLER_SOURCE){Copy-Item -LiteralPath $env:TESTING_SKILLS_INSTALLER_SOURCE -Destination $installer}else{Invoke-WebRequest -UseBasicParsing -Uri '%INSTALLER_URL%' -OutFile $installer}; $actual=(Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant(); if($actual -cne '%INSTALLER_SHA256%'){ throw 'Installer SHA-256 verification failed.' }; $global:LASTEXITCODE=0; & $installer; if(-not $? -or $LASTEXITCODE -ne 0){ exit $(if($LASTEXITCODE){$LASTEXITCODE}else{1}) } } finally { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }"
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
