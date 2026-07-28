# Plan de corrección — Q6: fail-open en la verificación de firmas de scripts

> **Qué es esto.** El plan de ejecución para cerrar el hallazgo **E2-2** (`revision-E2-2026-07-27.md`),
> que quedó fuera del plan de correcciones E1-E6 porque requería una decisión de diseño del operador.
>
> **Decisión tomada (2026-07-28):** el operador confirmó que **si la firma de un script no se puede
> verificar, el script debe bloquearse** — el fail-open actual no era intencional. Este plan
> implementa ese cambio.
>
> **Elaborado con:** Opus 5, 2026-07-28 (investigación del código real, sin cambios).
> **Ejecutar con:** Sonnet **ALTO**, en **2 sesiones separadas** (ver §6 — el orden importa y no es
> negociable).
>
> ⚠️ **Este es el plan de mayor riesgo operativo de todos los ejecutados hasta ahora.** No por
> complejidad técnica (el diff es chico) sino por consecuencia: el propósito del cambio es
> **bloquear ejecuciones**. Un error de criterio acá no rompe una función — deja a *todos* los
> usuarios sin poder trabajar, en un producto que se paga por ejecutar. §5 y §7 existen por eso.

---

## 1. Lo que la investigación encontró (más de lo que decía E2-2)

E2-2 documentaba **3** fail-opens (los `catch` genéricos de las 3 etapas). Al leer el código
completo para armar este plan aparecieron **6 más**, en 3 archivos distintos. El inventario real:

| # | Dónde | Qué pasa | ¿En E2-2? |
|---|---|---|---|
| **F1** | `authManager.js:254-257` | `catch` genérico etapa 1 → `console.warn` y **sigue** | ✅ sí |
| **F2** | `authManager.js:492` | `catch` genérico etapa 2 → warn y **sigue** | ✅ sí |
| **F3** | `authManager.js:541` | `catch` genérico etapa 3 → warn y **sigue** | ✅ sí |
| **F4** | `authManager.js:258-262` | Si el backend **no manda** `security.checksum`/`signature`, el `else` **saltea toda la verificación** y cachea el script igual | ❌ **nuevo** |
| **F5** | `authManager.js:332` | `await this.loadScript(scriptName)` **sin mirar el resultado** — si devolvió `{success:false}` por firma inválida, se ignora | ❌ **nuevo** |
| **F6** | `authManager.js:528-530` | **La etapa 3 lee de `scriptCache` (RAM), no del disco** — ver §2, es el más serio | ❌ **nuevo** |
| **F7** | `scriptVerifier.js:110-113` ⛔ | `verifySignature()` devuelve `true` si no hay clave pública ("degradación elegante") — **sin clave, toda firma es válida** | ❌ **nuevo** |
| **F8** | `scriptVerifier.js:198-206, 232-235` ⛔ | Etapas 2/3 sin registro previo → warn y pasan | ❌ **nuevo** |
| **F9** | `backend-server/routes/client.js:236-239` | Si falla el firmado, el backend **sirve el script sin `security`** (alimenta F4) | ❌ **nuevo** |

**F4 + F9 forman una cadena:** un fallo del firmador del servidor produce un script servido sin
firma, que el cliente ejecuta sin verificar — **en silencio, sin ningún error visible**. Ninguno de
los dos lados avisa.

### ✅ Estado actual verificado en producción (2026-07-28)

Antes de escribir el plan se comprobó contra el sistema real:

- **El backend firma correctamente hoy.** Descarga real de `testM2.js` con token válido → devuelve
  `security` con `checksum`, `signature` y `signedAt` presentes. `RSA_PRIVATE_KEY`/`RSA_PUBLIC_KEY`
  están en el `.env` del servidor.
- **El cliente carga la clave pública correctamente**, tanto en `npm start` como en el `.exe`
  empaquetado (verificado en los logs de arranque del build de v2.7.44:
  `✅ [ScriptVerifier] Clave pública cargada desde: ...app.asar\src\security\public.pem`).

**Conclusión:** los 9 fail-opens son **latentes, no activos**. Esto es una buena noticia doble:
el riesgo hoy es bajo, y —más importante para este plan— **el camino feliz funciona**, así que
endurecerlo no debería cambiar nada para un usuario normal. Ese es exactamente el criterio de
verificación de §5.

---

## 2. F6 en detalle — la etapa 3 no verifica lo que dice verificar

Vale aparte porque no es un fail-open más: es una capa de defensa que **no defiende nada**.

`scriptVerifier.js:155-156` documenta la etapa 3 así:

> *ETAPA 3: Antes de ejecutar en VM/fork — Verifica que el archivo en disco no fue manipulado externamente*

