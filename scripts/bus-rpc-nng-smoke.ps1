Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Ensure logs directory exists
if (!(Test-Path -Path "logs")) {
    New-Item -ItemType Directory -Path "logs" | Out-Null
}

Write-Host "Running bus NNG RPC smoke test..."
    try {
    # Run the example with the with-nng feature and capture all output to a log file.
    # Redirect both stdout and stderr into the log file (compatible with Windows PowerShell).
    cargo run -p bus --features with-nng --example nng_rpc_smoke 2>&1 | Out-File -Encoding UTF8 "logs/bus-rpc-nng-smoke.txt"
} catch {
    Write-Warning "cargo run failed or exited non-zero. See logs for details."
}

# Read the log and look for the success marker
$log = Get-Content -Raw -Path "logs/bus-rpc-nng-smoke.txt" -ErrorAction SilentlyContinue

if ($null -ne $log -and $log -match "BUS NNG RPC SMOKE: GREEN") {
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
