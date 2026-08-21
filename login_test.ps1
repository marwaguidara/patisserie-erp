$body = @{ email = "cashier@bakery.com"; password = "password123" } | ConvertTo-Json
try {
    $resp = Invoke-RestMethod -Uri "http://localhost:5000/api/auth/login" -Method Post -Body $body -ContentType "application/json"
    Write-Host "JWT:" $resp.token
    Write-Host "Role:" $resp.user.role
    Write-Host "Name:" $resp.user.name
} catch {
    Write-Host "ERROR:" $_.Exception.Message
}
