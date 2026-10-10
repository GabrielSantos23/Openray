# Builds everything: the `@raycast/api` runtime, the sample extension, the TypeScript frontend and
# the .NET launcher.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

Write-Host "==> @raycast/api"
Push-Location (Join-Path $root "api")
node build.mjs
Pop-Location

foreach ($extension in Get-ChildItem -Path (Join-Path $root "extensions") -Directory) {
  Write-Host "==> extension: $($extension.Name)"
  Push-Location $extension.FullName
  if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund | Out-Null }
  node build.mjs
  Pop-Location
}

Write-Host "==> frontend"
Push-Location (Join-Path $root "frontend")
if (-not (Test-Path "node_modules")) { npm install --no-audit --no-fund | Out-Null }
npm run build
Pop-Location

Write-Host "==> launcher (.NET)"
Push-Location (Join-Path $root "host")
dotnet build -c Release -v q
Pop-Location

Write-Host ""
Write-Host "Build complete."
