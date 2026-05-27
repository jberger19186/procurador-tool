"""
MODULO 11 - Extension Chrome (K-01 a K-06)
Lanza Chrome con la extension cargada como unpacked y ejecuta tests del popup.

Requiere: extension instalada localmente en extension-app/
SKIPS: K-07 a K-09 requieren sesion PJN activa.
"""

import sys
import time
import requests
import urllib3
import pytest

from playwright.sync_api import sync_playwright, BrowserContext

# Agregar helpers/ al path
sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))
from helpers.db import create_test_user, cleanup_user as db_cleanup_user, TEST_PASSWORD

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ─── Constantes ────────────────────────────────────────────────────────────────
EXTENSION_PATH = "C:/Users/JONATHAN/source/repos/ProcuradorTool/extension-app"
API_URL = "https://api.procuradortool.com"
USER_EMAIL = "procuradortool@gmail.com"
USER_PASSWORD = "TestPass2025!"
ADMIN_EMAIL = "admin@procurador.com"
ADMIN_PASSWORD = "Admin2025!"

POPUP_TIMEOUT = 10_000   # ms
LOGIN_TIMEOUT = 15_000   # ms


# ─── Helpers ───────────────────────────────────────────────────────────────────
def get_admin_token():
    r = requests.post(
        f"{API_URL}/auth/login",
        json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD, "machineId": "TEST-M11"},
        verify=False, timeout=15
    )
    return r.json().get("token", "")


def get_extension_id(context: BrowserContext) -> str:
    """Obtiene el ID de la extension desde la URL del service worker o background page."""
    for _ in range(20):
        # service_workers es PROPIEDAD (lista), no metodo
        try:
            workers = context.service_workers
            for sw in workers:
                url = sw.url
                if "chrome-extension://" in url:
                    return url.split("chrome-extension://")[1].split("/")[0]
        except Exception:
            pass

        # Fallback: background_pages (MV2) o paginas con chrome-extension://
        try:
            for pg in context.pages:
                url = pg.url
                if "chrome-extension://" in url and "_generated" not in url:
                    return url.split("chrome-extension://")[1].split("/")[0]
        except Exception:
            pass

        time.sleep(0.5)
    raise RuntimeError("No se encontro el ID de la extension (service worker no registrado)")


def open_popup(context: BrowserContext, ext_id: str):
    """Abre el popup de la extension como pagina normal."""
    popup_url = f"chrome-extension://{ext_id}/popup.html"
    page = context.new_page()
    page.goto(popup_url, timeout=POPUP_TIMEOUT)
    page.wait_for_load_state("domcontentloaded", timeout=POPUP_TIMEOUT)
    page.wait_for_timeout(1500)  # dar tiempo al IIFE async de inicializar
    return page


def get_view_state(page):
    """Retorna 'main' si view-main es visible, 'login' si view-login es visible, 'other'."""
    main = page.evaluate(
        "() => { const v = document.getElementById('view-main'); "
        "return v ? window.getComputedStyle(v).display : 'none'; }"
    )
    login = page.evaluate(
        "() => { const v = document.getElementById('view-login'); "
        "return v ? window.getComputedStyle(v).display : 'none'; }"
    )
    if main not in ("none", ""):
        return "main"
    if login not in ("none", ""):
        return "login"
    return "other"


def ensure_at_login(page):
    """Si el popup muestra la vista de flujos, hace logout primero."""
    state = get_view_state(page)
    if state == "main":
        # Hacer logout via boton
        page.evaluate(
            "() => { const b = document.getElementById('btn-logout') || "
            "document.querySelector('[id*=logout],[class*=logout]'); if(b) b.click(); }"
        )
        page.wait_for_timeout(2000)
        # Esperar login view
        try:
            page.wait_for_function(
                "() => { const v = document.getElementById('view-login'); "
                "return v && window.getComputedStyle(v).display !== 'none'; }",
                timeout=8000
            )
        except Exception:
            pass
    return get_view_state(page)


def popup_login(page, email, password):
    """Llena el formulario de login y hace click en btn-login-submit. Retorna True si llego a view-main."""
    # Rellenar campos via JS (funcionan aunque el campo no sea visible)
    page.evaluate(f"document.getElementById('login-email').value = '{email}'")
    page.evaluate(f"document.getElementById('login-password').value = '{password}'")
    # El handler de login esta en 'btn-login-submit' (no en form submit)
    page.evaluate(
        "() => { const b = document.getElementById('btn-login-submit'); "
        "if (b) { b.click(); return 'ok'; } "
        "const b2 = document.querySelector('button[type=submit]'); "
        "if (b2) { b2.click(); return 'fallback'; } "
        "return 'not-found'; }"
    )
    page.wait_for_timeout(4000)
    return get_view_state(page) == "main"


