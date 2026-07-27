[CmdletBinding(DefaultParameterSetName = "All")]
param(
    [Parameter(Mandatory = $true, ParameterSetName = "All")]
    [switch]$All,

    [Parameter(Mandatory = $true, ParameterSetName = "Single")]
    [ValidateNotNullOrEmpty()]
    [string]$Skill,

    [ValidateNotNullOrEmpty()]
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath("UserProfile")) ".agents\skills"),

    [string]$SourceDirectory,

    [ValidatePattern("^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")]
    [string]$Repository = "Saitamasans/testing-skills",

    [ValidateNotNullOrEmpty()]
    [string]$Ref = "main",

    [switch]$Force,

    [switch]$Repair
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$downloadRoot = $null
$stagingRoot = $null

function Resolve-LocalSkillsRoot {
    param([Parameter(Mandatory = $true)][string]$Directory)

    $resolved = (Resolve-Path -LiteralPath $Directory -ErrorAction Stop).Path
    $nestedSkills = Join-Path $resolved "skills"
    if (Test-Path -LiteralPath $nestedSkills -PathType Container) {
        return $nestedSkills
    }
    if ((Split-Path -Leaf $resolved) -eq "skills") {
        return $resolved
    }
    throw "本地来源中找不到 skills 目录：$resolved"
}

function Get-ValidSkillPackages {
    param([Parameter(Mandatory = $true)][string]$SkillsRoot)

    $packages = @(
        Get-ChildItem -LiteralPath $SkillsRoot -Directory |
            Where-Object {
                $_.Name -cmatch "^[a-z0-9][a-z0-9-]*$" -and
                (Test-Path -LiteralPath (Join-Path $_.FullName "SKILL.md") -PathType Leaf)
            } |
            Sort-Object Name
    )
    if ($packages.Count -eq 0) {
        throw "来源中没有发现包含 SKILL.md 的有效 Skill 包：$SkillsRoot"
    }
    return $packages
}

function Get-FileSha256 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
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

function Invoke-CompleteEighthSkillInstaller {
    param(
        [Parameter(Mandatory = $true)][string]$DestinationRoot,
        [switch]$Replace,
        [switch]$RepairInstall
    )

    $completeSha256 = "__COMPLETE_INSTALLER_SHA256__"
    if ($completeSha256 -cnotmatch "^[a-f0-9]{64}$") {
        throw "通用安装器尚未写入完整运行时安装器的可信 SHA-256。"
    }
    $completeScript = $env:TESTING_SKILLS_COMPLETE_INSTALLER_SCRIPT
    if (-not $completeScript -and $PSScriptRoot) {
        $sibling = Join-Path $PSScriptRoot "install-web-api-test-execution-evidence.ps1"
        if (Test-Path -LiteralPath $sibling -PathType Leaf) {
            $completeScript = $sibling
        }
    }
    if (-not $completeScript) {
        $completeDownloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("testing-skills-complete-installer-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Path $completeDownloadRoot | Out-Null
        $completeScript = Join-Path $completeDownloadRoot "install-web-api-test-execution-evidence.ps1"
        $completeUrl = "https://github.com/Saitamasans/testing-skills/releases/download/web-api-test-execution-evidence-v1.0.2/install-web-api-test-execution-evidence.ps1"
        Invoke-WebRequest -UseBasicParsing -Uri $completeUrl -OutFile $completeScript
    }
    if (-not (Test-Path -LiteralPath $completeScript -PathType Leaf) -or
        (Get-FileSha256 -Path $completeScript) -cne $completeSha256) {
        throw "完整运行时安装器 SHA-256 校验失败。"
    }

    $powerShellExe = Join-Path $PSHOME "powershell.exe"
    $arguments = @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $completeScript,
        "-InstallRoot", $DestinationRoot
    )
    if ($Replace) { $arguments += "-Force" }
    if ($RepairInstall) { $arguments += "-Repair" }
    & $powerShellExe @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "完整运行时安装失败，退出码：$LASTEXITCODE。"
    }
}

