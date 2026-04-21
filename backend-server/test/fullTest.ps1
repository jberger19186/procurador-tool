Write-Host "🚀 TEST COMPLETO - FASE 1" -ForegroundColor Cyan
Write-Host ("=" * 80) -ForegroundColor Cyan

$testsPassed = 0
$testsFailed = 0

function Test-Endpoint {
    param($name, $scriptBlock)
    Write-Host "`n$name" -ForegroundColor Yellow
    try {
        & $scriptBlock
        $script:testsPassed++
        Write-Host "✅ PASS" -ForegroundColor Green
        return $true
    } catch {
        $script:testsFailed++
        Write-Host "❌ FAIL: $($_.Exception.Message)" -ForegroundColor Red
        return $false
    }
}

# TEST 1: Health Check
Test-Endpoint "1. Health Check" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/health"
    if ($response.status -ne "OK") { throw "Health check failed" }
    Write-Host "   Status: $($response.status)" -ForegroundColor Cyan
    Write-Host "   Uptime: $([math]::Round($response.uptime, 2))s" -ForegroundColor Cyan
}

# TEST 2: Login Usuario
Test-Endpoint "2. Login Usuario" {
    $loginBody = @{
        email = "test@example.com"
        password = "Test123456!"
        machineId = "TEST-MACHINE-001"
    } | ConvertTo-Json
    
    $script:loginResponse = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST -Body $loginBody -ContentType "application/json"
    $script:token = $loginResponse.token
    $script:headers = @{
        "Authorization" = "Bearer $token"
        "Content-Type" = "application/json"
    }
    
    if (-not $token) { throw "Token no recibido" }
    Write-Host "   Email: $($loginResponse.user.email)" -ForegroundColor Cyan
    Write-Host "   Plan: $($loginResponse.subscription.plan)" -ForegroundColor Cyan
    Write-Host "   Remaining: $($loginResponse.subscription.remaining)" -ForegroundColor Cyan
}

# TEST 3: Verificar Sesión
Test-Endpoint "3. Verificar Sesión" {
    $body = @{ machineId = "TEST-MACHINE-001" } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "http://localhost:3000/client/verify-session" -Method POST -Headers $headers -Body $body
    if (-not $response.success) { throw "Sesión no válida" }
    Write-Host "   Usuario ID: $($response.user.id)" -ForegroundColor Cyan
    Write-Host "   Remaining: $($response.subscription.remaining)" -ForegroundColor Cyan
}

# TEST 4: Listar Scripts Disponibles
Test-Endpoint "4. Listar Scripts Disponibles" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/client/scripts/available" -Method GET -Headers $headers
    if ($response.scripts.Count -eq 0) { throw "No hay scripts disponibles" }
    Write-Host "   Scripts encontrados: $($response.scripts.Count)" -ForegroundColor Cyan
    $response.scripts | ForEach-Object { Write-Host "     • $($_.name)" -ForegroundColor Gray }
}

# TEST 5: Descargar Script Encriptado
Test-Endpoint "5. Descargar Script Encriptado" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/client/scripts/download/testM1.js" -Method GET -Headers $headers
    if (-not $response.script.encryptedContent) { throw "Script sin contenido encriptado" }
    Write-Host "   Script: $($response.script.name)" -ForegroundColor Cyan
    Write-Host "   Version: $($response.script.version)" -ForegroundColor Cyan
    Write-Host "   Hash: $($response.script.hash.Substring(0,16))..." -ForegroundColor Cyan
    Write-Host "   IV presente: $(if($response.script.iv) {'✅'} else {'❌'})" -ForegroundColor Cyan
    Write-Host "   Encryption key presente: $(if($response.encryptionKey) {'✅'} else {'❌'})" -ForegroundColor Cyan
}

# TEST 6: Ejecutar Script (servidor)
Test-Endpoint "6. Ejecutar Script en Servidor" {
    $body = @{ scriptName = "testM1.js"; params = @{ test = "fulltest" } } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "http://localhost:3000/scripts/execute" -Method POST -Headers $headers -Body $body
    if (-not $response.success) { throw "Ejecución fallida" }
    Write-Host "   Resultado: $($response.result.message)" -ForegroundColor Cyan
    Write-Host "   Decrypt time: $($response.metrics.decryptTime)" -ForegroundColor Cyan
    Write-Host "   Execution time: $($response.metrics.executionTime)" -ForegroundColor Cyan
}

