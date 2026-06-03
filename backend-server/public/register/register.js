'use strict';

// ─── Estado ───────────────────────────────────────────────────────────────────
let selectedPlan = null;
let availablePlans = [];
let isSubmitting = false;

// ─── Validación de CUIT/CUIL ──────────────────────────────────────────────────
function validarCuit(cuit) {
    const clean = cuit.replace(/[-\s]/g, '');
    if (!/^\d{11}$/.test(clean)) return false;
    const mult = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += parseInt(clean[i]) * mult[i];
    const rem = sum % 11;
    const check = rem === 0 ? 0 : rem === 1 ? 9 : 11 - rem;
    return check === parseInt(clean[10]);
}

// Auto-formatear CUIT mientras escribe: XX-XXXXXXXX-X
document.getElementById('cuit').addEventListener('input', function () {
    let v = this.value.replace(/\D/g, '').substring(0, 11);
    if (v.length > 10)      v = v.substring(0,2) + '-' + v.substring(2,10) + '-' + v.substring(10);
    else if (v.length > 2)  v = v.substring(0,2) + '-' + v.substring(2);
    this.value = v;
});

// ─── Persistencia del borrador (conservar datos al ir a T&C / Privacidad) ──────
// Guardamos los campos NO sensibles en sessionStorage. Las contraseñas NO se
// persisten por seguridad; el navegador suele restaurarlas vía bfcache al volver.
const DRAFT_FIELDS = ['nombre','apellido','email','cuit','calle','numero','piso','depto','localidad','provincia'];

function saveDraft() {
    try {
        const draft = {};
        DRAFT_FIELDS.forEach(id => { const el = document.getElementById(id); if (el) draft[id] = el.value; });
        draft.plan = selectedPlan;
        draft.toc  = document.getElementById('toc')?.checked || false;
        sessionStorage.setItem('reg_draft', JSON.stringify(draft));
    } catch { /* sessionStorage no disponible: ignorar */ }
}

function restoreDraft() {
    try {
        const raw = sessionStorage.getItem('reg_draft');
        if (!raw) return;
        const draft = JSON.parse(raw);
        DRAFT_FIELDS.forEach(id => {
            const el = document.getElementById(id);
            if (el && draft[id] != null) el.value = draft[id];
        });
        if (draft.toc) { const t = document.getElementById('toc'); if (t) t.checked = true; }
        if (draft.plan) selectPlan(draft.plan);   // se re-aplica cuando las cards ya están renderizadas
    } catch { /* ignorar */ }
}

function clearDraft() { try { sessionStorage.removeItem('reg_draft'); } catch {} }

// Guardar continuamente mientras el usuario completa el formulario
document.getElementById('registerForm').addEventListener('input',  saveDraft);
document.getElementById('registerForm').addEventListener('change', saveDraft);

// ─── Indicador en vivo de coincidencia de contraseñas ─────────────────────────
function updatePwMatch() {
    const pwd  = document.getElementById('password').value;
    const conf = document.getElementById('confirmPassword').value;
    const el   = document.getElementById('pw-match');
    if (!el) return;
    if (!conf) { el.style.display = 'none'; el.textContent = ''; el.className = 'pw-match'; return; }
    el.style.display = 'block';
    if (pwd === conf) { el.textContent = '✓ Las contraseñas coinciden'; el.className = 'pw-match ok'; }
    else              { el.textContent = '✗ Las contraseñas no coinciden'; el.className = 'pw-match bad'; }
}
document.getElementById('password').addEventListener('input', updatePwMatch);
document.getElementById('confirmPassword').addEventListener('input', updatePwMatch);

// ─── Cargar planes disponibles ────────────────────────────────────────────────
async function loadPlans() {
    try {
        const res = await fetch('/auth/plan-availability');
        const data = await res.json();
        if (!data.success) throw new Error('Error al cargar planes');
        availablePlans = data.plans;
        renderPlanCards(data.plans);
    } catch (e) {
        document.getElementById('planCards').innerHTML =
            '<p style="color:#dc2626;grid-column:1/-1">Error al cargar los planes. Recargá la página.</p>';
    }
}

