<#
.SYNOPSIS
    将本地源码仓库中的 agy-icon-studio 实体部署到 Google Antigravity 全局插件目录。
#>
param(
    [string]$TargetDir = $(Join-Path $env:USERPROFILE ".gemini\config\plugins\agy-icon-studio")
)

$ErrorActionPreference = "Stop"
$SourceDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

Write-Host "[agy-icon-studio] 源目录: $SourceDir"
Write-Host "[agy-icon-studio] 目标目录: $TargetDir"

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null

$rootFiles = @("plugin.json", "agy-market.json", "package.json", "LICENSE", "README.md", "CHANGELOG.md")
foreach ($file in $rootFiles) {
    $src = Join-Path $SourceDir $file
    if (Test-Path $src) {
        Copy-Item -Force $src (Join-Path $TargetDir $file)
    }
}

$copyDirs = @("assets", "bin", "skills", "scripts")
foreach ($dir in $copyDirs) {
    $srcSub = Join-Path $SourceDir $dir
    $dstSub = Join-Path $TargetDir $dir
    if (Test-Path $srcSub) {
        if (Test-Path $dstSub) {
            Remove-Item -Recurse -Force $dstSub
        }
        Copy-Item -Recurse -Force $srcSub $dstSub
    }
}

Write-Host "[agy-icon-studio] 全局插件部署完成！"
