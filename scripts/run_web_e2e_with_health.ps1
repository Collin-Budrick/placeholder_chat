param()

Write-Host "Starting gateway health check and E2E run"

$healthCheckFlag = $env:SKIP_GATEWAY_HEALTH
if ($healthCheckFlag -eq '1' -or $healthCheckFlag -eq 'true') {
  Write-Host "Gateway health check skipped via SKIP_GATEWAY_HEALTH=1"
  $healthOk = $true
} else {
  $healthOk = & "$PSScriptRoot\wait_gateway_health.ps1"
  if (-not $healthOk) {
    Write-Output "Gateway unhealthy, aborting E2E."
    exit 1
  }
}

Write-Host "Gateway healthy. Running Playwright tests..."
Push-Location "apps/web"
bunx playwright test
Pop-Location
