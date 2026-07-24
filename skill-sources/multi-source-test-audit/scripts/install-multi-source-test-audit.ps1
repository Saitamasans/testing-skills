[CmdletBinding()]
param(
    [switch]$Force,
    [switch]$Repair,
    [string]$InstallRoot = $(if ($env:TESTING_SKILLS_INSTALL_ROOT) { $env:TESTING_SKILLS_INSTALL_ROOT } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.agents\skills' }),
    [string]$StateRoot = $(if ($env:TESTING_SKILLS_STATE_ROOT) { $env:TESTING_SKILLS_STATE_ROOT } else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.testing-skills' }),
    [string]$ReleaseUrl,
    [string]$ReleaseSha256,
    [switch]$AllowLocalFixture
)

$ErrorActionPreference = 'Stop'
$script:Slug = 'multi-source-test-audit'
$script:Version = '0.1.2'
$script:ReleaseTag = 'multi-source-test-audit-v0.1.2'
$script:InstallerVersion = '0.1.2'
$script:ArchiveName = 'multi-source-test-audit-0.1.2-windows-x64.zip'
$script:FixedReleaseUrl = "https://github.com/Saitamasans/testing-skills/releases/download/$script:ReleaseTag/$script:ArchiveName"
$script:PublishedArchiveSha256 = '__ARCHIVE_SHA256__'

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Assert-ReleaseUrl {
    param([Parameter(Mandatory = $true)][string]$Url)
    $parsed = $null
    if (-not [Uri]::TryCreate($Url, [UriKind]::Absolute, [ref]$parsed)) { throw 'release_not_published: invalid release URL' }
    if ($AllowLocalFixture -and $parsed.IsLoopback -and $parsed.Scheme -eq 'http') { return }
    $expectedPath = "/Saitamasans/testing-skills/releases/download/$script:ReleaseTag/$script:ArchiveName"
    if ($parsed.Scheme -cne 'https' -or $parsed.Host -cne 'github.com' -or $parsed.AbsolutePath -cne $expectedPath) {
        throw 'release_not_published: release URL is not the fixed immutable Release URL'
    }
}

function Assert-ReleaseConfiguration {
    param([string]$Url, [string]$Sha256)
    $placeholder = '__' + 'ARCHIVE_SHA256__'
    if (-not $Url) { $Url = $script:FixedReleaseUrl }
    if (-not $Sha256) { $Sha256 = $script:PublishedArchiveSha256 }
    if ($AllowLocalFixture -and $Sha256 -eq $placeholder) {
        throw 'release_not_published: local fixture still requires an explicit archive SHA-256'
    }
    if (-not $AllowLocalFixture -and ($Sha256 -eq $placeholder -or $Sha256 -notmatch '^[0-9a-fA-F]{64}$')) {
        throw 'release_not_published: installer template requires immutable Release SHA-256'
    }
    Assert-ReleaseUrl -Url $Url
    return [pscustomobject]@{ Url = $Url; Sha256 = $Sha256.ToLowerInvariant() }
}

function New-Directory {
    param([Parameter(Mandatory = $true)][string]$Path)
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw "installation_failed: reparse point is not allowed: $Path" }
}

function Test-SafeRelativePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.StartsWith('/') -or $Path.StartsWith('\\') -or $Path.Contains(':')) { return $false }
    $parts = $Path.Replace('\', '/').Split('/')
    return (-not ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }))
}

