$end = (Get-Date).AddSeconds(60)
while((Get-Date) -lt $end) {
  try {
    $r = Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 http://localhost:5173
    $code = $r.StatusCode
    if ($code -ge 200 -and $code -lt 400) { Write-Output 'UP'; exit 0 }
  } catch {}
  Start-Sleep -Milliseconds 500
}
Write-Output 'DOWN'
