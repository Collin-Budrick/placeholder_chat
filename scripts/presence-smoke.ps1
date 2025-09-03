# Presence smoke test
# Runs the full WS smoke (which starts gateway and connects/disconnects clients)
# then inspects the gateway log for presence/online and presence/offline publications.

$ErrorActionPreference = 'Stop'

Write-Host "Running WS smoke (which starts gateway and produces logs)..."
powershell -ExecutionPolicy Bypass -File ./scripts/ws-smoke.ps1

$log = "logs\gateway-smoke.txt"
if (-not (Test-Path $log)) {
    Write-Error "Log file not found: $log"
    exit 1
}

# Check for presence online/offline entries.
# Accept both the PRESENCE_DIAG stdout markers and the presence/diag JSON publishes.
$online = Select-String -Path $log -Pattern @('PRESENCE_DIAG: online','"event":"online"') -SimpleMatch
$offline = Select-String -Path $log -Pattern @('PRESENCE_DIAG: offline','"event":"offline"') -SimpleMatch

if ($online -and $offline) {
    Write-Host "Presence smoke passed: both online and offline events were published."
    exit 0
} else {
    Write-Host "Presence smoke failed. Log tail:"
    Get-Content $log -Tail 200 | ForEach-Object { Write-Host $_ }
    if (-not $online) { Write-Host "Missing presence/online event" }
    if (-not $offline) { Write-Host "Missing presence/offline event" }
    exit 1
}
