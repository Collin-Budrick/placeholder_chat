param(
)

function Wait-GatewayHealth {
  param(
    [int]$TimeoutSec = 30,
    [int]$IntervalSec = 1
  )
  $port = 7000
  $start = Get-Date
  $deadline = $start.AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    try {
      $resp = Invoke-WebRequest -Uri "http://localhost:$port/healthz" -UseBasicParsing
      if ($resp.StatusCode -eq 200) {
        Write-Host "HEALTH_OK"
        return $true
      }
    } catch {
      # ignore
    }
    Start-Sleep -Seconds $IntervalSec
  }
  Write-Host "HEALTH_FAIL"
  return $false
}
Wait-GatewayHealth
