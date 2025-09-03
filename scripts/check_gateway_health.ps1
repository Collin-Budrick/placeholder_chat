param()

# Simple gateway health check utility
$gatewayPort = 7000

$conn = Get-NetTCPConnection -LocalPort $gatewayPort -ErrorAction SilentlyContinue
if ($conn) {
  foreach ($item in $conn) {
    if ($item.OwningProcess) {
      $gatewayPid = $item.OwningProcess
      Write-Host "LISTEN_PID:$gatewayPid"
    }
  }
} else {
  Write-Host "NO_LISTEN"
}

# Check gateway health endpoint
try {
  $resp = Invoke-WebRequest -Uri "http://localhost:7000/healthz" -UseBasicParsing
  if ($resp.StatusCode -eq 200) {
    Write-Host "HEALTH_OK"
  } else {
    Write-Host "HEALTH_FAIL"
  }
} catch {
  Write-Host "ERR"
}
