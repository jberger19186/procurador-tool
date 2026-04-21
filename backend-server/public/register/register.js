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
        const priceText = plan.price_usd != null
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

    const fields = ['nombre','apellido','email','password','confirmPassword','cuit','calle','numero','localidad','provincia'];
    fields.forEach(id => clearErr(id));
    clearErr('plan'); clearErr('toc');

    const get = id => document.getElementById(id)?.value.trim() || '';

    if (!get('nombre')) { setErr('nombre', 'Requerido'); valid = false; }
    if (!get('apellido')) { setErr('apellido', 'Requerido'); valid = false; }

    const email = get('email');
    if (!email) { setErr('email', 'Requerido'); valid = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setErr('email', 'Email inválido'); valid = false; }

    const pwd = get('password');
    if (!pwd) { setErr('password', 'Requerido'); valid = false; }
    else if (pwd.length < 8) { setErr('password', 'Mínimo 8 caracteres'); valid = false; }

    if (get('confirmPassword') !== pwd) { setErr('confirmPassword', 'Las contraseñas no coinciden'); valid = false; }

    const cuit = get('cuit');
    if (!cuit) { setErr('cuit', 'Requerido'); valid = false; }
    else if (!validarCuit(cuit)) { setErr('cuit', 'CUIT/CUIL inválido'); valid = false; }

    if (!get('calle'))    { setErr('calle', 'Requerido'); valid = false; }
    if (!get('numero'))   { setErr('numero', 'Requerido'); valid = false; }
    if (!get('localidad')){ setErr('localidad', 'Requerido'); valid = false; }
    if (!get('provincia')){ setErr('provincia', 'Seleccioná una provincia'); valid = false; }

    if (!selectedPlan) { setErr('plan', 'Seleccioná un plan'); valid = false; }

    if (!document.getElementById('toc').checked) {
        setErr('toc', 'Debés aceptar los Términos y Condiciones');
        valid = false;
    }

    return valid;
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
loadPlans();