function Expand-SafeZip {
    param(
        [Parameter(Mandatory = $true)][string]$Archive,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    New-Directory -Path $Destination
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    $seen = @{}
    try {
        foreach ($entry in $zip.Entries) {
            $relative = $entry.FullName.Replace('\', '/')
            if ($relative.EndsWith('/')) { continue }
            if (-not (Test-SafeRelativePath -Path $relative)) { throw "installation_failed: unsafe ZIP member: $($entry.FullName)" }
            $canonical = $relative.ToLowerInvariant()
            if ($seen.ContainsKey($canonical)) { throw "installation_failed: duplicate ZIP member: $($entry.FullName)" }
            $seen[$canonical] = $true
            $mode = ([int64]$entry.ExternalAttributes -shr 16) -band 0xF000
            if ($mode -eq 0xA000) { throw "installation_failed: symbolic links are not allowed: $($entry.FullName)" }
            $target = Join-Path $Destination ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
            $parent = Split-Path -Parent $target
            New-Directory -Path $parent
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
        }
    }
    finally { $zip.Dispose() }
}

function Get-Json {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "installation_failed: missing manifest: $Path" }
    return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
}

function Assert-RuntimeManifest {
    param([Parameter(Mandatory = $true)][string]$BundleRoot)
    $path = Join-Path $BundleRoot 'runtime\runtime-manifest.json'
    $manifest = Get-Json -Path $path
    if ($manifest.slug -cne $script:Slug -or $manifest.runtime_version -cne $script:Version -or $manifest.python_version -cne '3.12.10' -or $manifest.platform -cne 'windows-x64') {
        throw 'installation_failed: runtime manifest identity mismatch'
    }
    $expected = [ordered]@{ openpyxl = '3.1.5'; cryptography = '49.0.0'; cffi = '2.1.0'; et_xmlfile = '2.0.0'; pycparser = '3.0' }
    foreach ($name in $expected.Keys) {
        if ([string]$manifest.dependencies.$name -cne $expected[$name]) { throw "installation_failed: dependency version mismatch: $name" }
    }
    foreach ($field in @('python_executable', 'application_entry', 'schemas', 'key_files', 'isolation')) {
        if ($null -eq $manifest.$field) { throw "installation_failed: runtime manifest field missing: $field" }
    }
    foreach ($item in $manifest.key_files.psobject.Properties) {
        if (-not (Test-SafeRelativePath -Path $item.Name) -or [string]$item.Value -notmatch '^[0-9a-fA-F]{64}$') { throw 'installation_failed: invalid runtime key-file manifest' }
        $file = Join-Path $BundleRoot ($item.Name.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Sha256 $file) -cne ([string]$item.Value).ToLowerInvariant()) { throw "installation_failed: runtime key-file hash mismatch: $($item.Name)" }
    }
    foreach ($schema in @($manifest.schemas)) {
        $schemaPath = Join-Path $BundleRoot ([string]$schema)
        if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) { throw "installation_failed: schema missing: $schema" }
    }
    return $manifest
}

