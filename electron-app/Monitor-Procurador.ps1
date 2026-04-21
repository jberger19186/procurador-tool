# ===================================================================
# MONITOR DE CARPETAS TEMPORALES - PROCURADOR SCW
# ===================================================================
# Este script monitorea la creacion de carpetas tmp_* y copia su contenido
# al escritorio para analisis de seguridad
# ===================================================================

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MONITOR DE SEGURIDAD - PROCURADOR    " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Configuracion
$tempPath = $env:TEMP
$desktopPath = [Environment]::GetFolderPath("Desktop")
$outputFolder = Join-Path $desktopPath "Procurador-Scripts-Copiados"
$logFile = Join-Path $desktopPath "Procurador-Monitor-Log.txt"

# Crear carpeta de salida
if (-not (Test-Path $outputFolder)) {
    New-Item -ItemType Directory -Path $outputFolder -Force | Out-Null
    Write-Host "[+] Carpeta de salida creada: $outputFolder" -ForegroundColor Green
}

# Iniciar log
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
$logHeader = "===================================================================`n"
$logHeader += "MONITOR DE CARPETAS TEMPORALES - PROCURADOR SCW`n"
$logHeader += "===================================================================`n"
$logHeader += "Fecha de inicio: $timestamp`n"
$logHeader += "Carpeta monitoreada: $tempPath`n"
$logHeader += "Carpeta de salida: $outputFolder`n"
$logHeader += "===================================================================`n`n"

$logHeader | Out-File -FilePath $logFile -Encoding UTF8
Write-Host "[+] Log iniciado: $logFile" -ForegroundColor Green
Write-Host ""

Write-Host "[*] Monitoreando carpeta: $tempPath" -ForegroundColor Yellow
Write-Host "[*] Presiona Ctrl+C para detener" -ForegroundColor Yellow
Write-Host ""
Write-Host "Esperando creacion de carpetas tmp_*..." -ForegroundColor White
Write-Host ""

# Contador
$carpetasDetectadas = 0

# Crear FileSystemWatcher
$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = $tempPath
$watcher.Filter = "*.*"
$watcher.IncludeSubdirectories = $false
$watcher.EnableRaisingEvents = $true

