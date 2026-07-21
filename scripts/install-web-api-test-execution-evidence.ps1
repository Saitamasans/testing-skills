[CmdletBinding()]
param(
    [ValidateSet("x64", "arm64")]
    [string]$Architecture,

    [string]$ManifestUri,

    [string]$ManifestSha256,

    [ValidateNotNullOrEmpty()]
    [string]$InstallRoot = $(if ($env:TESTING_SKILLS_INSTALL_ROOT) { $env:TESTING_SKILLS_INSTALL_ROOT } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) ".agents\skills" }),

    [ValidateNotNullOrEmpty()]
    [string]$StateRoot = $(if ($env:TESTING_SKILLS_STATE_ROOT) { $env:TESTING_SKILLS_STATE_ROOT } else { Join-Path ([Environment]::GetFolderPath("UserProfile")) ".testing-skills" }),

    [switch]$Repair,

    [switch]$Force,

    [switch]$AllowLocalFixture,

    [string]$LocalSmokeScript,

    [ValidateRange(0, 20)]
    [int]$MaxRetries = 5,

    [ValidateRange(0, 60000)]
    [int]$RetryDelayMilliseconds = 750,

    [ValidateRange(0, 1099511627776)]
    [long]$SafetyMarginBytes = 536870912,

    [long]$TestAvailableBytes = -1,

    [ValidateSet("", "AfterRuntime", "AfterSkill", "BeforeReceipt", "ReceiptWrite")]
    [string]$TestFailurePoint = ""
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

$script:SkillName = "web-api-test-execution-evidence"
$script:BundleVersion = "1.0.2"
$script:ReleaseTag = "web-api-test-execution-evidence-v1.0.2"
$script:PinnedManifests = @{
    x64 = @{
        Uri = "https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/web-api-test-execution-evidence-1.0.2-windows-x64.manifest.json"
        Sha256 = "__X64_COMPANION_MANIFEST_SHA256__"
    }
    arm64 = @{
        Uri = "https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/web-api-test-execution-evidence-1.0.2-windows-arm64.manifest.json"
        Sha256 = "__ARM64_COMPANION_MANIFEST_SHA256__"
    }
}

function Get-Sha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
    try {
        $algorithm = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        }
        finally {
            $algorithm.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Get-BytesSha256 {
    param([Parameter(Mandatory = $true)][byte[]]$Bytes)

    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($Bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Write-JsonUtf8 {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Value
    )

    $parent = Split-Path -Parent $Path
    if ($parent) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    $json = ($Value | ConvertTo-Json -Depth 20) + "`n"
    [IO.File]::WriteAllText($Path, $json, (New-Object Text.UTF8Encoding($false)))
}

function Assert-TrustedUri {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [switch]$AllowLocal
    )

    $parsed = $null
    if (-not [Uri]::TryCreate($Uri, [UriKind]::Absolute, [ref]$parsed)) {
        throw "无效下载地址：$Uri"
    }
    if ($parsed.Scheme -eq "https") {
        return $parsed
    }
    if ($AllowLocal -and $parsed.Scheme -eq "http" -and $parsed.IsLoopback) {
        return $parsed
    }
    throw "下载地址必须使用 HTTPS，且重定向不得降级：$Uri"
}

function Assert-ProjectReleaseUri {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [switch]$AllowLocal
    )

    $parsed = Assert-TrustedUri -Uri $Uri -AllowLocal:$AllowLocal
    if ($AllowLocal -and $parsed.IsLoopback) {
        return $parsed
    }
    $expectedPrefix = "/Saitamasans/testing-skills/releases/download/$script:ReleaseTag/"
    if ($parsed.Host -cne "github.com" -or -not $parsed.AbsolutePath.StartsWith($expectedPrefix, [StringComparison]::Ordinal)) {
        throw "下载地址不属于固定项目 Release：$Uri"
    }
    return $parsed
}

function Get-WindowsArchitecture {
    $reported = $null
    try {
        $reported = (Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop).OSArchitecture
    }
    catch {
        $reported = ""
    }
    $machine = $env:PROCESSOR_ARCHITEW6432
    if (-not $machine) {
        $machine = $env:PROCESSOR_ARCHITECTURE
    }
    $combined = "$reported $machine".ToUpperInvariant()
    if ($combined.Contains("ARM64")) {
        return "arm64"
    }
    if ($combined.Contains("64") -or $combined.Contains("AMD64")) {
        return "x64"
    }
    throw "不支持的 Windows 架构：$reported $machine。仅支持 x64 和 ARM64。"
}

function Get-PinnedManifest {
    param([Parameter(Mandatory = $true)][ValidateSet("x64", "arm64")][string]$Architecture)

    return $script:PinnedManifests[$Architecture]
}

function Get-StringSha256 {
    param([Parameter(Mandatory = $true)][string]$Value)

    $bytes = [Text.Encoding]::UTF8.GetBytes($Value)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($algorithm.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
    }
    finally {
        $algorithm.Dispose()
    }
}

function Initialize-FinalPathApi {
    if ("TestingSkills.WindowsFinalPath" -as [type]) { return }
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace TestingSkills {
    public static class WindowsFinalPath {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern SafeFileHandle CreateFile(
            string fileName,
            uint desiredAccess,
            uint shareMode,
            IntPtr securityAttributes,
            uint creationDisposition,
            uint flagsAndAttributes,
            IntPtr templateFile);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern uint GetFinalPathNameByHandle(
            SafeFileHandle file,
            StringBuilder path,
            uint pathLength,
            uint flags);

        public static string Resolve(string path) {
            const uint ShareAll = 1U | 2U | 4U;
            const uint OpenExisting = 3U;
            const uint BackupSemantics = 0x02000000U;
            using (SafeFileHandle handle = CreateFile(
                path, 0U, ShareAll, IntPtr.Zero, OpenExisting, BackupSemantics, IntPtr.Zero)) {
                if (handle.IsInvalid) {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                StringBuilder buffer = new StringBuilder(1024);
                uint length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0U);
                if (length == 0U) {
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                }
                if (length >= buffer.Capacity) {
                    buffer = new StringBuilder((int)length + 1);
                    length = GetFinalPathNameByHandle(handle, buffer, (uint)buffer.Capacity, 0U);
                    if (length == 0U || length >= buffer.Capacity) {
                        throw new Win32Exception(Marshal.GetLastWin32Error());
                    }
                }
                return buffer.ToString();
            }
        }
    }
}
"@
}

