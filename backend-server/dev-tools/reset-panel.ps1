# reset-panel.ps1 -- Panel GUI de Reset y Gestion de Usuarios.
# Abre una ventana Windows Forms con botones para las operaciones mas comunes
# de reset de la base de datos y gestion de cuentas de prueba.
#
# Uso:  powershell -ExecutionPolicy Bypass -File reset-panel.ps1
#
# (ASCII puro a proposito: PowerShell 5.1 lee .ps1 como ANSI y los acentos rompen el parser.)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

$KEY    = "C:/Users/JONATHAN/.ssh/do_procurador"
$HOST_  = "root@142.93.64.94"
$DBNAME = "procurador_db"
$DEVDIR = Split-Path -Parent $MyInvocation.MyCommand.Path

# ── Colores ───────────────────────────────────────────────────────────────────
$AMBER = [System.Drawing.Color]::FromArgb(217,119,6)
$BG    = [System.Drawing.Color]::FromArgb(247,247,245)
$RED   = [System.Drawing.Color]::FromArgb(185,28,28)
$GREEN = [System.Drawing.Color]::FromArgb(22,101,52)
$BLUE  = [System.Drawing.Color]::FromArgb(30,64,175)
$TEXT1 = [System.Drawing.Color]::FromArgb(26,26,26)
$TEXT3 = [System.Drawing.Color]::FromArgb(138,138,138)
$LIGHT = [System.Drawing.Color]::FromArgb(180,220,255)

# ── Helpers ───────────────────────────────────────────────────────────────────
function Ts { (Get-Date).ToString("HH:mm:ss") }

function RunSQL([string]$sql) {
    # Pipe via stdin para evitar que el shell remoto parta el SQL en palabras.
    $sql | ssh -i $KEY $HOST_ ("sudo -u postgres psql " + $DBNAME + " -t 2>/dev/null")
}

function BackupDB {
    $ts = (Get-Date).ToString("yyyyMMdd_HHmmss")
    ssh -i $KEY $HOST_ ("sudo -u postgres pg_dump " + $DBNAME + " > /tmp/backup_pre_reset_" + $ts + ".sql && echo 'OK: /tmp/backup_pre_reset_" + $ts + ".sql' 2>/dev/null")
}

function AppendLog([System.Windows.Forms.RichTextBox]$box, [string]$msg, [System.Drawing.Color]$color) {
    $box.SelectionStart  = $box.TextLength
    $box.SelectionLength = 0
    $box.SelectionColor  = $color
    $box.AppendText($msg + "`n")
    $box.SelectionColor  = $box.ForeColor
    $box.ScrollToCaret()
}

function Ask([string]$prompt, [string]$title, [string]$default) {
    [Microsoft.VisualBasic.Interaction]::InputBox($prompt, $title, $default)
}

# ── Ventana principal ─────────────────────────────────────────────────────────
$form = New-Object System.Windows.Forms.Form
$form.Text            = "Procurador SCW -- Panel de Reset y Gestion"
$form.Size            = New-Object System.Drawing.Size(780, 640)
$form.StartPosition   = "CenterScreen"
$form.BackColor       = $BG
$form.Font            = New-Object System.Drawing.Font("Segoe UI", 9)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox     = $false

# Titulo
$lbT = New-Object System.Windows.Forms.Label
$lbT.Text = "Procurador SCW -- Dev Tools"
$lbT.Font = New-Object System.Drawing.Font("Segoe UI", 13, [System.Drawing.FontStyle]::Bold)
$lbT.ForeColor = $AMBER
$lbT.Location  = New-Object System.Drawing.Point(16, 12)
$lbT.Size      = New-Object System.Drawing.Size(500, 28)
$form.Controls.Add($lbT)

$lbS = New-Object System.Windows.Forms.Label
$lbS.Text = "Panel de Reset y Gestion de Usuarios"
$lbS.ForeColor = $TEXT3
$lbS.Location  = New-Object System.Drawing.Point(18, 38)
$lbS.Size      = New-Object System.Drawing.Size(400, 18)
$form.Controls.Add($lbS)

$sep = New-Object System.Windows.Forms.Label
$sep.BorderStyle = "Fixed3D"
$sep.Location = New-Object System.Drawing.Point(10, 62)
$sep.Size     = New-Object System.Drawing.Size(744, 2)
$form.Controls.Add($sep)

# ── Helper: crear GroupBox ────────────────────────────────────────────────────
function MkGroup([string]$title, [int]$x, [int]$y, [int]$w, [int]$h) {
    $gb = New-Object System.Windows.Forms.GroupBox
    $gb.Text = $title
    $gb.Font = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Bold)
    $gb.ForeColor = $TEXT1
    $gb.Location  = New-Object System.Drawing.Point($x, $y)
    $gb.Size      = New-Object System.Drawing.Size($w, $h)
    return $gb
}

