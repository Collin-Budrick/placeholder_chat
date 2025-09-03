Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (!(Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}

Write-Host "Running bus IPC RPC smoke test..."
try {
    cargo run -p bus --features with-ipc --example ipc_rpc_smoke 2>&1 | Out-File -Encoding UTF8 "logs/bus-rpc-ipc-smoke.txt"
} catch {
    Write-Warning "cargo run failed or exited non-zero. See logs for details."
}

$log = Get-Content -Raw -Path "logs/bus-rpc-ipc-smoke.txt" -ErrorAction SilentlyContinue

if ($null -ne $log -and $log -match "BUS IPC RPC SMOKE: GREEN") {
    Write-Host "GREEN"
    exit 0
} else {
    Write-Host "FAIL"
    Write-Host "=== LOG OUTPUT ==="
    if ($null -ne $log) {
        Write-Host $log
    } else {
        Write-Host "No log produced."
    }
    exit 1
}
