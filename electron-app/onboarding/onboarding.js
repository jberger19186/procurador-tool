/**
 * onboarding.js — Renderer logic for the Onboarding Wizard
 * Runs inside the onboarding BrowserWindow (context-isolated, preload: preload-onboarding.js)
 */

// ── State ──────────────────────────────────────────────────────────────────
let currentStep = 1;
const TOTAL_STEPS = 4;
let stepStatus = { 1: false, 2: false, 3: false, 4: false };
let loggedIn = false;
let chromeFound = false;
let profileExists = false;

// ── DOM refs ───────────────────────────────────────────────────────────────
const btnNext   = document.getElementById('btnNext');
const btnBack   = document.getElementById('btnBack');
const btnSkip   = document.getElementById('btnSkip');
const mainBody  = document.getElementById('mainBody');
const mainFooter = document.getElementById('mainFooter');
const stepDone  = document.getElementById('stepDone');

// ── Init ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    updateStepUI();
    runStep1();
    await loadRememberedCredentials();

    btnNext.addEventListener('click', goNext);
    btnBack.addEventListener('click', goBack);
    btnSkip.addEventListener('click', skipStep);

    document.getElementById('loginPassword')
        .addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('loginEmail').addEventListener('input', updateStepUI);
    document.getElementById('loginPassword').addEventListener('input', updateStepUI);

    document.getElementById('btnSetupPerfil')
        .addEventListener('click', doSetupProfile);
    document.getElementById('btnConfirmPerfil')
        .addEventListener('click', async () => {
            profileExists = true;
            document.getElementById('s3ConfirmRow').style.display = 'none';
            document.getElementById('s3ProfileInstructions').style.display = 'none';
            // Mostrar sección de extensión (secuencial: Chrome ya está cerrado)
            document.getElementById('s3ExtSection').style.display = 'block';
            // Inicializar toggle con el valor guardado
            const habilitada = await onboardingAPI.getExtensionEnabled();
            _aplicarToggleOB(habilitada);
            setTimeout(() => {
                document.getElementById('s3ExtSection').scrollIntoView({ behavior: 'smooth', block: 'center' });
            }, 150);
        });

    document.getElementById('toggleExtOnboarding')
        .addEventListener('change', async (e) => {
            const val = e.target.checked;
            _aplicarToggleOB(val);
            await onboardingAPI.setExtensionEnabled(val);
            // Si se habilita y el paso ya estaba done, no hacer nada especial
            // Si se deshabilita, marcar el paso como completo igual (opcional)
            if (!val) setStepDone(3);
        });

    // Botón instalar extensión → Chrome Web Store
    document.getElementById('btnInstalarExtOB')
        ?.addEventListener('click', () => {
            onboardingAPI.openExternalUrl(
                'https://chromewebstore.google.com/detail/pjn-%E2%80%93-automatizaci%C3%B3n/aodnfemklhciagaglpggnclmbdhnhbme'
            );
            // Marcar step 3 como completado cuando el usuario hace clic en instalar
            setStepDone(3);
        });
    document.getElementById('btnRecreatePerfil')
        ?.addEventListener('click', doRecreateProfile);
    document.getElementById('btnAgregarPwd')
        ?.addEventListener('click', doAgregarPassword);
    document.getElementById('btnTestPJN')
        ?.addEventListener('click', doTestPJN);
    document.getElementById('btnTour')
        ?.addEventListener('click', () => onboardingAPI.complete({ loggedIn, showTour: true }));
    document.getElementById('btnEnterApp')
        ?.addEventListener('click', () => onboardingAPI.complete({ loggedIn, showTour: false }));
});

// ── Navigation ─────────────────────────────────────────────────────────────
function goNext() {
    if (currentStep === 2 && !loggedIn) { doLogin(); return; }
    if (currentStep < TOTAL_STEPS) {
        currentStep++;
        updateStepUI();
        if (currentStep === 3) runStep3();
    } else {
        showCompletion();
    }
}

function goBack() {
    if (currentStep > 1) {
        currentStep--;
        updateStepUI();
    }
}

function skipStep() {
    setStepDone(currentStep, true); // mark as skipped (still "done" for navigation)
    if (currentStep < TOTAL_STEPS) {
        currentStep++;
        updateStepUI();
        if (currentStep === 3) runStep3();
    } else {
        showCompletion();
    }
}

function setStepDone(n, skipped = false) {
    stepStatus[n] = true;
    const dot = document.getElementById(`dot${n}`);
    if (dot) {
        dot.classList.remove('active');
        dot.classList.add('done');
        dot.textContent = skipped ? '↷' : '✓';
    }
    if (n < TOTAL_STEPS) {
        const line = document.getElementById(`line${n}`);
        if (line && !skipped) line.classList.add('done');
    }
    btnNext.disabled = false;
}