# ── Helper: crear Button ──────────────────────────────────────────────────────
function MkBtn([string]$txt, [int]$x, [int]$y, [int]$w, [int]$h, [System.Drawing.Color]$bg, [System.Drawing.Color]$fg) {
    $b = New-Object System.Windows.Forms.Button
    $b.Text = $txt
    $b.Location  = New-Object System.Drawing.Point($x, $y)
    $b.Size      = New-Object System.Drawing.Size($w, $h)
    $b.BackColor = $bg
    $b.ForeColor = $fg
    $b.FlatStyle = "Flat"
    $b.FlatAppearance.BorderColor = [System.Drawing.Color]::FromArgb(200,200,200)
    $b.Font   = New-Object System.Drawing.Font("Segoe UI", 8.5)
    $b.Cursor = "Hand"
    return $b
}

# ── GRUPO 1: Reset de usuarios ────────────────────────────────────────────────
$g1 = MkGroup "Reset de usuarios" 10 70 360 160
$form.Controls.Add($g1)

$btnAll  = MkBtn "Borrar TODOS los no-admins" 10 22 330 36 $RED ([System.Drawing.Color]::White)
$btnAll.Font = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)
$g1.Controls.Add($btnAll)

$btnData = MkBtn "Solo datos transaccionales (conserva usuarios)" 10 65 330 36 $BG $TEXT1
$g1.Controls.Add($btnData)

$btnDel  = MkBtn "Borrar un usuario por email..." 10 108 330 36 $BG $TEXT1
$g1.Controls.Add($btnDel)

# ── GRUPO 2: Reset de usos ────────────────────────────────────────────────────
$g2 = MkGroup "Reset de usos / contadores" 10 238 360 180
$form.Controls.Add($g2)

$btnUsos    = MkBtn "Resetear TODOS los contadores a 0" 10 22 330 36 $BG $TEXT1
$g2.Controls.Add($btnUsos)

$btnTrial   = MkBtn "Setear estado TRIAL (usage_count / limit)..." 10 65 330 36 $BG $TEXT1
$g2.Controls.Add($btnTrial)

$btnPago    = MkBtn "Activar cuenta (estado PAGO limpio)..." 10 108 330 36 $BG $TEXT1
$g2.Controls.Add($btnPago)

$btnCort    = MkBtn "Asignar cortesia +N usos..." 10 148 330 30 $BG $TEXT1
$g2.Controls.Add($btnCort)

# ── GRUPO 3: Consultas rapidas ────────────────────────────────────────────────
$g3 = MkGroup "Consultas rapidas" 10 428 360 130
$form.Controls.Add($g3)

$btnLU  = MkBtn "Ver todos los usuarios" 10 22 158 36 $BG $TEXT1
$g3.Controls.Add($btnLU)

$btnLS  = MkBtn "Ver suscripciones" 178 22 158 36 $BG $TEXT1
$g3.Controls.Add($btnLS)

$btnUD  = MkBtn "Estado de un usuario por email..." 10 65 330 36 $BG $TEXT1
$g3.Controls.Add($btnUD)

$btnBk  = MkBtn "Backup DB ahora (guarda en /tmp del server)" 10 108 330 30 $BLUE ([System.Drawing.Color]::White)
$g3.Controls.Add($btnBk)

# ── Consola log ───────────────────────────────────────────────────────────────
$gLog = MkGroup "Consola" 380 70 374 488
$form.Controls.Add($gLog)

$log = New-Object System.Windows.Forms.RichTextBox
$log.Location  = New-Object System.Drawing.Point(8, 18)
$log.Size      = New-Object System.Drawing.Size(358, 460)
$log.BackColor = [System.Drawing.Color]::FromArgb(15,15,15)
$log.ForeColor = [System.Drawing.Color]::FromArgb(220,220,220)
$log.Font      = New-Object System.Drawing.Font("Cascadia Code", 8)
$log.ReadOnly  = $true
$log.ScrollBars = "Vertical"
$gLog.Controls.Add($log)

$btnClr = MkBtn "Limpiar" 634 564 120 30 $BG $TEXT3
$form.Controls.Add($btnClr)
$btnClr.Add_Click({ $log.Clear() })

$sepB = New-Object System.Windows.Forms.Label
$sepB.BorderStyle = "Fixed3D"
$sepB.Location = New-Object System.Drawing.Point(10, 568)
$sepB.Size     = New-Object System.Drawing.Size(744, 2)
$form.Controls.Add($sepB)

$lbF = New-Object System.Windows.Forms.Label
$lbF.Text = "Las operaciones afectan la DB de produccion directamente. Hacer backup antes de reset masivo."
$lbF.ForeColor = $TEXT3
$lbF.Location  = New-Object System.Drawing.Point(12, 575)
$lbF.Size      = New-Object System.Drawing.Size(620, 18)
$form.Controls.Add($lbF)