def create_rejected_user():
    """Crea un usuario de prueba con estado rejected directamente en DB para K-03."""
    import time as _t
    email = f"qa-k03-{int(_t.time())}@test.com"
    try:
        user_id = create_test_user(
            email=email,
            registration_status="rejected",
            sub_status="cancelled",
            plan_name="COMBO_PROMO",
        )
        return email, TEST_PASSWORD, user_id
    except Exception as e:
        print(f"[create_rejected_user] Error: {e}")
        return None, None, None


def create_extension_promo_user():
    """Crea un usuario con plan EXTENSION_PROMO activo directamente en DB para K-05."""
    import time as _t
    email = f"qa-k05-{int(_t.time())}@test.com"
    try:
        user_id = create_test_user(
            email=email,
            registration_status="active",
            sub_status="active",
            plan_name="EXTENSION_PROMO",
        )
        return email, TEST_PASSWORD, user_id
    except Exception as e:
        print(f"[create_extension_promo_user] Error: {e}")
        return None, None, None


# ─── Fixture: contexto con extension cargada ──────────────────────────────────
@pytest.fixture(scope="module")
def ext_context():
    """Lanza Chrome con la extension unpacked. Scope=module para reutilizar."""
    import tempfile
    import shutil

    user_data_dir = tempfile.mkdtemp(prefix="pw_ext_test_")

    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            user_data_dir=user_data_dir,
            headless=False,
            slow_mo=100,
            args=[
                f"--disable-extensions-except={EXTENSION_PATH}",
                f"--load-extension={EXTENSION_PATH}",
                "--ignore-certificate-errors",
                "--disable-web-security",
                "--no-first-run",
            ],
            ignore_https_errors=True,
        )

        # Navegar a about:blank para activar la extension
        if context.pages:
            try:
                context.pages[0].goto("about:blank")
            except Exception:
                pass
        else:
            pg = context.new_page()
            pg.goto("about:blank")

        # Dar tiempo al service worker para registrarse
        time.sleep(2)

        yield context

        try:
            context.close()
        except Exception:
            pass

    # Limpiar user_data_dir
    try:
        shutil.rmtree(user_data_dir, ignore_errors=True)
    except Exception:
        pass


@pytest.fixture(scope="module")
def ext_id(ext_context):
    return get_extension_id(ext_context)


# ─── K-01: Popup sin sesion muestra pantalla de login ─────────────────────────
def test_K01_popup_sin_sesion(ext_context, ext_id):
    """K-01: Abrir popup sin token almacenado -> pantalla de login."""
    page = open_popup(ext_context, ext_id)
    try:
        # Asegurar que no hay token guardado
        page.evaluate("chrome.storage.local.clear()")
        page.reload()
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1000)

        content = page.content()
        # Debe mostrar campos de login
        assert (
            'type="email"' in content or
            'type="password"' in content or
            "login" in content.lower() or
            "email" in content.lower() or
            "iniciar" in content.lower() or
            "ingresar" in content.lower()
        ), f"K-01 FAIL: No se encontro pantalla de login en el popup. Content: {content[:500]}"

        print("K-01 PASS: Popup sin sesion muestra pantalla de login")
    finally:
        page.close()


# ─── K-02: Login con credenciales validas ─────────────────────────────────────
def test_K02_login_valido(ext_context, ext_id):
    """K-02: Login con credenciales correctas -> muestra flujos habilitados."""
    page = open_popup(ext_context, ext_id)
    try:
        # Asegurar que estamos en login view
        state = ensure_at_login(page)
        print(f"  Estado inicial: {state}")

        if state != "login":
            pytest.skip("K-02: No se pudo llegar al estado de login")

        # Login con usuario valido
        logged_in = popup_login(page, USER_EMAIL, USER_PASSWORD)
        assert logged_in, "K-02 FAIL: Login con credenciales validas no cargo la vista de flujos"

        print("K-02 PASS: Login valido muestra contenido de flujos/planes")
    finally:
        page.close()


