<#
.SYNOPSIS
  Read-only live checks for ChargeMesh. Sends no database writes or blockchain transactions.

.DESCRIPTION
  Checks the API, a read-only Atlas query, the simulator connection, Monad chain id, the settler
  balance, deployment addresses and laptop clock. Secret env values are never read or printed.

.EXAMPLE
  ./scripts/preflight.ps1
  ./scripts/preflight.ps1 -DriverAddress 0x0000000000000000000000000000000000000000
#>
param(
  [string]$ApiUrl = "http://localhost:4000",
  [string]$RpcUrl = "https://testnet-rpc.monad.xyz",
  [string]$ChargePointId = "CM-DEMO-001",
  [string]$DriverAddress = "",
  [decimal]$MinSettlerMon = 11,
  [decimal]$MinDriverMon = 12,
  [int]$MaxClockSkewSeconds = 30
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$failures = 0
$chainId = 10143

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

# 1. Required local file and live API configuration. The file contents are intentionally not read.
$apiEnvFile = Join-Path $root "backend/api/.env"
Report (Test-Path -LiteralPath $apiEnvFile -PathType Leaf) "Backend env file" "presence checked; contents not read"

$config = $null
try {
  $health = Invoke-RestMethod "$ApiUrl/health" -TimeoutSec 5
  Report ($health.status -eq "ok") "API health" "status=$($health.status) chainMode=$($health.chainMode)"
  $config = Invoke-RestMethod "$ApiUrl/api/v1/config" -TimeoutSec 5
  Report ($config.chainMode -eq "monad") "Chain mode" "api=$($config.chainMode) expected=monad"
  Report ($config.chainId -eq $chainId) "Chain id" "api=$($config.chainId) expected=$chainId"
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

# 3. Deployment, Atlas read, on-chain settler and balances
$deploymentFile = Join-Path $root "contracts/deployments/$chainId.json"
if (-not (Test-Path $deploymentFile)) {
  Report $false "Deployment" "missing $deploymentFile"
} else {
  $deployment = Get-Content $deploymentFile -Raw | ConvertFrom-Json
  try {
    $rpcChainId = [int](ConvertFrom-Hex (Invoke-Rpc "eth_chainId" @()))
    Report ($rpcChainId -eq $chainId) "RPC chain id" "rpc=$rpcChainId expected=$chainId"

    $code = Invoke-Rpc "eth_getCode" @($deployment.escrow, "latest")
    Report ($code.Length -gt 2) "Escrow code" "$($deployment.escrow) has $([int](($code.Length - 2) / 2)) bytes"

    $settlerWord = Invoke-Rpc "eth_call" @(@{ to = $deployment.escrow; data = "0xab221a76" }, "latest")
    $onchainSettler = "0x" + $settlerWord.Substring($settlerWord.Length - 40)
    Report ($onchainSettler.ToLower() -eq $deployment.settler.ToLower()) "Settler" "on-chain=$onchainSettler deployment=$($deployment.settler)"

    if ($null -ne $config) {
      Report ($config.contractAddress.ToLower() -eq $deployment.escrow.ToLower()) "API contract" "matches committed deployment"
      Report ($config.settlerAddress.ToLower() -eq $deployment.settler.ToLower()) "API settler" "matches committed deployment"
    }

    try {
      $headers = @{ "x-wallet-address" = $deployment.settler }
      $nodes = @(Invoke-RestMethod "$ApiUrl/api/v1/nodes?mine=true" -Headers $headers -TimeoutSec 8)
      Report $true "MongoDB Atlas read" "$($nodes.Count) host node record(s) returned"
    } catch {
      Report $false "MongoDB Atlas read" $_.Exception.Message
    }

    $wei = ConvertFrom-Hex (Invoke-Rpc "eth_getBalance" @($deployment.settler, "latest"))
    $mon = [decimal]($wei / [System.Numerics.BigInteger]::Pow(10, 12)) / 1000000
    Report ($mon -ge $MinSettlerMon) "Settler balance" ("{0:N3} MON (min {1} MON: 10 MON reserve + gas)" -f $mon, $MinSettlerMon)

    if ($DriverAddress) {
      if ($DriverAddress -notmatch '^0x[0-9a-fA-F]{40}$') {
        Report $false "Driver address" "must be a 0x-prefixed 20-byte address"
      } else {
        $driverWei = ConvertFrom-Hex (Invoke-Rpc "eth_getBalance" @($DriverAddress, "latest"))
        $driverMon = [decimal]($driverWei / [System.Numerics.BigInteger]::Pow(10, 12)) / 1000000
        Report ($driverMon -ge $MinDriverMon) "Driver balance" ("{0:N3} MON (min {1} MON)" -f $driverMon, $MinDriverMon)
      }
    }

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
