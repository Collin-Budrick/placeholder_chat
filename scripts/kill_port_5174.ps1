$port = 5174
$tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($tcp) {
  $pids = $tcp.OwningProcess | Select-Object -Unique
  foreach ($killPid in $pids) {
    try {
      Stop-Process -Id $killPid -Force -ErrorAction Stop
      Write-Host "Stopped process $killPid on port $port"
    } catch {
      if ($_.Exception -and $_.Exception.Message) {
Write-Host "Failed to stop process $killPid on port $port: $($_.Exception.Message)"
      } else {
Write-Host ("Failed to stop process {0} on port {1}: Unknown error" -f $killPid, $port)
      }
    }
  }
} else {
  Write-Host "No process listening on port $port"
}
