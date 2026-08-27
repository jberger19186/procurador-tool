"""
demo-capture/capture_common.py — D3 (demo Etapa 1.6): constantes y helpers
compartidos por los 3 pipelines de captura (visores, portal, app Electron).

Viewport fijo (1280x800) porque el plan lo marca como "requisito de
reproducibilidad no negociable" (plan-demo-producto-2026-08-26.md, D3) — el
mismo motivo por el que el spike de §0.1 lo verificó explícitamente antes de
construir nada acá.
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
ASSETS_DIR = REPO_ROOT / "backend-server" / "public" / "landing" / "demo" / "assets"
DEMO_FIXTURES_DIR = REPO_ROOT / "backend-server" / "dev-tools" / "demo-fixtures"
DEMO_FIXTURES_OUTPUT_DIR = DEMO_FIXTURES_DIR / "output"

VIEWPORT = {"width": 1280, "height": 800}


def ruta_captura(capitulo: str, nombre_archivo: str) -> Path:
    """Ruta de salida para una captura, creando el subdirectorio del capítulo
    si hace falta. `nombre_archivo` incluye el número de paso, ej.
    '2.4-visor-novedades.png' — así el nombre del archivo es autoexplicativo
    sin tener que cruzar con el guion para saber qué paso es cada uno."""
    carpeta = ASSETS_DIR / capitulo
    carpeta.mkdir(parents=True, exist_ok=True)
    return carpeta / nombre_archivo


def archivo_mas_reciente(carpeta: Path, prefijo: str) -> Path:
    """El generador de fixtures (D2) nombra cada visor con su propio
    timestamp — acá se toma siempre el más reciente por mtime real, mismo
    criterio que ya usa `buscarPdfExpediente()` en producción (ordenar por
    nombre fue justo el bug del visor de v2.7.35, ver ese módulo)."""
    candidatos = sorted(carpeta.glob(f"{prefijo}*"), key=lambda p: p.stat().st_mtime, reverse=True)
    if not candidatos:
        raise FileNotFoundError(
            f"No se encontró ningún archivo con prefijo '{prefijo}' en {carpeta}. "
            "¿Se corrió generar-visores.js antes de capturar?"
        )
    return candidatos[0]
