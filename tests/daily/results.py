"""
tests/daily/results.py — localizar y parsear los visores HTML que cada flujo
deja en `descargas/`.

🚨 Regla dura (ver CLAUDE.md, hallazgo de la corrida diaria): NUNCA contar las
palabras "Exitoso"/"Error" del HTML — son clases CSS (`.status-ok`, texto de
badges) y dan un conteo falso. Cada parser lee el dato estructurado real:
  - visores de Procuración: `const datosEmbebidos = {...}`, campo
    `expedientes[].estado` ("exitoso" | otro).
  - visores de Informe: `const DATOS_BATCH = {...}`, campo
    `expedientes[].ok` (bool) + `.rutaPDF` (criterio "Abrir PDF activo",
    el que caza las regresiones 822bf0d/debb503: un PDF que existe pero no
    se enlaza es peor que uno que no se generó).
  - visor de Monitor: servido ya renderizado por `main.js` (sin objeto JS),
    se leen los 3 `<div class="stat-val">` por su label adyacente, no por
    posición fija (más robusto si el layout cambia de orden).
"""

from __future__ import annotations

import glob
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

_TESTS_DIR = Path(__file__).resolve().parents[1]
if str(_TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(_TESTS_DIR))

from daily.config import DESCARGAS_DIR, PREFIJOS_VISOR


@dataclass
class ResultadoFlujo:
    clave: str
    estado: str            # 'ok' | 'error' | 'sin_datos'
    detalle: str
    path: Optional[str] = None


def _mas_reciente(prefijo: str, desde_epoch: Optional[float] = None) -> Optional[str]:
    """
    Devuelve el path del archivo más reciente que empieza con `prefijo`.
    Si `desde_epoch` está seteado, ignora archivos con mtime anterior — así
    una corrida no reporta accidentalmente el resultado de una corrida vieja
    si algún flujo no llegó a generar su visor.
    """
    candidatos = glob.glob(os.path.join(DESCARGAS_DIR, f"{prefijo}*.html"))
    if desde_epoch is not None:
        candidatos = [c for c in candidatos if os.path.getmtime(c) >= desde_epoch]
    if not candidatos:
        return None
    return max(candidatos, key=os.path.getmtime)


def _extraer_objeto_js(html: str, nombre_var: str) -> Optional[dict]:
    """
    Extrae `const <nombre_var> = { ... };` del HTML y lo parsea como JSON.

    Cuenta llaves balanceadas carácter por carácter en vez de usar una regex
    con un tope fijo de anidamiento — `datosEmbebidos` tiene 3+ niveles reales
    (expedientes[].movimientos[].{...}), y una regex de "1 nivel tolerado"
    (el mismo criterio simplificado que usa generador_visor.js del lado de
    Electron para SU propio problema, que es más chico) corta ahí y deja el
    resto como basura sintáctica sin cerrar — json.loads falla en silencio.
    Se detectó parseando visores reales, no en una prueba sintética.
    """
    marca = re.search(r"const\s+" + re.escape(nombre_var) + r"\s*=\s*", html)
    if not marca:
        return None
    inicio = marca.end()
    if inicio >= len(html) or html[inicio] != "{":
        return None

    profundidad = 0
    dentro_string = False
    escapando = False
    fin = None
    for i in range(inicio, len(html)):
        c = html[i]
        if escapando:
            escapando = False
            continue
        if c == "\\" and dentro_string:
            escapando = True
            continue
        if c == '"':
            dentro_string = not dentro_string
            continue
        if dentro_string:
            continue
        if c == "{":
            profundidad += 1
        elif c == "}":
            profundidad -= 1
            if profundidad == 0:
                fin = i + 1
                break
    if fin is None:
        return None
    return json.loads(html[inicio:fin])


