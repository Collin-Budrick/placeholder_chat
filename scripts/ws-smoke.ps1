# WS smoke test for gateway (PowerShell)
# Starts the gateway (cargo run -p gateway) in the background, directs logs to logs/gateway-smoke.txt,
# waits for /healthz, opens two websocket clients, exchanges messages both ways, then stops the gateway.
# Run from repository root.

$ErrorActionPreference = 'Stop'

# Ensure logs directory exists
if (-not (Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}

# Kill any existing gateway processes to avoid redb locking or port conflicts
try {
    $existing = Get-Process -Name gateway -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Stopping existing gateway process(es)..."
        $existing | Stop-Process -Force -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 200
    }
} catch {
    Write-Host "No existing gateway processes found or failed to stop: $_"
}

$logfile = "logs\gateway-smoke.txt"
if (Test-Path $logfile) { Remove-Item $logfile -ErrorAction SilentlyContinue }

# Start gateway in background with debug logging and redirect stdout/stderr to logfile.
# Use cmd.exe /C to set env and run cargo. -NoNewWindow writes into this shell's console unless cmd is detached;
# Start-Process without -NoNewWindow will detach; we capture logs in a file so we can inspect them.
$cmd = 'set RUST_LOG=debug && cargo run -p gateway > "' + $logfile + '" 2>&1'
$proc = Start-Process -FilePath cmd.exe -ArgumentList '/C', $cmd -WindowStyle Hidden -PassThru

Write-Host "Started gateway (PID $($proc.Id)), logs -> $logfile"

# Wait for server to accept connections on /healthz
$max = 30
$ready = $false
for ($i = 0; $i -lt $max; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $r = Invoke-WebRequest -Uri 'http://127.0.0.1:7000/healthz' -UseBasicParsing -TimeoutSec 1 -ErrorAction SilentlyContinue
        if ($r -and $r.StatusCode -eq 200) { $ready = $true; break }
    } catch {}
}
if (-not $ready) {
    Write-Error "Gateway did not respond on http://127.0.0.1:7000/healthz after $($max * 0.5) seconds"
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "`n=== gateway stdout/stderr (tail 200 lines) ==="
    if (Test-Path $logfile) {
        Get-Content $logfile -Tail 200 | ForEach-Object { Write-Host $_ }
    } else {
        Write-Host "(no log file found)"
    }
    exit 1
}

Write-Host "Gateway is up - running WS smoke test"

# Prepare URIs and clients
$uri = 'ws://127.0.0.1:7000/ws?room=smoke-test'
$client1 = [System.Net.WebSockets.ClientWebSocket]::new()
$client2 = [System.Net.WebSockets.ClientWebSocket]::new()

# Connect both clients
try {
    $client1.ConnectAsync([Uri]$uri, [Threading.CancellationToken]::None).Wait(5000)
    $client2.ConnectAsync([Uri]$uri, [Threading.CancellationToken]::None).Wait(5000)
} catch {
    Write-Host "WebSocket connect failed: $_"
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    Write-Host "`n=== gateway stdout/stderr (tail 200 lines) ==="
    if (Test-Path $logfile) { Get-Content $logfile -Tail 200 | ForEach-Object { Write-Host $_ } }
    exit 1
}

# Helper to send text
function Send-Text($client, $text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $seg = [System.ArraySegment[byte]]::new($bytes)
    $client.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait(2000)
}

# Helper to receive one text message (with timeout fallback)
function Receive-Text($client, $timeoutSec) {
    $recv = New-Object 'byte[]' 8192
    $seg = [System.ArraySegment[byte]]::new($recv)
    $task = $client.ReceiveAsync($seg, [Threading.CancellationToken]::None)
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    while (-not $task.IsCompleted -and $sw.Elapsed.TotalSeconds -lt $timeoutSec) {
        Start-Sleep -Milliseconds 50
    }
    if (-not $task.IsCompleted) {
        throw "Receive timed out"
    }
    $res = $task.Result
    return [System.Text.Encoding]::UTF8.GetString($recv, 0, $res.Count)
}

# Exchange messages: client1 -> client2
try {
    Send-Text $client1 "smoke-1-to-2"
    $msg = Receive-Text $client2 5
    Write-Host "client2 received: $msg"
} catch {
    Write-Host "Error during client1->client2: $_"
    Write-Host "`n=== gateway logs (tail 200) ==="
    if (Test-Path $logfile) { Get-Content $logfile -Tail 200 | ForEach-Object { Write-Host $_ } }
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

# client2 -> client1
try {
    Send-Text $client2 "smoke-2-to-1"
    $msg2 = Receive-Text $client1 5
    Write-Host "client1 received: $msg2"
} catch {
    Write-Host "Error during client2->client1: $_"
    Write-Host "`n=== gateway logs (tail 200) ==="
    if (Test-Path $logfile) { Get-Content $logfile -Tail 200 | ForEach-Object { Write-Host $_ } }
    if ($proc) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue }
    exit 1
}

# Close websockets gracefully
try {
    $client1.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).Wait(2000)
} catch {
    Write-Host "client1 close error: $_"
}
try {
    $client2.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).Wait(2000)
} catch {
    Write-Host "client2 close error: $_"
}

Write-Host "WS smoke test completed successfully"

# Stop gateway
if ($proc) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
}

# Show final logs tail
Write-Host "`n=== gateway logs (tail 200) ==="
if (Test-Path $logfile) { Get-Content $logfile -Tail 200 | ForEach-Object { Write-Host $_ } }