Pero el llamador (`authManager.js:528-530`) hace:

```js
const diskCode = this.scriptCache.get(scriptName);   // ← RAM, no disco
if (diskCode) {
    this.scriptVerifier.verifyMultiStage(scriptName, 3, diskCode);
}
```

`verifyMultiStage(…, 3, …)` compara el checksum de `diskCode` contra `registry.stage2 || stage1` —
que se calcularon **del mismo contenido de la caché**. Es RAM contra el hash de esa misma RAM:
**siempre pasa**. La variable se llama `diskCode` pero nunca tocó el disco.

Y lo que efectivamente se ejecuta (`fork(tempScriptPath)`, línea 637) son dos archivos que sí están
en disco y que **nadie verifica**: `tempDir/<script>.enc` (el código cifrado) y `tempDir/<script>`
(el wrapper que lo desencripta).

**Implicancia honesta:** la ventana que la etapa 3 dice cubrir —manipulación del archivo entre que
se escribe y se ejecuta— está **abierta hoy**, y lo estuvo siempre. Es una ventana corta (milisegundos)
y requiere acceso local al disco del usuario, así que no es una urgencia; pero conviene saber que la
"tercera capa de defensa" no existe en la práctica.

---

## 3. Principio de diseño: cerrar desde afuera, sin tocar la zona protegida

`electron-app/src/security/scriptVerifier.js` está marcado **⛔ NO TOCAR** en CLAUDE.md, y F7/F8
viven ahí. La buena noticia: **no hace falta tocarlo.**

`ScriptVerifier` ya expone `isReady()` (línea 331) y `getConfig()` (338), que informan si la clave
pública se cargó. El llamador puede **exigir** esa condición antes de confiar en el resultado:

```js
// en authManager.js — cierra F7 sin modificar la zona protegida
if (!this.scriptVerifier.isReady()) {
    return { success: false, error: 'Verificador de integridad no disponible' };
}
```

`verifySignature()` sigue devolviendo `true` sin clave (F7 sigue ahí), pero **ya nadie le pregunta
en esa condición**. Mismo criterio para F8: si el llamador garantiza que la etapa 1 corrió y
bloqueó ante fallo, las etapas 2/3 nunca se encuentran sin registro previo.

**Regla del plan: cero cambios en `src/security/`.** Si durante la ejecución aparece un caso que
parece requerirlo, **no improvisar** — detenerse y consultar al operador.

---

## 4. Los cambios, uno por uno

### FASE 1 — Backend (`routes/client.js`) · sin release, `scp` + `pm2 restart`

#### C1. F9 — dejar de servir scripts sin firma

**Archivo:** `backend-server/routes/client.js:236-239`

```js
// ANTES
} catch (signError) {
    console.warn(`⚠️ No se pudo firmar ${scriptName}:`, signError.message);
    // Continúa sin firma (degradación elegante)
}

// DESPUÉS
} catch (signError) {
    console.error(`[SEGURIDAD] No se pudo firmar ${scriptName}: ${signError.message}`);
    return res.status(500).json({
        success: false,
        error: 'No se pudo firmar el script. Intentá de nuevo en unos minutos.'
    });
}
```

> ⚠️ **Detalle verificado:** `routes/client.js` **no importa `logger`** — usa `console.*` (17 usos).
> Usar `console.error` como arriba, **no** `logger.error`, para no agregar un import solo por esto.
> PM2 igual redirige `console.error` a `/var/log/procurador/pm2-error.log`, así que el monitoreo del
> punto 3 de la verificación funciona igual. El prefijo `[SEGURIDAD]` es lo que hace greppeable la
> línea.

**Por qué esto va primero y solo:** el cliente endurecido (Fase 2) va a rechazar scripts sin firma.
Si el backend pudiera servir alguno sin firmar, esos usuarios quedarían bloqueados sin explicación.
Cerrando el backend primero, **se garantiza que la condición que el cliente exigirá siempre se
cumple** antes de que ningún cliente la exija.

**Riesgo de este cambio:** si el firmador fallara, los usuarios reciben un 500 en vez de un script
sin verificar. Es exactamente el comportamiento buscado, pero significa que **un bug del firmador
ahora corta el servicio**. Por eso la verificación de abajo mide que hoy no falla nunca.

**Verificación:**
1. Staging: descargar los 13 scripts de la whitelist con un token real; los 13 deben venir con
   `security.checksum` + `security.signature` + `security.signedAt`. **Cero excepciones.**
