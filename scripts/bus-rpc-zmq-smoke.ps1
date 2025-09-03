Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Ensure logs directory exists
if (!(Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}

Write-Host "Running bus ZMQ RPC smoke test..."
try {
    # Run the example with the with-zmq feature and capture both stdout and stderr to a log file.
    cargo run -p bus --features with-zmq --example zmq_rpc_smoke 2>&1 | Out-File -Encoding UTF8 "logs/bus-rpc-zmq-smoke.txt"
} catch {
    Write-Warning "cargo run failed or exited non-zero. See logs for details."
}

# Read the log and look for the success marker
$log = Get-Content -Raw -Path "logs/bus-rpc-zmq-smoke.txt" -ErrorAction SilentlyContinue

if ($null -ne $log -and $log -match "BUS ZMQ RPC SMOKE: GREEN") {
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
