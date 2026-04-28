// ============ ESTADO ============
let isLoading = false;

// ============ INICIALIZACIÓN ============
document.addEventListener('DOMContentLoaded', async () => {
    console.log('🔐 Pantalla de login cargada');

    // Botones de ventana (frameless)
    document.getElementById('loginMinBtn')
        ?.addEventListener('click', () => window.electronAPI?.minimizeWindow());
    document.getElementById('loginCloseBtn')
        ?.addEventListener('click', () => window.electronAPI?.closeWindow());

    // Verificar que electronAPI esté disponible
    if (typeof window.electronAPI === 'undefined') {
        console.error('❌ electronAPI no está disponible');
        showError('Error: API de Electron no disponible. Reinicie la aplicación.');
        return;
    }

    console.log('✅ electronAPI disponible');

    // Cargar Machine ID
    await loadMachineId();

    // Verificar conexión al backend
    await checkBackendConnection();

    // Cargar cuentas recordadas (antes del setup para que el focus sea correcto)
    try { await loadRememberedCredentials(); } catch (_) {}

    // Setup form handler — siempre se ejecuta
    setupLoginForm();

    // Focus en email o en password si el email ya fue completado
    const emailEl = document.getElementById('email');
    if (emailEl.value) {
        document.getElementById('password').focus();
    } else {
        emailEl.focus();
    }
});

// ============ CUENTAS GUARDADAS (multi-cuenta) ============

// Lee el array crudo desde safeStorage (sin migración ni side effects)
async function readAccountsRaw() {
    try {
        const raw = await window.electronAPI.safeStorageGet('psc_accounts');
        if (!raw) return [];
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

// Escribe el array crudo en safeStorage
async function writeAccountsRaw(accounts) {
    await window.electronAPI.safeStorageSet('psc_accounts', JSON.stringify(accounts));
}

// Migra formato anterior psc_remember → psc_accounts (solo una vez)
async function migrateOldFormat() {
    try {
        const old = await window.electronAPI.safeStorageGet('psc_remember');
        if (!old) return;
        const data = JSON.parse(old);
        if (data.email && data.password) {
            const accounts = await readAccountsRaw();
            if (!accounts.find(a => a.email === data.email)) {
                accounts.push({ email: data.email, password: data.password });
                await writeAccountsRaw(accounts);
            }
        }
        await window.electronAPI.safeStorageDelete('psc_remember');
    } catch (_) {}
}

async function saveAccount(email, password) {
    const accounts = await readAccountsRaw();
    const idx = accounts.findIndex(a => a.email === email);
    if (idx >= 0) {
        accounts[idx].password = password;
    } else {
        accounts.push({ email, password });
    }
    await writeAccountsRaw(accounts);
}

async function removeAccount(email) {
    const accounts = await readAccountsRaw();
    await writeAccountsRaw(accounts.filter(a => a.email !== email));
}

async function loadRememberedCredentials() {
    try {
        await migrateOldFormat();
    } catch (_) {}

    let accounts = [];
    try {
        accounts = await readAccountsRaw();
    } catch (_) {}

    if (accounts.length === 0) return;

    const section = document.getElementById('savedAccountsSection');
    const list    = document.getElementById('savedAccountsList');
    section.style.display = '';
    list.innerHTML = '';

    // Pre-cargar el primer usuario guardado
    document.getElementById('email').value    = accounts[0].email;
    document.getElementById('password').value = accounts[0].password;
    document.getElementById('rememberMe').checked = true;

    accounts.forEach(acc => {
        const chip = document.createElement('div');
        chip.style.cssText = 'display:flex;align-items:center;gap:4px;background:#f3f4f6;border:1px solid #e5e7eb;border-radius:20px;padding:4px 10px;font-size:12px;cursor:pointer;transition:background 0.15s;';
        chip.innerHTML = `<span>${acc.email}</span><button data-email="${acc.email}" title="Olvidar" style="background:none;border:none;cursor:pointer;color:#9ca3af;font-size:14px;line-height:1;padding:0 0 0 2px;">&times;</button>`;

        // Clic en el chip → pre-completar formulario
        chip.addEventListener('click', (e) => {
            if (e.target.tagName === 'BUTTON') return;
            document.getElementById('email').value    = acc.email;
            document.getElementById('password').value = acc.password;
            document.getElementById('rememberMe').checked = true;
            document.getElementById('password').focus();
        });

        // Clic en × → olvidar cuenta
        chip.querySelector('button').addEventListener('click', async (e) => {
            e.stopPropagation();
            await removeAccount(acc.email);
            chip.remove();
            const remaining = list.querySelectorAll('div');
            if (remaining.length === 0) section.style.display = 'none';
        });

        list.appendChild(chip);
    });
}

async function saveOrClearRemembered(email, password, remember) {
    if (remember) {
        await saveAccount(email, password);
        console.log('💾 Cuenta guardada cifrada:', email);
    } else {
        await removeAccount(email);
        console.log('🗑️ Cuenta olvidada:', email);
    }
}

// ============ CARGAR MACHINE ID ============
async function loadMachineId() {
    try {
        console.log('📋 Obteniendo Machine ID...');
        const machineId = await window.electronAPI.getMachineId();
        const display = document.getElementById('machineIdDisplay');

        if (machineId) {
            // Mostrar solo primeros y últimos caracteres
            const short = machineId.substring(0, 8) + '...' + machineId.substring(machineId.length - 8);
            display.textContent = short;
            display.title = machineId;
            console.log('✅ Machine ID obtenido:', short);
        } else {
            display.textContent = 'Error al obtener ID';
            console.warn('⚠️ Machine ID no disponible');
        }
    } catch (error) {
        console.error('❌ Error obteniendo machine ID:', error);
        document.getElementById('machineIdDisplay').textContent = 'No disponible';
    }
}

// ============ VERIFICAR CONEXIÓN AL BACKEND ============
async function checkBackendConnection() {
    const statusEl = document.getElementById('connectionStatus');

    try {
        console.log('🔌 Verificando conexión al backend...');
        const result = await window.electronAPI.checkConnection();

        if (result.success) {
            statusEl.textContent = '✅ Conectado al servidor';
            statusEl.classList.add('connected');
            statusEl.classList.remove('error');
            console.log('✅ Conexión al backend exitosa');
        } else {
            statusEl.textContent = '⚠️ Sin conexión al servidor';
            statusEl.classList.add('error');
            statusEl.classList.remove('connected');
            console.warn('⚠️ Backend no responde');
        }
    } catch (error) {
        statusEl.textContent = '❌ Error de conexión';
        statusEl.classList.add('error');
        statusEl.classList.remove('connected');
        console.error('❌ Error conectando al backend:', error);
    }
}

// ============ SETUP FORM ============
function setupLoginForm() {
    const form = document.getElementById('loginForm');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (isLoading) return;

        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        // Validaciones básicas
        if (!email || !password) {
            showError('Por favor complete todos los campos');
            return;
        }

        if (!isValidEmail(email)) {
            showError('Email inválido');
            return;
        }

        await handleLogin(email, password);
    });
}