2. Repetir en prod tras desplegar (mismo comando, token de prod).
3. Revisar `error.log` de prod **durante 24-48 h** buscando `[SEGURIDAD] No se pudo firmar`. Si
   aparece aunque sea una vez, **detener el plan**: hay un problema real de firmado que hay que
   entender antes de endurecer el cliente.
4. Smoke normal (health/API/landing 200) + una Procuración real desde la app **v2.7.44** (la actual,
   todavía sin endurecer) para confirmar que el cambio no rompió el flujo vigente.

> **⏸️ Punto de corte obligatorio.** La Fase 2 **no arranca** hasta que el punto 3 esté cumplido con
> al menos 24 h de log limpio. Este plan está diseñado para ejecutarse en 2 sesiones con esa espera
> en el medio; si se junta todo en una sola sesión se pierde la única señal que dice si es seguro
> endurecer el cliente.

---

### FASE 2 — Cliente Electron · requiere release (v2.7.45)

#### C2. F1 — etapa 1: bloquear ante error genérico

**Archivo:** `electron-app/src/auth/authManager.js:254-257`

```js
// ANTES
// Error genérico de verificación - log pero no bloquear
this.securityAudit.logSecurityError(scriptName, verifyError);
console.warn(`⚠️ Error verificando ${scriptName}:`, verifyError.message);

// DESPUÉS
// Q6 (2026-07-28): fail-CLOSED. Si la verificación no se puede completar, no se
// puede afirmar que el script sea legítimo — y este es el único punto donde se
// verifica la firma RSA. Antes se logueaba y el script se cacheaba igual.
this.securityAudit.logSecurityError(scriptName, verifyError);
console.error(`🚨 VERIFICACIÓN FALLIDA: ${scriptName} - ${verifyError.message}`);
return { success: false, error: `No se pudo verificar la integridad de ${scriptName}` };
```

#### C3. F4 — exigir datos de firma (el `else`)

**Archivo:** `electron-app/src/auth/authManager.js:258-262`

```js
// ANTES
} else {
    this.securityAudit.logVerificationSkipped(scriptName, 'Sin datos de firma del servidor');
    console.warn(`⚠️ Script sin firma digital: ${scriptName}`);
}

// DESPUÉS
} else {
    // Q6: el backend SIEMPRE firma (ver Fase 1/C1). Un script sin datos de firma
    // indica un problema real del servidor, no un caso normal a tolerar.
    this.securityAudit.logVerificationSkipped(scriptName, 'Sin datos de firma del servidor');
    console.error(`🚨 SCRIPT SIN FIRMA DIGITAL: ${scriptName} - rechazado`);
    return { success: false, error: `El servidor no envió la firma de ${scriptName}` };
}
```

#### C4. F7 — exigir verificador operativo (sin tocar la zona protegida)

**Archivo:** `electron-app/src/auth/authManager.js`, al inicio del bloque de verificación (~línea 213)

```js
// Q6: si la clave pública no se pudo cargar, verifySignature() devuelve true para
// CUALQUIER firma (scriptVerifier.js:110-113, "degradación elegante"). Se cierra
// desde acá — sin modificar src/security/, que es zona protegida.
if (!this.scriptVerifier.isReady()) {
    console.error('🚨 Verificador de integridad no inicializado — no se puede validar ningún script');
    return { success: false, error: 'Verificador de integridad no disponible. Reinstalá la aplicación.' };
}
```

#### C5. F2 y F3 — etapas 2 y 3: bloquear ante error genérico

**Archivos:** `authManager.js:492` y `authManager.js:541` — mismo patrón en ambos:

```js
// ANTES (×2)
console.warn(`⚠️ Error checksum etapa N:`, checksumError.message);

// DESPUÉS (×2)
console.error(`🚨 ERROR EN VERIFICACIÓN ETAPA N: ${scriptName} - ${checksumError.message}`);
return reject({ success: false, error: `No se pudo verificar la integridad en etapa N` });
```

> Nota: acá es `reject(...)`, no `return {…}` — estas dos etapas están dentro de la Promise de
> `executeRemoteScriptAsLocal`, a diferencia de C2. **Respetar el patrón de cada sitio**, es la
> clase de detalle que rompe silenciosamente.

#### C6. F5 — mirar el resultado de `loadScript()`

**Archivo:** `electron-app/src/auth/authManager.js:320-333` (2 llamadas)

```js
// ANTES (×2)
await this.loadScript(scriptName);
code = this.scriptCache.get(scriptName);

// DESPUÉS (×2)
const loadResult = await this.loadScript(scriptName);
if (!loadResult.success) {
    return reject({ success: false, error: loadResult.error || 'No se pudo cargar el script' });
}
code = this.scriptCache.get(scriptName);
```