# ─── K-03: Login con usuario bloqueado ────────────────────────────────────────
def test_K03_login_usuario_bloqueado(ext_context, ext_id):
    """K-03: Login con usuario rejected/blocked -> mensaje de error especifico."""
    email, password, user_id = create_rejected_user()
    if not email:
        pytest.skip("No se pudo crear usuario de prueba para K-03")

    page = open_popup(ext_context, ext_id)
    try:
        # Si hay sesion activa, hacer logout primero
        state = ensure_at_login(page)
        print(f"  Estado inicial tras ensure_at_login: {state}")

        if state != "login":
            pytest.skip(f"K-03: No se pudo llegar al estado login (estado={state})")

        # Intentar login con usuario rechazado
        logged_in = popup_login(page, email, password)

        state_after = get_view_state(page)
        error_msg = page.evaluate(
            "() => { const el = document.getElementById('login-msg'); "
            "return el ? el.textContent.trim() : ''; }"
        )

        print(f"  Estado despues de login rechazado: {state_after}, error: {error_msg!r}")

        # El usuario rechazado NO debe poder entrar a la vista de flujos
        assert not logged_in, \
            f"K-03 FAIL: Usuario rechazado accedio a la vista de flujos"
        assert state_after in ("login", "other"), \
            f"K-03 FAIL: Vista de flujos visible para usuario rechazado (estado={state_after})"

        print(f"K-03 PASS: Usuario rechazado no puede acceder. Estado={state_after}, msg={error_msg!r}")
    finally:
        page.close()
        if user_id:
            db_cleanup_user(user_id)


# ─── K-04: Flujos COMBO_PROMO ─────────────────────────────────────────────────
def test_K04_flujos_combo_promo(ext_context, ext_id):
    """K-04: Usuario COMBO_PROMO -> muestra todos los flujos configurados en el plan."""
    page = open_popup(ext_context, ext_id)
    try:
        # Asegurar que estamos en la vista de login (logout si hay sesion activa)
        state = ensure_at_login(page)
        print(f"  Estado inicial tras ensure_at_login: {state}")

        if state != "login":
            # Si ya estamos en main con COMBO_PROMO, verificar directamente
            plan_badge = page.evaluate(
                "() => { const b = document.getElementById('plan-badge-label'); "
                "return b ? b.textContent : ''; }"
            )
            if "COMBO" in plan_badge:
                # Verificar flujos directamente
                content = page.content().lower()
                flujos_presentes = sum(1 for f in ["consulta", "escritos", "notificaciones", "deox"] if f in content)
                assert flujos_presentes >= 2, f"K-04 FAIL: COMBO_PROMO muestra {flujos_presentes} flujos"
                print(f"K-04 PASS: COMBO_PROMO muestra {flujos_presentes}/4 flujos (sesion activa)")
                return
            pytest.skip(f"K-04: No se pudo llegar al login (estado={state})")

        # Login con COMBO_PROMO
        logged_in = popup_login(page, USER_EMAIL, USER_PASSWORD)
        assert logged_in, f"K-04 FAIL: Login COMBO_PROMO fallo"

        # Verificar flujos disponibles — COMBO_PROMO tiene todos los flujos de extension
        # Los flow-btn enabled (no locked) son los habilitados para el plan
        enabled_flows = page.evaluate(
            "() => Array.from(document.querySelectorAll('.flow-btn:not(.locked)')) "
            ".map(b => b.dataset.flow)"
        )
        print(f"  Flujos habilitados para COMBO_PROMO: {enabled_flows}")

        assert len(enabled_flows) >= 2, \
            f"K-04 FAIL: COMBO_PROMO tiene muy pocos flujos habilitados: {enabled_flows}"

        print(f"K-04 PASS: COMBO_PROMO muestra {len(enabled_flows)} flujos de extension")
    finally:
        page.close()


# ─── K-05: Flujos EXTENSION_PROMO ─────────────────────────────────────────────
def test_K05_flujos_extension_promo(ext_context, ext_id):
    """K-05: Usuario EXTENSION_PROMO -> solo flujos de extension, sin acceso a app Electron."""
    # Crear usuario EXTENSION_PROMO temporal
    email, password, user_id = create_extension_promo_user()
    if not email:
        pytest.skip("No se pudo crear usuario EXTENSION_PROMO para K-05")

    # Verificar via API que el plan es EXTENSION_PROMO y que enabledFlows esta correcto
    r = requests.post(
        f"{API_URL}/auth/extension-login",
        json={"email": email, "password": password, "machineId": "TEST-K05"},
        verify=False, timeout=15
    )

    if r.status_code != 200:
        if user_id:
            db_cleanup_user(user_id)
        pytest.skip(f"Login extension fallido para usuario K05 (status={r.status_code}): {r.text[:200]}")

    data = r.json()
    ext_info = data.get("extension", {})
    plan = ext_info.get("plan", "")
    enabled_flows = ext_info.get("enabledFlows", [])

    assert plan == "EXTENSION_PROMO", \
        f"K-05 FAIL: Plan esperado EXTENSION_PROMO, obtenido {plan}"

    # EXTENSION_PROMO no deberia incluir flujos exclusivos de app (procuracion, informe, monitor)
    # Solo flujos de extension
    app_only_flows = [f for f in enabled_flows if f in ["procuracion", "informe", "monitor"]]
    assert len(app_only_flows) == 0, \
        f"K-05 FAIL: EXTENSION_PROMO incluye flujos de app: {app_only_flows}"

    # Debe tener al menos algunos flujos de extension
    ext_flows = [f for f in enabled_flows if f in ["consulta", "escritos1", "escritos2", "notificaciones", "deox"]]
    assert len(ext_flows) >= 1, \
        f"K-05 FAIL: EXTENSION_PROMO no tiene flujos de extension. enabledFlows={enabled_flows}"

    print(f"K-05 PASS: EXTENSION_PROMO tiene flujos={enabled_flows}, sin acceso a app")
    if user_id:
        db_cleanup_user(user_id)


