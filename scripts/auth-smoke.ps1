param(
  [string]$BaseUri = "http://localhost:7000"
)

Write-Output "AUTH SMOKE TEST (Signup -> Login -> Logout) starting against $BaseUri"

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession

function PostJson([string]$path, [hashtable]$payload) {
  $body = $payload | ConvertTo-Json -Depth 5
  Invoke-WebRequest -Uri ("${BaseUri}${path}") -Method POST -ContentType "application/json" -Body $body -WebSession $session -UseBasicParsing
}

# Gateway auto-start management
$gatewayStartedByScript = $false
$gatewayProc = $null
try {
  $conn = Test-NetConnection -ComputerName "localhost" -Port 7000 -WarningAction SilentlyContinue
  if (-not $conn.TcpTestSucceeded) {
    Write-Host "Gateway not listening on port 7000. Starting gateway..."
    Push-Location "apps/gateway"
    # Start the gateway server in background
    $gatewayProc = Start-Process -FilePath "cargo" -ArgumentList "run -q" -WorkingDirectory (Get-Location).Path -PassThru
    $gatewayStartedByScript = $true
    Start-Sleep -Seconds 8
    Pop-Location
    # Wait for gateway to start listening on port 7000
    $maxWait = 60
    $waited = 0
    do {
      Start-Sleep -Seconds 1
      $conn = Test-NetConnection -ComputerName "localhost" -Port 7000 -WarningAction SilentlyContinue
      $waited++
    } while (-not $conn.TcpTestSucceeded -and $waited -lt $maxWait)
    if ($conn.TcpTestSucceeded) {
      Write-Host "Gateway is listening on port 7000 after startup."
    } else {
      Write-Host "Gateway failed to listen on port 7000 within timeout."
    }
  } else {
    Write-Host "Gateway already listening on port 7000"
  }
} catch {
  Write-Host "Gateway START ERROR: $($_.Exception.Message)"
}

# Unique test credentials
$timestamp = (Get-Date).ToString("yyyyMMddHHmmssfff")
$email = "smoke_${timestamp}@example.com"
$password = "Password123!"

$pass = @(
  @{ "step" = "signup"; "url" = "$BaseUri/api/auth/signup"; "body" = @{ email = $email; password = $password } }
  @{ "step" = "login";  "url" = "$BaseUri/api/auth/login";  "body" = @{ email = $email; password = $password } }
  @{ "step" = "logout"; "url" = "$BaseUri/api/auth/logout"; "body" = @{} }
)

# 1) Signup
try {
  $signupRes = PostJson "/api/auth/signup" @{ email = $email; password = $password }
  if (200,201 -contains $signupRes.StatusCode) {
    $cookies = $session.Cookies.GetCookies("$BaseUri")
    $cookieCount = ($cookies | Where-Object { $_.Name -eq "session" }).Count
    if ($cookieCount -gt 0) {
      Write-Host "Signup PASS: cookie 'session' set"
    } else {
      Write-Host "Signup FAIL: no session cookie set"
    }
  } else {
    Write-Host "Signup FAIL: status code $($signupRes.StatusCode)"
  }
} catch {
  Write-Host "Signup EXCEPTION: $($_.Exception.Message)"
  throw
}

# 2) Login
try {
  $loginRes = PostJson "/api/auth/login" @{ email = $email; password = $password }
  if ($loginRes.StatusCode -eq 200) {
    $cookies = $session.Cookies.GetCookies("$BaseUri")
    $cookieCount = ($cookies | Where-Object { $_.Name -eq "session" }).Count
    if ($cookieCount -gt 0) {
      Write-Host "Login PASS: session cookie present"
    } else {
      Write-Host "Login FAIL: session cookie missing after login"
    }
  } else {
    Write-Host "Login FAIL: status code $($loginRes.StatusCode)"
  }
} catch {
  Write-Host "Login EXCEPTION: $($_.Exception.Message)"
  throw
}

# 3) Logout
try {
  $logout = Invoke-WebRequest -Uri ("$BaseUri/api/auth/logout") -Method POST -WebSession $session -UseBasicParsing
  if ($logout.StatusCode -eq 204 -or $logout.StatusCode -eq 200) {
    $cookies = $session.Cookies.GetCookies("$BaseUri")
    $cookieCount = ($cookies | Where-Object { $_.Name -eq "session" }).Count
    if ($cookieCount -eq 0) {
      Write-Host "Logout PASS: session cookie cleared"
    } else {
      Write-Host "Logout FAIL: session cookie still present"
    }
  } else {
    Write-Host "Logout FAIL: status code not 200/204"
  }
} catch {
  Write-Host "Logout EXCEPTION: $($_.Exception.Message)"
  throw
}

# Cleanup gateway if started by script
if ($gatewayStartedByScript -and $gatewayProc -and -not $gatewayProc.HasExited) {
  try {
    Stop-Process -Id $gatewayProc.Id -Force
    Write-Host "Gateway process stopped after smoke test"
  } catch {
    Write-Host "Gateway shutdown failed: $($_.Exception.Message)"
  }
}

Write-Output "AUTH SMOKE TEST completed for $email"
