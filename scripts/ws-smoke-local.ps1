# WS smoke test (local) - assumes gateway already running on 127.0.0.1:7000
# Connects two websocket clients, exchanges messages both ways.

$ErrorActionPreference = 'Stop'

# Wait for server to accept connections on port 7000
$max = 30
$ready = $false
for ($i = 0; $i -lt $max; $i++) {
    Start-Sleep -Milliseconds 500
    try {
        $c = Test-NetConnection -ComputerName 127.0.0.1 -Port 7000 -WarningAction SilentlyContinue
        if ($c -and $c.TcpTestSucceeded) { $ready = $true; break }
    } catch {}
}
if (-not $ready) {
    Write-Error "Gateway did not start on 127.0.0.1:7000"
    exit 1
}

Write-Host "Gateway is up - running WS smoke test (local)"

# Prepare URIs and clients
$uri = 'ws://127.0.0.1:7000/ws?room=smoke-test'
$client1 = [System.Net.WebSockets.ClientWebSocket]::new()
$client2 = [System.Net.WebSockets.ClientWebSocket]::new()

# Connect both clients
$client1.ConnectAsync([Uri]$uri, [Threading.CancellationToken]::None).Wait()
$client2.ConnectAsync([Uri]$uri, [Threading.CancellationToken]::None).Wait()

# Helper to send text
function Send-Text($client, $text) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($text)
    $seg = [System.ArraySegment[byte]]::new($bytes)
    $client.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).Wait()
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
Send-Text $client1 "smoke-1-to-2"
$msg = Receive-Text $client2 5
Write-Host "client2 received: $msg"

# client2 -> client1
Send-Text $client2 "smoke-2-to-1"
$msg2 = Receive-Text $client1 5
Write-Host "client1 received: $msg2"

# Close websockets gracefully
try {
    $client1.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).Wait()
} catch {
    Write-Host "client1 close error: $_"
}
try {
    $client2.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).Wait()
} catch {
    Write-Host "client2 close error: $_"
}

Write-Host "WS smoke test completed successfully (local)"