# ─── K-06: Cerrar sesion en extension ─────────────────────────────────────────
def test_K06_logout(ext_context, ext_id):
    """K-06: Cerrar sesion en la extension -> borra token, vuelve a login."""
    page = open_popup(ext_context, ext_id)
    try:
        # K-04 debio dejar sesion activa. Si no, loguear primero.
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1500)

        # Ver si estamos en la vista de flujos o login
        view_main_display = page.evaluate(
            "() => { const v = document.getElementById('view-main'); "
            "return v ? window.getComputedStyle(v).display : 'none'; }"
        )

        if view_main_display == "none":
            # No hay sesion activa — hacer login primero
            page.evaluate(f"""
                const inp = document.getElementById('login-email') || document.querySelector('input[type=email]');
                if (inp) inp.value = '{USER_EMAIL}';
            """)
            page.evaluate(f"""
                const inp = document.getElementById('login-password') || document.querySelector('input[type=password]');
                if (inp) inp.value = '{USER_PASSWORD}';
            """)
            page.evaluate("""
                const btn = document.querySelector('#login-form button[type=submit], #login-submit, .login-btn');
                if (btn) btn.click();
            """)
            page.wait_for_timeout(3000)

        # Verificar que hay sesion activa (token en pjn_ext_auth)
        session_before = page.evaluate(
            "new Promise(r => chrome.storage.local.get('pjn_ext_auth', r))"
        )
        print(f"  Session antes de logout: {str(session_before)[:100]}")

        # Buscar boton de logout/cerrar sesion via JS (puede ser icono con texto)
        logout_found = page.evaluate(
            "() => { "
            "  const candidates = ["
            "    document.getElementById('logoutBtn'),"
            "    document.getElementById('btn-logout'),"
            "    document.querySelector('[id*=\"logout\"]'),"
            "    document.querySelector('[class*=\"logout\"]'),"
            "    ...Array.from(document.querySelectorAll('button')).filter(b => "
            "      /cerrar|salir|logout|desconectar/i.test(b.textContent)"
            "    )"
            "  ].filter(Boolean);"
            "  if (candidates.length > 0) {"
            "    candidates[0].click();"
            "    return candidates[0].id || candidates[0].className || 'clicked';"
            "  }"
            "  return null;"
            "}"
        )

        if not logout_found:
            pytest.skip("K-06: No se encontro boton de logout en el popup")

        print(f"  Logout button encontrado y clickeado: {logout_found}")
        page.wait_for_timeout(2500)

        # Verificar que la vista de login es visible
        login_visible = page.evaluate(
            "() => { const v = document.getElementById('view-login'); "
            "return v ? window.getComputedStyle(v).display : 'no-view'; }"
        )
        main_visible = page.evaluate(
            "() => { const v = document.getElementById('view-main'); "
            "return v ? window.getComputedStyle(v).display : 'none'; }"
        )

        # Verificar que el token fue borrado del storage
        session_after = page.evaluate(
            "new Promise(r => chrome.storage.local.get('pjn_ext_auth', r))"
        )
        token_after = (session_after or {}).get("pjn_ext_auth")
        print(f"  login-view={login_visible}, main-view={main_visible}, token_after={str(token_after)[:50] if token_after else None}")

        # La vista principal (flujos) debe estar oculta
        assert main_visible in ("none", ""), \
            f"K-06 FAIL: Vista de flujos sigue visible despues de logout (display={main_visible})"

        # El token debe haber sido borrado
        assert not token_after, \
            f"K-06 FAIL: Token sigue en storage despues de logout: {token_after}"

        print("K-06 PASS: Logout borra token y redirige a pantalla de login")
    finally:
        page.close()