function renderPlanCards(plans) {
    const container = document.getElementById('planCards');
    container.innerHTML = '';

    for (const plan of plans) {
        const isSelectable = plan.available;
        const badge = getPlanBadge(plan);
        const fmtArs = v => new Intl.NumberFormat('es-AR').format(v);
        const priceText = plan.price_ars != null
            ? `<div class="plan-price">$${fmtArs(plan.price_ars)} <span class="period">ARS / mes</span></div>`
            : plan.price_usd != null
                ? `<div class="plan-price">$${plan.price_usd} <span class="period">USD / mes</span></div>`
                : `<div class="plan-price" style="color:#94a3b8;font-size:14px">Precio por definir</div>`;

        const card = document.createElement('div');
        card.className = 'plan-card' + (isSelectable ? '' : ' disabled');
        card.dataset.name = plan.name;
        const extraBadge = plan.name === 'COMBO_PROMO' && isSelectable
            ? `<span class="plan-badge badge-promo" style="margin-right:4px">Promo Lanzamiento</span>`
            : '';
        card.innerHTML = `
            <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:2px">${extraBadge}<span class="plan-badge ${badge.cls}">${badge.label}</span></div>
            <div class="plan-name">${plan.display_name}</div>
            ${priceText}
            <div class="plan-desc">${getPlanDesc(plan)}</div>
            ${!isSelectable && plan.reason === 'quota_full' ? '<div style="font-size:11px;color:#ef4444;margin-top:4px">Cupos agotados</div>' : ''}
            ${!isSelectable && plan.reason === 'promo_expired' ? '<div style="font-size:11px;color:#ef4444;margin-top:4px">Promo vencida</div>' : ''}
        `;

        if (isSelectable) {
            card.addEventListener('click', () => selectPlan(plan.name));
        }

        container.appendChild(card);
    }
}

function getPlanBadge(plan) {
    if (!plan.available) {
        if (plan.reason === 'quota_full')   return { label: 'Sin cupos',     cls: 'badge-soon' };
        if (plan.reason === 'promo_expired') return { label: 'Promo vencida', cls: 'badge-soon' };
        return { label: 'Próximamente', cls: 'badge-soon' };
    }
    if (plan.name === 'EXTENSION_PROMO') return { label: 'Promo Lanzamiento', cls: 'badge-promo' };
    if (plan.name === 'COMBO_PROMO')     return { label: 'Beta',              cls: 'badge-beta'  };
    if (plan.promo_type === 'quota')     return { label: `${plan.promo_remaining} cupos`, cls: 'badge-promo' };
    if (plan.promo_type === 'date')      return { label: 'Promo Lanzamiento', cls: 'badge-promo' };
    return { label: 'Disponible', cls: 'badge-beta' };
}

function getPlanDesc(plan) {
    if (plan.name === 'EXTENSION_PROMO') return '5 flujos habilitados en la extensión Chrome.';
    if (plan.name === 'COMBO_PROMO') return 'Extensión Chrome + app Electron. Hasta 50 ejecuciones/mes.';
    if (plan.name === 'BASIC') return 'App Electron — 50 ejecuciones/mes.';
    if (plan.name === 'PRO') return 'App Electron — 200 ejecuciones/mes.';
    if (plan.name === 'ENTERPRISE') return 'Sin límites. Soporte dedicado.';
    return '';
}

function selectPlan(name) {
    selectedPlan = name;
    document.querySelectorAll('.plan-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.name === name);
    });
    clearErr('plan');

    // Mostrar sección según plan seleccionado
    document.getElementById('flowsSection').style.display = name === 'EXTENSION_PROMO' ? 'block' : 'none';
    document.getElementById('betaSection').style.display  = name === 'COMBO_PROMO'     ? 'block' : 'none';
}

// ─── Validación de campos ─────────────────────────────────────────────────────
function setErr(id, msg) {
    const el = document.getElementById('err-' + id);
    const inp = document.getElementById(id);
    if (el) el.textContent = msg;
    if (inp) inp.classList.toggle('invalid', !!msg);
}
function clearErr(id) { setErr(id, ''); }

function validateForm() {
    let valid = true;
    const missing = [];   // resumen de campos faltantes/ inválidos

    const fields = ['nombre','apellido','email','password','confirmPassword','cuit','calle','numero','localidad','provincia'];
    fields.forEach(id => clearErr(id));
    clearErr('plan'); clearErr('toc');

    const get = id => document.getElementById(id)?.value.trim() || '';
    // Marca error en el campo, suma al resumen y baja la bandera de validez
    const fail = (id, fieldErr, summaryLabel) => { setErr(id, fieldErr); missing.push(summaryLabel); valid = false; };

    if (!get('nombre'))   fail('nombre', 'Requerido', 'Nombre');
    if (!get('apellido')) fail('apellido', 'Requerido', 'Apellido');

    const email = get('email');
    if (!email) fail('email', 'Requerido', 'Email');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('email', 'Email inválido', 'Email (formato inválido)');

    const pwd = get('password');
    if (!pwd) fail('password', 'Requerido', 'Contraseña');
    else if (pwd.length < 8) fail('password', 'La contraseña debe tener al menos 8 caracteres.', 'Contraseña (mínimo 8 caracteres)');
    else if (!/[a-zA-Z]/.test(pwd) || !/[0-9]/.test(pwd)) fail('password', 'Debe incluir al menos una letra y un número.', 'Contraseña (una letra y un número)');
    else if (email && pwd.toLowerCase() === email.toLowerCase()) fail('password', 'No puede ser igual a tu email.', 'Contraseña (no puede ser igual al email)');

    // El campo "confirmar" se apoya SOLO en el indicador en vivo (#pw-match), no en
    // el error estático del campo (que quedaba pegado aunque después coincidieran).
    if (!get('confirmPassword'))         { updatePwMatch(); missing.push('Confirmar contraseña'); valid = false; }
    else if (get('confirmPassword') !== pwd) { updatePwMatch(); missing.push('Confirmar contraseña (no coincide)'); valid = false; }

    const cuit = get('cuit');
    if (!cuit) fail('cuit', 'Requerido', 'CUIT / CUIL');
    else if (!validarCuit(cuit)) fail('cuit', 'CUIT/CUIL inválido', 'CUIT / CUIL (inválido)');

    if (!get('calle'))     fail('calle', 'Requerido', 'Calle');
    if (!get('numero'))    fail('numero', 'Requerido', 'Numeración');
    if (!get('localidad')) fail('localidad', 'Requerido', 'Localidad');
    if (!get('provincia')) fail('provincia', 'Seleccioná una provincia', 'Provincia');

    if (!selectedPlan) { setErr('plan', 'Seleccioná un plan'); missing.push('Seleccionar un plan'); valid = false; }

    if (!document.getElementById('toc').checked) {
        setErr('toc', 'Debés aceptar los Términos y Condiciones');
        missing.push('Aceptar los Términos y Condiciones');
        valid = false;
    }

    renderMissingSummary(missing);
    return valid;
}