function Assert-BundleManifest {
    param([Parameter(Mandatory = $true)][string]$BundleRoot)
    $path = Join-Path $BundleRoot 'bundle-manifest.json'
    $manifest = Get-Json -Path $path
    if ($manifest.slug -cne $script:Slug -or $manifest.runtime_version -cne $script:Version) { throw 'installation_failed: bundle manifest identity mismatch' }
    $expected = @{}
    foreach ($item in @($manifest.files)) {
        $relative = ([string]$item.path).Replace('\', '/')
        if (-not (Test-SafeRelativePath -Path $relative) -or $relative -eq 'bundle-manifest.json' -or $item.sha256 -notmatch '^[0-9a-fA-F]{64}' -or [int64]$item.size -lt 0) { throw 'installation_failed: invalid bundle manifest entry' }
        if ($expected.ContainsKey($relative)) { throw "installation_failed: duplicate bundle manifest entry: $relative" }
        $expected[$relative] = $item
        $file = Join-Path $BundleRoot ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "installation_failed: bundle file missing: $relative" }
        $info = Get-Item -LiteralPath $file -Force
        if ($info.Length -ne [int64]$item.size -or (Get-Sha256 $file) -cne ([string]$item.sha256).ToLowerInvariant()) { throw "installation_failed: bundle hash mismatch: $relative" }
    }
    $actual = @(Get-ChildItem -LiteralPath $BundleRoot -Recurse -File | ForEach-Object { $_.FullName.Substring($BundleRoot.TrimEnd('\').Length + 1).Replace('\', '/') } | Where-Object { $_ -ne 'bundle-manifest.json' -and $_ -notmatch '(^|/)__pycache__/.*\.pyc$' })
    if ((@($actual | Sort-Object) -join "`n") -cne (@($expected.Keys | Sort-Object) -join "`n")) { throw 'installation_failed: bundle manifest inventory mismatch' }
    return $path
}

function Invoke-Smoke {
    param([Parameter(Mandatory = $true)][string]$BundleRoot)
    $smoke = Join-Path $BundleRoot 'scripts\runtime-smoke.ps1'
    if (-not (Test-Path -LiteralPath $smoke -PathType Leaf)) { throw 'installation_failed: runtime smoke script missing' }
    $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    if (-not (Test-Path -LiteralPath $powershell -PathType Leaf)) { $powershell = (Get-Command powershell.exe -ErrorAction Stop).Source }
    & $powershell -NoProfile -ExecutionPolicy Bypass -File $smoke
    if ($LASTEXITCODE -ne 0) { throw "installation_failed: staging smoke failed ($LASTEXITCODE)" }
}

function Invoke-InstalledSmoke {
    param([Parameter(Mandatory = $true)][string]$InstallationPath)
    $launcher = Join-Path $InstallationPath 'scripts\multi-source-test-audit.ps1'
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'installation_failed: installed launcher missing' }
    & $launcher --version
    if ($LASTEXITCODE -ne 0) { throw "installation_failed: installed smoke failed ($LASTEXITCODE)" }
}

function Write-ReceiptAtomic {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$InstallationPath,
        [Parameter(Mandatory = $true)][string]$ArchiveSha256,
        [Parameter(Mandatory = $true)][string]$BundleManifestSha256,
        [Parameter(Mandatory = $true)][bool]$Repaired
    )
    $parent = Split-Path -Parent $Path
    New-Directory -Path $parent
    $temporary = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $receipt = [ordered]@{
        slug = $script:Slug
        version = $script:Version
        release_tag = $script:ReleaseTag
        archive_sha256 = $ArchiveSha256
        bundle_manifest_sha256 = $BundleManifestSha256
        installation_path = [IO.Path]::GetFullPath($InstallationPath)
        installed_at = [DateTime]::UtcNow.ToString('o')
        python_version = '3.12.10'
        openpyxl_version = '3.1.5'
        cryptography_version = '49.0.0'
        cffi_version = '2.1.0'
        smoke_status = 'passed'
        repaired = $Repaired
        installer_version = $script:InstallerVersion
    }
    try {
        $json = $receipt | ConvertTo-Json -Depth 10
        [IO.File]::WriteAllText($temporary, "$json`n", (New-Object Text.UTF8Encoding($false)))
        Move-Item -LiteralPath $temporary -Destination $Path -Force
    }
    finally { Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue }
}

function Install-Release {
    $configuration = Assert-ReleaseConfiguration -Url $ReleaseUrl -Sha256 $ReleaseSha256
    New-Directory -Path $InstallRoot
    New-Directory -Path $StateRoot
    $target = Join-Path $InstallRoot $script:Slug
    $receiptPath = Join-Path $StateRoot "installations\$script:Slug.json"
    if ((Test-Path -LiteralPath $target) -and -not $Force -and -not $Repair) {
        throw "installation_failed: existing installation requires -Force or -Repair: $target"
    }
    $tempRoot = Join-Path ([IO.Path]::GetTempPath()) "${script:Slug}-$([Guid]::NewGuid().ToString('N'))"
    $archive = Join-Path $tempRoot $script:ArchiveName
    $extractRoot = Join-Path $tempRoot 'extract'
    $stage = Join-Path $tempRoot 'stage'
    $backup = "$target.backup-$([Guid]::NewGuid().ToString('N'))"
    $activated = $false
    try {
        New-Directory -Path $tempRoot
        Invoke-WebRequest -UseBasicParsing -Uri $configuration.Url -OutFile $archive
        if ((Get-Sha256 $archive) -cne $configuration.Sha256) { throw 'installation_failed: ZIP SHA-256 mismatch' }
        Expand-SafeZip -Archive $archive -Destination $extractRoot
        $bundle = Join-Path $extractRoot $script:Slug
        if (-not (Test-Path -LiteralPath $bundle -PathType Container)) { throw 'installation_failed: archive root is missing' }
        Assert-RuntimeManifest -BundleRoot $bundle | Out-Null
        $bundleManifestPath = Assert-BundleManifest -BundleRoot $bundle
        $bundleSha = Get-Sha256 -Path $bundleManifestPath
        Invoke-Smoke -BundleRoot $bundle
        New-Directory -Path (Split-Path -Parent $stage)
        Move-Item -LiteralPath $bundle -Destination $stage
        if (Test-Path -LiteralPath $target) { Move-Item -LiteralPath $target -Destination $backup }
        Move-Item -LiteralPath $stage -Destination $target
        $activated = $true
        Invoke-InstalledSmoke -InstallationPath $target
        Write-ReceiptAtomic -Path $receiptPath -InstallationPath $target -ArchiveSha256 $configuration.Sha256 -BundleManifestSha256 $bundleSha -Repaired:($Repair -or $Force)
        Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction SilentlyContinue
        Write-Output "installed: $target"
    }
    catch {
        if ($activated -and (Test-Path -LiteralPath $target)) { Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue }
        if (Test-Path -LiteralPath $backup) { Move-Item -LiteralPath $backup -Destination $target -Force }
        throw
    }
    finally { Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction SilentlyContinue }
}

try { Install-Release; exit 0 }
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    if ($_.Exception.Message -like 'release_not_published:*') { exit 30 }
    exit 1
}