function Remove-ExtendedPathPrefix {
    param([Parameter(Mandatory = $true)][string]$Path)

    if ($Path.StartsWith("\\?\UNC\", [StringComparison]::OrdinalIgnoreCase)) {
        return "\\" + $Path.Substring(8)
    }
    if ($Path.StartsWith("\\?\", [StringComparison]::OrdinalIgnoreCase)) {
        return $Path.Substring(4)
    }
    return $Path
}

function Get-RootPreservingFullPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    $trimmed = $full.TrimEnd("\", "/")
    if ($trimmed.Equals($root.TrimEnd("\", "/"), [StringComparison]::OrdinalIgnoreCase)) {
        return $full
    }
    return $trimmed
}

function Resolve-PhysicalInstallRoot {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot
    )

    Initialize-FinalPathApi
    $full = Get-RootPreservingFullPath -Path $InstallRoot
    $existing = $full
    $suffix = New-Object Collections.Generic.List[string]
    while (-not [IO.Directory]::Exists($existing)) {
        $leaf = [IO.Path]::GetFileName($existing)
        if (-not $leaf) {
            throw "无法解析安装目录的物理父路径：$InstallRoot"
        }
        $suffix.Insert(0, $leaf)
        $parent = [IO.Directory]::GetParent($existing)
        if (-not $parent) {
            throw "无法解析安装目录的物理父路径：$InstallRoot"
        }
        $existing = $parent.FullName
    }
    $physical = Remove-ExtendedPathPrefix -Path ([TestingSkills.WindowsFinalPath]::Resolve($existing))
    foreach ($segment in $suffix) {
        $physical = [IO.Path]::Combine($physical, $segment)
    }
    return (Get-RootPreservingFullPath -Path $physical).ToUpperInvariant()
}

function Get-InstallerMutexName {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$SkillName
    )

    $physicalRoot = Resolve-PhysicalInstallRoot -InstallRoot $InstallRoot
    $digest = Get-StringSha256 -Value "$SkillName|$physicalRoot"
    return "Global\testing-skills-$SkillName-$digest"
}

function Enter-NamedInstallerMutex {
    param([Parameter(Mandatory = $true)][string]$Name)

    $mutex = New-Object Threading.Mutex($false, $Name)
    try {
        try {
            $acquired = $mutex.WaitOne(0)
        }
        catch [Threading.AbandonedMutexException] {
            $acquired = $true
        }
        if (-not $acquired) {
            throw "另一个安装进程正在运行，请等待其完成后重试。"
        }
        return $mutex
    }
    catch {
        $mutex.Dispose()
        throw
    }
}

function Enter-InstallerLock {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRoot,
        [Parameter(Mandatory = $true)][string]$SkillName
    )

    $textRoot = (Get-RootPreservingFullPath -Path $InstallRoot).ToUpperInvariant()
    $preliminaryName = "Global\testing-skills-preflight-" + (Get-StringSha256 -Value "$SkillName|$textRoot")
    $preliminary = Enter-NamedInstallerMutex -Name $preliminaryName
    try {
        $canonicalName = Get-InstallerMutexName -InstallRoot $InstallRoot -SkillName $SkillName
        return (Enter-NamedInstallerMutex -Name $canonicalName)
    }
    finally {
        $preliminary.ReleaseMutex()
        $preliminary.Dispose()
    }
}

function Assert-WritableDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    New-Item -ItemType Directory -Path $Path -Force | Out-Null
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
        throw "安装目录不得是重解析点：$Path"
    }
    $probe = Join-Path $Path (".write-probe-" + [Guid]::NewGuid().ToString("N"))
    try {
        [IO.File]::WriteAllText($probe, "probe")
    }
    catch {
        throw "目录没有写入权限：$Path"
    }
    finally {
        if (Test-Path -LiteralPath $probe) {
            Remove-Item -LiteralPath $probe -Force -ErrorAction SilentlyContinue
        }
    }
}

function Assert-Preflight {
    param(
        [Parameter(Mandatory = $true)][string]$InstallRootPath,
        [Parameter(Mandatory = $true)][string]$StateRootPath,
        [Parameter(Mandatory = $true)][long]$RequiredBytes,
        [long]$AvailableBytesOverride = -1
    )

    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw "完整运行时安装器仅支持 Windows。"
    }
    if ($InstallRootPath.Length -gt 180 -or $StateRootPath.Length -gt 180) {
        throw "安装根路径过长，请选择更短的目录。"
    }
    Assert-WritableDirectory -Path $InstallRootPath
    Assert-WritableDirectory -Path $StateRootPath

    $powerShellExe = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path -LiteralPath $powerShellExe -PathType Leaf)) {
        throw "找不到可启动的 Windows PowerShell 5.1。"
    }
    & $powerShellExe -NoProfile -Command "exit 0"
    if ($LASTEXITCODE -ne 0) {
        throw "当前策略不允许启动安装校验进程。"
    }

    if ($AvailableBytesOverride -ge 0) {
        $available = $AvailableBytesOverride
    }
    else {
        $root = [IO.Path]::GetPathRoot($StateRootPath)
        $drive = New-Object IO.DriveInfo($root)
        $available = $drive.AvailableFreeSpace
    }
    if ($available -lt $RequiredBytes) {
        throw "磁盘空间不足：需要 $RequiredBytes 字节，可用 $available 字节。"
    }
}

function New-TemporaryStatePathAlias {
    param([Parameter(Mandatory = $true)][string]$StateRootPath)

    $stateRoot = Get-RootPreservingFullPath -Path $StateRootPath
    $root = [IO.Path]::GetPathRoot($stateRoot)
    if ($root -notmatch "^[A-Za-z]:\\$") {
        throw "运行时短路径映射仅支持本地 Windows 卷：$StateRootPath"
    }
    $physicalStateRoot = Resolve-PhysicalInstallRoot -InstallRoot $stateRoot
    if ($physicalStateRoot -cne $stateRoot.ToUpperInvariant()) {
        throw "状态目录不得位于重解析路径下：$StateRootPath"
    }
    $subst = Join-Path $env:SystemRoot "System32\subst.exe"
    if (-not (Test-Path -LiteralPath $subst -PathType Leaf)) {
        throw "找不到 Windows 短路径映射工具：$subst"
    }

    foreach ($letter in [char[]]"ZYXWVUTSRQPONMLKJIHGFED") {
        $drive = ([string]$letter + ":")
        $aliasRoot = $drive + "\"
        if (Test-Path -LiteralPath $aliasRoot) { continue }
        & $subst $drive $stateRoot | Out-Null
        if ($LASTEXITCODE -ne 0) { continue }
        try {
            $aliasPhysical = Resolve-PhysicalInstallRoot -InstallRoot $aliasRoot
            if ($aliasPhysical -cne $physicalStateRoot) {
                throw "临时短路径映射未指向请求的状态目录。"
            }
            Write-Host "当前阶段=启用临时短路径；映射=$aliasRoot；物理=$stateRoot"
            return [pscustomobject]@{
                Drive = $drive
                Root = $aliasRoot
                Subst = $subst
            }
        }
        catch {
            & $subst /D $drive | Out-Null
            throw
        }
    }
    throw "没有可用于安全解压的临时短盘符。"
}

function Remove-TemporaryStatePathAlias {
    param([Parameter(Mandatory = $true)]$Alias)

    & ([string]$Alias.Subst) /D ([string]$Alias.Drive) | Out-Null
    if (Test-Path -LiteralPath ([string]$Alias.Root)) {
        throw "无法清理临时短路径映射：$([string]$Alias.Root)"
    }
    Write-Host "当前阶段=清理临时短路径；映射=$([string]$Alias.Root)"
}

function New-HttpRequest {
    param(
        [Parameter(Mandatory = $true)][Uri]$Uri,
        [long]$Offset = -1,
        [string]$IfRange
    )

    $request = [Net.HttpWebRequest]::Create($Uri)
    $request.Method = "GET"
    $request.AllowAutoRedirect = $false
    $request.AutomaticDecompression = [Net.DecompressionMethods]::GZip -bor [Net.DecompressionMethods]::Deflate
    $request.UserAgent = "testing-skills-complete-installer/1.0.2"
    $request.Timeout = 30000
    $request.ReadWriteTimeout = 30000
    $request.Proxy = [Net.WebRequest]::DefaultWebProxy
    if ($request.Proxy) {
        $request.Proxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
    }
    if ($Offset -ge 0) {
        $request.AddRange([long]$Offset)
        if ($IfRange) {
            $request.Headers["If-Range"] = $IfRange
        }
    }
    return $request
}

function Open-HttpResponse {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [long]$Offset = -1,
        [string]$IfRange,
        [switch]$AllowLocal
    )

    $current = Assert-TrustedUri -Uri $Uri -AllowLocal:$AllowLocal
    for ($redirect = 0; $redirect -le 5; $redirect++) {
        $request = New-HttpRequest -Uri $current -Offset $Offset -IfRange $IfRange
        $response = $null
        try {
            $response = $request.GetResponse()
        }
        catch [Net.WebException] {
            if ($_.Exception.Response) {
                $response = $_.Exception.Response
            }
            else {
                throw
            }
        }
        $status = [int]$response.StatusCode
        if ($status -in 301, 302, 303, 307, 308) {
            $location = $response.Headers["Location"]
            $response.Dispose()
            if (-not $location) {
                throw "HTTP 重定向缺少 Location。"
            }
            $next = New-Object Uri($current, $location)
            $current = Assert-TrustedUri -Uri $next.AbsoluteUri -AllowLocal:$AllowLocal
            continue
        }
        return [PSCustomObject]@{ Response = $response; FinalUri = $current }
    }
    throw "HTTP 重定向次数超过上限。"
}

function Read-ResponseBytes {
    param(
        [Parameter(Mandatory = $true)]$Response,
        [long]$MaximumBytes = 5242880
    )

    $inputStream = $Response.GetResponseStream()
    $memory = New-Object IO.MemoryStream
    try {
        $buffer = New-Object byte[] 65536
        while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            if ($memory.Length + $read -gt $MaximumBytes) {
                throw "可信清单超过允许大小。"
            }
            $memory.Write($buffer, 0, $read)
        }
        return ,$memory.ToArray()
    }
    finally {
        $inputStream.Dispose()
        $memory.Dispose()
    }
}

