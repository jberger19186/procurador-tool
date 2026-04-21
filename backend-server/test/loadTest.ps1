# Test de carga para ver el impacto real del caché

Write-Host "🔥 TEST DE CARGA - SISTEMA DE CACHÉ" -ForegroundColor Cyan
Write-Host ("=" * 60) -ForegroundColor Cyan

# Login
$loginBody = @{
    email = "test@example.com"
    password = "Test123456!"
    machineId = "TEST-MACHINE-001"
} | ConvertTo-Json

$loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
$token = $loginResponse.token

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

# Test con múltiples scripts
$scripts = @(
    @{ name = "testM1.js"; params = @{ test = "load-test" } },
    @{ name = "testM2.js"; params = @{ iterations = 5 } },
    @{ name = "consultarscwpjn.js"; params = @{ numeroExpediente = "EXP-001/2026" } },
    @{ name = "listarSCWPJN.js"; params = @{ limite = 5 } }
)

Write-Host "`n📊 Ejecutando 50 requests (alternando entre 4 scripts)..." -ForegroundColor Yellow

$times = @()
$decryptTimes = @()

for ($i = 1; $i -le 50; $i++) {
    $scriptIndex = $i % $scripts.Count
    $currentScript = $scripts[$scriptIndex]
    
    $body = @{
        scriptName = $currentScript.name
        params = $currentScript.params
    } | ConvertTo-Json
    
    $measure = Measure-Command {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/scripts/execute" -Method POST -Headers $headers -Body $body
    }
    
    $times += $measure.TotalMilliseconds
    
    # Extraer tiempo de decrypt del response
    if ($response.metrics.decryptTime -match '(\d+)ms') {
        $decryptTimes += [int]$matches[1]
    }
    
    # Progreso
    if ($i % 10 -eq 0) {
        Write-Host "  Completado: $i/50" -ForegroundColor Cyan
    }
}

Write-Host "`n📈 RESULTADOS:" -ForegroundColor Green
Write-Host ("-" * 60) -ForegroundColor Gray

# Estadísticas de tiempo total
$avgTotal = [math]::Round(($times | Measure-Object -Average).Average, 2)
$minTotal = [math]::Round(($times | Measure-Object -Minimum).Minimum, 2)
$maxTotal = [math]::Round(($times | Measure-Object -Maximum).Maximum, 2)

Write-Host "Tiempo Total de Request:" -ForegroundColor Yellow
Write-Host "  Promedio: $avgTotal ms" -ForegroundColor Cyan
Write-Host "  Mínimo: $minTotal ms" -ForegroundColor Cyan
Write-Host "  Máximo: $maxTotal ms" -ForegroundColor Cyan

# Estadísticas de decrypt time
if ($decryptTimes.Count -gt 0) {
    $avgDecrypt = [math]::Round(($decryptTimes | Measure-Object -Average).Average, 2)
    $minDecrypt = ($decryptTimes | Measure-Object -Minimum).Minimum
    $maxDecrypt = ($decryptTimes | Measure-Object -Maximum).Maximum
    
    Write-Host "`nTiempo de Desencriptación (Decrypt):" -ForegroundColor Yellow
    Write-Host "  Promedio: $avgDecrypt ms" -ForegroundColor Cyan
    Write-Host "  Mínimo: $minDecrypt ms" -ForegroundColor Green
    Write-Host "  Máximo: $maxDecrypt ms" -ForegroundColor Cyan
}

# Estadísticas del caché
Write-Host "`n📊 Estadísticas del Caché:" -ForegroundColor Yellow
$health = Invoke-RestMethod -Uri "http://localhost:3000/health"
$cache = $health.cache

Write-Host "  Scripts en caché: $($cache.size)/$($cache.maxSize)" -ForegroundColor Cyan
Write-Host "  Memoria usada: $($cache.totalMB) MB" -ForegroundColor Cyan
Write-Host "  Total Hits: $($cache.hits)" -ForegroundColor Green
Write-Host "  Total Misses: $($cache.misses)" -ForegroundColor Yellow
Write-Host "  Hit Rate: $($cache.hitRate)" -ForegroundColor Green

Write-Host "`n✅ TEST COMPLETADO" -ForegroundColor Green
Write-Host ("=" * 60) -ForegroundColor Cyan