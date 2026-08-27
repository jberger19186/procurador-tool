"""
tests/daily/flujos.py — los 6 flujos reales contra el PJN, invocados vía
`window.electronAPI` (confirmado alcanzable por CDP en el spike F0). Cada
función solo DISPARA el flujo y espera a que la promesa IPC resuelva — la
LECTURA del resultado real (qué expedientes salieron bien) la hace F1
(`results.py`) leyendo el visor HTML que el propio flujo generó en disco, no
el valor de retorno del IPC (que no trae el detalle por expediente).

API async (ver electron_driver.py sobre por qué, no la sync API).

Timeouts generosos (600-900s) — no son un valor arbitrario: la corrida real
de verificación del 2026-08-27 mostró que un solo expediente puede disparar
el sistema de reintentos propio del producto ("hard N": cierra Chrome,
relanza, reintenta) cuando el PJN responde lento — un timeout de Playwright
de 180s cortó la espera de un lote que en realidad terminó bien a los 241s.
El histórico del proyecto documenta hasta 5 reintentos por expediente.

Secuencia recomendada del flujo 6 (§6.6 de la propuesta) — importa el orden:
  crear parte descartable -> consulta inicial -> novedades sobre las 3 ->
  borrar la parte descartable. Novedades va DESPUÉS y sobre las 3 a propósito:
  una parte recién baselineada debe dar 0 novedades, así que ese paso verifica
  gratis que la consulta inicial escribió bien la línea base.
"""

from __future__ import annotations

import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from playwright.async_api import Page

from daily.config import (
    BATCH_EXPEDIENTES,
    CONFIG_INFORME_DEFAULT,
    INFORME_INDIVIDUAL_EXPEDIENTE,
    PARTE_DESCARTABLE,
)
from daily.electron_driver import evaluar_con_timeout


def fecha_hoy_ddmmyyyy() -> str:
    return datetime.now().strftime("%d/%m/%Y")


async def correr_procuracion(page: Page, fecha: Optional[str] = None, timeout_seg: float = 600) -> dict:
    fecha = fecha or fecha_hoy_ddmmyyyy()
    return await evaluar_con_timeout(
        page,
        "(fecha) => window.electronAPI.runProcessCustomDate(fecha)",
        fecha,
        timeout_seg,
    )


async def correr_procuracion_lote(page: Page, lines: Optional[list[str]] = None, fecha_limite: str = "", timeout_seg: float = 600) -> dict:
    lines = lines or BATCH_EXPEDIENTES
    return await evaluar_con_timeout(
        page,
        "(opts) => window.electronAPI.runProcessCustom(opts)",
        {"lines": lines, "fechaLimite": fecha_limite},
        timeout_seg,
    )


async def correr_informe_individual(page: Page, expediente: Optional[str] = None, timeout_seg: float = 600) -> dict:
    expediente = expediente or INFORME_INDIVIDUAL_EXPEDIENTE
    return await evaluar_con_timeout(
        page,
        "(opts) => window.electronAPI.runInforme(opts)",
        {"expediente": expediente, "configInforme": CONFIG_INFORME_DEFAULT},
        timeout_seg,
    )


async def correr_informe_lote(page: Page, lines: Optional[list[str]] = None, timeout_seg: float = 900) -> dict:
    lines = lines or BATCH_EXPEDIENTES
    return await evaluar_con_timeout(
        page,
        "(opts) => window.electronAPI.runInforme(opts)",
        {"batchLines": lines, "configInforme": CONFIG_INFORME_DEFAULT},
        timeout_seg,
    )


async def obtener_partes(page: Page, timeout_seg: float = 30) -> list[dict]:
    resp = await evaluar_con_timeout(page, "() => window.electronAPI.monitorGetPartes()", None, timeout_seg)
    return resp.get("partes", resp) if isinstance(resp, dict) else resp


async def crear_parte_descartable(page: Page, timeout_seg: float = 30) -> dict:
    """Crea la parte de §6.6 (DON COCHO). Devuelve la respuesta cruda del backend."""
    return await evaluar_con_timeout(
        page,
        "(opts) => window.electronAPI.monitorAgregarParte(opts)",
        PARTE_DESCARTABLE,
        timeout_seg,
    )


async def eliminar_parte(page: Page, parte_id: int, timeout_seg: float = 30) -> dict:
    return await evaluar_con_timeout(
        page,
        "(id) => window.electronAPI.monitorEliminarParte(id)",
        parte_id,
        timeout_seg,
    )


async def correr_monitor_inicial(page: Page, parte: dict, timeout_seg: float = 600) -> dict:
    return await evaluar_con_timeout(
        page,
        "(opts) => window.electronAPI.runMonitoreo(opts)",
        {"modo": "inicial", "partes": [parte]},
        timeout_seg,
    )


async def correr_monitor_novedades(page: Page, partes: list[dict], timeout_seg: float = 900) -> dict:
    return await evaluar_con_timeout(
        page,
        "(opts) => window.electronAPI.runMonitoreo(opts)",
        {"modo": "novedades", "partes": partes},
        timeout_seg,
    )