function Get-TrustedManifestBytes {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [int]$Retries,
        [int]$RetryDelay,
        [switch]$AllowLocal
    )

    if ($ExpectedSha256 -cnotmatch "^[a-f0-9]{64}$") {
        throw "安装器未写入有效的可信 companion manifest SHA-256。"
    }
    for ($attempt = 0; $attempt -le $Retries; $attempt++) {
        $opened = $null
        try {
            $opened = Open-HttpResponse -Uri $Uri -AllowLocal:$AllowLocal
            $status = [int]$opened.Response.StatusCode
            if ($status -ne 200) {
                throw "可信清单下载返回 HTTP $status。"
            }
            $bytes = [byte[]](Read-ResponseBytes -Response $opened.Response)
            $actual = Get-BytesSha256 -Bytes $bytes
            if ($actual -cne $ExpectedSha256) {
                throw "可信 companion manifest SHA-256 不匹配。"
            }
            return ,$bytes
        }
        catch {
            if ($attempt -ge $Retries) {
                throw
            }
            Write-Host "清单下载重试：重试=$($attempt + 1)，原因=$($_.Exception.Message)"
            Start-Sleep -Milliseconds $RetryDelay
        }
        finally {
            if ($opened -and $opened.Response) {
                $opened.Response.Dispose()
            }
        }
    }
}

function Assert-CompanionManifest {
    param(
        [Parameter(Mandatory = $true)]$Manifest,
        [Parameter(Mandatory = $true)][string]$SelectedArchitecture,
        [switch]$AllowLocal
    )

    if ($Manifest.schema_version -ne 1) { throw "companion manifest schema_version 无效。" }
    if ($Manifest.bundle.name -cne $script:SkillName) { throw "companion manifest bundle.name 无效。" }
    if ($Manifest.bundle.version -cne $script:BundleVersion) { throw "companion manifest bundle.version 无效。" }
    if ($Manifest.bundle.release_tag -cne $script:ReleaseTag) { throw "companion manifest release_tag 无效。" }
    if ($Manifest.bundle.os -cne "windows" -or $Manifest.bundle.arch -cne $SelectedArchitecture) {
        throw "companion manifest 平台或架构不匹配。"
    }
    $expectedName = "$script:SkillName-$script:BundleVersion-windows-$SelectedArchitecture.zip"
    if ($Manifest.archive.file_name -cne $expectedName) { throw "bundle 文件名无效。" }
    if ([long]$Manifest.archive.size_bytes -le 0) { throw "bundle 大小无效。" }
    if ([string]$Manifest.archive.sha256 -cnotmatch "^[a-f0-9]{64}$") { throw "bundle SHA-256 无效。" }
    Assert-ProjectReleaseUri -Uri $Manifest.archive.download_url -AllowLocal:$AllowLocal | Out-Null
    if ($Manifest.payload_manifest.path -cne "bundle-manifest.json") { throw "payload manifest 路径无效。" }
    if ([long]$Manifest.payload_manifest.size_bytes -le 0) { throw "payload manifest 大小无效。" }
    if ([string]$Manifest.payload_manifest.sha256 -cnotmatch "^[a-f0-9]{64}$") { throw "payload manifest SHA-256 无效。" }
    if ([long]$Manifest.installed_size_bytes -le 0) { throw "安装大小无效。" }
}

function Read-PartialMetadata {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return $null
    }
    try {
        return (Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function Write-DownloadProgress {
    param(
        [string]$Artifact,
        [long]$Total,
        [long]$Downloaded,
        [double]$StartedAt,
        [int]$RetryCount,
        [long]$ResumeOffset
    )

    if (-not $script:DownloadProgressState) {
        $script:DownloadProgressState = @{}
    }

    $elapsed = [Math]::Max(0.001, ([DateTime]::UtcNow - [DateTime]::FromFileTimeUtc([long]$StartedAt)).TotalSeconds)
    $transferred = [Math]::Max(0, $Downloaded - $ResumeOffset)
    $speed = [long]($transferred / $elapsed)
    $percent = if ($Total -gt 0) { [Math]::Min(100, [Math]::Round(($Downloaded * 100.0) / $Total, 1)) } else { 0 }
    $eta = if ($speed -gt 0) { [Math]::Ceiling(($Total - $Downloaded) / $speed) } else { "?" }
    $now = [DateTime]::UtcNow
    $key = $Artifact
    $previous = $script:DownloadProgressState[$key]
    $percentChanged = $null -eq $previous -or [Math]::Abs($percent - [double]$previous.Percent) -ge 0.1
    $due = $null -eq $previous -or ($now - $previous.At).TotalMilliseconds -ge 200
    $complete = $percent -ge 100
    $line = "当前文件=$Artifact；总字节=$Total；已下载=$Downloaded；百分比=$percent%；字节/秒=$speed；ETA=$eta 秒；重试=$RetryCount；续传偏移=$ResumeOffset"
    $interactive = $false
    try { $interactive = [Environment]::UserInteractive -and -not [Console]::IsOutputRedirected } catch { $interactive = $false }
    $nonInteractiveDue = $null -eq $previous -or [Math]::Abs($percent - [double]$previous.Percent) -ge 5 -or ($null -ne $previous -and ($now - $previous.At).TotalSeconds -ge 30)
    if ($complete -or ($percentChanged -and $due -and ($interactive -or $nonInteractiveDue))) {
        if ($interactive -and -not $complete) {
            Write-Host ("`r" + $line.PadRight(180)) -NoNewline
        }
        else {
            Write-Host $line
        }
        $script:DownloadProgressState[$key] = @{ Percent = $percent; At = $now }
    }
}

function Test-FileIntegrity {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][long]$ExpectedSize,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -ne $ExpectedSize) { return $false }
    return (Get-Sha256 -Path $Path) -ceq $ExpectedSha256
}

function Save-PartialMetadata {
    param(
        [string]$Path,
        [string]$Uri,
        [long]$ExpectedSize,
        [string]$ETag,
        [string]$LastModified
    )

    Write-JsonUtf8 -Path $Path -Value ([ordered]@{
        schema_version = 1
        url = $Uri
        expected_size = $ExpectedSize
        etag = $ETag
        last_modified = $LastModified
    })
}