function updateStepUI() {
    // Activate correct step panel
    for (let i = 1; i <= TOTAL_STEPS; i++) {
        const el = document.getElementById(`step${i}`);
        if (el) el.classList.toggle('active', i === currentStep);
        const dot = document.getElementById(`dot${i}`);
        if (dot && !dot.classList.contains('done')) {
            dot.classList.toggle('active', i === currentStep);
        }
    }

    btnBack.style.display = currentStep > 1 ? 'inline-flex' : 'none';

    if (currentStep === 2 && !loggedIn) {
        // Habilitado cuando ambos campos tienen contenido
        const emailOk = document.getElementById('loginEmail').value.trim().length > 0;
        const passOk  = document.getElementById('loginPassword').value.length > 0;
        btnNext.disabled = !(emailOk && passOk);
    } else {
        btnNext.disabled = !stepStatus[currentStep];
    }

    // Step-specific skip label / visibility
    const skippable = [3, 4];
    btnSkip.style.display = skippable.includes(currentStep) ? 'inline-flex' : 'none';

    // Next button label
    if (currentStep === 2) {
        btnNext.textContent = loggedIn ? 'Continuar →' : 'Iniciar sesión';
    } else if (currentStep === TOTAL_STEPS) {
        btnNext.textContent = 'Finalizar →';
    } else {
        btnNext.textContent = 'Continuar →';
    }
}

function showCompletion() {
    mainBody.style.display = 'none';
    mainFooter.style.display = 'none';
    document.getElementById('stepIndicator').style.display = 'none';
    stepDone.classList.add('active');
}

// ── Step 1: Backend connection ─────────────────────────────────────────────
async function runStep1() {
    setS1Checking();
    try {
        const res = await onboardingAPI.checkConnection();
        if (res.success) {
            setS1Ok('Servidor conectado', 'La comunicación con el backend es correcta.');
            setStepDone(1);
        } else {
            setS1Error(res.error || 'No se pudo conectar al servidor.');
        }
    } catch (e) {
        setS1Error(e.message);
    }
}

function setS1Checking() {
    const icon = document.getElementById('s1Icon');
    icon.textContent = '⏳';
    icon.className = 'ob-status-icon checking';
    document.getElementById('s1Title').textContent = 'Verificando conexión...';
    document.getElementById('s1Detail').textContent = 'Conectando con el servidor';
    document.getElementById('s1Error').classList.remove('visible');
    btnNext.disabled = true;
}

function setS1Ok(title, detail) {
    const icon = document.getElementById('s1Icon');
    icon.textContent = '✅';
    icon.className = 'ob-status-icon ok';
    document.getElementById('s1Title').textContent = title;
    document.getElementById('s1Detail').textContent = detail;
}

function setS1Error(msg) {
    const icon = document.getElementById('s1Icon');
    icon.textContent = '❌';
    icon.className = 'ob-status-icon error';
    document.getElementById('s1Title').textContent = 'Sin conexión al servidor';
    document.getElementById('s1Detail').textContent = 'Verificá tu internet o contactá al administrador.';
    const errEl = document.getElementById('s1Error');
    errEl.textContent = msg;
    errEl.classList.add('visible');
    // Add retry button if not already present
    if (!document.getElementById('btnRetryConn')) {
        const btn = document.createElement('button');
        btn.id = 'btnRetryConn';
        btn.className = 'ob-btn ob-btn-secondary';
        btn.textContent = '↺ Reintentar';
        btn.style.alignSelf = 'flex-start';
        btn.onclick = runStep1;
        document.getElementById('step1').appendChild(btn);
    }
}

// ── Step 2: Remembered credentials ────────────────────────────────────────
async function loadRememberedCredentials() {
    try {
        const raw = await window.onboardingAPI.safeStorageGet('psc_remember');
        if (!raw) return;
        const data = JSON.parse(raw);
        if (data.email)    document.getElementById('loginEmail').value = data.email;
        if (data.password) document.getElementById('loginPassword').value = data.password;
        document.getElementById('loginRemember').checked = true;
    } catch (_) {
        await window.onboardingAPI.safeStorageDelete('psc_remember');
    }
}

async function saveOrClearRemembered(email, password, remember) {
    if (remember) {
        await window.onboardingAPI.safeStorageSet('psc_remember', JSON.stringify({ email, password }));
    } else {
        await window.onboardingAPI.safeStorageDelete('psc_remember');
    }
}

