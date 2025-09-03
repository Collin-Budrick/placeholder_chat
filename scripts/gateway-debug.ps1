# Gateway debug runner
# - Starts gateway and redirects stdout/stderr to logs/gateway-debug.log
# - Waits for /healthz (timeout)
# - Issues a verbose POST and saves response body
# - Prints gateway log tail
# - Stops gateway

Set-StrictMode -Version Latest

$repoRoot = Resolve-Path -Path (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Definition) '..')
$exe = Join-Path $repoRoot 'target\debug\gateway.exe'
$log = Join-Path $repoRoot 'logs\gateway-debug.log'
$respBody = Join-Path $repoRoot 'logs\last_post_response_body.txt'

if (-not (Test-Path $exe)) {
    Write-Error "gateway exe not found at $exe"
    exit 2
}

Remove-Item -ErrorAction SilentlyContinue $log, $respBody

Write-Output "Starting gateway: $exe"
$p = Start-Process -FilePath $exe -RedirectStandardOutput $log -RedirectStandardError $log -PassThru -WindowStyle Hidden -ErrorAction Stop

# wait for health
$timeoutSec = 15
$intervalMs = 200
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
    if ($p -and -not $p.HasExited) { Stop-Process -Id $p.Id -Force }
    exit 3
}

Write-Output "HEALTHZ_OK: $h"

Write-Output '--- CURL POST (verbose) ---'
# verbose output to console
& curl.exe -v -X POST -H 'Content-Type: application/json' -d '{"text":"rate-test-body"}' http://127.0.0.1:7000/rooms/general/messages 2>&1

Write-Output '--- CURL POST (save body) ---'
# save body to file and print status code
$code = & curl.exe -s -w '%{http_code}' -o $respBody -X POST -H 'Content-Type: application/json' -d '{"text":"rate-test-body"}' http://127.0.0.1:7000/rooms/general/messages
Write-Output "HTTP_CODE: $code"
if (Test-Path $respBody) {
    Write-Output '--- RESPONSE BODY ---'
    Get-Content $respBody | ForEach-Object { Write-Output $_ }
} else {
    Write-Output 'no response body file'
}

Write-Output '--- GATEWAY LOG (tail 200) ---'
if (Test-Path $log) {
    Get-Content $log -Tail 200 | ForEach-Object { Write-Output $_ }
} else {
    Write-Output 'log missing'
}

# stop gateway
Start-Sleep -Seconds 1
if ($p -and -not $p.HasExited) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    Write-Output "gateway stopped (pid $($p.Id))"
} else {
    Write-Output "gateway not running"
}
