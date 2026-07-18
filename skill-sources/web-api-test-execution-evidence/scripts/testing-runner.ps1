[CmdletBinding()]
param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$RunnerArgs
)

$ErrorActionPreference = "Stop"
$skillName = "web-api-test-execution-evidence"

function Throw-InstallationError {
    param([Parameter(Mandatory = $true)][string]$Code, [Parameter(Mandatory = $true)][string]$Message)

    $exception = [InvalidOperationException]::new("${Code}: $Message")
    $exception.Data["installation_code"] = $Code
    throw $exception
}

function Throw-Incomplete { param([string]$Message) Throw-InstallationError -Code "installation_incomplete" -Message $Message }
function Throw-Corrupt { param([string]$Message) Throw-InstallationError -Code "installation_corrupt" -Message $Message }

function Test-ChildPath {
    param([Parameter(Mandatory = $true)][string]$Parent, [Parameter(Mandatory = $true)][string]$Child)

    $parentFull = [IO.Path]::GetFullPath($Parent).TrimEnd("\")
    $childFull = [IO.Path]::GetFullPath($Child)
    return $childFull.StartsWith($parentFull + "\", [StringComparison]::OrdinalIgnoreCase)
}

function Get-ExistingItem {
    param([Parameter(Mandatory = $true)][string]$Path, [Parameter(Mandatory = $true)][string]$Label)

    try { return Get-Item -LiteralPath $Path -Force } catch { Throw-Incomplete "$Label is missing." }
}

function Assert-NoReparseChain {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Label
    )

    if (-not (Test-ChildPath -Parent $Root -Child $Target)) {
        Throw-Corrupt "$Label is outside its canonical root."
    }
    $rootFull = [IO.Path]::GetFullPath($Root)
    $cursor = [IO.Path]::GetFullPath($Target)
    while ($true) {
        $item = Get-ExistingItem -Path $cursor -Label $Label
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            Throw-Corrupt "$Label contains a reparse point."
        }
        if ([string]::Equals($cursor, $rootFull, [StringComparison]::OrdinalIgnoreCase)) { break }
        $parent = Split-Path -Parent $cursor
        if ([string]::IsNullOrEmpty($parent) -or [string]::Equals($parent, $cursor, [StringComparison]::OrdinalIgnoreCase)) {
            Throw-Corrupt "$Label cannot be traced to its canonical root."
        }
        $cursor = $parent
    }
}

function Get-VerifiedManifestFile {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$Runtime,
        [Parameter(Mandatory = $true)][string]$Relative,
        [Parameter(Mandatory = $true)][string]$Label
    )

    $record = @($Manifest.files | Where-Object { $_.path -ceq $Relative })
    if (
        $record.Count -ne 1 -or
        [long]$record[0].size_bytes -le 0 -or
        [string]$record[0].sha256 -cnotmatch "^[a-f0-9]{64}$"
    ) {
        Throw-Corrupt "$Label inventory record is invalid."
    }
    $target = Join-Path $Runtime ($Relative -replace "/", "\")
    Assert-NoReparseChain -Root $Runtime -Target $target -Label $Label
    $item = Get-ExistingItem -Path $target -Label $Label
    if (-not $item.PSIsContainer -and $item.Length -eq [long]$record[0].size_bytes -and (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ceq [string]$record[0].sha256) {
        return $target
    }
    Throw-Corrupt "$Label does not match payload inventory."
}

function Get-RunnerArgs {
    param([string[]]$DirectArgs)

    if ([string]::IsNullOrEmpty($env:TESTING_RUNNER_ARGS_B64)) { return @($DirectArgs) }
    if (@($DirectArgs).Count -gt 0) { Throw-Corrupt "direct arguments cannot be combined with TESTING_RUNNER_ARGS_B64." }
    try {
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($env:TESTING_RUNNER_ARGS_B64))
    } catch {
        Throw-Corrupt "TESTING_RUNNER_ARGS_B64 is not valid Base64."
    }
    if (-not $json.TrimStart().StartsWith("[")) { Throw-Corrupt "TESTING_RUNNER_ARGS_B64 must encode a JSON argument array." }
    try { $decoded = ConvertFrom-Json -InputObject $json } catch { Throw-Corrupt "TESTING_RUNNER_ARGS_B64 must encode valid JSON." }
    $output = @()
    foreach ($argument in @($decoded)) {
        if ($argument -isnot [string]) { Throw-Corrupt "TESTING_RUNNER_ARGS_B64 must encode only string arguments." }
        $output += $argument
    }
    return $output
}