# ── Logica de botones ─────────────────────────────────────────────────────────

$btnAll.Add_Click({
    $r = [System.Windows.Forms.MessageBox]::Show(
        "Esto borra TODOS los usuarios que no son admin y TODOS sus datos." + [char]10 +
        "Los administradores quedan intactos." + [char]10 + [char]10 +
        "Se hara un backup automatico antes. Continuar?",
        "Confirmar reset total",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($r -ne "Yes") { AppendLog $log "Cancelado." $TEXT3; return }

    AppendLog $log ("[" + (Ts) + "] Haciendo backup previo...") $AMBER
    $bk = BackupDB
    AppendLog $log $bk $TEXT3

    AppendLog $log ("[" + (Ts) + "] Ejecutando reset-nonadmin-users.sql...") $AMBER
    $sqlFile = Join-Path $DEVDIR "reset-nonadmin-users.sql"
    $out = Get-Content $sqlFile | ssh -i $KEY $HOST_ ("sudo -u postgres psql " + $DBNAME + " -v ON_ERROR_STOP=1 2>&1")
    foreach ($line in $out) { AppendLog $log $line $GREEN }
    AppendLog $log "--- Reset completado ---" $AMBER
})

$btnData.Add_Click({
    $r = [System.Windows.Forms.MessageBox]::Show(
        "Borra datos transaccionales (tickets, pagos, logs, notificaciones, monitor)." + [char]10 +
        "Conserva todos los usuarios y sus suscripciones." + [char]10 + [char]10 + "Continuar?",
        "Confirmar reset de datos",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Question)
    if ($r -ne "Yes") { AppendLog $log "Cancelado." $TEXT3; return }
    AppendLog $log ("[" + (Ts) + "] Borrando datos transaccionales...") $AMBER
    $sql = "DELETE FROM ticket_comments; DELETE FROM support_tickets; DELETE FROM invoices; DELETE FROM payments; DELETE FROM webhook_events; DELETE FROM usage_logs; DELETE FROM usage_adjustments; DELETE FROM usage_extras; DELETE FROM user_events; DELETE FROM admin_events; DELETE FROM ai_assistance_logs; DELETE FROM analytics_events; DELETE FROM notifications; DELETE FROM user_notifications; DELETE FROM monitor_consultas_log; DELETE FROM monitor_partes; DELETE FROM active_executions;"
    RunSQL $sql | Out-Null
    AppendLog $log "--- Datos transaccionales borrados ---" $GREEN
})

$btnDel.Add_Click({
    $email = Ask "Email del usuario a borrar" "Borrar usuario" ""
    if ([string]::IsNullOrWhiteSpace($email)) { return }
    $r = [System.Windows.Forms.MessageBox]::Show(
        "Borrar el usuario '" + $email + "' y TODOS sus datos?",
        "Confirmar",
        [System.Windows.Forms.MessageBoxButtons]::YesNo,
        [System.Windows.Forms.MessageBoxIcon]::Warning)
    if ($r -ne "Yes") { AppendLog $log "Cancelado." $TEXT3; return }
    AppendLog $log ("[" + (Ts) + "] Borrando " + $email + "...") $AMBER
    $uid = (RunSQL ("SELECT id FROM users WHERE email='" + $email + "';")).Trim()
    if ([string]::IsNullOrWhiteSpace($uid)) {
        AppendLog $log ("No se encontro el usuario: " + $email) $RED
        return
    }
    RunSQL ("DELETE FROM ticket_comments WHERE author_id=" + $uid + "; DELETE FROM ticket_comments WHERE ticket_id IN (SELECT id FROM support_tickets WHERE user_id=" + $uid + "); DELETE FROM support_tickets WHERE user_id=" + $uid + "; DELETE FROM invoices WHERE user_id=" + $uid + "; DELETE FROM payments WHERE user_id=" + $uid + "; DELETE FROM usage_logs WHERE user_id=" + $uid + "; DELETE FROM usage_extras WHERE user_id=" + $uid + "; DELETE FROM user_events WHERE user_id=" + $uid + "; DELETE FROM notifications WHERE user_id=" + $uid + "; DELETE FROM user_notifications WHERE user_id=" + $uid + "; DELETE FROM monitor_partes WHERE user_id=" + $uid + "; DELETE FROM subscriptions WHERE user_id=" + $uid + "; DELETE FROM users WHERE id=" + $uid + ";") | Out-Null
    AppendLog $log ("Usuario id=" + $uid + " (" + $email + ") eliminado.") $GREEN
})

$btnUsos.Add_Click({
    $email = Ask "Email del usuario" "Resetear contadores a 0" "procuradortool@gmail.com"
    if ([string]::IsNullOrWhiteSpace($email)) { return }
    AppendLog $log ("[" + (Ts) + "] Reseteando contadores de " + $email + "...") $AMBER
    $sql = "UPDATE subscriptions SET usage_count=0, proc_usage=0, informe_usage=0, batch_usage=0, monitor_novedades_usage=0 WHERE user_id=(SELECT id FROM users WHERE email='" + $email + "'); SELECT usage_count, proc_usage, informe_usage FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE email='" + $email + "');"
    AppendLog $log (RunSQL $sql) $GREEN
})

$btnTrial.Add_Click({
    $email = Ask "Email del usuario" "Setear estado trial" "procuradortool@gmail.com"
    if ([string]::IsNullOrWhiteSpace($email)) { return }
    $usados = Ask "usage_count (usados)" "Trial" "0"
    $limite = Ask "usage_limit (limite)" "Trial" "20"
    AppendLog $log ("[" + (Ts) + "] Seteando trial " + $usados + "/" + $limite + " para " + $email + "...") $AMBER
    $sql = "UPDATE subscriptions SET payment_provider=NULL, usage_count=" + $usados + ", usage_limit=" + $limite + ", proc_usage=0, informe_usage=0, batch_usage=0, monitor_novedades_usage=0, status='suspended' WHERE user_id=(SELECT id FROM users WHERE email='" + $email + "'); UPDATE users SET registration_status='pending_activation' WHERE email='" + $email + "'; SELECT s.usage_count, s.usage_limit, s.status, u.registration_status FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.email='" + $email + "';"
    AppendLog $log (RunSQL $sql) $GREEN
})

$btnPago.Add_Click({
    $email = Ask "Email del usuario" "Activar cuenta (estado pago)" "procuradortool@gmail.com"
    if ([string]::IsNullOrWhiteSpace($email)) { return }
    AppendLog $log ("[" + (Ts) + "] Activando cuenta pago para " + $email + "...") $AMBER
    $sql = "UPDATE subscriptions SET payment_provider='mercadopago', status='active', usage_limit=999999, usage_count=0, proc_usage=0, informe_usage=0, batch_usage=0, monitor_novedades_usage=0 WHERE user_id=(SELECT id FROM users WHERE email='" + $email + "'); UPDATE users SET registration_status='active' WHERE email='" + $email + "'; SELECT s.status, s.payment_provider, s.usage_limit, u.registration_status FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.email='" + $email + "';"
    AppendLog $log (RunSQL $sql) $GREEN
})

$btnCort.Add_Click({
    $email = Ask "Email del usuario" "Cortesia" "procuradortool@gmail.com"
    if ([string]::IsNullOrWhiteSpace($email)) { return }
    $n = Ask "Usos extra a agregar" "Cortesia +N" "5"
    AppendLog $log ("[" + (Ts) + "] Agregando +" + $n + " cortesia a " + $email + "...") $AMBER
    $sql = "UPDATE subscriptions SET usage_limit = usage_limit + " + $n + " WHERE user_id=(SELECT id FROM users WHERE email='" + $email + "') AND payment_provider IS NULL; SELECT usage_count, usage_limit FROM subscriptions WHERE user_id=(SELECT id FROM users WHERE email='" + $email + "');"
    AppendLog $log (RunSQL $sql) $GREEN
})

$btnLU.Add_Click({
    AppendLog $log ("[" + (Ts) + "] Usuarios en DB:") $AMBER
    AppendLog $log (RunSQL "SELECT id, email, role, registration_status FROM users ORDER BY id;") $LIGHT
})

$btnLS.Add_Click({
    AppendLog $log ("[" + (Ts) + "] Suscripciones:") $AMBER
    AppendLog $log (RunSQL "SELECT u.email, s.status, s.payment_provider, s.usage_count, s.usage_limit FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.user_id;") $LIGHT
})

$btnUD.Add_Click({
    $email = Ask "Email del usuario" "Estado de usuario" ""
    if ([string]::IsNullOrWhiteSpace($email)) { return }
    AppendLog $log ("[" + (Ts) + "] Estado de " + $email) $AMBER
    $sql = "SELECT u.id, u.registration_status, s.status, s.payment_provider, s.usage_count, s.usage_limit, s.proc_usage, s.informe_usage FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE u.email='" + $email + "';"
    AppendLog $log (RunSQL $sql) $LIGHT
})

$btnBk.Add_Click({
    AppendLog $log ("[" + (Ts) + "] Haciendo backup...") $AMBER
    AppendLog $log (BackupDB) $GREEN
})

# ── Mensaje inicial ───────────────────────────────────────────────────────────
AppendLog $log ("Panel listo. Conectado a: " + $HOST_) $AMBER
AppendLog $log ("DB: " + $DBNAME) $TEXT3
AppendLog $log "" $TEXT3

[void]$form.ShowDialog()
