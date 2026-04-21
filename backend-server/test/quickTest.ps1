# Test rápido del sistema de caché

Write-Host "🚀 INICIANDO TEST DEL SISTEMA DE CACHÉ" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

# 1. Login
Write-Host "`n🔐 1. Login..." -ForegroundColor Yellow
$loginBody = @{
    email = "test@example.com"
    password = "Test123456!"
    machineId = "TEST-MACHINE-001"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
Write-Host "✅ Login exitoso" -ForegroundColor Green

$token = $loginResponse.token
$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# 2. Test de caché con testM1
Write-Host "`n🧪 2. Test con testM1.js" -ForegroundColor Yellow
Write-Host ("-" * 60) -ForegroundColor Gray

$scriptBody = @{
    scriptName = "testM1.js"
    params = @{ test = "cache-test" }
} | ConvertTo-Json

Write-Host "  🔸 Ejecución 1 (CACHE MISS)..." -ForegroundColor Blue
$time1 = Measure-Command {
    $r1 = Invoke-RestMethod -Uri "http://localhost:3000/scripts/execute" -Method POST -Headers $headers -Body $scriptBody
}
Write-Host "     Tiempo total: $([math]::Round($time1.TotalMilliseconds, 2)) ms" -ForegroundColor Cyan
Write-Host "     Decrypt time: $($r1.metrics.decryptTime)" -ForegroundColor Cyan

Start-Sleep -Milliseconds 500

Write-Host "  🔸 Ejecución 2 (CACHE HIT)..." -ForegroundColor Blue
$time2 = Measure-Command {
    $r2 = Invoke-RestMethod -Uri "http://localhost:3000/scripts/execute" -Method POST -Headers $headers -Body $scriptBody
}
Write-Host "     Tiempo total: $([math]::Round($time2.TotalMilliseconds, 2)) ms" -ForegroundColor Cyan
Write-Host "     Decrypt time: $($r2.metrics.decryptTime)" -ForegroundColor Cyan

$improvement = [math]::Round((($time1.TotalMilliseconds - $time2.TotalMilliseconds) / $time1.TotalMilliseconds * 100), 2)
Write-Host "`n  📊 Mejora: $improvement%" -ForegroundColor Green

# 3. Test con más scripts
Write-Host "`n🧪 3. Test con procesarNovedadesCompleto.js" -ForegroundColor Yellow
Write-Host ("-" * 60) -ForegroundColor Gray

$scriptBody2 = @{
    scriptName = "procesarNovedadesCompleto.js"
    params = @{ expediente = "EXP-TEST/2026" }
} | ConvertTo-Json

Write-Host "  🔸 Ejecución 1..." -ForegroundColor Blue
$time3 = Measure-Command {
    $r3 = Invoke-RestMethod -Uri "http://localhost:3000/scripts/execute" -Method POST -Headers $headers -Body $scriptBody2
}
Write-Host "     Tiempo: $([math]::Round($time3.TotalMilliseconds, 2)) ms" -ForegroundColor Cyan

Write-Host "  🔸 Ejecución 2..." -ForegroundColor Blue
$time4 = Measure-Command {
    $r4 = Invoke-RestMethod -Uri "http://localhost:3000/scripts/execute" -Method POST -Headers $headers -Body $scriptBody2
}
Write-Host "     Tiempo: $([math]::Round($time4.TotalMilliseconds, 2)) ms" -ForegroundColor Cyan

# 4. Estadísticas finales
Write-Host "`n📊 4. Estadísticas del caché" -ForegroundColor Yellow
Write-Host ("-" * 60) -ForegroundColor Gray

$health = Invoke-RestMethod -Uri "http://localhost:3000/health"
$cache = $health.cache

Write-Host "  Scripts en caché: $($cache.size)/$($cache.maxSize)" -ForegroundColor Cyan
Write-Host "  Memoria usada: $($cache.totalMB) MB" -ForegroundColor Cyan
Write-Host "  Cache Hits: $($cache.hits)" -ForegroundColor Green
Write-Host "  Cache Misses: $($cache.misses)" -ForegroundColor Yellow
Write-Host "  Hit Rate: $($cache.hitRate)" -ForegroundColor Green

Write-Host "`n✅ TEST COMPLETADO" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Cyan