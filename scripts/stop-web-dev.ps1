$ErrorActionPreference = "Stop"

# Resolve repository root relative to this script
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path -Path (Join-Path $scriptDir '..')
$logDir = Join-Path $repoRoot 'logs'

$gatewayPidFile = Join-Path $logDir 'gateway-dev.pid'
$webPidFile = Join-Path $logDir 'web-dev.pid'
$gatewayOutLog = Join-Path $logDir 'gateway-dev.out.log'
$gatewayErrLog = Join-Path $logDir 'gateway-dev.err.log'
$webOutLog = Join-Path $logDir 'web-dev.out.log'
$webErrLog = Join-Path $logDir 'web-dev.err.log'

# Helper to stop a process by pid if running
function Stop-IfRunning([int]$pid) {
  if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}

# Stop gateway by PID if exists
if (Test-Path $gatewayPidFile) {
  try {
    $gp = Get-Content $gatewayPidFile -ErrorAction SilentlyContinue
    if ($gp -match '^\d+$') { Stop-IfRunning [int]$gp }
  } catch {}
  Remove-Item $gatewayPidFile -ErrorAction SilentlyContinue
}

# Stop gateway by name (in case PID file is stale or missing)
Get-Process -Name 'gateway' -ErrorAction SilentlyContinue | ForEach-Object {
  Try { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue } Catch {}
}

# Stop web bun PID if exists
if (Test-Path $webPidFile) {
  try {
    $wp = Get-Content $webPidFile -ErrorAction SilentlyContinue
    if ($wp -match '^\d+$') { Stop-IfRunning [int]$wp }
  } catch {}
  Remove-Item $webPidFile -ErrorAction SilentlyContinue
}

# Stop bun processes for web (by command line)
Get-CimInstance Win32_Process -Filter "Name = 'bun.exe' OR Name = 'bun'" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like "*apps\web*") {
    Try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } Catch {}
  }
}

# Optional: Clear commonly used dev ports
try {
  $ports = 5173,5174,5175,5176,5177,5178
  Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.OwningProcess) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
  }
} catch {}

Write-Output "Stop-web-dev: termination attempts issued."
exit 0
