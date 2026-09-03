[CmdletBinding()]
param([switch]$Repair)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$ReleaseZipName = 'js-test-mapper-0.1.1-rc.1.zip'
$ReleaseZipSha256 = '949c0c32b40843b9053da4acee2a426bd61e54563289701fa80056065439b1f6'
$ReleaseUrl = 'https://github.com/Saitamasans/testing-skills/releases/download/v0.1.1-rc.1/js-test-mapper-0.1.1-rc.1.zip'
$UserRoot = if ($env:JS_TEST_MAPPER_USERPROFILE) { [IO.Path]::GetFullPath($env:JS_TEST_MAPPER_USERPROFILE) } else { [Environment]::GetFolderPath('UserProfile') }
$SkillRoot = Join-Path $UserRoot '.agents\skills\js-test-mapper'
$RuntimeRoot = Join-Path $UserRoot '.codex\runtimes\js-test-mapper'
$TempRoot = Join-Path ([IO.Path]::GetTempPath()) ('js-test-mapper-install-' + [guid]::NewGuid().ToString('N'))
$SkillParent = Split-Path -Parent $SkillRoot
$SkillStaging = Join-Path $SkillParent ('.js-test-mapper-staging-' + [guid]::NewGuid().ToString('N'))
$SkillBackup = Join-Path $SkillParent ('.js-test-mapper-backup-' + [guid]::NewGuid().ToString('N'))
$BackupCreated = $false
$SkillCommitted = $false

function Test-FileSha256([string]$Path, [string]$Expected) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $stream = [IO.File]::OpenRead($Path)
    try { $actual = ([BitConverter]::ToString(([Security.Cryptography.SHA256]::Create()).ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose() }
    return ($actual -eq $Expected)
}
function Assert-RequiredFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Required release file is missing: $Path" }
}

try {
    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $node) { throw 'Node.js 20 or newer is required. Install Node.js and run this installer again.' }
    $nodeVersion = (& $node.Source -p 'process.versions.node').Trim()
    if ([int]($nodeVersion.Split('.')[0]) -lt 20) { throw "Node.js 20 or newer is required; detected $nodeVersion." }
    New-Item -ItemType Directory -Path $TempRoot -Force | Out-Null
    $zipPath = Join-Path $TempRoot $ReleaseZipName
    $siblingZip = if ($env:JS_TEST_MAPPER_RELEASE_DIR) { Join-Path $env:JS_TEST_MAPPER_RELEASE_DIR $ReleaseZipName } else { Join-Path $PSScriptRoot $ReleaseZipName }
    if (Test-Path -LiteralPath $siblingZip -PathType Leaf) { Copy-Item -LiteralPath $siblingZip -Destination $zipPath -Force }
    else { (New-Object Net.WebClient).DownloadFile($ReleaseUrl, $zipPath) }
    if (-not (Test-FileSha256 $zipPath $ReleaseZipSha256)) { throw 'Release ZIP SHA-256 verification failed. Nothing was installed.' }
    $payload = Join-Path $TempRoot 'payload'
    Expand-Archive -LiteralPath $zipPath -DestinationPath $payload -Force
    $payloadSkill = Join-Path $payload 'skills\js-test-mapper'
    foreach ($relative in @('SKILL.md', 'agents\openai.yaml', 'scripts\runtime-launcher.mjs')) { Assert-RequiredFile (Join-Path $payloadSkill $relative) }
    foreach ($relative in @('install-bundle.mjs', 'saitamasans-js-test-mapper-runtime-0.1.0.tgz', 'js-test-mapper-runtime-0.1.0.manifest.json')) { Assert-RequiredFile (Join-Path $payload $relative) }
    $runtimeArgs = @((Join-Path $payload 'install-bundle.mjs'), '--release-dir', $payload, '--install-root', $RuntimeRoot)
    if ($Repair) { $runtimeArgs += '--repair' }
    & $node.Source @runtimeArgs
    if ($LASTEXITCODE -ne 0) { throw "Runtime installation failed with exit code $LASTEXITCODE." }
    Assert-RequiredFile (Join-Path $RuntimeRoot 'runtime-receipt.json')
    & $node.Source (Join-Path $payloadSkill 'scripts\runtime-launcher.mjs') '--runtime-root' $RuntimeRoot '--runtime-info' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Runtime integrity verification failed.' }
    New-Item -ItemType Directory -Path $SkillParent -Force | Out-Null
    Copy-Item -LiteralPath $payloadSkill -Destination $SkillStaging -Recurse -Force
    foreach ($relative in @('SKILL.md', 'agents\openai.yaml', 'scripts\runtime-launcher.mjs')) { Assert-RequiredFile (Join-Path $SkillStaging $relative) }
    if (Test-Path -LiteralPath $SkillRoot) { Move-Item -LiteralPath $SkillRoot -Destination $SkillBackup; $BackupCreated = $true }
    Move-Item -LiteralPath $SkillStaging -Destination $SkillRoot
    foreach ($relative in @('SKILL.md', 'agents\openai.yaml', 'scripts\runtime-launcher.mjs')) { Assert-RequiredFile (Join-Path $SkillRoot $relative) }
    $SkillCommitted = $true
    if ($BackupCreated) { Remove-Item -LiteralPath $SkillBackup -Recurse -Force }
    Write-Host ''
    Write-Host 'js-test-mapper installation completed.' -ForegroundColor Green
    Write-Host "Skill:   $SkillRoot"
    Write-Host "Runtime: $RuntimeRoot"
    Write-Host 'Next: fully exit and reopen CC Switch / Codex.'
    Write-Host 'Confirm: Web JS Reverse Test Mapping / js-test-mapper.'
    Write-Host 'Call js-test-mapper to create a read-only JS reverse test map for this test site:'
    Write-Host 'https://example.test'
    exit 0
} catch {
    if (-not $SkillCommitted) {
        if (Test-Path -LiteralPath $SkillRoot) { Remove-Item -LiteralPath $SkillRoot -Recurse -Force -ErrorAction SilentlyContinue }
        if ($BackupCreated -and (Test-Path -LiteralPath $SkillBackup)) { Move-Item -LiteralPath $SkillBackup -Destination $SkillRoot -ErrorAction SilentlyContinue }
    }
    Write-Error $_.Exception.Message
    exit 1
} finally {
    if (Test-Path -LiteralPath $SkillStaging) { Remove-Item -LiteralPath $SkillStaging -Recurse -Force -ErrorAction SilentlyContinue }
    if (Test-Path -LiteralPath $TempRoot) { Remove-Item -LiteralPath $TempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}
