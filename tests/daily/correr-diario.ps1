# correr-diario.ps1 -- Doble clic para correr la prueba diaria de la app.
# Modo por defecto: automatico (F2, los 6 flujos por codigo).
# Modo asistido (F1): correr-diario.ps1 -Asistido
# Modo desatendido (F5): correr-diario.ps1 -Desatendido
#   -- este es el que invoca una tarea programada. NO hace la pausa final
#      (Read-Host colgaria para siempre sin una sesion interactiva) y loguea
#      a archivo en vez de solo consola (ver cli.py::_correr_desatendido).
#
# Uso:  powershell -ExecutionPolicy Bypass -File correr-diario.ps1
#       powershell -ExecutionPolicy Bypass -File correr-diario.ps1 -Asistido
#       powershell -ExecutionPolicy Bypass -File correr-diario.ps1 -Desatendido
#
# (ASCII puro a proposito: PowerShell 5.1 lee .ps1 como ANSI y los acentos
# rompen el parser -- mismo criterio que dev-tools/reset-panel.ps1.)

param(
    [switch]$Asistido,
    [switch]$Desatendido
)

# $MyInvocation.MyCommand.Path es null cuando se corre desde un exe compilado
# con ps2exe. Fallback: usar el path del proceso en ejecucion.
$SCRIPTDIR = if ($MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
}

$CLI = Join-Path $SCRIPTDIR "cli.py"

if (-not (Test-Path $CLI)) {
    Write-Host "ERROR: no se encontro cli.py en $SCRIPTDIR" -ForegroundColor Red
    Write-Host ""
    Read-Host "Presiona Enter para cerrar"
    exit 1
}

if (-not $Desatendido) {
    Write-Host "============================================================"
    Write-Host "  Prueba diaria de la app -- Procurador SCW"
    Write-Host "============================================================"
    Write-Host ""
}

if ($Asistido) {
    python $CLI --asistido
} elseif ($Desatendido) {
    python $CLI --desatendido
} else {
    python $CLI
}

$exitCode = $LASTEXITCODE

if ($Desatendido) {
    # Sin pausa ni Write-Host: una tarea programada no tiene sesion
    # interactiva -- Read-Host colgaria el proceso para siempre. El detalle
    # de la corrida queda en tests/daily/logs/ (cli.py lo loguea a archivo).
    exit $exitCode
}

Write-Host ""
Write-Host "============================================================"
if ($exitCode -eq 0) {
    Write-Host "  Corrida terminada sin errores." -ForegroundColor Green
} else {
    Write-Host "  Corrida terminada con al menos un error -- revisar arriba." -ForegroundColor Red
}
Write-Host "============================================================"
Write-Host ""
Read-Host "Presiona Enter para cerrar"
exit $exitCode
