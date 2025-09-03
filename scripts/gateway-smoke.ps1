# Smoke test runner for gateway (Windows PowerShell)
# - Builds the gateway binary
# - Starts gateway in background
# - Polls /healthz until ready (timeout)
# - Probes POST /rooms/general/messages and GET /rooms/general/history
# - Stops gateway and prints results

Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path -Path (Join-Path $scriptDir '..') 
$exeExpected = Join-Path $repoRoot 'target\debug\gateway.exe'

Write-Output "Building gateway (cargo build -p gateway)..."
$build = & cargo build -p gateway 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "cargo build failed (exit $LASTEXITCODE). Output:"
    $build | ForEach-Object { Write-Error $_ }
    exit 2
}

if (-not (Test-Path $exeExpected)) {
    Write-Error "gateway executable not found at $exeExpected after build"
    exit 3
}

Write-Output "Starting gateway: $exeExpected"
$p = Start-Process -FilePath $exeExpected -PassThru -WindowStyle Hidden -ErrorAction SilentlyContinue

if (-not $p) {
    Write-Error "Failed to start gateway"
    exit 4
}

# Wait for health endpoint up to timeout
$timeoutSec = 15
$intervalMs = 250
$start = Get-Date
$ok = $false
while (((Get-Date) - $start).TotalSeconds -lt $timeoutSec) {
    try {
        $h = Invoke-RestMethod -Uri 'http://127.0.0.1:7000/healthz' -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop
        $ok = $true
        break
    } catch {
        Start-Sleep -Milliseconds $intervalMs
    }
}

if (-not $ok) {
    Write-Output "HEALTHZ_TIMEOUT after ${timeoutSec}s"
    if ($p -and -not $p.HasExited) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    exit 5
}

Write-Output "HEALTHZ_OK: $h"

# POST message
Write-Output "--- POST message ---"
try {
    $post = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:7000/rooms/general/messages' -ContentType 'application/json' -Body '{"text":"smoke-test"}' -UseBasicParsing -ErrorAction Stop
    Write-Output "POST_OK: $(($post | ConvertTo-Json -Compress))"
} catch {
    Write-Output "POST_FAIL: $($_.Exception.Message)"
}

# GET history
Write-Output "--- GET history ---"
try {
    $hist = Invoke-RestMethod -Uri 'http://127.0.0.1:7000/rooms/general/history?limit=10' -UseBasicParsing -ErrorAction Stop
    Write-Output "HISTORY_OK: $(($hist | ConvertTo-Json -Compress))"
} catch {
    Write-Output "HISTORY_FAIL: $($_.Exception.Message)"
}

# Stop gateway process
Start-Sleep -Seconds 1
try {
    if ($p -and -not $p.HasExited) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        Write-Output "gateway stopped (pid $($p.Id))"
    } else {
        Write-Output "gateway was not running"
    }
} catch {
    Write-Output "failed to stop gateway: $($_.Exception.Message)"
}
