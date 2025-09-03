# Rate limiter smoke test
# - Builds gateway
# - Starts gateway
# - Waits for /healthz
# - Sends N POSTs to /rooms/general/messages and prints HTTP status codes
# - Stops gateway

Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$repoRoot = Resolve-Path -Path (Join-Path $scriptDir '..')
$exeExpected = Join-Path $repoRoot 'target\debug\gateway.exe'

Write-Output "Building gateway..."
$build = & cargo build -p gateway 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Error "cargo build failed (exit $LASTEXITCODE)"
    $build | ForEach-Object { Write-Error $_ }
    exit 2
}

if (-not (Test-Path $exeExpected)) {
    Write-Error "gateway executable not found at $exeExpected after build"
    exit 3
}

Write-Output "Starting gateway..."
$p = Start-Process -FilePath $exeExpected -PassThru -WindowStyle Hidden -ErrorAction SilentlyContinue
if (-not $p) {
    Write-Error "Failed to start gateway"
    exit 4
}

# wait for health
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
    Write-Output "HEALTHZ_TIMEOUT"
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
    exit 5
}
Write-Output "HEALTHZ_OK: $h"

# Send repeated POSTs to hit rate limiter (use Invoke-WebRequest to avoid quoting issues)
$attempts = 8
Write-Output "Sending $attempts POSTs to /rooms/general/messages (anon user)"
for ($i = 1; $i -le $attempts; $i++) {
    $bodyObj = @{ text = "rate-test-$i" }
    $jsonBody = $bodyObj | ConvertTo-Json -Compress

    try {
        $resp = Invoke-WebRequest -Method Post -Uri 'http://127.0.0.1:7000/rooms/general/messages' -ContentType 'application/json' -Body $jsonBody -UseBasicParsing -ErrorAction Stop
        $status = $resp.StatusCode
        Write-Output ("[{0}] HTTP {1}" -f $i, $status)
    } catch {
        # Try to extract HTTP status code from the exception response if present
        $statusVal = $_.Exception.Response
        if ($statusVal -ne $null) {
            try {
                $code = $statusVal.StatusCode.value__
                Write-Output ("[{0}] HTTP {1}" -f $i, $code)
            } catch {
                Write-Output ("[{0}] ERROR {1}" -f $i, $_.Exception.Message)
            }
        } else {
            Write-Output ("[{0}] ERROR {1}" -f $i, $_.Exception.Message)
        }
    }

    Start-Sleep -Milliseconds 200
}

# Stop gateway
Start-Sleep -Seconds 1
if ($p -and -not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Output "gateway stopped (pid $($p.Id))"
} else {
    Write-Output "gateway was not running"
}
