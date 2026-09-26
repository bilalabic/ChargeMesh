<#
.SYNOPSIS
  Starts ChargeMesh against MongoDB Atlas and Monad testnet, with the frontend in live mode.

.DESCRIPTION
  This script deliberately overrides only non-secret mode and local URL settings. MongoDB and
  settler credentials stay in backend/api/.env and are loaded by the API process; this script
  never reads or prints their values. Startup stops when Atlas indexes cannot be verified or the
  API does not report CHAIN_MODE=monad.

.EXAMPLE
  ./scripts/dev.ps1
  ./scripts/dev.ps1 -SimArgs '--vehicle-accept 14500'
  ./scripts/dev.ps1 -SkipFrontend
#>
param(
  [string]$SimArgs = "",
  [switch]$SkipFrontend,
  [switch]$SkipPreflight,
  [int]$ApiStartupTimeoutSeconds = 45
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:COREPACK_ENABLE_DOWNLOAD_PROMPT = "0"

$apiEnvFile = Join-Path $root "backend/api/.env"
if (-not (Test-Path -LiteralPath $apiEnvFile -PathType Leaf)) {
  throw "backend/api/.env is missing. Copy backend/api/.env.example and fill MONGODB_URI and SETTLER_PRIVATE_KEY locally."
}

# Public, non-secret live-mode settings. Process environment takes precedence over .env files.
$env:CHAIN_MODE = "monad"
$env:DEMO_ALLOW_ANY_TIME = "false"
$env:PORT = "4000"
$env:OCPP_PORT = "9000"
$env:WEB_BASE_URL = "http://localhost:3000"
$env:CS_URL = "ws://localhost:9000/ocpp"
$env:VITE_API_MODE = "live"
$env:VITE_API_URL = "http://localhost:4000/api/v1"
$env:VITE_CHAIN_ID = "10143"

function Start-Service([string]$Title, [string]$Command) {
  $script = "`$Host.UI.RawUI.WindowTitle = '$Title'; Set-Location '$root'; $Command"
  Start-Process pwsh -ArgumentList @("-NoExit", "-Command", $script) | Out-Null
  Write-Host "started: $Title -> $Command"
}

function Wait-LiveApi {
  $deadline = [DateTimeOffset]::UtcNow.AddSeconds($ApiStartupTimeoutSeconds)
  do {
    try {
      $health = Invoke-RestMethod "http://localhost:4000/health" -TimeoutSec 2
      if ($health.status -eq "ok" -and $health.chainMode -eq "monad" -and $health.chainId -eq 10143) {
        Write-Host "ready: ChargeMesh API -> Atlas connected, Monad mode active"
        return
      }
    } catch {
      # The API connects to Atlas and verifies indexes before opening the HTTP port.
    }
    Start-Sleep -Milliseconds 750
  } while ([DateTimeOffset]::UtcNow -lt $deadline)

  throw "ChargeMesh API did not become ready in live Monad mode within $ApiStartupTimeoutSeconds seconds. Check the API window without sharing secret values."
}

Write-Host "Verifying MongoDB Atlas indexes (secret values are not displayed)..."
corepack pnpm db:indexes
if ($LASTEXITCODE -ne 0) { throw "MongoDB Atlas index verification failed." }

Start-Service "ChargeMesh API" "corepack pnpm dev:backend"
Wait-LiveApi

$simCommand = "corepack pnpm dev:sim"
if ($SimArgs) { $simCommand = "corepack pnpm --filter @chargemesh/charger-sim dev -- $SimArgs" }
Start-Service "ChargeMesh Simulator" $simCommand

if (-not $SkipFrontend) {
  Start-Service "ChargeMesh Frontend" "corepack pnpm dev:frontend"
}

Write-Host ""
Write-Host "Live services started: Atlas + Monad testnet + MetaMask frontend."
if (-not $SkipPreflight) {
  Start-Sleep -Seconds 3
  & (Join-Path $PSScriptRoot "preflight.ps1")
}