# Accion cuando se crea una carpeta
$action = {
    $path = $Event.SourceEventArgs.FullPath
    $name = $Event.SourceEventArgs.Name
    
    # Solo procesar carpetas que empiecen con tmp_
    if ($name -match "^tmp_[a-f0-9]+$") {
        
        $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
        $logEntry = "`n[$timestamp] CARPETA DETECTADA!`n"
        $logEntry += "Nombre: $name`n"
        $logEntry += "Ruta completa: $path`n`n"
        
        Write-Host ""
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "  CARPETA TEMPORAL DETECTADA!         " -ForegroundColor Green
        Write-Host "========================================" -ForegroundColor Green
        Write-Host "Nombre: $name" -ForegroundColor Cyan
        Write-Host "Ruta: $path" -ForegroundColor Cyan
        Write-Host ""
        
        # Esperar un poco para que se escriban archivos
        Start-Sleep -Milliseconds 500
        
        # Verificar si la carpeta existe y tiene contenido
        if (Test-Path $path) {
            try {
                # Listar archivos
                $archivos = Get-ChildItem -Path $path -Recurse -File -ErrorAction SilentlyContinue
                
                $logEntry += "Archivos encontrados:`n"
                $logEntry += "--------------------`n"
                
                Write-Host "[*] Archivos encontrados:" -ForegroundColor Yellow
                
                foreach ($archivo in $archivos) {
                    $relativePath = $archivo.FullName.Substring($path.Length + 1)
                    $size = "{0:N2} KB" -f ($archivo.Length / 1KB)
                    
                    Write-Host "  - $relativePath ($size)" -ForegroundColor White
                    $logEntry += "  - $relativePath ($size)`n"
                }
                
                Write-Host ""
                
                # Crear carpeta de destino
                $destFolder = Join-Path $outputFolder $name
                New-Item -ItemType Directory -Path $destFolder -Force | Out-Null
                
                Write-Host "[+] Copiando archivos..." -ForegroundColor Yellow
                
                $logEntry += "`nArchivos copiados a: $destFolder`n"
                $logEntry += "--------------------`n"
                
                # Copiar todo el contenido
                Copy-Item -Path "$path\*" -Destination $destFolder -Recurse -Force -ErrorAction SilentlyContinue
                
                Write-Host "[+] Archivos copiados exitosamente!" -ForegroundColor Green
                Write-Host "[+] Ubicacion: $destFolder" -ForegroundColor Green
                Write-Host ""
                
                # Intentar abrir archivos .enc
                Write-Host "[*] Analizando archivos encriptados..." -ForegroundColor Yellow
                
                $archivosEnc = Get-ChildItem -Path $destFolder -Filter "*.enc" -ErrorAction SilentlyContinue
                
                foreach ($enc in $archivosEnc) {
                    $logEntry += "`nContenido de $($enc.Name) (primeros 500 chars):`n"
                    
                    try {
                        $contenido = Get-Content -Path $enc.FullName -Raw -ErrorAction Stop
                        $preview = $contenido.Substring(0, [Math]::Min(500, $contenido.Length))
                        $logEntry += $preview + "`n...(truncado)`n"
                        
                        Write-Host "  [+] $($enc.Name) - Contenido: ENCRIPTADO (basura hexadecimal)" -ForegroundColor Cyan
                    }
                    catch {
                        $logEntry += "  Error leyendo archivo: $($_.Exception.Message)`n"
                    }
                }
                
                # Intentar abrir archivos .js (wrappers)
                $archivosJs = Get-ChildItem -Path $destFolder -Filter "*.js" -Exclude "*.enc" -ErrorAction SilentlyContinue
                
                foreach ($js in $archivosJs) {
                    $logEntry += "`nContenido de $($js.Name):`n"
                    
                    try {
                        $contenido = Get-Content -Path $js.FullName -Raw -ErrorAction Stop
                        $logEntry += $contenido + "`n"
                        
                        Write-Host "  [+] $($js.Name) - Contenido: WRAPPER (desencriptador)" -ForegroundColor Cyan
                    }
                    catch {
                        $logEntry += "  Error leyendo archivo: $($_.Exception.Message)`n"
                    }
                }
                
                Write-Host ""
                Write-Host "[*] Intentando ejecutar archivo .enc (deberia fallar)..." -ForegroundColor Yellow
                
                if ($archivosEnc.Count -gt 0) {
                    $primerEnc = $archivosEnc[0].FullName
                    
                    try {
                        $errorFile = Join-Path $destFolder "error.txt"
                        $proceso = Start-Process -FilePath "node" -ArgumentList $primerEnc -Wait -PassThru -NoNewWindow -RedirectStandardError $errorFile -ErrorAction Stop
                        
                        if (Test-Path $errorFile) {
                            $error = Get-Content $errorFile -Raw
                            $logEntry += "`nIntento de ejecucion de .enc:`n"
                            $logEntry += $error + "`n"
                            
                            Write-Host "  [!] Como esperado, el archivo .enc NO es ejecutable" -ForegroundColor Red
                            Write-Host "      Error: $($error.Split([Environment]::NewLine)[0])" -ForegroundColor Red
                        }
                    }
                    catch {
                        Write-Host "  [!] Error al intentar ejecutar .enc (esperado)" -ForegroundColor Red
                        $logEntry += "`nError ejecutando .enc: $($_.Exception.Message)`n"
                    }
                }
                
                Write-Host ""
                
                # Guardar log
                $logEntry | Out-File -FilePath $logFile -Append -Encoding UTF8
                
                Write-Host "========================================" -ForegroundColor Green
                Write-Host ""
                
                # Incrementar contador
                $script:carpetasDetectadas++
                
            }
            catch {
                Write-Host "[!] Error procesando carpeta: $($_.Exception.Message)" -ForegroundColor Red
                $logEntry += "`nError: $($_.Exception.Message)`n"
                $logEntry | Out-File -FilePath $logFile -Append -Encoding UTF8
            }
        }
        else {
            Write-Host "[!] La carpeta ya no existe (eliminada rapidamente)" -ForegroundColor Red
        }
    }
}

# Registrar evento
Register-ObjectEvent $watcher "Created" -Action $action | Out-Null

Write-Host "[OK] Monitor activo - Esperando carpetas tmp_*..." -ForegroundColor Green
Write-Host ""
Write-Host "INSTRUCCIONES:" -ForegroundColor Yellow
Write-Host "1. Deja este script corriendo" -ForegroundColor White
Write-Host "2. En otra terminal, ejecuta: npm run dev" -ForegroundColor White
Write-Host "3. Este script detectara y copiara los archivos automaticamente" -ForegroundColor White
Write-Host "4. Revisa el escritorio para ver los resultados" -ForegroundColor White
Write-Host ""

# Loop infinito
try {
    while ($true) {
        Start-Sleep -Seconds 1
        
        # Mostrar contador cada 10 segundos
        if ((Get-Date).Second % 10 -eq 0) {
            Write-Host "[*] Monitoreando... (Carpetas detectadas: $carpetasDetectadas)" -ForegroundColor DarkGray
        }
    }
}
finally {
    # Cleanup al detener
    $watcher.EnableRaisingEvents = $false
    $watcher.Dispose()
    
    $finalLog = "`n===================================================================`n"
    $finalLog += "Monitor detenido: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')`n"
    $finalLog += "Total de carpetas detectadas: $carpetasDetectadas`n"
    $finalLog += "===================================================================`n"
    
    $finalLog | Out-File -FilePath $logFile -Append -Encoding UTF8
    
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "  MONITOR DETENIDO                     " -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "Carpetas detectadas: $carpetasDetectadas" -ForegroundColor Cyan
    Write-Host "Log guardado en: $logFile" -ForegroundColor Cyan
    Write-Host "Archivos copiados en: $outputFolder" -ForegroundColor Cyan
    Write-Host ""
}