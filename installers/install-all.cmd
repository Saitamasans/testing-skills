@echo off
setlocal
set "INSTALL_SELECTOR=-All"
set "TESTING_SKILLS_REQUIRE_COMPLETE_RUNTIME=1"
set "GENERIC_INSTALLER_URL=https://raw.githubusercontent.com/Saitamasans/testing-skills/web-api-test-execution-evidence-v1.0.1/scripts/install.ps1"
set "GENERIC_INSTALLER_SHA256=5a3b9726f771edcbed8c402c2b8eaa46dbef1972661e144f6ff10a16af99f8e7"
set "COMPLETE_INSTALLER_URL=https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.1/install-web-api-test-execution-evidence.ps1"
set "COMPLETE_INSTALLER_SHA256=670759ec9dcd75016d1a755ae77e3127e9f0dbe5bcb4f5810f51364b35360083"
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
"%POWERSHELL_EXE%" -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12; $proxy=[Net.WebRequest]::DefaultWebProxy; if($proxy){$proxy.Credentials=[Net.CredentialCache]::DefaultNetworkCredentials}; $directory=Join-Path ([IO.Path]::GetTempPath()) ('testing-skills-all-installer-'+[Guid]::NewGuid().ToString('N')); $generic=Join-Path $directory 'install.ps1'; $complete=Join-Path $directory 'install-web-api-test-execution-evidence.ps1'; try { New-Item -ItemType Directory -Path $directory | Out-Null; if($env:TESTING_SKILLS_GENERIC_INSTALLER_SOURCE){Copy-Item -LiteralPath $env:TESTING_SKILLS_GENERIC_INSTALLER_SOURCE -Destination $generic}else{Invoke-WebRequest -UseBasicParsing -Uri '%GENERIC_INSTALLER_URL%' -OutFile $generic}; if((Get-FileHash -LiteralPath $generic -Algorithm SHA256).Hash.ToLowerInvariant() -cne '%GENERIC_INSTALLER_SHA256%'){ throw 'Generic installer SHA-256 verification failed.' }; if($env:TESTING_SKILLS_COMPLETE_INSTALLER_SOURCE){Copy-Item -LiteralPath $env:TESTING_SKILLS_COMPLETE_INSTALLER_SOURCE -Destination $complete}else{Invoke-WebRequest -UseBasicParsing -Uri '%COMPLETE_INSTALLER_URL%' -OutFile $complete}; if((Get-FileHash -LiteralPath $complete -Algorithm SHA256).Hash.ToLowerInvariant() -cne '%COMPLETE_INSTALLER_SHA256%'){ throw 'Complete installer SHA-256 verification failed.' }; $env:TESTING_SKILLS_COMPLETE_INSTALLER_SCRIPT=$complete; $global:LASTEXITCODE=0; & $generic -All; if(-not $? -or $LASTEXITCODE -ne 0){ exit $(if($LASTEXITCODE){$LASTEXITCODE}else{1}) } } finally { Remove-Item -LiteralPath $directory -Recurse -Force -ErrorAction SilentlyContinue }"
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