// ============ HANDLE LOGIN ============
async function handleLogin(email, password) {
    try {
        setLoading(true);
        hideError();

        console.log('🔐 Intentando login...');

        const result = await window.electronAPI.login(email, password);

        if (result.success) {
            console.log('✅ Login exitoso');
            showSuccess('¡Bienvenido! Cargando aplicación...');

            // Guardar o limpiar credenciales según checkbox
            const remember = document.getElementById('rememberMe').checked;
            await saveOrClearRemembered(email, password, remember);

            // Esperar un momento para que el usuario vea el mensaje
            await new Promise(resolve => setTimeout(resolve, 1000));

            // El main.js se encargará de cambiar a la ventana principal

        } else {
            console.error('❌ Login fallido:', result.error);

            // Mensajes de error específicos
            if (result.code === 'EMAIL_NOT_VERIFIED') {
                showErrorHTML(
                    '📧 Debés verificar tu email antes de ingresar. ' +
                    'Revisá tu casilla o <a href="https://api.procuradortool.com/usuarios/" ' +
                    'target="_blank" style="color:inherit;font-weight:700;text-decoration:underline;">' +
                    'ingresá al portal</a> para reenviar el link.'
                );
            } else {
                let errorMsg = 'Error al iniciar sesión';

                if (result.error.includes('Credenciales inválidas')) {
                    errorMsg = 'Email o contraseña incorrectos';
                } else if (result.error.includes('vinculada a otro dispositivo')) {
                    errorMsg = 'Esta cuenta está vinculada a otro dispositivo. Contacte al administrador.';
                } else if (result.error.includes('suscripción')) {
                    errorMsg = 'No tiene una suscripción activa. Contacte al administrador.';
                } else if (result.error.includes('conexión') || result.error.includes('ECONNREFUSED')) {
                    errorMsg = 'No se puede conectar al servidor. Verifique su conexión.';
                } else {
                    errorMsg = result.error;
                }

                showError(errorMsg);
            }
            setLoading(false);
        }

    } catch (error) {
        console.error('❌ Error inesperado en login:', error);
        showError('Error inesperado. Intente nuevamente.');
        setLoading(false);
    }
}

// ============ UI HELPERS ============
function setLoading(loading) {
    isLoading = loading;

    const button = document.getElementById('loginButton');
    const spinner = document.getElementById('loadingSpinner');
    const form = document.getElementById('loginForm');

    if (loading) {
        button.style.display = 'none';
        spinner.style.display = 'block';
        form.querySelectorAll('input').forEach(input => input.disabled = true);
    } else {
        button.style.display = 'flex';
        spinner.style.display = 'none';
        form.querySelectorAll('input').forEach(input => input.disabled = false);
    }
}

function showError(message) {
    const errorEl = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');

    errorText.textContent = message;
    errorEl.style.display = 'flex';

    // Auto-hide después de 5 segundos
    setTimeout(() => {
        hideError();
    }, 5000);
}

function hideError() {
    const errorEl = document.getElementById('errorMessage');
    errorEl.style.display = 'none';
}

function showErrorHTML(html) {
    const errorEl   = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    errorText.innerHTML = html;
    errorEl.style.display = 'flex';
    setTimeout(() => { hideError(); errorText.innerHTML = ''; }, 10000);
}

function showSuccess(message) {
    const errorEl = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');

    errorEl.style.background = 'rgba(16, 185, 129, 0.2)';
    errorEl.style.borderColor = '#10b981';
    errorEl.style.color = '#10b981';

    errorText.textContent = message;
    errorEl.style.display = 'flex';
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// ============ KEYBOARD SHORTCUTS ============
document.addEventListener('keydown', (e) => {
    // ESC para limpiar form (sin borrar lo guardado en localStorage)
    if (e.key === 'Escape') {
        document.getElementById('email').value = '';
        document.getElementById('password').value = '';
        document.getElementById('rememberMe').checked = false;
        document.getElementById('email').focus();
        hideError();
    }
});