try {
    $completeSkill = "web-api-test-execution-evidence"
    if (-not $SourceDirectory -and -not $All -and $Skill -ceq $completeSkill) {
        Invoke-CompleteEighthSkillInstaller -DestinationRoot ([IO.Path]::GetFullPath($InstallRoot)) -Replace:$Force -RepairInstall:$Repair
        return
    }
    if ($SourceDirectory) {
        $skillsRoot = Resolve-LocalSkillsRoot -Directory $SourceDirectory
        Write-Output "使用本地 Skill 来源：$skillsRoot"
    }
    else {
        [Net.ServicePointManager]::SecurityProtocol =
            [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

        $downloadRoot = Join-Path ([IO.Path]::GetTempPath()) ("testing-skills-download-" + [Guid]::NewGuid().ToString("N"))
        $archivePath = Join-Path $downloadRoot "repository.zip"
        $extractRoot = Join-Path $downloadRoot "repository"
        New-Item -ItemType Directory -Path $downloadRoot | Out-Null

        $escapedRef = [Uri]::EscapeDataString($Ref)
        $archiveUrl = "https://codeload.github.com/$Repository/zip/$escapedRef"
        Write-Output "正在从 GitHub 下载 $Repository（版本：$Ref）..."
        Invoke-WebRequest -UseBasicParsing -Uri $archiveUrl -OutFile $archivePath
        Expand-Archive -LiteralPath $archivePath -DestinationPath $extractRoot -Force

        $repositoryRoots = @(
            Get-ChildItem -LiteralPath $extractRoot -Directory |
                Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "skills") -PathType Container }
        )
        if ($repositoryRoots.Count -ne 1) {
            throw "下载内容结构异常：未找到唯一的 skills 目录。"
        }
        $skillsRoot = Join-Path $repositoryRoots[0].FullName "skills"
    }

    $availablePackages = @(Get-ValidSkillPackages -SkillsRoot $skillsRoot)
    if ($All) {
        $requestedPackages = $availablePackages
    }
    else {
        $requestedPackages = @($availablePackages | Where-Object { $_.Name -ceq $Skill })
        if ($requestedPackages.Count -ne 1) {
            $availableNames = ($availablePackages.Name -join "、")
            throw "未知 Skill：$Skill。可选名称：$availableNames"
        }
    }
    $containsCompleteSkill = @(
        $requestedPackages | Where-Object { $_.Name -ceq $completeSkill }
    ).Count -gt 0
    if ($Repair -and -not $containsCompleteSkill) {
        throw "-Repair 仅适用于 $completeSkill。"
    }
    if ($SourceDirectory -and $containsCompleteSkill) {
        Write-Output "注意：第八个 Skill 的 -SourceDirectory 安装仅供开发者检查源码，不包含 Node.js、Runner 或 Chromium，不能执行 Web/API 自动化测试。"
    }
    elseif (-not $SourceDirectory -and $containsCompleteSkill) {
        $requestedPackages = @($requestedPackages | Where-Object { $_.Name -cne $completeSkill })
    }

    foreach ($package in $requestedPackages) {
        if (-not (Test-Path -LiteralPath (Join-Path $package.FullName "SKILL.md") -PathType Leaf)) {
            throw "Skill 包校验失败，缺少 SKILL.md：$($package.Name)"
        }
    }

    $installRootPath = [IO.Path]::GetFullPath($InstallRoot)
    New-Item -ItemType Directory -Path $installRootPath -Force | Out-Null
    $stagingRoot = Join-Path $installRootPath (".testing-skills-stage-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Path $stagingRoot | Out-Null

    $installed = 0
    $skipped = 0
    foreach ($package in $requestedPackages) {
        $targetPath = Join-Path $installRootPath $package.Name
        if ((Test-Path -LiteralPath $targetPath) -and -not $Force) {
            Write-Output "已跳过：$($package.Name)（目标已存在；如需替换请加 -Force）"
            $skipped++
            continue
        }

        $stagedPackage = Join-Path $stagingRoot ("new-" + $package.Name)
        $backupPackage = Join-Path $stagingRoot ("backup-" + $package.Name)
        Copy-Item -LiteralPath $package.FullName -Destination $stagedPackage -Recurse -Force
        if (-not (Test-Path -LiteralPath (Join-Path $stagedPackage "SKILL.md") -PathType Leaf)) {
            throw "复制后校验失败：$($package.Name)"
        }

        $hadExisting = Test-Path -LiteralPath $targetPath
        try {
            if ($hadExisting) {
                Move-Item -LiteralPath $targetPath -Destination $backupPackage
            }
            Move-Item -LiteralPath $stagedPackage -Destination $targetPath
            if (Test-Path -LiteralPath $backupPackage) {
                Remove-Item -LiteralPath $backupPackage -Recurse -Force
            }
        }
        catch {
            if (Test-Path -LiteralPath $backupPackage) {
                if (Test-Path -LiteralPath $targetPath) {
                    Remove-Item -LiteralPath $targetPath -Recurse -Force
                }
                Move-Item -LiteralPath $backupPackage -Destination $targetPath
            }
            throw
        }

        Write-Output "已安装：$($package.Name) -> $targetPath"
        $installed++
    }

    if ($SourceDirectory -and $containsCompleteSkill) {
        Write-Output "开发者源码复制完成：复制 $installed 个，保留 $skipped 个。"
        Write-Output "开发者源码目录：$installRootPath"
        Write-Output "此模式不能执行 Web/API 自动化测试；-All 和正式单包安装必须使用完整 Release 安装器。"
    }
    else {
        Write-Output "安装完成：新装/替换 $installed 个，保留 $skipped 个。"
        Write-Output "安装目录：$installRootPath"
        Write-Output "请重启 Codex、Claude Code 或 CC Switch，然后用自然语言调用对应 Skill。"
    }
    if (-not $SourceDirectory -and $containsCompleteSkill -and $All) {
        Invoke-CompleteEighthSkillInstaller -DestinationRoot $installRootPath -Replace:$Force -RepairInstall:$Repair
    }
}
catch {
    Write-Error ("安装失败：" + $_.Exception.Message)
    exit 1
}
finally {
    if ($stagingRoot -and (Test-Path -LiteralPath $stagingRoot)) {
        Remove-Item -LiteralPath $stagingRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($downloadRoot -and (Test-Path -LiteralPath $downloadRoot)) {
        Remove-Item -LiteralPath $downloadRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($completeDownloadRoot -and (Test-Path -LiteralPath $completeDownloadRoot)) {
        Remove-Item -LiteralPath $completeDownloadRoot -Recurse -Force -ErrorAction SilentlyContinue
    }
}
