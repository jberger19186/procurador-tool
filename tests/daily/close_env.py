"""
tests/daily/close_env.py — estado de procesos de la app y cierre limpio.

Reusado también por F3 (§6.2 de la propuesta): antes de lanzar una instancia
por código, hay que verificar que no exista ninguna corriendo — el spike de
F0 confirmó que Electron NO tiene single-instance lock acá, y que una segunda
instancia colisiona en silencio (Chromium no puede tomar el lock de LevelDB
de Local Storage/, así que la segunda cae a memoria sin avisar y pierde todo
lo que escribe al cerrarse).
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from daily.config import APP_PROCESS_NAME


def app_process_count() -> int:
    """Cuántos procesos con ese nombre hay corriendo (0 = nada abierto)."""
    result = subprocess.run(
        [
            "powershell.exe", "-NoProfile", "-Command",
            f"(Get-Process -Name '{APP_PROCESS_NAME}' -ErrorAction SilentlyContinue "
            f"| Select-Object -ExpandProperty ProcessName -Unique | Measure-Object).Count",
        ],
        capture_output=True, text=True, timeout=15,
    )
    try:
        return int(result.stdout.strip() or "0")
    except ValueError:
        return 0


def assert_no_instance_running() -> None:
    """
    Guard de instancia única (§6.2). Lanza RuntimeError si la app ya está
    corriendo — el llamador decide qué hacer (abortar con mensaje claro).
    """
    n = app_process_count()
    if n > 0:
        raise RuntimeError(
            f"Hay {n} proceso(s) de '{APP_PROCESS_NAME}' corriendo. "
            "Electron no tiene single-instance lock (confirmado en el spike F0): "
            "lanzar otra instancia colisiona en silencio con la sesión abierta. "
            "Cerrá la app manualmente antes de correr el script."
        )


def close_app(espera_seg: float = 3.0) -> bool:
    """
    Cierra la app con CloseMainWindow() (cierre limpio, deja guardar estado);
    si sigue viva tras la espera, fuerza con Stop-Process. Devuelve True si
    el cierre fue limpio, False si hizo falta forzar.
    """
    subprocess.run(
        [
            "powershell.exe", "-NoProfile", "-Command",
            f"Get-Process -Name '{APP_PROCESS_NAME}' -ErrorAction SilentlyContinue "
            f"| ForEach-Object {{ $_.CloseMainWindow() | Out-Null }}",
        ],
        capture_output=True, text=True, timeout=15,
    )
    time.sleep(espera_seg)

    if app_process_count() == 0:
        return True

    subprocess.run(
        [
            "powershell.exe", "-NoProfile", "-Command",
            f"Get-Process -Name '{APP_PROCESS_NAME}' -ErrorAction SilentlyContinue "
            f"| Stop-Process -Force",
        ],
        capture_output=True, text=True, timeout=15,
    )
    return False


def list_chrome_tab_titles() -> list[str]:
    """
    Enumera los títulos de las ventanas visibles de chrome.exe — best-effort,
    para avisarle al operador qué pestañas quedaron abiertas (los visores/PDF
    que el propio flujo abrió; no se pueden cerrar por código, ver §4 de la
    propuesta — Chrome queda fuera del alcance de este script).
    """
    ps = r"""
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class W32Titles {
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int lpdwProcessId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern int GetWindowTextLength(IntPtr hWnd);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
}
'@
$chromePids = (Get-Process -Name chrome -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
$titulos = New-Object System.Collections.Generic.List[string]
[W32Titles]::EnumWindows({
    param($hWnd, $lParam)
    if ([W32Titles]::IsWindowVisible($hWnd)) {
        $procId = 0
        [W32Titles]::GetWindowThreadProcessId($hWnd, [ref]$procId) | Out-Null
        if ($chromePids -contains $procId) {
            $len = [W32Titles]::GetWindowTextLength($hWnd)
            if ($len -gt 0) {
                $sb = New-Object System.Text.StringBuilder ($len + 1)
                [W32Titles]::GetWindowText($hWnd, $sb, $sb.Capacity) | Out-Null
                $titulos.Add($sb.ToString())
            }
        }
    }
    return $true
}, [IntPtr]::Zero) | Out-Null
$titulos | ForEach-Object { Write-Output $_ }
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-Command", ps],
        capture_output=True, text=True, timeout=15,
    )
    titulos = [t.strip() for t in result.stdout.splitlines() if t.strip()]
    return titulos
