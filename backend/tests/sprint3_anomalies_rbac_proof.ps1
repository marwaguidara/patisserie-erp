<#
.SYNOPSIS
  Sprint 3 - Prompt 1 - RBAC proof for GET /ai/anomalies (security only; AI still 501).
  Invoke-RestMethod is used for every HTTP call.
.EXPECTED
  ADMIN/STOCK -> 200 (allowed: anomaly report returned by AI service)
  PRODUCTION/CASHIER/EMPLOYEE -> 403 (refused)
#>
param([string]$Base = 'http://127.0.0.1:5000')

function Invoke-Http {
  param([string]$Uri, [string]$Method, [string]$Bearer = '', [hashtable]$Body)
  try {
    if ($Body) {
      $r = Invoke-RestMethod -Uri $Uri -Method $Method -Body ($Body | ConvertTo-Json -Compress) -ContentType 'application/json' -Headers @{ Authorization = "Bearer $Bearer" } -ErrorAction Stop
    } else {
      $r = Invoke-RestMethod -Uri $Uri -Method $Method -Headers @{ Authorization = "Bearer $Bearer" } -ErrorAction Stop
    }
    return @{ http = 200; raw = ($r | ConvertTo-Json -Compress -Depth 5) }
  } catch {
    $ex = $_.Exception
    if ($ex.Response -and $ex.Response.StatusCode) {
      $http = $ex.Response.StatusCode.value__
      $raw = $_.ErrorDetails.Message
      if ([string]::IsNullOrWhiteSpace($raw)) {
        $s = $ex.Response.GetResponseStream()
        if ($s -and $s.CanSeek -and $s.Position -gt 0) { $s.Seek(0, 'Begin') | Out-Null }
        if ($s) { try { $raw = (New-Object System.IO.StreamReader($s)).ReadToEnd() } catch {} }
      }
      return @{ http = $http; raw = $raw }
    }
    return @{ http = 'ERR'; raw = $ex.Message }
  }
}

$cases = @(
  [pscustomobject]@{ Role = 'ADMIN';      Email = 'admin@bakery.com';      Pass = 'password123'; Want = 200 },
  [pscustomobject]@{ Role = 'STOCK';      Email = 'stock@bakery.com';      Pass = 'password123'; Want = 200 },
  [pscustomobject]@{ Role = 'PRODUCTION'; Email = 'production@bakery.com'; Pass = 'password123'; Want = 403 },
  [pscustomobject]@{ Role = 'CASHIER';    Email = 'cashier@bakery.com';    Pass = 'password123'; Want = 403 },
  [pscustomobject]@{ Role = 'EMPLOYEE';   Email = 'employe@bakery.com';   Pass = 'password123'; Want = 403 }
)

$results = @()
foreach ($c in $cases) {
  $login = Invoke-Http -Uri "$Base/api/auth/login" -Method Post -Body @{ email = $c.Email; password = $c.Pass }
  if ($login.http -ne 200) {
    $results += [pscustomobject]@{ role = $c.Role; loginStatus = $login.http; http = $null; expected = $c.Want; passed = $false; raw = 'login-failed' }
    continue
  }
  $token = ($login.raw | ConvertFrom-Json).token
  $call = Invoke-Http -Uri "$Base/ai/anomalies" -Method Get -Bearer $token
  $passed = ($call.http -eq $c.Want)
  $results += [pscustomobject]@{ role = $c.Role; loginStatus = 200; http = $call.http; expected = $c.Want; passed = $passed; raw = $call.raw }
}

Write-Output '=== Sprint 3 /anomalies RBAC proof (Invoke-RestMethod) ==='
$results | ForEach-Object {
  Write-Output ("role={0}  loginStatus={1}  /ai/anomalies http={2}  expected={3}  passed={4}" -f $_.role, $_.loginStatus, $_.http, $_.expected, $_.passed)
  Write-Output ("  raw JSON body: {0}" -f $_.raw)
}
Write-Output '--- raw JSON summary (array) ---'
$results | ConvertTo-Json -Compress -Depth 5
$ok = ($results | Where-Object passed).Count
Write-Output ("---- {0}/{1} cases matched expectation ----" -f $ok, $results.Count)
