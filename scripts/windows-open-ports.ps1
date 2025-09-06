param(
  [int]$Port = 5173
)

function Ensure-FirewallRule {
  param(
    [string]$Name,
    [string]$Protocol,
    [int]$Port
  )
  $existing = Get-NetFirewallRule -DisplayName $Name -ErrorAction SilentlyContinue
  if (-not $existing) {
    New-NetFirewallRule -DisplayName $Name -Direction Inbound -Action Allow -Protocol $Protocol -LocalPort $Port | Out-Null
    Write-Host "Created firewall rule: $Name ($Protocol/$Port)"
  } else {
    Write-Host "Firewall rule already exists: $Name"
  }
}

Ensure-FirewallRule -Name "Stack Dev HTTPS (TCP $Port)" -Protocol TCP -Port $Port
Ensure-FirewallRule -Name "Stack Dev HTTP3 (UDP $Port)" -Protocol UDP -Port $Port

Write-Host "Firewall is configured for TCP/UDP $Port."

