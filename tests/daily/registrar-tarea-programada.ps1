# registrar-tarea-programada.ps1 -- F5: registra la tarea programada de
# Windows que corre la prueba diaria de forma DESATENDIDA (sin operador).
#
# NO SE EJECUTO AL CONSTRUIRLA. Es codigo listo, no una tarea activada --
# el plan (docs/internal/propuesta-script-prueba-diaria-2026-08-27.md, F5)
# recomienda esperar a acumular mas corridas asistidas antes de soltar el
# modo desatendido: una corrida que falla a mitad de camino sin nadie
# presente consume cupo real sin que se detecte a tiempo. Correr este
# script es la decision explicita de activarlo -- nadie mas lo hace por vos.
#
# Que hace: crea (o reemplaza) una tarea de Task Scheduler que invoca
# correr-diario.ps1 -Desatendido todos los dias a la hora indicada, corra
# el usuario logueado o no (requiere que la sesion de Windows exista, para
# que Chrome y la app puedan abrir ventanas -- no corre con la sesion
# bloqueada/deslogueada, ver la nota de -RunOnlyIfLoggedOn abajo).
#
# Uso (como Administrador):
#   powershell -ExecutionPolicy Bypass -File registrar-tarea-programada.ps1
#   powershell -ExecutionPolicy Bypass -File registrar-tarea-programada.ps1 -HoraLocal "08:00"
#
# Para desactivarla despues:
#   Unregister-ScheduledTask -TaskName "ProcuradorSCW-PruebaDiaria" -Confirm:$false
#
# (ASCII puro a proposito, mismo criterio que correr-diario.ps1.)

param(
    [string]$HoraLocal = "08:00"
)

$TASK_NAME = "ProcuradorSCW-PruebaDiaria"

$SCRIPTDIR = if ($MyInvocation.MyCommand.Path) {
    Split-Path -Parent $MyInvocation.MyCommand.Path
} else {
    Split-Path -Parent ([System.Diagnostics.Process]::GetCurrentProcess().MainModule.FileName)
}

$CORRER = Join-Path $SCRIPTDIR "correr-diario.ps1"

if (-not (Test-Path $CORRER)) {
    Write-Host "ERROR: no se encontro correr-diario.ps1 en $SCRIPTDIR" -ForegroundColor Red
    exit 1
}

$existente = Get-ScheduledTask -TaskName $TASK_NAME -ErrorAction SilentlyContinue
if ($existente) {
    Write-Host "Ya existe una tarea '$TASK_NAME' -- se va a reemplazar." -ForegroundColor Yellow
    Unregister-ScheduledTask -TaskName $TASK_NAME -Confirm:$false
}

$accion = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$CORRER`" -Desatendido"

$disparador = New-ScheduledTaskTrigger -Daily -At $HoraLocal

# -RunOnlyIfLoggedOn (via LogonType Interactive) a proposito: la app y Chrome
# necesitan una sesion de escritorio real para abrir ventanas -- correr con
# la sesion bloqueada/deslogueada (S4U) haria que la app nunca llegue a
# renderizar nada util. El costo es que si la maquina esta apagada o
# deslogueada a la hora fijada, la corrida de ese dia simplemente no pasa
# (el cron de alertas del backend, 0 12 * * *, avisa igual si pasan 7 dias
# sin una corrida nueva -- ver utils/verificationAlertCheck.js).
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

$config = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -DontStopOnIdleEnd `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -RestartCount 0

Register-ScheduledTask -TaskName $TASK_NAME `
    -Action $accion -Trigger $disparador -Principal $principal -Settings $config `
    -Description "Procurador SCW -- prueba diaria desatendida contra el PJN real (F5, tests/daily/). Log en tests/daily/logs/." `
    | Out-Null

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Tarea '$TASK_NAME' registrada -- corre todos los dias a las $HoraLocal" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Para desactivarla:"
Write-Host "  Unregister-ScheduledTask -TaskName `"$TASK_NAME`" -Confirm:`$false"
Write-Host ""
Write-Host "Para probarla ahora mismo (sin esperar a la hora fijada):"
Write-Host "  Start-ScheduledTask -TaskName `"$TASK_NAME`""
Write-Host ""