function showS2Success(email) {
    // Ocultar formulario y mostrar card de éxito
    document.getElementById('loginEmail').closest('.ob-form-group').style.display = 'none';
    document.getElementById('loginPassword').closest('.ob-form-group').style.display = 'none';
    document.getElementById('loginRemember').parentElement.style.display = 'none';

    const card = document.createElement('div');
    card.className = 'ob-status-card';
    card.innerHTML = `
        <div class="ob-status-icon ok" style="animation:popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)">✅</div>
        <div class="ob-status-text">
            <strong>Sesión iniciada correctamente</strong>
            <span>${email}</span>
        </div>
    `;
    document.getElementById('s2Error').before(card);
}

// ── Step 2: Login ──────────────────────────────────────────────────────────
async function doLogin() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('s2Error');

    if (!email || !password) {
        errEl.textContent = 'Completá el correo y la contraseña.';
        errEl.classList.add('visible');
        return;
    }

    btnNext.disabled = true;
    btnNext.textContent = 'Iniciando sesión...';
    errEl.classList.remove('visible');

    const remember = document.getElementById('loginRemember').checked;

    try {
        const res = await onboardingAPI.login(email, password);
        if (res.success) {
            await saveOrClearRemembered(email, password, remember);
            loggedIn = true;
            // Mostrar confirmación visual antes de habilitar continuar
            showS2Success(email);
            setStepDone(2);
            updateStepUI();
        } else {
            errEl.textContent = res.error || 'Credenciales incorrectas.';
            errEl.classList.add('visible');
            btnNext.disabled = false;
            btnNext.textContent = 'Iniciar sesión';
        }
    } catch (e) {
        errEl.textContent = e.message;
        errEl.classList.add('visible');
        btnNext.disabled = false;
        btnNext.textContent = 'Iniciar sesión';
    }
}

// ── Step 3: Chrome profile ─────────────────────────────────────────────────
async function runStep3() {
    const chromeCrd = document.getElementById('s3ChromeCard');
    const profileCrd = document.getElementById('s3ProfileCard');
    const actionsDiv = document.getElementById('s3Actions');
    const notFound   = document.getElementById('s3ChromeNotFound');

    chromeCrd.style.display = '';
    profileCrd.style.display = 'none';
    actionsDiv.style.display = 'none';
    notFound.style.display = 'none';

    // Check Chrome
    setS3Chrome('checking', '⏳', 'Detectando Google Chrome...', 'Buscando en rutas estándar');
    const chromeRes = await onboardingAPI.checkChrome();
    chromeFound = chromeRes.found;

    if (!chromeFound) {
        setS3Chrome('error', '❌', 'Chrome no encontrado', '');
        notFound.style.display = 'block';
        btnNext.disabled = true;
        btnSkip.style.display = 'none'; // can't skip — Chrome is required
        return;
    }

    const chromeName = chromeRes.path.split('\\').pop();
    setS3Chrome('ok', '✅', 'Google Chrome detectado', chromeRes.path);

    // Check profile
    profileCrd.style.display = '';
    setS3Profile('checking', '⏳', 'Verificando perfil dedicado...', '');
    const profileRes = await onboardingAPI.checkProfile();
    profileExists = profileRes.exists;

    if (profileExists) {
        setS3Profile('ok', '✅', 'Perfil dedicado encontrado', profileRes.path);
        document.getElementById('btnRecreatePerfil').style.display = 'inline-flex';
        setStepDone(3);
    } else {
        setS3Profile('warn', '⚠️', 'Perfil aún no configurado', 'Presioná el botón para crear el perfil dedicado.<br><span style="line-height:1.3;display:block;">Chrome se abrirá — una vez cargada la página podés cerrarlo para continuar.</span>');
        actionsDiv.style.display = 'block';
    }
}

function setS3Chrome(state, icon, title, detail) {
    const el = document.getElementById('s3ChromeIcon');
    el.textContent = icon;
    el.className = `ob-status-icon ${state}`;
    document.getElementById('s3ChromeTitle').textContent = title;
    document.getElementById('s3ChromeDetail').textContent = detail;
}

function setS3Profile(state, icon, title, detail) {
    const el = document.getElementById('s3ProfileIcon');
    el.textContent = icon;
    el.className = `ob-status-icon ${state}`;
    document.getElementById('s3ProfileTitle').textContent = title;
    document.getElementById('s3ProfileDetail').innerHTML = detail;
}

