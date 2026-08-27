"""
tests/daily/config.py — constantes de la prueba diaria.

Fuente de verdad de nombres/rutas/endpoints. Si algo de esto cambia en el
producto (nombres de archivo, endpoints, costos por flujo), se toca ACÁ y no
se sale a buscarlo en cada módulo.
"""

import os

API_URL = "https://api.procuradortool.com"
VERIFICATION_CUIT = "27320694359"
VERIFICATION_USER_ID = 250  # procuradortool@gmail.com

# Costos documentados en CLAUDE.md / Etapa 1.5 F2 (routes/admin.js VERIF_COSTO_PRUEBA).
# monitor_novedades es dinámico: costoPorPrueba = partesActivas (lo informa el propio
# endpoint de cupo, no se hardcodea acá).
COSTO_PRUEBA = {
    "proc": 1,
    "batch": 1,
    "informe": 3,   # compartido entre informe individual y por lote
    "global": 6,
}

# Carpeta de descargas de la cuenta de verificación (por CUIT).
DESCARGAS_DIR = os.path.join(
    os.environ.get("APPDATA", ""), "procurador-electron", "usuarios",
    VERIFICATION_CUIT, "descargas",
)

# Prefijos de archivo por flujo (ver CLAUDE.md, sección de nombres unificados v2.7.33).
PREFIJOS_VISOR = {
    "proc":     "procurar-individual_visor_",
    "batch":    "procurar-lote_visor_",
    "informe":  "informe-individual_visor_",
    "informe_lote": "informe-lote_visor_",
    "monitor":  "monitor-novedades_visor_",
    "monitor_inicial": "monitor-inicial_visor_",
}

NOMBRES_FLUJO = {
    "proc": "Procuración",
    "batch": "Procuración por lote",
    "informe": "Informe individual",
    "informe_lote": "Informe por lote",
    "monitor": "Monitor — novedades",
    "monitor_inicial": "Monitor — consulta inicial",
}

APP_PROCESS_NAME = "Procurador SCW"
APP_EXE_PATH = os.path.join(
    os.environ.get("LOCALAPPDATA", ""), "Programs", "Procurador SCW", "Procurador SCW.exe",
)

# Fixture de expedientes para Procuración por lote e Informe por lote — mismo
# archivo que usa el procedimiento manual (dev-tools/batch-verificacion.txt).
BATCH_EXPEDIENTES = ["FCR 18745/2017", "FCR 18745/2018"]
INFORME_INDIVIDUAL_EXPEDIENTE = "FCR 18745/2017"

# Defaults del modal de Informe — mismos valores que trae el HTML por defecto
# (index.html: #informe-movact/#informe-movhist), sin secciones opcionales.
CONFIG_INFORME_DEFAULT = {
    "movimientosActuales": "mamhref",   # "Movimientos + href"
    "movimientosHistoricos": "mhn",     # "Ninguno"
    "intervinientes": False,
    "vinculados": False,
    "recursos": False,
    "notas": False,
}

# Parte descartable del flujo 6 (§6.6 de la propuesta) — mismos datos que la
# DON COCHO real, se crea y se borra dentro de la gracia de 24h en cada corrida.
PARTE_DESCARTABLE = {
    "nombre": "DON COCHO",
    "jurisdiccionCodigo": "14",
    "jurisdiccionSigla": "FCR",
}