try {
    $profileRoot = if ($env:USERPROFILE) { $env:USERPROFILE } else { [Environment]::GetFolderPath("UserProfile") }
    $stateRoot = if ($env:TESTING_SKILLS_STATE_ROOT) { $env:TESTING_SKILLS_STATE_ROOT } else { Join-Path $profileRoot ".testing-skills" }
    $installRoot = if ($env:TESTING_SKILLS_INSTALL_ROOT) { $env:TESTING_SKILLS_INSTALL_ROOT } else { Join-Path $profileRoot ".agents\skills" }
    $runtimeRoot = Join-Path $stateRoot "runtime\$skillName"
    $diagnosticsRoot = Join-Path $stateRoot "diagnostics\$skillName"
    $receiptPath = Join-Path $stateRoot "installations\$skillName.json"
    try { $receiptText = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 } catch { Throw-Incomplete "canonical installation receipt is missing." }
    try { $receipt = $receiptText | ConvertFrom-Json } catch { Throw-Corrupt "canonical installation receipt schema is invalid." }
    if (
        $receipt.schema_version -ne 1 -or
        $receipt.skill -cne $skillName -or
        $receipt.bundle_version -cne "1.0.0" -or
        [string]$receipt.payload_manifest_sha256 -cnotmatch "^[a-f0-9]{64}$"
    ) {
        Throw-Corrupt "canonical installation receipt schema is invalid."
    }

    try {
        $runtime = [IO.Path]::GetFullPath([string]$receipt.runtime_path)
        $skill = [IO.Path]::GetFullPath([string]$receipt.skill_path)
        $diagnostics = [IO.Path]::GetFullPath([string]$receipt.diagnostics_path)
    } catch { Throw-Corrupt "canonical installation receipt paths are invalid." }
    $expectedSkill = [IO.Path]::GetFullPath((Join-Path $installRoot $skillName))
    if (
        -not (Test-ChildPath -Parent $runtimeRoot -Child $runtime) -or
        -not [string]::Equals($skill, $expectedSkill, [StringComparison]::OrdinalIgnoreCase) -or
        -not (Test-ChildPath -Parent $diagnosticsRoot -Child $diagnostics)
    ) {
        Throw-Corrupt "receipt paths are outside the canonical installation roots."
    }

    Assert-NoReparseChain -Root $runtimeRoot -Target $runtime -Label "receipt runtime path"
    Assert-NoReparseChain -Root $installRoot -Target $skill -Label "receipt skill path"
    Assert-NoReparseChain -Root $diagnosticsRoot -Target $diagnostics -Label "receipt diagnostics path"

    $manifestPath = Join-Path $runtime "bundle-manifest.json"
    Assert-NoReparseChain -Root $runtime -Target $manifestPath -Label "payload manifest"
    if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$receipt.payload_manifest_sha256) {
        Throw-Corrupt "payload manifest SHA-256 does not match receipt."
    }
    try { $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch { Throw-Corrupt "payload manifest is not valid JSON." }
    if ($manifest.schema_version -ne 1 -or -not $manifest.files) { Throw-Corrupt "payload manifest schema is invalid." }

    $node = Get-VerifiedManifestFile -Manifest $manifest -Runtime $runtime -Relative "node/node.exe" -Label "bundled Node"
    $runtimeLauncher = Get-VerifiedManifestFile -Manifest $manifest -Runtime $runtime -Relative "skill/web-api-test-execution-evidence/scripts/testing-runner.mjs" -Label "bundled runtime launcher"
    $null = Get-VerifiedManifestFile -Manifest $manifest -Runtime $runtime -Relative "skill/web-api-test-execution-evidence/scripts/installed-runtime-lib.mjs" -Label "bundled runtime verifier"

    Remove-Item Env:NODE_OPTIONS -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_PATH -ErrorAction SilentlyContinue
    Remove-Item Env:NODE_REPL_EXTERNAL_MODULE -ErrorAction SilentlyContinue
    $runnerArgs = @(Get-RunnerArgs -DirectArgs $RunnerArgs)
    $runnerArgsJson = "[" + ((@($runnerArgs) | ForEach-Object { ConvertTo-Json -InputObject $_ -Compress }) -join ",") + "]"
    $env:TESTING_RUNNER_ARGS_B64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($runnerArgsJson))
    $process = Start-Process -FilePath $node -ArgumentList ('"{0}"' -f $runtimeLauncher) -Wait -PassThru -NoNewWindow
    exit $process.ExitCode
}
catch {
    $code = [string]$_.Exception.Data["installation_code"]
    if ($code -ne "installation_corrupt" -and $code -ne "installation_incomplete") { $code = "installation_incomplete" }
    [Console]::Error.WriteLine("${code}: " + $_.Exception.Message + " Rerun the GitHub Release installer with -Repair.")
    exit 20
}
