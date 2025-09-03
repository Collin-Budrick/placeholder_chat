param(
  [switch]$Detach,
  [switch]$Start,
  [switch]$Stop,
  [switch]$Debug
)

# Self detach: if not Detach then detach
if (-not $Detach) {
  $psExe = (Get-Process -Id $PID).Path
  $incomingArgs = $args
  $args  = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'--Detach') + $incomingArgs
  Start-Process -FilePath $psExe -ArgumentList $args -WindowStyle Hidden | Out-Null
  Write-Output "Detached self-spawn..."
  return
}

# Support long stop: map --stop to Stop
if ($args -contains '--stop') {
  $Stop = $true
  # no need to set Detach; since child is already Detach
}
# Support long start: map --start to Start
if ($args -contains '--start') {
  $Start = $true
}

# If Detach param is present and Start/Stop not explicitly set, we map to Start
if ($Detach -and -not $Start -and -not $Stop -and -not $Debug) {
  $Start = $true
}

$ErrorActionPreference = "Stop"

# Ensure UTF-8 output
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

# Resolve paths
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot  = Resolve-Path -Path (Join-Path $scriptDir '..')
$webDir    = Join-Path $repoRoot 'apps\web'
$logDir    = Join-Path $repoRoot 'logs'

$gatewayExe     = Join-Path $repoRoot 'target\debug\gateway.exe'
$gatewayOutLog  = Join-Path $logDir 'gateway-dev.out.log'
$gatewayErrLog  = Join-Path $logDir 'gateway-dev.err.log'
$gatewayPidFile = Join-Path $logDir 'gateway-dev.pid'

$webOutLog  = Join-Path $logDir 'web-dev.out.log'
$webErrLog  = Join-Path $logDir 'web-dev.err.log'
$webPidFile = Join-Path $logDir 'web-dev.pid'

# Helper: stop a process by pid if running
function Stop-IfRunning([int]$pid) {
  if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}

# Basic argument validation
if (-not ($Start -or $Stop)) {
  Write-Error "Specify -Start or -Stop."
  exit 1
}
if ($Start -and $Stop) {
  Write-Error "Specify only one of -Start or -Stop."
  exit 1
}

# Stop flow (same behavior as stop-web-dev.ps1)
if ($Stop) {
  foreach ($pf in @($gatewayPidFile,$webPidFile)) {
    if (Test-Path $pf) {
      try {
        $pid = Get-Content $pf -ErrorAction SilentlyContinue
        if ($pid -match '^\d+$') { Stop-IfRunning [int]$pid }
      } catch {}
      Remove-Item $pf -ErrorAction SilentlyContinue
    }
  }
  Get-Process -Name 'gateway' -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
  if (Test-Path $webPidFile) {
    try {
      $wp = Get-Content $webPidFile -ErrorAction SilentlyContinue
      if ($wp -match '^\d+$') { Stop-IfRunning [int]$wp }
    } catch {}
    Remove-Item $webPidFile -ErrorAction SilentlyContinue
  }
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
}

# Start path
if (-not (Test-Path $gatewayExe)) { Write-Error "Gateway executable not found: $gatewayExe"; exit 1 }
if (-not (Test-Path $webDir))     { Write-Error "Web directory not found: $webDir"; exit 1 }

# Ensure mutual exclusivity of -Debug with -Start
if ($Debug -and -not $Start) {
  Write-Error "-Debug can only be used with -Start."
  exit 1
}

# Pre-flight cleanup (same as existing start script)
Get-Process -Name 'bun','bun.exe' -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}
Get-Process -Name 'gateway' -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
}

# Remove stale PIDs
if (Test-Path $gatewayPidFile) {
  try {
    $old = Get-Content $gatewayPidFile -ErrorAction SilentlyContinue
    if ($old -match '^\d+$') { Stop-IfRunning [int]$old }
  } catch {}
  Remove-Item $gatewayPidFile -ErrorAction SilentlyContinue
}
if (Test-Path $webPidFile) {
  Remove-Item $webPidFile -ErrorAction SilentlyContinue
}

# Free common dev ports
$portsToClear = 5173,5174,5175,5176,5177,5178
Get-NetTCPConnection -State Listen -LocalPort $portsToClear -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.OwningProcess) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 200

# Verify inputs again
if (-not (Test-Path $gatewayExe)) { Write-Error "Gateway executable not found: $gatewayExe"; exit 1 }
if (-not (Test-Path $webDir))     { Write-Error "Web directory not found: $webDir"; exit 1 }

if ($Start) {
  if ($Debug) {
    # Foreground (debug) mode: run in current console, no logs redirection
    Write-Output "Starting gateway and web dev in foreground (debug mode)..."
    $gw = Start-Process -FilePath $gatewayExe -WorkingDirectory $repoRoot -PassThru -NoNewWindow
    $wb = Start-Process -FilePath 'bun' -ArgumentList @('run','dev','--','--port','5173','--strictPort') -WorkingDirectory $webDir -PassThru -NoNewWindow
    # Persist PIDs for potential manual stop, then wait
    $gw.Id | Out-File -FilePath $gatewayPidFile -Encoding ascii -Force
    $wb.Id | Out-File -FilePath $webPidFile -Encoding ascii -Force
    Write-Output "Gateway PID: $($gw.Id)  Web PID: $($wb.Id)"
    Wait-Process -Id $gw.Id, $wb.Id
    Remove-Item $gatewayPidFile -ErrorAction SilentlyContinue
    Remove-Item $webPidFile -ErrorAction SilentlyContinue
    Write-Output "Debug run completed."
    exit 0
  } else {
    # Detached background mode: run with logs
    Write-Output "Starting gateway (background) and web dev server (background)..."
    $gw = Start-Process -FilePath $gatewayExe -WorkingDirectory $repoRoot `
          -RedirectStandardOutput $gatewayOutLog -RedirectStandardError $gatewayErrLog `
          -PassThru -WindowStyle Hidden
    $gw.Id | Out-File -FilePath $gatewayPidFile -Encoding ascii -Force

    $wb = Start-Process -FilePath 'bun' -ArgumentList @('run','dev','--','--port','5173','--strictPort') `
          -WorkingDirectory $webDir -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog `
          -PassThru -WindowStyle Hidden
    $wb.Id | Out-File -FilePath $webPidFile -Encoding ascii -Force

    Write-Output "Gateway PID: $($gw.Id)  Log: $gatewayOutLog"
    Write-Output "Web PID:     $($wb.Id)  Log: $webOutLog"
    exit 0
  }
}

# If script reaches here, show usage
Write-Output "Usage: web-dev.ps1 -Start [-Debug] or -Stop"