// Resumen visual de campos faltantes (arriba del botón)
function renderMissingSummary(missing) {
    const box  = document.getElementById('missingSummary');
    const list = document.getElementById('missingList');
    if (!box || !list) return;
    if (!missing.length) { box.style.display = 'none'; list.innerHTML = ''; return; }
    list.innerHTML = missing.map(m => `<li>${m}</li>`).join('');
    box.style.display = 'block';
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Submit ───────────────────────────────────────────────────────────────────
document.getElementById('registerForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!validateForm()) return;

    isSubmitting = true;
    document.getElementById('submitBtn').disabled = true;
    document.getElementById('btnText').style.display = 'none';
    document.getElementById('btnSpinner').style.display = 'inline-block';
    document.getElementById('formError').style.display = 'none';

    const get = id => document.getElementById(id)?.value.trim() || '';

    const payload = {
        nombre:    get('nombre'),
        apellido:  get('apellido'),
        email:     get('email'),
        password:  document.getElementById('password').value,
        cuit:      get('cuit'),
        domicilio: {
            calle:     get('calle'),
            numero:    get('numero'),
            piso:      get('piso') || undefined,
            depto:     get('depto') || undefined,
            localidad: get('localidad'),
            provincia: get('provincia'),
        },
        plan_name:   selectedPlan,
        toc_accepted: true,
    };

    try {
        const res = await fetch('/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await res.json();

        if (res.ok && data.success) {
            clearDraft();   // registro exitoso: descartar borrador guardado
            document.getElementById('view-form').style.display = 'none';
            document.getElementById('view-success').style.display = 'block';
            document.getElementById('successMsg').textContent =
                `Te enviamos un email a ${payload.email}. Hacé clic en el enlace para confirmar tu cuenta.`;
        } else {
            showFormError(data.error || 'Error al registrarse. Intentá nuevamente.');
        }
    } catch {
        showFormError('Error de conexión. Verificá tu internet e intentá nuevamente.');
    } finally {
        isSubmitting = false;
        document.getElementById('submitBtn').disabled = false;
        document.getElementById('btnText').style.display = 'inline';
        document.getElementById('btnSpinner').style.display = 'none';
    }
});

function showFormError(msg) {
    const el = document.getElementById('formError');
    el.textContent = msg;
    el.style.display = 'block';
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// ─── Init ─────────────────────────────────────────────────────────────────────
(async function init() {
    try {
        const res  = await fetch('/auth/register-status');
        const data = await res.json();
        if (!data.open) {
            document.getElementById('view-form').style.display = 'none';
            const closed = document.createElement('div');
            closed.style.cssText = 'text-align:center;padding:40px 20px';
            closed.innerHTML = `
                <div style="font-size:48px;margin-bottom:16px">🔒</div>
                <h2 style="color:#1a1a1a;font-family:inherit;margin-bottom:12px">Registro temporalmente cerrado</h2>
                <p style="color:#5c5c5c;font-size:14px;line-height:1.7">
                    El registro de nuevos usuarios está pausado en este momento.<br>
                    Si tenés un código de acceso o querés más información, contactanos en<br>
                    <a href="mailto:soporte@procuradortool.com" style="color:#d97706">soporte@procuradortool.com</a>.
                </p>`;
            const card = document.querySelector('.register-card') || document.body;
            card.appendChild(closed);
            return;
        }
    } catch { /* si falla la consulta, muestra el formulario igual */ }
    await loadPlans();
    restoreDraft();   // restaura datos si el usuario fue a T&C/Privacidad y volvió
})();