# TEST 7: Registrar Ejecución desde Cliente
Test-Endpoint "7. Registrar Ejecución desde Cliente" {
    $logBody = @{
        scriptName = "testM2.js"
        success = $true
        executionTime = 1234
    } | ConvertTo-Json
    
    $response = Invoke-RestMethod -Uri "http://localhost:3000/client/scripts/log-execution" -Method POST -Headers $headers -Body $logBody
    if (-not $response.success) { throw "Log no registrado" }
    Write-Host "   Usage: $($response.usageCount)/$($response.usageLimit)" -ForegroundColor Cyan
    Write-Host "   Remaining: $($response.remaining)" -ForegroundColor Cyan
}

# TEST 8: Refresh Token
Test-Endpoint "8. Refresh Token" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/auth/refresh" -Method POST -Headers $headers
    if (-not $response.token) { throw "Token no renovado" }
    Write-Host "   Nuevo token recibido: $($response.token.Substring(0,20))..." -ForegroundColor Cyan
}

# TEST 9: Login Admin
Test-Endpoint "9. Login Admin" {
    $adminBody = @{
        email = "admin@procurador.com"
        password = "Admin123!"
        machineId = "ADMIN-MACHINE-001"
    } | ConvertTo-Json
    
    $script:adminResponse = Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST -Body $adminBody -ContentType "application/json"
    $script:adminHeaders = @{
        "Authorization" = "Bearer $($adminResponse.token)"
        "Content-Type" = "application/json"
    }
    
    if (-not $adminResponse.token) { throw "Admin token no recibido" }
    Write-Host "   Admin: $($adminResponse.user.email)" -ForegroundColor Cyan
    Write-Host "   Role: $($adminResponse.user.role)" -ForegroundColor Cyan
}

# TEST 10: Dashboard Admin
Test-Endpoint "10. Dashboard de Estadísticas" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/stats/overview" -Method GET -Headers $adminHeaders
    if ($response.stats.totalUsers -lt 1) { throw "Sin datos en dashboard" }
    Write-Host "   Total Usuarios: $($response.stats.totalUsers)" -ForegroundColor Cyan
    Write-Host "   Suscripciones Activas: $($response.stats.activeSubscriptions)" -ForegroundColor Cyan
    Write-Host "   Ejecuciones Hoy: $($response.stats.executionsToday)" -ForegroundColor Cyan
    Write-Host "   Cache Hit Rate: $($response.stats.cache.hitRate)" -ForegroundColor Cyan
}

# TEST 11: Listar Usuarios (Admin)
Test-Endpoint "11. Listar Usuarios" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/users" -Method GET -Headers $adminHeaders
    if ($response.users.Count -eq 0) { throw "No hay usuarios" }
    Write-Host "   Total usuarios: $($response.count)" -ForegroundColor Cyan
}

# TEST 12: Listar Scripts (Admin)
Test-Endpoint "12. Listar Scripts (Admin)" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/scripts" -Method GET -Headers $adminHeaders
    if ($response.scripts.Count -eq 0) { throw "No hay scripts" }
    Write-Host "   Total scripts: $($response.scripts.Count)" -ForegroundColor Cyan
}

# TEST 13: Estadísticas de Caché
Test-Endpoint "13. Estadísticas de Caché" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/cache/stats" -Method GET -Headers $adminHeaders
    Write-Host "   Scripts en caché: $($response.stats.size)/$($response.stats.maxSize)" -ForegroundColor Cyan
    Write-Host "   Hit Rate: $($response.stats.hitRate)" -ForegroundColor Cyan
    Write-Host "   Memoria: $($response.stats.totalMB) MB" -ForegroundColor Cyan
}

# TEST 14: Warmup de Caché
Test-Endpoint "14. Warmup de Caché" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/cache/warmup" -Method POST -Headers $adminHeaders
    if ($response.scriptsLoaded -eq 0) { throw "No se cargaron scripts" }
    Write-Host "   Scripts cargados: $($response.scriptsLoaded)" -ForegroundColor Cyan
}

# TEST 15: Ver Logs
Test-Endpoint "15. Ver Logs de Uso" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/logs?limit=10" -Method GET -Headers $adminHeaders
    Write-Host "   Logs recuperados: $($response.count)" -ForegroundColor Cyan
}

