param(
    [Parameter(Mandatory = $true)][string]$Path,
    [string]$Uuid = (New-Guid).ToString(),
    [string]$Root = (Join-Path $env:LOCALAPPDATA "RaycastMini")
)

# Installs an extension folder into the launcher's extension directory, the way the store does.
#
# Raycast copies every extension to <configRoot>/extensions/<uuid>/ and symlinks
# <configRoot>/extensions/node_modules -> <install dir>/Raycast/api/node_modules so that the
# extension's `require("@raycast/api")` resolves against the version bundled with the app.
$ErrorActionPreference = "Stop"

$manifest = Get-Content -LiteralPath (Join-Path $Path "package.json") -Raw | ConvertFrom-Json
$name = if ($manifest.name) { $manifest.name } else { Split-Path -Leaf $Path }

$destination = Join-Path $Root ("extensions\" + $Uuid)
New-Item -ItemType Directory -Force -Path $destination | Out-Null

# Only the runtime artefacts are needed at run time (the same as Raycast's install payload).
foreach ($item in @("package.json", "dist", "assets", "tools")) {
    $source = Join-Path $Path $item
    if (Test-Path -LiteralPath $source) {
        Copy-Item -Path $source -Destination $destination -Recurse -Force
    }
}

# The node_modules bridge Raycast maintains between <configRoot>/extensions/node_modules and
# <install dir>/api/node_modules. The worker already resolves `@raycast/api` through NODE_PATH, so
# this link is only needed for authoring flows (`ray build`, `npm install` inside an extension).
$apiNodeModules = Join-Path (Split-Path -Parent $PSScriptRoot) "api\node_modules"
$link = Join-Path $Root "extensions\node_modules"
if (-not (Test-Path -LiteralPath $link)) {
    try {
        New-Item -ItemType Junction -Path $link -Target $apiNodeModules | Out-Null
        Write-Host "Linked $link -> $apiNodeModules"
    }
    catch {
        Write-Warning "Could not create the node_modules junction (needs Developer Mode / admin). NODE_PATH already resolves @raycast/api, so this is only needed for authoring."
    }
}

Write-Host "Installed '$name' as $Uuid -> $destination"
