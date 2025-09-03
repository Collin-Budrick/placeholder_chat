param(
  [switch]$Detached,
  [switch]$Stop
)
# Note: Stop can be invoked with --stop
# Map --stop to Stop
if ($args -contains '--stop') {
  $Stop = $true
  $Detached = $true
}
# PS-bound Stop is handled by PowerShell; no extra action needed
function Stop-IfRunning([int]$pid) {
  if ($pid -and (Get-Process -Id $pid -ErrorAction SilentlyContinue)) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
}

$ErrorActionPreference = "Stop"

# --- encoding ---
$utf8 = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

# --- paths/encoding ---
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

# If Stop switch, kill PIDs (do this before detaching)
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
  # Extra cleanup to ensure no lingering dev processes
  Get-Process -Name 'gateway' -ErrorAction SilentlyContinue | ForEach-Object {
    Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
  }
  Get-CimInstance Win32_Process -Filter "Name = 'bun.exe' OR Name = 'bun'" -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.CommandLine -and $_.CommandLine -like "*apps\web*") {
      Try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } Catch {}
    }
  }
  # Optional: Clear commonly used dev ports
  try {
    $ports = 5173,5174,5175,5176,5177,5178,7000
    Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue | ForEach-Object {
      if ($_.OwningProcess) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
  } catch {}
  Remove-Item $gatewayPidFile -ErrorAction SilentlyContinue
  Remove-Item $webPidFile -ErrorAction SilentlyContinue
  Write-Output "Stopped (if running) and cleaned PID files."
  exit 0
}

# If not Detached (default), relaunch self detached
if (-not $Detached) {
  $psExe = (Get-Process -Id $PID).Path   # works for both powershell.exe and pwsh.exe
  $args  = @('-NoProfile','-ExecutionPolicy','Bypass','-File',"`"$PSCommandPath`"",'--detached')
  Start-Process -FilePath $psExe -ArgumentList $args -WindowStyle Hidden | Out-Null
  Write-Output "Launching background dev stack… (use --stop to kill later)"
  return
}

# Pre-flight: clean strays
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
$portsToClear = 5173,5174,5175,5176,5177,5178,7000
Get-NetTCPConnection -State Listen -LocalPort $portsToClear -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.OwningProcess) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
}
Start-Sleep -Milliseconds 200

# Development default: ensure the gateway allows the web dev origin so cookies can be set across ports.
# This sets CORS_ALLOW_ORIGINS to the common dev origin used by the web server when not provided.
if (-not $env:CORS_ALLOW_ORIGINS -or $env:CORS_ALLOW_ORIGINS -eq "") {
  $env:CORS_ALLOW_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173"
}

# Pre-flight: build gateway from source. If this fails we abort before launching any processes.
Write-Output "Preflight: building gateway (cargo build --manifest-path apps/gateway/Cargo.toml)"
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
  Write-Error "cargo not found in PATH. Install Rust toolchain and cargo."
  exit 1
}
$cwd = Get-Location
try {
  Set-Location $repoRoot
  & cargo build --manifest-path (Join-Path $repoRoot 'apps\gateway\Cargo.toml')
  $cargoExit = $LASTEXITCODE
} finally {
  Set-Location $cwd
}
if ($cargoExit -ne 0) {
  Write-Error "cargo build failed with exit code $cargoExit. Aborting."
  exit $cargoExit
}

# Preflight: install web deps and build the web app with bun. Abort on any failure.
Write-Output "Preflight: installing web deps (bun install) and building web (bun run build) in: $webDir"
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
  Write-Error "bun not found in PATH. Install bun to proceed."
  exit 1
}
$cwd = Get-Location
try {
  Set-Location $webDir

  # Install dependencies first. Fail fast if install fails.
  & bun install
  $bunInstallExit = $LASTEXITCODE
  if ($bunInstallExit -ne 0) {
    Write-Error "bun install failed with exit code $bunInstallExit. Aborting."
    exit $bunInstallExit
  }

  # Build the web app. Many projects use "bun run build" — if you use a different script, adjust accordingly.
  & bun run build
  $bunBuildExit = $LASTEXITCODE
} finally {
  Set-Location $cwd
}
if ($bunBuildExit -ne 0) {
  Write-Error "bun run build failed with exit code $bunBuildExit. Aborting."
  exit $bunBuildExit
}

# Verify inputs (post-build)
if (-not (Test-Path $gatewayExe)) { Write-Error "Gateway executable not found: $gatewayExe"; exit 1 }
if (-not (Test-Path $webDir))     { Write-Error "Web directory not found: $webDir"; exit 1 }

# Start gateway (detached child; no -Wait)
Write-Output "Starting gateway (background): $gatewayExe"
$gw = Start-Process -FilePath $gatewayExe -WorkingDirectory $repoRoot `
      -RedirectStandardOutput $gatewayOutLog -RedirectStandardError $gatewayErrLog `
      -PassThru -WindowStyle Hidden
$gw.Id | Out-File -FilePath $gatewayPidFile -Encoding ascii -Force

# Start web (bun)
Write-Output "Starting web dev in: $webDir"

# Ensure Auth.js has a dev secret and basic env defaults so the dev server does not crash with MissingSecret.
# These defaults are intentionally development-only and will not be used in production.
if (-not $env:AUTH_SECRET -or $env:AUTH_SECRET -eq "") {
  $env:AUTH_SECRET = 'dev-insecure-secret'
}
if (-not $env:AUTH_URL -or $env:AUTH_URL -eq "") {
  $env:AUTH_URL = "http://127.0.0.1:5173"
}
if (-not $env:AUTH_TRUST_HOST -or $env:AUTH_TRUST_HOST -eq "") {
  $env:AUTH_TRUST_HOST = "true"
}

$wb = Start-Process -FilePath 'bun' -ArgumentList @('run','dev','--','--port','5173','--strictPort') `
      -WorkingDirectory $webDir -RedirectStandardOutput $webOutLog -RedirectStandardError $webErrLog `
      -PassThru -WindowStyle Hidden
$wb.Id | Out-File -FilePath $webPidFile -Encoding ascii -Force

Write-Output "Background launch complete."
Write-Output "Gateway PID: $($gw.Id)  Log: $gatewayOutLog"
Write-Output "Web PID:     $($wb.Id)  Log: $webOutLog"

# child exits immediately; services keep running
return