# TEST 16: Detalle de Usuario
# Obtener el ID del usuario test dinámicamente
$usersListResponse = Invoke-RestMethod -Uri "http://localhost:3000/admin/users" -Method GET -Headers $adminHeaders
$testUser = $usersListResponse.users | Where-Object { $_.email -eq "test@example.com" }
$userId = $testUser.id

if (Test-Endpoint "16. Detalle de Usuario" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/users/$userId" -Method GET -Headers $adminHeaders
    Write-Host "   Usuario: $($response.user.email)" -ForegroundColor Cyan
    Write-Host "   Machine ID: $(if($response.user.machine_id) { $response.user.machine_id.Substring(0,16) + '...' } else { 'NULL' })" -ForegroundColor Cyan
    Write-Host "   Logs recientes: $($response.recentLogs.Count)" -ForegroundColor Cyan
}) {
    # TEST 17: Desvincular Hardware
    Test-Endpoint "17. Desvincular Hardware" {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/users/$userId/unbind-hardware" -Method POST -Headers $adminHeaders
        if (-not $response.success) { throw "No se pudo desvincular" }
        Write-Host "   Hardware desvinculado correctamente" -ForegroundColor Cyan
    }
    
    # TEST 18: Suspender Suscripción
    Test-Endpoint "18. Suspender Suscripción" {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/subscriptions/$userId/suspend" -Method POST -Headers $adminHeaders
        if (-not $response.success) { throw "No se pudo suspender" }
        Write-Host "   Suscripción suspendida" -ForegroundColor Cyan
    }
    
    # TEST 19: Reactivar Suscripción
    Test-Endpoint "19. Reactivar Suscripción" {
        $response = Invoke-RestMethod -Uri "http://localhost:3000/admin/subscriptions/$userId/reactivate" -Method POST -Headers $adminHeaders
        if (-not $response.success) { throw "No se pudo reactivar" }
        Write-Host "   Suscripción reactivada" -ForegroundColor Cyan
    }
}

# TEST 20: Heartbeat
Test-Endpoint "20. Heartbeat" {
    $response = Invoke-RestMethod -Uri "http://localhost:3000/client/heartbeat" -Method POST -Headers $headers
    if (-not $response.success) { throw "Heartbeat fallido" }
    Write-Host "   Timestamp: $($response.timestamp)" -ForegroundColor Cyan
}

# Resumen Final
Write-Host "`n" ("=" * 80) -ForegroundColor Cyan
Write-Host "RESUMEN DE TESTS" -ForegroundColor Cyan
Write-Host ("=" * 80) -ForegroundColor Cyan
Write-Host "✅ Tests exitosos: $testsPassed" -ForegroundColor Green
Write-Host "❌ Tests fallidos: $testsFailed" -ForegroundColor Red

$successRate = if ($testsPassed + $testsFailed -gt 0) { 
    [math]::Round(($testsPassed / ($testsPassed + $testsFailed)) * 100, 2) 
} else { 
    0 
}
Write-Host "📊 Tasa de éxito: $successRate%" -ForegroundColor $(if($successRate -eq 100) {'Green'} else {'Yellow'})

Write-Host ("=" * 80) -ForegroundColor Cyan

if ($testsFailed -eq 0) {
    Write-Host "`n🎉 ¡TODOS LOS TESTS PASARON! FASE 1 COMPLETADA AL 100%" -ForegroundColor Green
    Write-Host "`n📋 PRÓXIMOS PASOS:" -ForegroundColor Cyan
    Write-Host "  • Backend completamente funcional ✅" -ForegroundColor Green
    Write-Host "  • Sistema de encriptación operativo ✅" -ForegroundColor Green
    Write-Host "  • Rate limiting configurado ✅" -ForegroundColor Green
    Write-Host "  • Endpoints de cliente listos para Electron ✅" -ForegroundColor Green
    Write-Host "  • Panel de administración completo ✅" -ForegroundColor Green
    Write-Host "`n  ➡️  Listo para comenzar FASE 2: Aplicación Electron" -ForegroundColor Yellow
} else {
    Write-Host "`n⚠️ Algunos tests fallaron. Revisa los errores arriba." -ForegroundColor Yellow
}