async function doSetupProfile() {
    document.getElementById('btnSetupPerfil').disabled = true;
    document.getElementById('btnSetupPerfil').textContent = 'Abriendo Chrome...';
    document.getElementById('s3Error').classList.remove('visible');

    const res = await onboardingAPI.setupProfile();
    if (res.success) {
        setS3Profile('ok', '✅', 'Perfil creado — Chrome abierto', 'Iniciá sesión en scw.pjn.gov.ar y guardá la contraseña en Chrome. Cerrá el navegador para continuar.');
        document.getElementById('s3Actions').style.display = 'none';
        document.getElementById('s3ProfileInstructions').style.display = 'block';
        document.getElementById('s3ConfirmRow').style.display = 'block';
        setTimeout(() => {
            document.getElementById('s3ConfirmRow').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
    } else {
        const errEl = document.getElementById('s3Error');
        errEl.textContent = res.error || 'No se pudo crear el perfil.';
        errEl.classList.add('visible');
        document.getElementById('btnSetupPerfil').disabled = false;
        document.getElementById('btnSetupPerfil').textContent = '🔧 Crear perfil de Chrome';
    }
}

async function doRecreateProfile() {
    document.getElementById('btnRecreatePerfil').disabled = true;
    document.getElementById('btnRecreatePerfil').textContent = 'Recreando...';

    const res = await onboardingAPI.recreateProfile();
    if (res.success) {
        setS3Profile('ok', '✅', 'Perfil recreado — Chrome abierto', 'Iniciá sesión en scw.pjn.gov.ar y guardá la contraseña en Chrome. Cerrá el navegador para continuar.');
        document.getElementById('s3ProfileInstructions').style.display = 'block';
        document.getElementById('s3ConfirmRow').style.display = 'block';
        btnNext.disabled = true; // require confirmation
        setTimeout(() => {
            document.getElementById('s3ConfirmRow').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 150);
    } else {
        document.getElementById('btnRecreatePerfil').disabled = false;
        document.getElementById('btnRecreatePerfil').textContent = '↺ Recrear';
    }
}

// ── Extensión Chrome (step 3 — post perfil) ─────────────────────────────────

function _aplicarToggleOB(habilitada) {
    const chk   = document.getElementById('toggleExtOnboarding');
    const track = document.getElementById('toggleExtTrack');
    const thumb = document.getElementById('toggleExtThumb');
    const label = document.getElementById('toggleExtLabelOB');
    const body  = document.getElementById('s3ExtBody');
    if (!chk) return;
    chk.checked            = habilitada;
    track.style.background = habilitada ? '#3b82f6' : '#cbd5e1';
    thumb.style.left       = habilitada ? '21px' : '3px';
    label.textContent      = habilitada
        ? 'Habilitada — instalá desde Chrome Web Store'
        : 'Deshabilitada — podés instalarla más tarde';
    body.style.display     = habilitada ? '' : 'none';
    // Si se deshabilita, el paso puede continuar igual
    if (!habilitada) document.getElementById('btnNext').disabled = false;
}

// ── Step 4: PJN password ───────────────────────────────────────────────────
async function doAgregarPassword() {
    const btn = document.getElementById('btnAgregarPwd');
    btn.disabled = true;
    btn.textContent = 'Abriendo...';
    const res = await onboardingAPI.agregarPassword();
    btn.disabled = false;
    btn.textContent = 'Agregar';
    showS4Status(res.success ? 'ok' : 'error',
        res.success ? '✅' : '❌',
        res.success ? 'Chrome abierto correctamente' : 'No se pudo abrir Chrome',
        res.success ? 'Guardá la contraseña en Chrome y cerralo.' : (res.error || ''));
    if (res.success) setStepDone(4);
}

async function doTestPJN() {
    const btn = document.getElementById('btnTestPJN');
    btn.disabled = true;
    btn.textContent = 'Abriendo...';
    const res = await onboardingAPI.abrirNavegadorPJN();
    btn.disabled = false;
    btn.textContent = 'Probar';
    showS4Status(res.success ? 'ok' : 'error',
        res.success ? '🌐' : '❌',
        res.success ? 'Portal PJN abierto' : 'No se pudo conectar al PJN',
        res.success ? 'Verificá que la sesión se inicie correctamente.' : (res.error || ''));
    if (res.success) setStepDone(4);
}

function showS4Status(state, icon, title, detail) {
    const card = document.getElementById('s4StatusCard');
    card.style.display = '';
    const el = document.getElementById('s4Icon');
    el.textContent = icon;
    el.className = `ob-status-icon ${state}`;
    document.getElementById('s4Title').textContent = title;
    document.getElementById('s4Detail').textContent = detail;
}