function Receive-VerifiedArtifact {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][string]$Destination,
        [Parameter(Mandatory = $true)][long]$ExpectedSize,
        [Parameter(Mandatory = $true)][string]$ExpectedSha256,
        [Parameter(Mandatory = $true)][string]$ArtifactName,
        [int]$Retries,
        [int]$RetryDelay,
        [switch]$AllowLocal
    )

    $metadataPath = "$Destination.meta.json"
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    if ((Test-Path -LiteralPath $Destination) -and (Get-Item -LiteralPath $Destination).Length -gt $ExpectedSize) {
        Remove-Item -LiteralPath $Destination -Force
        Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
    }
    $metadata = Read-PartialMetadata -Path $metadataPath
    if ((Test-Path -LiteralPath $Destination) -and
        (-not $metadata -or [long]$metadata.expected_size -ne $ExpectedSize)) {
        Remove-Item -LiteralPath $Destination -Force
        Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
        $metadata = $null
    }

    $started = [DateTime]::UtcNow.ToFileTimeUtc()
    for ($attempt = 0; $attempt -le $Retries; $attempt++) {
        $opened = $null
        $response = $null
        if ((Test-Path -LiteralPath $Destination) -and
            (Get-Item -LiteralPath $Destination).Length -eq $ExpectedSize -and
            -not (Test-FileIntegrity -Path $Destination -ExpectedSize $ExpectedSize -ExpectedSha256 $ExpectedSha256)) {
            Write-Host "完整长度缓存未通过 SHA-256，已重置当前 .part 以便重新下载。"
            [IO.File]::WriteAllBytes($Destination, (New-Object byte[] 0))
            Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
            $metadata = $null
        }
        $offset = if (Test-Path -LiteralPath $Destination) { (Get-Item -LiteralPath $Destination).Length } else { 0 }
        $requestOffset = $offset
        $ifRange = $null
        if ($offset -gt 0 -and $metadata) {
            $ifRange = if ($metadata.etag) { [string]$metadata.etag } else { [string]$metadata.last_modified }
        }
        try {
            $opened = Open-HttpResponse -Uri $Uri -Offset $(if ($offset -gt 0) { $offset } else { -1 }) -IfRange $ifRange -AllowLocal:$AllowLocal
            $response = $opened.Response
            $status = [int]$response.StatusCode

            if ($status -eq 416) {
                if ($offset -eq $ExpectedSize -and (Test-FileIntegrity -Path $Destination -ExpectedSize $ExpectedSize -ExpectedSha256 $ExpectedSha256)) {
                    Write-DownloadProgress -Artifact $ArtifactName -Total $ExpectedSize -Downloaded $offset -StartedAt $started -RetryCount $attempt -ResumeOffset $requestOffset
                    return $Destination
                }
                throw "HTTP 416 仅允许用于已完整且通过 SHA-256 校验的缓存文件。"
            }
            if ($status -eq 429 -or $status -ge 500) {
                throw "可重试 HTTP $status"
            }
            if ($status -notin 200, 206) {
                throw "下载返回不可接受的 HTTP $status。"
            }

            $append = $false
            if ($offset -gt 0 -and $status -eq 206) {
                $contentRange = [string]$response.Headers["Content-Range"]
                if ($contentRange -cnotmatch "^bytes ([0-9]+)-([0-9]+)/([0-9]+)$") {
                    throw "206 响应缺少严格 Content-Range。"
                }
                if ([long]$Matches[1] -ne $offset -or [long]$Matches[2] -lt $offset -or [long]$Matches[2] -ge $ExpectedSize -or [long]$Matches[3] -ne $ExpectedSize) {
                    throw "Content-Range 与续传偏移或预期总量不匹配。"
                }
                $responseETag = [string]$response.Headers["ETag"]
                $responseLastModified = [string]$response.Headers["Last-Modified"]
                if ($metadata.etag -and $responseETag -and [string]$metadata.etag -cne $responseETag) {
                    Write-Host "续传验证器已变化，已清理当前 .part 和 metadata 并从 0 重新下载。"
                    [IO.File]::WriteAllBytes($Destination, (New-Object byte[] 0))
                    Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
                    $metadata = $null
                    throw "续传 ETag 验证器已变化。"
                }
                if (-not $metadata.etag -and $metadata.last_modified -and $responseLastModified -and [string]$metadata.last_modified -cne $responseLastModified) {
                    Write-Host "续传验证器已变化，已清理当前 .part 和 metadata 并从 0 重新下载。"
                    [IO.File]::WriteAllBytes($Destination, (New-Object byte[] 0))
                    Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
                    $metadata = $null
                    throw "续传 Last-Modified 验证器已变化。"
                }
                $append = $true
            }
            elseif ($offset -gt 0 -and $status -eq 200) {
                Write-Host "服务器未接受 Range，已从 0 重新下载当前文件。"
                [IO.File]::WriteAllBytes($Destination, (New-Object byte[] 0))
                $offset = 0
                $requestOffset = 0
                $metadata = $null
            }
            elseif ($offset -eq 0 -and $status -eq 206) {
                throw "未请求 Range 时不得返回 206。"
            }

            $etag = [string]$response.Headers["ETag"]
            $lastModified = [string]$response.Headers["Last-Modified"]
            Save-PartialMetadata -Path $metadataPath -Uri $opened.FinalUri.AbsoluteUri -ExpectedSize $ExpectedSize -ETag $etag -LastModified $lastModified
            $metadata = Read-PartialMetadata -Path $metadataPath
            $mode = if ($append) { [IO.FileMode]::Append } else { [IO.FileMode]::Create }
            $output = [IO.File]::Open($Destination, $mode, [IO.FileAccess]::Write, [IO.FileShare]::Read)
            $inputStream = $response.GetResponseStream()
            try {
                $buffer = New-Object byte[] 65536
                while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    if ($output.Length + $read -gt $ExpectedSize) {
                        throw "下载字节超过可信清单声明大小。"
                    }
                    $output.Write($buffer, 0, $read)
                    Write-DownloadProgress -Artifact $ArtifactName -Total $ExpectedSize -Downloaded $output.Length -StartedAt $started -RetryCount $attempt -ResumeOffset $requestOffset
                }
            }
            finally {
                $inputStream.Dispose()
                $output.Dispose()
            }

            $length = (Get-Item -LiteralPath $Destination).Length
            if ($length -ne $ExpectedSize) {
                throw "下载提前结束：收到 $length 字节，预期 $ExpectedSize 字节。"
            }
            if ((Get-Sha256 -Path $Destination) -cne $ExpectedSha256) {
                throw "bundle SHA-256 校验失败；已保留不可信 .part 供后续修复。"
            }
            Write-DownloadProgress -Artifact $ArtifactName -Total $ExpectedSize -Downloaded $length -StartedAt $started -RetryCount $attempt -ResumeOffset $requestOffset
            return $Destination
        }
        catch {
            if ($attempt -ge $Retries) {
                throw
            }
            Write-Host "下载重试：重试=$($attempt + 1)，续传偏移=$(if (Test-Path -LiteralPath $Destination) { (Get-Item -LiteralPath $Destination).Length } else { 0 })，原因=$($_.Exception.Message)"
            Start-Sleep -Milliseconds $RetryDelay
        }
        finally {
            if ($response) {
                $response.Dispose()
            }
        }
    }
}

function ConvertTo-SafeRelativePath {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not $Path -or $Path.Contains("`0") -or $Path.Contains("\") -or $Path.StartsWith("/") -or $Path.Contains(":")) {
        throw "不安全 ZIP 路径：$Path"
    }
    $candidate = $Path.TrimEnd("/")
    if (-not $candidate) {
        throw "不安全 ZIP 路径：$Path"
    }
    $segments = $candidate.Split("/")
    foreach ($segment in $segments) {
        if (-not $segment -or $segment -eq "." -or $segment -eq "..") {
            throw "不安全 ZIP 路径：$Path"
        }
    }
    return $candidate
}

