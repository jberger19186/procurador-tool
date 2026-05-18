# Suite QA — Procurador SCW

Suite de pruebas automatizadas con **pytest + Playwright** para verificar todos los componentes del sistema antes de la comercialización.

## Instalación

```bash
cd tests/

# 1. Crear entorno virtual (recomendado)
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # Linux/Mac

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Instalar Chromium (para tests web y Electron)
playwright install chromium
```

## Ejecutar los tests

### Menú interactivo
```bash
python run_tests.py
```

### Por módulo
```bash
# Solo API (M1–M7, M12, M13) — no requiere browser
pytest api/ -m api -v

# Solo portales web (M8, M9) — requiere Chromium
pytest web/ -m web -v

# Solo Electron (M10) — requiere app instalada
pytest desktop/ -m electron -v

# Todo + reporte HTML
pytest --html=reports/full_report.html --self-contained-html -v
```

### Con modo headless (para CI)
```bash
pytest web/ -m web -v --headed   # ver el browser
```

## Estructura

```
tests/
├── conftest.py              # Fixtures: tokens, playwright, browser, electron
├── helpers/
│   ├── auth.py              # Login HTTP + generación JWT via SSH (fallback)
│   └── db.py                # Queries SSH psql para verificar estado en DB
├── api/
│   ├── test_m1_auth.py      # M1: Autenticación y autorización
│   ├── test_m3_register.py  # M3: Registro de usuario
│   ├── test_m4_user.py      # M4: Endpoints de usuario
│   ├── test_m5_admin.py     # M5: Endpoints de admin
│   ├── test_m6_scripts.py   # M6: Scripts cifrados y licencia
│   └── test_m13_security.py # M13: Seguridad
├── web/
│   ├── test_m8_portal.py    # M8: Portal /usuarios/
│   └── test_m9_dashboard.py # M9: Panel admin /dashboard/
├── desktop/
│   └── test_m10_electron.py # M10: App Electron
├── screenshots/             # Screenshots automáticos de tests Electron
├── reports/                 # Reportes HTML generados por pytest-html
├── pytest.ini
├── requirements.txt
└── run_tests.py             # Runner interactivo
```

## Fixtures principales

| Fixture | Scope | Descripción |
|---------|-------|-------------|
| `user_token` | session | JWT del usuario de prueba |
| `admin_token` | session | JWT del admin |
| `api_session` | session | requests.Session autenticada como usuario |
| `admin_session` | session | requests.Session autenticada como admin |
| `page` | function | Página Playwright limpia por test |
| `logged_in_user_page` | function | Página del portal /usuarios/ ya logueada |
| `logged_in_admin_page` | function | Página del /dashboard/ ya logueada como admin |
| `electron_app` | session | App Electron lanzada via Playwright |
| `electron_window` | function | Primera ventana de la app Electron |

## Tokens y autenticación

El fixture `user_token` intenta primero login HTTP normal. Si falla (rate limit, estado bloqueado, etc.), genera el JWT directamente en el servidor via SSH usando el `JWT_SECRET` real. El payload es idéntico al que genera la API: `{id, role}`.

Esto permite testear usuarios en estados bloqueados (suspended, rejected) sin depender del flujo de login.

## Requisitos para tests de Electron (M10)

La app Electron debe tener sus `node_modules` instalados:
```bash
cd electron-app/
npm install
```

El launcher de Playwright usa el binario `electron` de `node_modules/.bin/`.

## Marcadores

```bash
pytest -m api       # Solo tests de API
pytest -m web       # Solo tests de browser
pytest -m electron  # Solo tests de Electron
pytest -m slow      # Tests lentos/E2E
pytest -m "not skip_ci"  # Excluir tests que requieren sesión PJN
```
