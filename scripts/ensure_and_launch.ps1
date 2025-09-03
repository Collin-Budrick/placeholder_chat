param([int]$port = 5174)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path -Path $scriptDir -ChildPath "..")
Set-Location $root
$Env:PORT = $port
$serverPath = "$root/apps/web/server/entry.express.js"

$tcp = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($tcp) {
  $pids = $tcp.OwningProcess | Select-Object -Unique
  foreach ($pid in $pids) {
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
  }
  Write-Host "Terminated processes listening on port $port"
}

Write-Host "Launching server on port $port"
node "$serverPath"
