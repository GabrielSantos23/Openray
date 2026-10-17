# Installs a FlowKey extension into Openray's extensions root (replaces the Store's
# install-extension.ps1, removed in the FlowKey migration M2).
#
# Usage:  install-flowkey.ps1 <path-to-extension-dir>
#   The dir must contain manifest.json. If it has build.mjs, it is built first (node build.mjs)
#   so the bundle in the install tree is current. Copies manifest.json, the bundle (manifest.entry
#   or main.js), src-free assets and package files into <root>\<manifest.id>.
#
# The extensions root is $env:OPENRAY_EXTENSIONS_ROOT or %LOCALAPPDATA%\Openray\extensions.
param(
    [Parameter(Mandatory = $true)][string]$ExtensionDir
)

$ErrorActionPreference = "Stop"
$source = Resolve-Path $ExtensionDir
$manifestPath = Join-Path $source "manifest.json"
if (-not (Test-Path $manifestPath)) {
    throw "not a FlowKey extension: $manifestPath missing"
}
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json
if (-not $manifest.id) {
    throw "manifest.json has no id"
}

$buildScript = Join-Path $source "build.mjs"
if (Test-Path $buildScript) {
    Write-Host "==> building $($manifest.id)"
    Push-Location $source
    node build.mjs
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "build failed for $($manifest.id)" }
    Pop-Location
}

$root = $env:OPENRAY_EXTENSIONS_ROOT
if (-not $root) {
    $root = Join-Path $env:LOCALAPPDATA "Openray\extensions"
}
New-Item -ItemType Directory -Force -Path $root | Out-Null
$target = Join-Path $root $manifest.id

Write-Host "==> installing $($manifest.id) -> $target"
New-Item -ItemType Directory -Force -Path $target | Out-Null
Copy-Item (Join-Path $source "manifest.json") $target -Force

$entry = if ($manifest.entry) { $manifest.entry } else { "main.js" }
$entrySource = Join-Path $source $entry
if (-not (Test-Path $entrySource)) {
    throw "bundle missing: $entrySource (build the extension first)"
}
Copy-Item $entrySource $target -Force

$assets = Join-Path $source "assets"
if (Test-Path $assets) {
    Copy-Item $assets (Join-Path $target "assets") -Recurse -Force
}

Write-Host "==> installed. Restart Openray to pick it up."