Hoy el bloqueo funciona por efecto colateral (si la verificación falla, `loadScript` retorna antes
del `scriptCache.set()`, la caché queda vacía y el `if (!code)` rechaza). Funciona, pero es frágil y
el mensaje de error que ve el usuario pierde la causa real.

#### C7. F6 — que la etapa 3 verifique el disco de verdad *(ver §7 antes de ejecutar)*

**Archivos:** `authManager.js` ~502 (escritura) y ~528 (verificación)

Al escribir el `.enc`, guardar su hash; en etapa 3, releer el archivo **del disco** y comparar:

```js
// Al escribir (~502), después de fs.writeFileSync(encScriptPath, encryptedContent, 'utf8'):
const encDiskHash = this.scriptVerifier.calculateChecksum(encryptedContent);

// En etapa 3 (~528), reemplazando el bloque que lee de scriptCache:
const encOnDisk = fs.readFileSync(encScriptPath, 'utf8');
if (this.scriptVerifier.calculateChecksum(encOnDisk) !== encDiskHash) {
    return reject({ success: false, error: 'El script fue modificado en disco antes de ejecutarse' });
}
```

Esto cierra la ventana real (manipulación entre escritura y `fork`) sin desencriptar nada y sin
tocar `scriptVerifier.js`. **Es el único ítem del plan que agrega lógica nueva en vez de endurecer
la existente** — por eso §7 propone tratarlo aparte.

> ⚠️ **Detalle verificado:** `authManager.js` **no importa `crypto`** hoy. C7 requiere agregar
> `const crypto = require('crypto');` al tope del archivo. Alternativa sin import nuevo: usar
> `this.scriptVerifier.calculateChecksum(contenido)`, que es público (`scriptVerifier.js:95`), hace
> exactamente el mismo SHA-256 y **no modifica la zona protegida** (solo la usa). **Preferir esta
> segunda opción** — menos superficie y consistente con el resto del flujo.

---

## 5. Verificación de la Fase 2 — qué probar y qué significa cada resultado

El objetivo es doble y hay que medir los dos lados: **que bloquee lo que debe** y —más importante—
**que NO bloquee lo que no debe**.

### 5.1 No-regresión (lo que más importa)

1. `npm start` → arranque limpio, `[ScriptVerifier] Clave pública cargada` presente en el log.
2. **Los 3 flujos reales contra el PJN** (Procuración, Informe, Monitor) — requiere al operador.
   **Ninguno debe fallar.** Si alguno falla, el fix está mal: el camino feliz está verificado como
   sano hoy (§1), así que cualquier bloqueo en condiciones normales es un falso positivo.
3. Verificar en el log que las 3 etapas reportan OK (`✅ Verificación RSA OK`,
   `✅ [ScriptVerifier] Checksum Etapa 2/3 OK`) — confirma que se ejecutan, no que se saltean.
4. Segunda corrida seguida del mismo flujo (script ya en caché) → debe funcionar igual. Ejercita el
   camino de caché de C6, distinto al de descarga.

### 5.2 Que efectivamente bloquee

Cada prueba se hace **en staging**, revirtiendo después:

| Prueba | Cómo forzarla | Esperado |
|---|---|---|
| **Firma inválida** (ya funcionaba) | Corromper 1 byte de `signature` en la respuesta del backend de staging | Rechazo con "Firma digital inválida" — no-regresión del camino que ya bloqueaba |
| **C3 / F4** | Parche temporal en `client.js` de staging: `securityData = null` | Rechazo con "El servidor no envió la firma" |
| **C4 / F7** | Renombrar `public.pem` en una copia del build empaquetado | Rechazo con "Verificador de integridad no disponible" |
| **C2 / F1** | Parche temporal en el `verifyFull` del cliente que lance un `Error` genérico | Rechazo con "No se pudo verificar la integridad" |
| **C7 / F6** (si se ejecuta) | Sobrescribir el `.enc` en `tempDir` entre escritura y `fork` (requiere un `sleep` temporal) | Rechazo con "modificado en disco" |

**Revertir todos los parches de prueba al terminar** y confirmar por `grep` que no quedó ninguno —
mismo checklist que ya se usó en la verificación del Bloque A.

### 5.3 Release

Checklist estándar de CLAUDE.md: bump `2.7.44 → 2.7.45` → tag → `npm run release` → versión visible
en los 5 lugares. **Presupuestar el bug recurrente de `npm run release`** (7 releases seguidos:
v2.7.38 a v2.7.44) — el release queda incompleto y hay que subir `.blockmap` + `latest.yml`
regenerado a mano. No es una sorpresa, es el procedimiento.

---

