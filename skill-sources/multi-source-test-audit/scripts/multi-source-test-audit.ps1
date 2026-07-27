[CmdletBinding()]
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

$ErrorActionPreference = 'Stop'
$script:Root = Split-Path -Parent $PSScriptRoot
$script:Python = Join-Path $script:Root 'runtime\python\python.exe'
$script:RuntimeManifestPath = Join-Path $script:Root 'runtime\runtime-manifest.json'
$script:BundleManifestPath = Join-Path $script:Root 'bundle-manifest.json'

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Test-SafeRelativePath {
    param([Parameter(Mandatory = $true)][string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path) -or $Path.StartsWith('/') -or $Path.StartsWith('\\') -or $Path.Contains(':')) { return $false }
    $parts = $Path.Replace('\', '/').Split('/')
    return (-not ($parts | Where-Object { $_ -eq '' -or $_ -eq '.' -or $_ -eq '..' }))
}

function Read-Manifest {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw 'installation_incomplete: required manifest is missing' }
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Assert-Bundle {
    $runtime = Read-Manifest -Path $script:RuntimeManifestPath
    if ($runtime.slug -cne 'multi-source-test-audit' -or $runtime.runtime_version -cne '0.1.5' -or $runtime.python_version -cne '3.12.10' -or $runtime.platform -cne 'windows-x64') { throw 'installation_incomplete: runtime manifest identity mismatch' }
    $expectedDependencies = [ordered]@{ openpyxl = '3.1.5'; cryptography = '49.0.0'; cffi = '2.1.0'; et_xmlfile = '2.0.0'; pycparser = '3.0' }
    foreach ($name in $expectedDependencies.Keys) {
        if ([string]$runtime.dependencies.$name -cne $expectedDependencies[$name]) { throw "installation_incomplete: dependency version mismatch: $name" }
    }
    foreach ($item in $runtime.key_files.psobject.Properties) {
        if (-not (Test-SafeRelativePath -Path $item.Name) -or [string]$item.Value -notmatch '^[0-9a-fA-F]{64}$') { throw 'installation_incomplete: invalid runtime key-file manifest' }
        $file = Join-Path $script:Root ($item.Name.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Sha256 $file) -cne ([string]$item.Value).ToLowerInvariant()) { throw "installation_incomplete: runtime manifest hash mismatch: $($item.Name)" }
    }
    foreach ($schema in @($runtime.schemas)) {
        $schemaPath = Join-Path $script:Root ([string]$schema)
        if (-not (Test-Path -LiteralPath $schemaPath -PathType Leaf)) { throw "installation_incomplete: schema missing: $schema" }
    }
    $bundle = Read-Manifest -Path $script:BundleManifestPath
    if ($bundle.slug -cne 'multi-source-test-audit' -or $bundle.runtime_version -cne '0.1.5') { throw 'installation_incomplete: bundle manifest identity mismatch' }
    $expected = @{}
    foreach ($item in @($bundle.files)) {
        $relative = ([string]$item.path).Replace('\', '/')
        if (-not (Test-SafeRelativePath -Path $relative) -or $relative -eq 'bundle-manifest.json' -or [string]$item.sha256 -notmatch '^[0-9a-fA-F]{64}$') { throw 'installation_incomplete: invalid bundle manifest entry' }
        if ($expected.ContainsKey($relative)) { throw "installation_incomplete: duplicate bundle manifest entry: $relative" }
        $expected[$relative] = $item
        $file = Join-Path $script:Root ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
        if (-not (Test-Path -LiteralPath $file -PathType Leaf) -or (Get-Item -LiteralPath $file).Length -ne [int64]$item.size -or (Get-Sha256 $file) -cne ([string]$item.sha256).ToLowerInvariant()) { throw "installation_incomplete: bundle manifest hash mismatch: $relative" }
    }
    $actual = @(Get-ChildItem -LiteralPath $script:Root -Recurse -File | ForEach-Object { $_.FullName.Substring($script:Root.TrimEnd('\').Length + 1).Replace('\', '/') } | Where-Object { $_ -ne 'bundle-manifest.json' -and $_ -notmatch '(^|/)__pycache__/.*\.pyc$' })
    if ((@($actual | Sort-Object) -join "`n") -cne (@($expected.Keys | Sort-Object) -join "`n")) { throw 'installation_incomplete: bundle manifest inventory mismatch' }
    return $runtime
}

try {
    if (-not (Test-Path -LiteralPath $script:Python -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $script:Root 'VERSION') -PathType Leaf)) { throw 'installation_incomplete: bundled Runtime files are missing' }
    if ((Get-Content -LiteralPath (Join-Path $script:Root 'VERSION') -Raw).Trim() -cne '0.1.5') { throw 'installation_incomplete: VERSION mismatch' }
    Assert-Bundle | Out-Null
    & $script:Python -I -m multi_source_test_audit @Arguments
    exit $LASTEXITCODE
}
catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 20
}
