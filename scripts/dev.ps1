<#
.SYNOPSIS
  Starts the ChargeMesh backend API, the OCPP charger simulator and the frontend,
  each in its own PowerShell window.

.EXAMPLE
  ./scripts/dev.ps1
  ./scripts/dev.ps1 -SimArgs '--vehicle-accept 14500'
  ./scripts/dev.ps1 -SkipFrontend
#>
param(
  [string]$SimArgs = "",
  [switch]$SkipFrontend,
  [int]$ApiWarmupSeconds = 4
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"

function Start-Service([string]$Title, [string]$Command) {
  $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$root'; $Command"
  Start-Process pwsh -ArgumentList @("-NoExit", "-Command", $script) | Out-Null
  Write-Host "started: $Title -> $Command"
}

Start-Service "ChargeMesh API" "corepack pnpm dev:backend"

# The simulator reconnects on its own, but starting it after the API avoids noisy retries.
Start-Sleep -Seconds $ApiWarmupSeconds
$simCommand = "corepack pnpm dev:sim"
if ($SimArgs) { $simCommand = "corepack pnpm --filter @chargemesh/charger-sim dev -- $SimArgs" }
Start-Service "ChargeMesh Simulator" $simCommand

if (-not $SkipFrontend) {
  Start-Service "ChargeMesh Frontend" "corepack pnpm dev:frontend"
}

Write-Host ""
Write-Host "Run ./scripts/preflight.ps1 once everything is up."