def parse_procurar_visor(path: str) -> ResultadoFlujo:
    """Procuración individual o por lote — comparten `datosEmbebidos`."""
    with open(path, encoding="utf-8") as f:
        html = f.read()
    datos = _extraer_objeto_js(html, "datosEmbebidos")
    if not datos:
        return ResultadoFlujo("proc", "sin_datos", f"No se pudo leer datosEmbebidos de {path}", path)
    exps = datos.get("expedientes", [])
    exitosos = sum(1 for e in exps if e.get("estado") == "exitoso")
    total = len(exps)
    estado = "ok" if exitosos == total and total > 0 else "error"
    return ResultadoFlujo("proc", estado, f"{exitosos}/{total} exitosos, {total - exitosos} fallidos", path)


def parse_informe_visor(path: str) -> ResultadoFlujo:
    """Informe individual o por lote — comparten `DATOS_BATCH`."""
    with open(path, encoding="utf-8") as f:
        html = f.read()
    datos = _extraer_objeto_js(html, "DATOS_BATCH")
    if not datos:
        return ResultadoFlujo("informe", "sin_datos", f"No se pudo leer DATOS_BATCH de {path}", path)
    exps = datos.get("expedientes", [])
    total = len(exps)
    ok_count = sum(1 for e in exps if e.get("ok"))
    # Criterio que caza 822bf0d/debb503: un PDF generado pero sin rutaPDF
    # (o con ruta vacía) es una regresión, no un éxito parcial.
    sin_pdf = [e.get("expediente") for e in exps if e.get("ok") and not e.get("rutaPDF")]
    if sin_pdf:
        return ResultadoFlujo(
            "informe", "error",
            f"{ok_count}/{total} OK pero sin PDF enlazado: {', '.join(sin_pdf)}", path,
        )
    estado = "ok" if ok_count == total and total > 0 else "error"
    return ResultadoFlujo("informe", estado, f"{ok_count}/{total} OK, todos con PDF enlazado", path)


def parse_monitor_visor(path: str) -> ResultadoFlujo:
    """
    Visor de Monitor — HTML server-rendered, sin objeto JS. Se leen los 3
    `stat-val` por su label adyacente (no por posición) para no depender del
    orden en que main.js los emite.
    """
    with open(path, encoding="utf-8") as f:
        html = f.read()

    def valor_de(label: str) -> Optional[int]:
        m = re.search(
            r'<div class="stat-val"[^>]*>(\d+)</div><div class="stat-label">'
            + re.escape(label),
            html,
        )
        return int(m.group(1)) if m else None

    procesadas = valor_de("Partes procesadas")
    exitosas = valor_de("Exitosas")
    novedades = valor_de("Novedades detectadas")

    if procesadas is None or exitosas is None:
        return ResultadoFlujo("monitor", "sin_datos", f"No se pudieron leer los stat-val de {path}", path)

    estado = "ok" if exitosas == procesadas and procesadas > 0 else "error"
    detalle = f"{exitosas}/{procesadas} partes exitosas, {novedades if novedades is not None else '?'} novedades"
    return ResultadoFlujo("monitor", estado, detalle, path)


PARSERS = {
    "proc": parse_procurar_visor,
    "batch": parse_procurar_visor,
    "informe": parse_informe_visor,
    "informe_lote": parse_informe_visor,
    "monitor": parse_monitor_visor,
    "monitor_inicial": parse_monitor_visor,
}


def leer_ultimo_resultado(clave: str, desde_epoch: Optional[float] = None) -> ResultadoFlujo:
    """
    Localiza y parsea el visor más reciente para el flujo `clave`.
    Si `desde_epoch` está seteado y no hay ningún visor posterior a esa marca,
    devuelve estado 'sin_datos' — el llamador decide si eso es 'omitido' o un
    error real (F1 no corre flujos, así que no sabe si el flujo se intentó).
    """
    prefijo = PREFIJOS_VISOR[clave]
    path = _mas_reciente(prefijo, desde_epoch)
    if not path:
        return ResultadoFlujo(clave, "sin_datos", "No se encontró ningún visor reciente", None)
    parser = PARSERS[clave]
    resultado = parser(path)
    resultado.clave = clave  # el parser interno no distingue individual/lote
    return resultado
