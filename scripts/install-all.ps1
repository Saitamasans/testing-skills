[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path ([Environment]::GetFolderPath("UserProfile")) ".agents\skills"),
    [switch]$Force
)

$installer = Join-Path $PSScriptRoot "install.ps1"
$repositoryRoot = Split-Path $PSScriptRoot -Parent
& $installer -All -SourceDirectory $repositoryRoot -InstallRoot $InstallRoot -Force:$Force
if (-not $?) {
    exit 1
}
exit 0
