# test-user-panel.ps1 — Panel de TESTING (local).
# Menú interactivo que ejecuta backend-server/dev-tools/test-user.js en el server (vía SSH).
# Sirve para borrar el usuario de prueba y ajustar usos/contadores en la DB.
# Uso: click derecho > "Ejecutar con PowerShell", o desde una terminal:  ./test-user-panel.ps1
#
# NO es producción. Las operaciones tocan la DB directo. Requiere la llave SSH.

$KEY    = "C:/Users/JONATHAN/.ssh/do_procurador"
$HOSTIP = "root@142.93.64.94"
$REMOTE = "cd /var/www/procurador/backend-server && node dev-tools/test-user.js"

function Run([string]$cmdArgs) {
    Write-Host ""
    ssh -i $KEY $HOSTIP "$REMOTE $cmdArgs"
    Write-Host ""
}

$email = Read-Host "Email del usuario [Enter = procuradortool@gmail.com]"
if ([string]::IsNullOrWhiteSpace($email)) { $email = "procuradortool@gmail.com" }

do {
    Write-Host "============================================================"
    Write-Host " Panel de testing  —  $email"
    Write-Host "============================================================"
    Write-Host " 1) Ver estado (usos por submódulo + trial)"
    Write-Host " 2) Borrar usuario (libera email + CUIT para registrar de 0)"
    Write-Host " 3) Setear TRIAL  (ej: 18/20)"
    Write-Host " 4) Setear uso de SUBMODULO (ej: proc 20  ->  20/50)"
    Write-Host " 5) Setear BONUS de submódulo (extiende el límite)"
    Write-Host " 6) Resetear todos los contadores a 0"
    Write-Host " 7) Cambiar el email objetivo"
    Write-Host " 8) Listar TODOS los usuarios (ver cuál borrar)"
    Write-Host " 0) Salir"
    Write-Host "------------------------------------------------------------"
    $op = Read-Host "Opción"

    switch ($op) {
        "1" { Run "show $email" }
        "2" {
            $c = Read-Host "Confirmá borrar '$email' y TODOS sus datos (escribí 'si')"
            if ($c -eq "si") { Run "delete $email" } else { Write-Host "Cancelado." }
        }
        "3" {
            $u = Read-Host "Usados (usage_count)"
            $l = Read-Host "Límite [Enter = 20]"
            if ([string]::IsNullOrWhiteSpace($l)) { $l = "20" }
            Run "trial $email $u $l"
        }
        "4" {
            Write-Host "Submódulos: proc | batch | informe | monitor_novedades"
            $s = Read-Host "Submódulo"
            $u = Read-Host "Usados"
            Run "usage $email $s $u"
        }
        "5" {
            Write-Host "Submódulos: proc | batch | informe | monitor_novedades | monitor_partes"
            $s = Read-Host "Submódulo"
            $n = Read-Host "Bonus (se suma al límite del plan)"
            Run "bonus $email $s $n"
        }
        "6" { Run "reset $email" }
        "7" {
            $email = Read-Host "Nuevo email objetivo"
            if ([string]::IsNullOrWhiteSpace($email)) { $email = "procuradortool@gmail.com" }
        }
        "8" {
            Run "list"
            $pick = Read-Host "Email a fijar como objetivo [Enter = dejar '$email']"
            if (-not [string]::IsNullOrWhiteSpace($pick)) { $email = $pick }
        }
        "0" { Write-Host "Chau." }
        default { Write-Host "Opción inválida." }
    }
} while ($op -ne "0")
