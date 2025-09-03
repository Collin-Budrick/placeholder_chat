$block = @"
# START-WEB-DEV-PROFILE-SETUP
# Auto-load helper to start the web dev script from anywhere in the repo
function Find-ProjectRoot {
param([string]$MarkerRelativePath = 'scripts\start-web-dev.ps1')
  $dir = Get-Location
  while ($dir -and $dir.Path -ne [System.IO.Directory]::GetDirectoryRoot($dir)) {
    $candidate = Join-Path $dir $MarkerRelativePath
    if (Test-Path $candidate) {
      return $dir
    }
    $dir = $dir.Parent
  }
  return $null
}
function start-web-dev {
  [CmdletBinding()]
  param(
    [Parameter(ValueFromRemainingArguments=$true)]
    [object[]]$ArgsFromUser
  )
  $root = Find-ProjectRoot
  if (-not $root) {
    Write-Error "Could not locate project root containing scripts\start-web-dev.ps1 starting from '$((Get-Location).Path)'."
    return
  }
  $script = Join-Path $root 'scripts\start-web-dev.ps1'
  if (-not (Test-Path $script)) {
    Write-Error "Script not found at expected path: $script"
    return
  }
  & $script @ArgsFromUser
}
# End
"@
$profilePath = if (Test-Path $PROFILE) { $PROFILE } else { Join-Path $env:USERPROFILE "Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1" }
$marker = "START-WEB-DEV-PROFILE-SETUP"

if (-not (Test-Path $profilePath)) {
  New-Item -ItemType File -Path $profilePath -Force | Out-Null
}

if (-not (Select-String -Path $profilePath -Pattern $marker -Quiet)) {
  Add-Content -Path $profilePath -Value $block
}
