<#
.SYNOPSIS
  Pre-demo checks for ChargeMesh (docs/06-demo-senaryosu.md). Read-only: sends no transactions.

.DESCRIPTION
  Checks the API health and config, the simulator connection, the settler balance against
  Monad's 10 MON reserve rule, that the on-chain settler matches the committed deployment,
  and that the laptop clock is close to chain time (quote expiry uses the laptop clock).

.EXAMPLE
  ./scripts/preflight.ps1
  ./scripts/preflight.ps1 -ExpectedChainMode anvil -RpcUrl http://localhost:8545 -ChainId 31337
#>
param(
  [string]$ApiUrl = "http://localhost:4000",
  [string]$ExpectedChainMode = "monad",
  [string]$RpcUrl = "https://testnet-rpc.monad.xyz",
  [int]$ChainId = 10143,
  [string]$ChargePointId = "CM-DEMO-001",
  [decimal]$MinSettlerMon = 11,
  [int]$MaxClockSkewSeconds = 30
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$failures = 0

function Report([bool]$Ok, [string]$Name, [string]$Detail) {
  $mark = if ($Ok) { "PASS" } else { "FAIL" }
  Write-Host ("[{0}] {1}: {2}" -f $mark, $Name, $Detail)
  if (-not $Ok) { $script:failures++ }
}

function Invoke-Rpc([string]$Method, [object[]]$Params) {
  $body = @{ jsonrpc = "2.0"; id = 1; method = $Method; params = $Params } | ConvertTo-Json -Compress -Depth 5
  $res = Invoke-RestMethod -Uri $RpcUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 15
  if ($res.error) { throw "$Method failed: $($res.error.message)" }
  return $res.result
}

function ConvertFrom-Hex([string]$Hex) {
  $clean = $Hex -replace "^0x", ""
  if ($clean -eq "") { return [System.Numerics.BigInteger]::Zero }
  return [System.Numerics.BigInteger]::Parse("0" + $clean, [System.Globalization.NumberStyles]::HexNumber)
}

# 1. API health and config
try {
  $health = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 5
  Report ($health.status -eq "ok") "API health" "status=$($health.status) chainMode=$($health.chainMode)"
  $config = Invoke-RestMethod "$ApiUrl/api/v1/config" -TimeoutSec 5
  Report ($config.chainMode -eq $ExpectedChainMode) "Chain mode" "api=$($config.chainMode) expected=$ExpectedChainMode"
  Report ($config.chainId -eq $ChainId) "Chain id" "api=$($config.chainId) expected=$ChainId"
} catch {
  Report $false "API" "unreachable at $ApiUrl ($($_.Exception.Message))"
}

# 2. Simulator connection
try {
  $chargers = Invoke-RestMethod "$ApiUrl/api/v1/chargers" -TimeoutSec 5
  $cp = @($chargers) | Where-Object { $_.chargePointId -eq $ChargePointId } | Select-Object -First 1
  $ok = $null -ne $cp -and $cp.connected
  Report $ok "Charger $ChargePointId" ($(if ($cp) { "connected=$($cp.connected) status=$($cp.connectorStatus)" } else { "not registered" }))
} catch {
  Report $false "Chargers" $_.Exception.Message
}

# 3. Deployment, on-chain settler and settler balance
$deploymentFile = Join-Path $root "contracts/deployments/$ChainId.json"
if (-not (Test-Path $deploymentFile)) {
  Report $false "Deployment" "missing $deploymentFile"
} else {
  $deployment = Get-Content $deploymentFile -Raw | ConvertFrom-Json
  try {
    $code = Invoke-Rpc "eth_getCode" @($deployment.escrow, "latest")
    Report ($code.Length -gt 2) "Escrow code" "$($deployment.escrow) has $([int](($code.Length - 2) / 2)) bytes"

    $settlerWord = Invoke-Rpc "eth_call" @(@{ to = $deployment.escrow; data = "0xab221a76" }, "latest")
    $onchainSettler = "0x" + $settlerWord.Substring($settlerWord.Length - 40)
    Report ($onchainSettler.ToLower() -eq $deployment.settler.ToLower()) "Settler" "on-chain=$onchainSettler deployment=$($deployment.settler)"

    $wei = ConvertFrom-Hex (Invoke-Rpc "eth_getBalance" @($deployment.settler, "latest"))
    $mon = [decimal]($wei / [System.Numerics.BigInteger]::Pow(10, 12)) / 1000000
    Report ($mon -ge $MinSettlerMon) "Settler balance" ("{0:N3} MON (min {1} MON: 10 MON reserve + gas)" -f $mon, $MinSettlerMon)

    $block = Invoke-Rpc "eth_getBlockByNumber" @("latest", $false)
    $chainTime = [long](ConvertFrom-Hex $block.timestamp)
    $skew = [Math]::Abs([DateTimeOffset]::UtcNow.ToUnixTimeSeconds() - $chainTime)
    Report ($skew -le $MaxClockSkewSeconds) "Clock skew" "$skew s vs chain time (max $MaxClockSkewSeconds s)"
  } catch {
    Report $false "RPC" "$RpcUrl ($($_.Exception.Message))"
  }
}

Write-Host ""
if ($failures -eq 0) {
  Write-Host "Preflight OK."
  exit 0
}
Write-Host "Preflight failed: $failures check(s)."
exit 1