## 6. Orden de ejecución (no negociable)

```
Sesión 1 (Sonnet ALTO)  ── Fase 1: backend (C1)
                           └─ desplegar staging → prod → smoke
                                      ↓
                        ⏸️  ESPERA 24-48 h con monitoreo del error.log
                           (si aparece "[SEGURIDAD] No se pudo firmar" → DETENER)
                                      ↓
Sesión 2 (Sonnet ALTO)  ── Fase 2: cliente (C2…C6, y C7 si se aprueba)
                           └─ verificación §5 → release v2.7.45
```

**Por qué la espera no es opcional:** es la única forma de saber si el firmador del servidor falla
alguna vez en condiciones reales. Endurecer el cliente sin ese dato es apostar a que nunca falla —
y si falla, el síntoma es *todos los usuarios sin poder ejecutar nada*, con el agravante de que el
fix requiere un release nuevo (horas), no un `pm2 restart` (segundos).

---

## 7. Decisiones que necesitan al operador

### Q6.a — ¿Se incluye C7 (F6, la etapa 3 real)?

**Recomiendo hacerlo, pero en una tercera sesión aparte**, no junto con C2-C6.

Razón: C2-C6 son todos el mismo cambio conceptual (un `warn` que pasa a ser un `return`/`reject`),
verificables juntos. C7 **agrega lógica nueva** —hashear al escribir, releer y comparar antes de
ejecutar— en el camino crítico de toda ejecución. Mezclarlo significa que, si algo falla en la
verificación de §5, hay que averiguar cuál de los dos tipos de cambio lo causó.

Separarlo cuesta un release más; mezclarlo cuesta claridad justo en el momento en que más se
necesita. Si preferís un solo release, es viable — pero conviene saber que se está eligiendo eso.

### Q6.b — ¿Kill switch remoto?

**Recomiendo que NO**, y quiero ser explícito sobre el motivo: un interruptor remoto para desactivar
la verificación de firmas es, por definición, una puerta trasera que anula exactamente la protección
que este plan agrega. Quien controle ese interruptor (o quien logre suplantarlo) desactiva el
sistema entero.

El escape ante un problema es el **fix-forward** que el proyecto ya usa: publicar v2.7.46 con el
comportamiento corregido. Es más lento que un flag, y esa lentitud es parte del costo de tener una
verificación que realmente verifica.

### Q6.c — Mensajes de error al usuario

Los mensajes propuestos son técnicos ("No se pudo verificar la integridad de testM2.js"). Un usuario
que se tope con esto no va a saber qué hacer.

**Propongo:** que los 4 casos deriven a un mismo mensaje accionable — *"No se pudo verificar la
integridad de los componentes de la aplicación. Cerrá y volvé a abrir; si el problema persiste,
contactá a soporte."* — dejando el detalle técnico solo en el log y en `securityAudit`. Confirmar
si preferís eso o el mensaje técnico visible.

---

## 8. Resumen de riesgo

| Aspecto | Evaluación |
|---|---|
| **Complejidad técnica** | Baja — ~8 cambios chicos, sin lógica nueva (salvo C7) |
| **Riesgo de romper el camino feliz** | **Alto en consecuencia, bajo en probabilidad.** Bajo porque hoy el sistema firma y verifica bien en el 100% de los casos medidos; alto en consecuencia porque el fallo deja a todos los usuarios sin ejecutar nada |
| **Reversibilidad** | Backend: inmediata (`scp` del archivo previo + restart). Cliente: **requiere release nuevo** (fix-forward, horas) — de ahí el orden de §6 |
| **Zona protegida** | **No se toca.** F7/F8 se cierran desde el llamador vía `isReady()` |
| **Ganancia real** | Cierra 9 fail-opens, uno de los cuales (F6) hace que una de las 3 capas de defensa no defienda nada hoy |

---

## 9. Cómo arrancar

**Sesión 1:**
> «Ejecutá la **Fase 1** del plan `docs/internal/plan-Q6-verificacion-firmas-2026-07-28.md`.»

**Sesión 2** (tras la espera de 24-48 h con log limpio):
> «Ejecutá la **Fase 2** del plan `docs/internal/plan-Q6-verificacion-firmas-2026-07-28.md`.»

**Reglas de ejecución:** backup de DB antes de cualquier cambio · staging antes que prod · verificar
`DB_NAME` antes de cualquier escritura · **nunca** `git add -A` · `node -r dotenv/config <script>
dotenv_config_path=.env.staging` para cualquier script de mantenimiento contra staging (bug de
`dotenv` documentado) · **cero cambios en `electron-app/src/security/`** — si parece necesario,
detenerse y consultar.
