Write-Host "🔒 TEST DE RATE LIMITING" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

Write-Host "`n📝 Test 1: Login rate limit (máx 5 intentos en 15 min)" -ForegroundColor Yellow

for ($i = 1; $i -le 7; $i++) {
    $body = @{
        email = "test@wrong.com"
        password = "wrongpassword"
        machineId = "TEST-001"
    } | ConvertTo-Json
    
    try {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
        Write-Host "  Intento $i : ✅ Respuesta recibida" -ForegroundColor Green
    } catch {
        $statusCode = $_.Exception.Response.StatusCode.value__
        if ($statusCode -eq 429) {
            Write-Host "  Intento $i : 🚫 Rate limit activado (429)" -ForegroundColor Red
        } else {
            Write-Host "  Intento $i : ⚠️ Error $statusCode" -ForegroundColor Yellow
        }
    }
    
    Start-Sleep -Milliseconds 200
}

Write-Host "`n✅ TEST COMPLETADO" -ForegroundColor Green