function Open-ValidatedZip {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot,
        [Parameter(Mandatory = $true)][long]$ExpectedExpandedBytes
    )

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    # ZipFile.OpenRead returns a ZipArchive whose entries are validated before extraction.
    $archive = [IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        $seen = New-Object "Collections.Generic.Dictionary[string,string]" ([StringComparer]::OrdinalIgnoreCase)
        [long]$expanded = 0
        foreach ($entry in $archive.Entries) {
            $relative = ConvertTo-SafeRelativePath -Path $entry.FullName
            if ($seen.ContainsKey($relative)) {
                throw "ZIP 中存在大小写重复路径：$($seen[$relative]) 与 $relative"
            }
            $seen.Add($relative, $relative)
            $unixKind = (($entry.ExternalAttributes -shr 16) -band 0xF000)
            $windowsAttributes = ($entry.ExternalAttributes -band 0xFFFF)
            if ($unixKind -eq 0xA000 -or ($windowsAttributes -band 0x400) -ne 0) {
                throw "ZIP 条目不得是符号链接或重解析点：$relative"
            }
            if ($entry.Length -lt 0) {
                throw "ZIP 条目大小无效：$relative"
            }
            $target = [IO.Path]::GetFullPath((Join-Path $DestinationRoot ($relative.Replace("/", "\"))))
            $prefix = [IO.Path]::GetFullPath($DestinationRoot).TrimEnd("\") + "\"
            if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
                throw "不安全 ZIP 路径：$relative"
            }
            if ($target.Length -ge 240) {
                throw "ZIP 解压路径过长：$relative"
            }
            $expanded += [long]$entry.Length
            if ($expanded -gt $ExpectedExpandedBytes) {
                throw "ZIP 解压总量超过 companion manifest 声明。"
            }
        }
        if ($expanded -ne $ExpectedExpandedBytes) {
            throw "ZIP 解压总量与 companion manifest 不一致：$expanded / $ExpectedExpandedBytes。"
        }
        return $archive
    }
    catch {
        $archive.Dispose()
        throw
    }
}

function Expand-ValidatedZip {
    param(
        [Parameter(Mandatory = $true)][string]$ArchivePath,
        [Parameter(Mandatory = $true)][string]$DestinationRoot,
        [Parameter(Mandatory = $true)][long]$ExpectedExpandedBytes
    )

    New-Item -ItemType Directory -Path $DestinationRoot -Force | Out-Null
    $archive = Open-ValidatedZip -ArchivePath $ArchivePath -DestinationRoot $DestinationRoot -ExpectedExpandedBytes $ExpectedExpandedBytes
    try {
        foreach ($entry in $archive.Entries) {
            $relative = ConvertTo-SafeRelativePath -Path $entry.FullName
            $target = [IO.Path]::GetFullPath((Join-Path $DestinationRoot ($relative.Replace("/", "\"))))
            if ($entry.FullName.EndsWith("/")) {
                New-Item -ItemType Directory -Path $target -Force | Out-Null
                continue
            }
            $parent = Split-Path -Parent $target
            New-Item -ItemType Directory -Path $parent -Force | Out-Null
            $inputStream = $entry.Open()
            $output = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
            try {
                $buffer = New-Object byte[] 65536
                [long]$written = 0
                while (($read = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
                    $written += $read
                    if ($written -gt $entry.Length) {
                        throw "ZIP 条目解压大小超过声明：$relative"
                    }
                    $output.Write($buffer, 0, $read)
                }
                if ($written -ne $entry.Length) {
                    throw "ZIP 条目解压大小不匹配：$relative"
                }
            }
            finally {
                $inputStream.Dispose()
                $output.Dispose()
            }
            $item = Get-Item -LiteralPath $target -Force
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw "解压结果不得包含重解析点：$relative"
            }
        }
    }
    finally {
        $archive.Dispose()
    }
}

function Assert-PayloadManifest {
    param(
        [Parameter(Mandatory = $true)][string]$BundleRoot,
        [Parameter(Mandatory = $true)]$Companion,
        [Parameter(Mandatory = $true)][string]$SelectedArchitecture
    )

    $manifestPath = Join-Path $BundleRoot "bundle-manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "bundle 缺少 payload manifest。"
    }
    if ((Get-Item -LiteralPath $manifestPath).Length -ne [long]$Companion.payload_manifest.size_bytes) {
        throw "payload manifest 大小不匹配。"
    }
    if ((Get-Sha256 -Path $manifestPath) -cne [string]$Companion.payload_manifest.sha256) {
        throw "payload manifest SHA-256 不匹配。"
    }
    try {
        $payload = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "payload manifest JSON 无效。"
    }
    if ($payload.schema_version -ne 1 -or $payload.bundle.name -cne $script:SkillName -or
        $payload.bundle.version -cne $script:BundleVersion -or $payload.bundle.release_tag -cne $script:ReleaseTag -or
        $payload.bundle.os -cne "windows" -or $payload.bundle.arch -cne $SelectedArchitecture) {
        throw "payload manifest bundle 身份不匹配。"
    }
    if ($payload.components.node.version -cne "22.23.1" -or
        $payload.components.runner.name -cne "@saitamasans/testing-runner" -or
        $payload.components.runner.version -cne "1.1.2" -or
        $payload.components.playwright.version -cne "1.61.1" -or
        $payload.components.playwright.chromium_revision -cne "1228" -or
        $payload.components.playwright.chromium_headless_shell_revision -cne "1228" -or
        $payload.components.playwright.ffmpeg_revision -cne "1011" -or
        $payload.components.skill.name -cne $script:SkillName) {
        throw "payload manifest 组件版本不匹配。"
    }

    $expected = New-Object "Collections.Generic.Dictionary[string,object]" ([StringComparer]::OrdinalIgnoreCase)
    [long]$declaredTotal = 0
    foreach ($entry in @($payload.files)) {
        $relative = ConvertTo-SafeRelativePath -Path ([string]$entry.path)
        if ($expected.ContainsKey($relative)) {
            throw "payload manifest 存在大小写重复路径：$relative"
        }
        if ([long]$entry.size_bytes -lt 0 -or [string]$entry.sha256 -cnotmatch "^[a-f0-9]{64}$") {
            throw "payload manifest 文件记录无效：$relative"
        }
        $expected.Add($relative, $entry)
        $declaredTotal += [long]$entry.size_bytes
    }
    if ($declaredTotal -ne [long]$payload.installed_size_bytes) {
        throw "payload manifest installed_size_bytes 无效。"
    }
    if ($declaredTotal + (Get-Item -LiteralPath $manifestPath).Length -ne [long]$Companion.installed_size_bytes) {
        throw "payload 与 companion 安装总量不一致。"
    }

    $actual = New-Object "Collections.Generic.Dictionary[string,string]" ([StringComparer]::OrdinalIgnoreCase)
    foreach ($item in Get-ChildItem -LiteralPath $BundleRoot -Recurse -Force) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "解压结果包含重解析点：$($item.FullName)"
        }
        if (-not $item.PSIsContainer) {
            $relative = $item.FullName.Substring($BundleRoot.TrimEnd("\").Length).TrimStart("\").Replace("\", "/")
            if ($relative -ceq "bundle-manifest.json") { continue }
            if ($actual.ContainsKey($relative)) {
                throw "解压结果存在大小写重复路径：$relative"
            }
            $actual.Add($relative, $item.FullName)
        }
    }
    if ($actual.Count -ne $expected.Count) {
        throw "解压文件数量与 payload manifest 不一致。"
    }
    foreach ($relative in $expected.Keys) {
        if (-not $actual.ContainsKey($relative)) {
            throw "payload manifest 文件缺失：$relative"
        }
        $record = $expected[$relative]
        $file = $actual[$relative]
        if ((Get-Item -LiteralPath $file).Length -ne [long]$record.size_bytes) {
            throw "payload 文件大小不匹配：$relative"
        }
        if ((Get-Sha256 -Path $file) -cne [string]$record.sha256) {
            throw "payload 文件 SHA-256 不匹配：$relative"
        }
    }
    foreach ($required in @(
        "node/node.exe",
        "runner/dist/cli.js",
        "runner/package.json",
        "skill/web-api-test-execution-evidence/SKILL.md",
        "smoke/installation-smoke-test.mjs",
        "smoke/installation-smoke-fixture.html",
        "browser-cache/chromium-1228/chrome-win64/chrome.exe",
        "browser-cache/chromium_headless_shell-1228/chrome-headless-shell-win64/chrome-headless-shell.exe",
        "browser-cache/ffmpeg-1011/ffmpeg-win64.exe"
    )) {
        if (-not $actual.ContainsKey($required)) {
            throw "完整 bundle 缺少必需文件：$required"
        }
    }
    return $payload
}

function Invoke-InstallationSmoke {
    param(
        [Parameter(Mandatory = $true)][string]$BundleRoot,
        [Parameter(Mandatory = $true)][string]$DiagnosticsRoot,
        [string]$FixtureScript,
        [switch]$AllowLocal
    )

    New-Item -ItemType Directory -Path $DiagnosticsRoot -Force | Out-Null
    Write-Host "当前阶段=本地完整 smoke test；诊断目录=$DiagnosticsRoot"
    if ($FixtureScript) {
        if (-not $AllowLocal) {
            throw "LocalSmokeScript 仅允许与 -AllowLocalFixture 一起用于测试。"
        }
        $fixturePath = (Resolve-Path -LiteralPath $FixtureScript -ErrorAction Stop).Path
        $powerShellExe = Join-Path $PSHOME "powershell.exe"
        & $powerShellExe -NoProfile -ExecutionPolicy Bypass -File $fixturePath -BundleRoot $BundleRoot -DiagnosticsRoot $DiagnosticsRoot
    }
    else {
        $node = Join-Path $BundleRoot "node\node.exe"
        $smoke = Join-Path $BundleRoot "smoke\installation-smoke-test.mjs"
        & $node $smoke $DiagnosticsRoot
    }
    if ($LASTEXITCODE -ne 0) {
        throw "安装 smoke test 失败，退出码：$LASTEXITCODE。"
    }
    $resultPath = Join-Path $DiagnosticsRoot "smoke-result.json"
    if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) {
        throw "安装 smoke test 未生成 smoke-result.json。"
    }
    try {
        $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
    }
    catch {
        throw "安装 smoke test 结果无效。"
    }
    if ($result.ok -ne $true) {
        throw "安装 smoke test 未通过。"
    }
}

function Write-AtomicReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)]$Receipt,
        [switch]$InjectFailure
    )

    $directory = Split-Path -Parent $Path
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    $temporary = Join-Path $directory ("installation-receipt." + [Guid]::NewGuid().ToString("N") + ".tmp")
    $backup = Join-Path $directory ("installation-receipt." + [Guid]::NewGuid().ToString("N") + ".backup")
    Write-JsonUtf8 -Path $temporary -Value $Receipt
    try {
        if ($InjectFailure) {
            throw "注入激活失败：ReceiptWrite"
        }
        if (Test-Path -LiteralPath $Path -PathType Leaf) {
            [IO.File]::Replace($temporary, $Path, $backup, $true)
            Remove-Item -LiteralPath $backup -Force -ErrorAction SilentlyContinue
        }
        else {
            [IO.File]::Move($temporary, $Path)
        }
    }
    finally {
        Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    }
}

function Test-DirectoryInventoryMatches {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedRoot,
        [Parameter(Mandatory = $true)][string]$ActualRoot
    )

    if (-not (Test-Path -LiteralPath $ExpectedRoot -PathType Container) -or
        -not (Test-Path -LiteralPath $ActualRoot -PathType Container)) {
        return $false
    }
    try {
        $expectedFiles = @(Get-ChildItem -LiteralPath $ExpectedRoot -Recurse -File -Force)
        $actualFiles = @(Get-ChildItem -LiteralPath $ActualRoot -Recurse -File -Force)
        if ($expectedFiles.Count -ne $actualFiles.Count) { return $false }
        foreach ($item in Get-ChildItem -LiteralPath $ActualRoot -Recurse -Force) {
            if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
        }
        foreach ($expectedFile in $expectedFiles) {
            $relative = $expectedFile.FullName.Substring($ExpectedRoot.TrimEnd("\").Length).TrimStart("\")
            $actualFile = Join-Path $ActualRoot $relative
            if (-not (Test-Path -LiteralPath $actualFile -PathType Leaf)) { return $false }
            if ((Get-Item -LiteralPath $actualFile).Length -ne $expectedFile.Length) { return $false }
            if ((Get-Sha256 -Path $actualFile) -cne (Get-Sha256 -Path $expectedFile.FullName)) { return $false }
        }
        return $true
    }
    catch {
        return $false
    }
}

function Test-SmokeEvidenceReference {
    param(
        [Parameter(Mandatory = $true)][string]$DiagnosticsRoot,
        [Parameter(Mandatory = $true)]$Reference,
        [Parameter(Mandatory = $true)][string]$ExpectedPath,
        [switch]$AllowSuffix
    )

    try {
        $relative = ConvertTo-SafeRelativePath -Path ([string]$Reference.path)
        if ($AllowSuffix) {
            if (-not $relative.EndsWith($ExpectedPath, [StringComparison]::Ordinal)) { return $false }
        }
        elseif ($relative -cne $ExpectedPath) { return $false }
        if ([long]$Reference.size_bytes -le 0 -or [string]$Reference.sha256 -cnotmatch "^[a-f0-9]{64}$") {
            return $false
        }
        $root = [IO.Path]::GetFullPath($DiagnosticsRoot).TrimEnd("\")
        $absolute = [IO.Path]::GetFullPath((Join-Path $root $relative.Replace("/", "\")))
        if (-not $absolute.StartsWith($root + "\", [StringComparison]::OrdinalIgnoreCase)) { return $false }
        if (-not (Test-Path -LiteralPath $absolute -PathType Leaf)) { return $false }
        $physicalRoot = Resolve-PhysicalInstallRoot -InstallRoot $root
        $expectedPhysical = Join-Path $physicalRoot $relative.Replace("/", "\")
        if (-not (Test-PhysicalPathMatches -Path $absolute -ExpectedPhysicalPath $expectedPhysical)) { return $false }
        $item = Get-Item -LiteralPath $absolute -Force
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or
            $item.Length -ne [long]$Reference.size_bytes -or
            (Get-Sha256 -Path $absolute) -cne [string]$Reference.sha256) {
            return $false
        }
        return $true
    }
    catch { return $false }
}

function Test-PhysicalPathIdentity {
    param([Parameter(Mandatory = $true)][string]$Path)

    try {
        $lexical = (Get-RootPreservingFullPath -Path $Path).ToUpperInvariant()
        $physical = Resolve-PhysicalInstallRoot -InstallRoot $Path
        return $physical -ceq $lexical
    }
    catch { return $false }
}

function Test-PhysicalPathMatches {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedPhysicalPath
    )

    try {
        $expected = (Get-RootPreservingFullPath -Path $ExpectedPhysicalPath).ToUpperInvariant()
        $physical = Resolve-PhysicalInstallRoot -InstallRoot $Path
        return $physical -ceq $expected
    }
    catch { return $false }
}

function Test-ExistingSmokeDiagnostics {
    param(
        [Parameter(Mandatory = $true)]$Receipt,
        [Parameter(Mandatory = $true)][string]$SelectedArchitecture,
        [Parameter(Mandatory = $true)][string]$RequestedStateRoot,
        [Parameter(Mandatory = $true)][string]$StateRootIoPath
    )

    try {
        $diagnosticsCanonical = [IO.Path]::GetFullPath([string]$Receipt.diagnostics_path)
        $canonicalStateRoot = [IO.Path]::GetFullPath($RequestedStateRoot).TrimEnd("\")
        $ioStateRoot = [IO.Path]::GetFullPath($StateRootIoPath).TrimEnd("\")
        $prefix = [IO.Path]::GetFullPath((Join-Path $RequestedStateRoot "diagnostics\$script:SkillName")).TrimEnd("\") + "\"
        if (-not $diagnosticsCanonical.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { return $false }
        $relativeDiagnostics = $diagnosticsCanonical.Substring($canonicalStateRoot.Length).TrimStart("\")
        $diagnostics = [IO.Path]::GetFullPath((Join-Path $ioStateRoot $relativeDiagnostics))
        if (-not (Test-PhysicalPathMatches -Path $diagnostics -ExpectedPhysicalPath $diagnosticsCanonical) -or
            -not (Test-Path -LiteralPath $diagnostics -PathType Container)) { return $false }
        $diagnosticsItem = Get-Item -LiteralPath $diagnostics -Force
        if (($diagnosticsItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
        $resultPath = Join-Path $diagnostics "smoke-result.json"
        if (-not (Test-Path -LiteralPath $resultPath -PathType Leaf)) { return $false }
        $result = Get-Content -LiteralPath $resultPath -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($result.schema_version -ne 1 -or $result.ok -ne $true -or
            $result.node.version -cne "22.23.1" -or $result.node.arch -cne $SelectedArchitecture -or
            $result.runner.version -cne "1.1.2" -or $result.browser.visible -ne $true -or
            $result.run_id -cne "run-bundle-smoke" -or
            $result.case_id -cne "BUNDLE-SMOKE-001" -or $result.case_status -cne "通过" -or
            $result.assertion_id -cne "BUNDLE-SMOKE-001-visible-text" -or $result.assertion_passed -ne $true) {
            return $false
        }
        if (-not (Test-SmokeEvidenceReference -DiagnosticsRoot (Join-Path $diagnostics $result.run_id) -Reference $result.png `
            -ExpectedPath "/BUNDLE-SMOKE-001-visible-text/web-page.png" -AllowSuffix)) { return $false }
        if (-not (Test-SmokeEvidenceReference -DiagnosticsRoot $diagnostics -Reference $result.trace `
            -ExpectedPath "evidence/BUNDLE-SMOKE-001/playwright-trace.zip")) { return $false }
        $requiredArtifacts = @("run-result.json", "projected-report.json", "result.html", "result.xlsx", "run-bundle-smoke/run-events.jsonl")
        $artifacts = @($result.artifacts)
        foreach ($required in $requiredArtifacts) {
            $matches = @($artifacts | Where-Object { [string]$_.path -ceq $required })
            if ($matches.Count -ne 1 -or -not (Test-SmokeEvidenceReference `
                -DiagnosticsRoot $diagnostics -Reference $matches[0] -ExpectedPath $required)) { return $false }
        }
        return $true
    }
    catch { return $false }
}

function Test-ExistingReceipt {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$SelectedArchitecture,
        [Parameter(Mandatory = $true)][string]$RequestedInstallRoot,
        [Parameter(Mandatory = $true)][string]$RequestedStateRoot,
        [Parameter(Mandatory = $true)][string]$StateRootIoPath,
        [Parameter(Mandatory = $true)]$Companion
    )

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    $receiptItem = Get-Item -LiteralPath $Path -Force
    if (($receiptItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { return $false }
    try {
        $receipt = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
        $expectedSkill = [IO.Path]::GetFullPath((Join-Path $RequestedInstallRoot $script:SkillName))
        $actualSkill = [IO.Path]::GetFullPath([string]$receipt.skill_path)
        $runtimeCanonical = [IO.Path]::GetFullPath([string]$receipt.runtime_path)
        $canonicalStateRoot = [IO.Path]::GetFullPath($RequestedStateRoot).TrimEnd("\")
        $ioStateRoot = [IO.Path]::GetFullPath($StateRootIoPath).TrimEnd("\")
        $runtimePrefix = [IO.Path]::GetFullPath((Join-Path $RequestedStateRoot "runtime\$script:SkillName")).TrimEnd("\") + "\"
        if ($receipt.schema_version -ne 1 -or
            $receipt.bundle_version -cne $script:BundleVersion -or
            $receipt.architecture -cne $SelectedArchitecture -or
            $receipt.archive_sha256 -cne [string]$Companion.archive.sha256 -or
            $receipt.payload_manifest_sha256 -cne [string]$Companion.payload_manifest.sha256 -or
            $actualSkill -cne $expectedSkill -or
            -not $runtimeCanonical.StartsWith($runtimePrefix, [StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
        $relativeRuntime = $runtimeCanonical.Substring($canonicalStateRoot.Length).TrimStart("\")
        $runtime = [IO.Path]::GetFullPath((Join-Path $ioStateRoot $relativeRuntime))
        if (-not (Test-Path -LiteralPath $runtime -PathType Container) -or
            -not (Test-PhysicalPathMatches -Path $runtime -ExpectedPhysicalPath $runtimeCanonical) -or
            -not (Test-PhysicalPathIdentity -Path $actualSkill)) { return $false }
        if (-not (Test-ExistingSmokeDiagnostics -Receipt $receipt -SelectedArchitecture $SelectedArchitecture `
            -RequestedStateRoot $RequestedStateRoot -StateRootIoPath $StateRootIoPath)) { return $false }
        Assert-PayloadManifest -BundleRoot $runtime -Companion $Companion -SelectedArchitecture $SelectedArchitecture | Out-Null
        return (Test-DirectoryInventoryMatches `
            -ExpectedRoot (Join-Path $runtime "skill\$script:SkillName") `
            -ActualRoot $actualSkill)
    }
    catch {
        return $false
    }
}

function Invoke-ActivationFailure {
    param(
        [string]$Point,
        [string]$ConfiguredPoint,
        [switch]$AllowLocal
    )

    if ($ConfiguredPoint -and -not $AllowLocal) {
        throw "TestFailurePoint 仅允许与 -AllowLocalFixture 一起用于测试。"
    }
    if ($ConfiguredPoint -ceq $Point) {
        throw "注入激活失败：$Point"
    }
}

function Write-InstallerSuccess {
    Write-Output "安装完成，可以执行 Web/API 自动化测试"
}

function Install-VerifiedBundleAtomically {
    param(
        [Parameter(Mandatory = $true)][string]$StagedRuntime,
        [Parameter(Mandatory = $true)][string]$RuntimeParent,
        [Parameter(Mandatory = $true)][string]$RecordedRuntimeParent,
        [Parameter(Mandatory = $true)][string]$SkillTarget,
        [Parameter(Mandatory = $true)][string]$ReceiptPath,
        [Parameter(Mandatory = $true)][string]$DiagnosticsRoot,
        [Parameter(Mandatory = $true)][string]$RecordedDiagnosticsRoot,
        [Parameter(Mandatory = $true)]$Companion,
        [Parameter(Mandatory = $true)][string]$SelectedArchitecture,
        [string]$FailurePoint,
        [switch]$AllowLocal
    )

    $identifier = [Guid]::NewGuid().ToString("N")
    $archiveMarker = ([string]$Companion.archive.sha256).Substring(0, 12)
    $runtimeLeaf = "$script:BundleVersion-$archiveMarker-$identifier"
    $runtimeTarget = Join-Path $RuntimeParent $runtimeLeaf
    $recordedRuntimeTarget = Join-Path $RecordedRuntimeParent $runtimeLeaf
    $skillParent = Split-Path -Parent $SkillTarget
    $skillCandidate = Join-Path $skillParent (".stage-skill-$identifier")
    $skillBackup = Join-Path $skillParent (".retained-$script:SkillName-$identifier")
    $hadSkill = Test-Path -LiteralPath $SkillTarget
    $sourceSkill = Join-Path $StagedRuntime "skill\$script:SkillName"
    $reuseSkill = $hadSkill -and (Test-DirectoryInventoryMatches -ExpectedRoot $sourceSkill -ActualRoot $SkillTarget)
    $runtimeActivated = $false
    $skillActivated = $false
    $receiptCommitted = $false

    if (-not $reuseSkill) {
        Copy-Item -LiteralPath $sourceSkill -Destination $skillCandidate -Recurse
    }
    try {
        Move-Item -LiteralPath $StagedRuntime -Destination $runtimeTarget
        $runtimeActivated = $true
        if (-not (Test-PhysicalPathMatches -Path $runtimeTarget -ExpectedPhysicalPath $recordedRuntimeTarget)) {
            throw "激活后的运行时物理路径与请求状态目录不一致。"
        }
        Invoke-ActivationFailure -Point "AfterRuntime" -ConfiguredPoint $FailurePoint -AllowLocal:$AllowLocal

        if (-not $reuseSkill) {
            if ($hadSkill) {
                Move-Item -LiteralPath $SkillTarget -Destination $skillBackup
            }
            Move-Item -LiteralPath $skillCandidate -Destination $SkillTarget
            $skillActivated = $true
        }
        Invoke-ActivationFailure -Point "AfterSkill" -ConfiguredPoint $FailurePoint -AllowLocal:$AllowLocal
        Invoke-ActivationFailure -Point "BeforeReceipt" -ConfiguredPoint $FailurePoint -AllowLocal:$AllowLocal

        $receipt = [ordered]@{
            schema_version = 1
            skill = $script:SkillName
            bundle_version = $script:BundleVersion
            release_tag = $script:ReleaseTag
            architecture = $SelectedArchitecture
            installed_at_utc = [DateTime]::UtcNow.ToString("o")
            archive_sha256 = [string]$Companion.archive.sha256
            payload_manifest_sha256 = [string]$Companion.payload_manifest.sha256
            runtime_path = $recordedRuntimeTarget
            skill_path = $SkillTarget
            diagnostics_path = $RecordedDiagnosticsRoot
        }
        Write-AtomicReceipt -Path $ReceiptPath -Receipt $receipt -InjectFailure:($FailurePoint -ceq "ReceiptWrite")
        $receiptCommitted = $true
        Remove-Item -LiteralPath $skillBackup -Recurse -Force -ErrorAction SilentlyContinue
        # Old immutable runtimes are intentionally retained for delayed cleanup when files are locked.
    }
    catch {
        if (-not $receiptCommitted) {
            if ($skillActivated -and (Test-Path -LiteralPath $SkillTarget)) {
                Remove-Item -LiteralPath $SkillTarget -Recurse -Force -ErrorAction SilentlyContinue
            }
            if ($hadSkill -and (Test-Path -LiteralPath $skillBackup)) {
                Move-Item -LiteralPath $skillBackup -Destination $SkillTarget
            }
            if ($runtimeActivated -and (Test-Path -LiteralPath $runtimeTarget)) {
                Remove-Item -LiteralPath $runtimeTarget -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        throw
    }
    finally {
        Remove-Item -LiteralPath $skillCandidate -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-CompleteExecutionInstaller {
    param(
        [string]$SelectedArchitecture,
        [string]$TrustedManifestUri,
        [string]$TrustedManifestSha256,
        [string]$InstallRootPath,
        [string]$StateRootPath,
        [switch]$RepairInstall,
        [switch]$ForceInstall,
        [switch]$AllowLocal,
        [string]$FixtureSmokeScript,
        [int]$Retries,
        [int]$RetryDelay,
        [long]$SpaceMargin,
        [long]$AvailableBytesOverride,
        [string]$FailurePoint
    )

    if (-not $SelectedArchitecture) {
        $SelectedArchitecture = Get-WindowsArchitecture
    }
    if (-not $TrustedManifestUri) {
        $TrustedManifestUri = (Get-PinnedManifest -Architecture $SelectedArchitecture).Uri
    }
    if (-not $TrustedManifestSha256) {
        $TrustedManifestSha256 = (Get-PinnedManifest -Architecture $SelectedArchitecture).Sha256
    }
    if (($AllowLocal -or $FixtureSmokeScript -or $AvailableBytesOverride -ge 0 -or $FailurePoint) -and -not $AllowLocal) {
        throw "测试注入参数必须显式使用 -AllowLocalFixture。"
    }
    [Net.ServicePointManager]::SecurityProtocol =
        [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $defaultProxy = [Net.WebRequest]::DefaultWebProxy
    if ($defaultProxy) {
        $defaultProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials
    }

    $installRootFull = [IO.Path]::GetFullPath($InstallRootPath)
    $stateRootFull = [IO.Path]::GetFullPath($StateRootPath)
    $lock = $null
    $stateAlias = $null
    $stagedRuntime = $null
    try {
        $lock = Enter-InstallerLock -InstallRoot $installRootFull -SkillName $script:SkillName
        Assert-ProjectReleaseUri -Uri $TrustedManifestUri -AllowLocal:$AllowLocal | Out-Null
        $manifestBytes = [byte[]](Get-TrustedManifestBytes -Uri $TrustedManifestUri -ExpectedSha256 $TrustedManifestSha256 -Retries $Retries -RetryDelay $RetryDelay -AllowLocal:$AllowLocal)
        try {
            $manifest = [Text.Encoding]::UTF8.GetString($manifestBytes) | ConvertFrom-Json
        }
        catch {
            throw "可信 companion manifest JSON 无效。"
        }
        Assert-CompanionManifest -Manifest $manifest -SelectedArchitecture $SelectedArchitecture -AllowLocal:$AllowLocal

        $requiredBytes = [long]$manifest.archive.size_bytes * 2 + [long]$manifest.installed_size_bytes * 2 + $SpaceMargin
        Assert-Preflight -InstallRootPath $installRootFull -StateRootPath $stateRootFull -RequiredBytes $requiredBytes -AvailableBytesOverride $AvailableBytesOverride
        $stateAlias = New-TemporaryStatePathAlias -StateRootPath $stateRootFull
        $stateRootIo = [string]$stateAlias.Root
        $receiptPath = Join-Path $stateRootIo "installations\web-api-test-execution-evidence.json"
        if (-not $RepairInstall -and -not $ForceInstall -and (Test-ExistingReceipt `
            -Path $receiptPath -SelectedArchitecture $SelectedArchitecture `
            -RequestedInstallRoot $installRootFull -RequestedStateRoot $stateRootFull `
            -StateRootIoPath $stateRootIo -Companion $manifest)) {
            Remove-TemporaryStatePathAlias -Alias $stateAlias
            $stateAlias = $null
            Write-InstallerSuccess
            return
        }
        if (-not $RepairInstall -and -not $ForceInstall -and (Test-Path -LiteralPath $receiptPath)) {
            throw "现有安装不完整或损坏，请使用 -Repair。"
        }

        $cacheRoot = Join-Path $stateRootIo "downloads\$script:SkillName\$script:BundleVersion\$SelectedArchitecture"
        $partialPath = Join-Path $cacheRoot ($manifest.archive.file_name + ".part")
        Receive-VerifiedArtifact -Uri $manifest.archive.download_url -Destination $partialPath `
            -ExpectedSize ([long]$manifest.archive.size_bytes) -ExpectedSha256 ([string]$manifest.archive.sha256) `
            -ArtifactName ([string]$manifest.archive.file_name) -Retries $Retries -RetryDelay $RetryDelay -AllowLocal:$AllowLocal | Out-Null

        $runtimeParent = Join-Path $stateRootIo "runtime\$script:SkillName"
        $recordedRuntimeParent = Join-Path $stateRootFull "runtime\$script:SkillName"
        New-Item -ItemType Directory -Path $runtimeParent -Force | Out-Null
        $stagedRuntime = Join-Path $runtimeParent (".stage-" + [Guid]::NewGuid().ToString("N"))
        if ([IO.Path]::GetPathRoot($stagedRuntime) -cne [IO.Path]::GetPathRoot($runtimeParent)) {
            throw "运行时 staging 必须与目标目录位于同一卷。"
        }
        Write-Host "当前阶段=验证 ZIP 并解压；staging=$stagedRuntime"
        Expand-ValidatedZip -ArchivePath $partialPath -DestinationRoot $stagedRuntime -ExpectedExpandedBytes ([long]$manifest.installed_size_bytes)
        Assert-PayloadManifest -BundleRoot $stagedRuntime -Companion $manifest -SelectedArchitecture $SelectedArchitecture | Out-Null

        $diagnosticsLeaf = "$script:BundleVersion-" + [DateTime]::UtcNow.ToString("yyyyMMddTHHmmssfffZ")
        $diagnosticsRoot = Join-Path $stateRootIo ("diagnostics\$script:SkillName\" + $diagnosticsLeaf)
        $recordedDiagnosticsRoot = Join-Path $stateRootFull ("diagnostics\$script:SkillName\" + $diagnosticsLeaf)
        Invoke-InstallationSmoke -BundleRoot $stagedRuntime -DiagnosticsRoot $diagnosticsRoot -FixtureScript $FixtureSmokeScript -AllowLocal:$AllowLocal

        $skillTarget = Join-Path $installRootFull $script:SkillName
        Install-VerifiedBundleAtomically -StagedRuntime $stagedRuntime -RuntimeParent $runtimeParent `
            -RecordedRuntimeParent $recordedRuntimeParent -SkillTarget $skillTarget `
            -ReceiptPath $receiptPath -DiagnosticsRoot $diagnosticsRoot -RecordedDiagnosticsRoot $recordedDiagnosticsRoot `
            -Companion $manifest -SelectedArchitecture $SelectedArchitecture -FailurePoint $FailurePoint -AllowLocal:$AllowLocal
        $stagedRuntime = $null
        Remove-TemporaryStatePathAlias -Alias $stateAlias
        $stateAlias = $null
        Write-InstallerSuccess
    }
    finally {
        try {
            if ($stagedRuntime -and (Test-Path -LiteralPath $stagedRuntime)) {
                Remove-Item -LiteralPath $stagedRuntime -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
        finally {
            try {
                if ($stateAlias) {
                    Remove-TemporaryStatePathAlias -Alias $stateAlias
                }
            }
            finally {
                if ($lock) {
                    $lock.ReleaseMutex()
                    $lock.Dispose()
                }
            }
        }
    }
}

if ($MyInvocation.InvocationName -ne ".") {
    try {
        Invoke-CompleteExecutionInstaller `
            -SelectedArchitecture $Architecture `
            -TrustedManifestUri $ManifestUri `
            -TrustedManifestSha256 $ManifestSha256 `
            -InstallRootPath $InstallRoot `
            -StateRootPath $StateRoot `
            -RepairInstall:$Repair `
            -ForceInstall:$Force `
            -AllowLocal:$AllowLocalFixture `
            -FixtureSmokeScript $LocalSmokeScript `
            -Retries $MaxRetries `
            -RetryDelay $RetryDelayMilliseconds `
            -SpaceMargin $SafetyMarginBytes `
            -AvailableBytesOverride $TestAvailableBytes `
            -FailurePoint $TestFailurePoint
        exit 0
    }
    catch {
        Write-Error ("安装失败：" + $_.Exception.Message)
        exit 1
    }
}
