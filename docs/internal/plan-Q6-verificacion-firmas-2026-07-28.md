# Plan de corrección — Q6: fail-open en la verificación de firmas de scripts

> **Qué es esto.** El plan de ejecución para cerrar el hallazgo **E2-2** (`revision-E2-2026-07-27.md`),
> que quedó fuera del plan de correcciones E1-E6 porque requería una decisión de diseño del operador.
>
> **Decisión tomada (2026-07-28):** el operador confirmó que **si la firma de un script no se puede
> verificar, el script debe bloquearse** — el fail-open actual no era intencional. Este plan
> implementa ese cambio.
>
> **Elaborado con:** Opus 5, 2026-07-28 (investigación del código real, sin cambios).
> **✅ Las 3 decisiones del operador están tomadas** (§7): C7 en release propio · sin kill switch ·
> mensaje único y amigable al usuario.
> **Ejecutar en 3 sesiones** (ver §6 — el orden importa y no es negociable):
> **Fase 1 → Sonnet MEDIO** · **Fase 2 → Sonnet ALTO** · **Fase 3 → Sonnet ALTO**.
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
> al menos 24 h de log limpio. Este plan está diseñado para ejecutarse en **3 sesiones separadas**
> (§6) con esa espera en el medio; si se junta todo en una sola se pierde la única señal que dice si
> es seguro endurecer el cliente.

---

### FASE 2 — Cliente Electron · requiere release (v2.7.45)

> ⚠️ **Antes de escribir código, leer esto.** Por la decisión **Q6.c** (§7), los textos que aparecen
> en los campos `error:` de los snippets de abajo son **placeholders descriptivos**, no el texto
> final. Los 4 casos de rechazo (C2, C3, C4, C5) deben devolverle al usuario **el mismo mensaje**:
>
> > *"No se pudo verificar la integridad de los componentes de la aplicación. Cerrá y volvé a abrir;
> > si el problema persiste, contactá a soporte."*
>
> **Definir una constante única** al tope de `authManager.js` (ej. `const ERROR_INTEGRIDAD = '…'`) y
> usarla en los 4 sitios. El detalle técnico (script, etapa, excepción) va **solo** a
> `console.error` y `securityAudit`, que es donde sirve para diagnosticar.

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

> **Fin de la Fase 2.** Los 5 cambios de arriba (C2…C6) son todos el mismo tipo: un `warn` que pasa
> a ser un rechazo. Se implementan, verifican y publican juntos como **v2.7.45**.

---

### FASE 3 — Cliente Electron · segundo release (v2.7.46)

Fase separada por decisión del operador (Q6.a): **es el único ítem que agrega lógica nueva**, no
solo endurece la existente. Va sola para que, si algo falla en su verificación, no haya duda de cuál
cambio lo causó.

**Prerrequisito:** v2.7.45 (Fase 2) publicada y corriendo bien unos días.

#### C7. F6 — que la etapa 3 verifique el disco de verdad

**Archivos:** `authManager.js` ~502 (escritura) y ~528 (verificación)

Al escribir el `.enc`, guardar su hash; en etapa 3, releer el archivo **del disco** y comparar:

```js
// Al escribir (~502), después de fs.writeFileSync(encScriptPath, encryptedContent, 'utf8'):
const encDiskHash = this.scriptVerifier.calculateChecksum(encryptedContent);

// En etapa 3 (~528), reemplazando el bloque que lee de scriptCache:
const encOnDisk = fs.readFileSync(encScriptPath, 'utf8');
if (this.scriptVerifier.calculateChecksum(encOnDisk) !== encDiskHash) {
    return reject({ success: false, error: ERROR_INTEGRIDAD });   // ver Q6.c
}
```

Esto cierra la ventana real (manipulación entre escritura y `fork`) sin desencriptar nada y sin
tocar `scriptVerifier.js`.

> ⚠️ **Detalle verificado:** `authManager.js` **no importa `crypto`** hoy. Usar
> `this.scriptVerifier.calculateChecksum(contenido)`, que es público (`scriptVerifier.js:95`), hace
> exactamente el mismo SHA-256 y **no modifica la zona protegida** (solo la usa) — evita agregar un
> import solo para esto. Es lo que muestra el snippet de arriba.

**Verificación específica de la Fase 3** (además de la no-regresión de §5.1, que se repite igual):

1. Los 3 flujos reales contra el PJN → **ninguno debe fallar**.
2. Prueba de bloqueo: sobrescribir el `.enc` en `tempDir` entre la escritura y el `fork` (requiere
   insertar un `sleep` temporal en el código para tener tiempo de hacerlo a mano) → debe rechazar.
   **Revertir el `sleep` al terminar.**
3. Confirmar en el log que la etapa 3 ahora reporta sobre el archivo en disco, no sobre la caché.

---

## 5. Verificación de la Fase 2 — qué probar y qué significa cada resultado

El objetivo es doble y hay que medir los dos lados: **que bloquee lo que debe** y —más importante—
**que NO bloquee lo que no debe**.

> **§5.1 (no-regresión) se repite tal cual en la Fase 3.** Lo específico de cada fase son las
> pruebas de bloqueo: §5.2 para la Fase 2, y la lista propia de la Fase 3 en §4.

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

> **Ojo con qué se verifica acá.** Por la decisión Q6.c, **el usuario ve siempre el mismo mensaje**
> en los 4 casos. Lo que distingue una prueba de otra es **el log** (`console.error` +
> `securityAudit`), no la pantalla. La columna "Esperado" de abajo describe **la línea del log**.

| Prueba | Cómo forzarla | Esperado (en el log) |
|---|---|---|
| **Firma inválida** (ya funcionaba) | Corromper 1 byte de `signature` en la respuesta del backend de staging | `🚨 FIRMA INVÁLIDA` — no-regresión del camino que ya bloqueaba |
| **C3 / F4** | Parche temporal en `client.js` de staging: `securityData = null` | `🚨 SCRIPT SIN FIRMA DIGITAL` |
| **C4 / F7** | Renombrar `public.pem` en una copia del build empaquetado | `🚨 Verificador de integridad no inicializado` |
| **C2 / F1** | Parche temporal en el `verifyFull` del cliente que lance un `Error` genérico | `🚨 VERIFICACIÓN FALLIDA` |

En los 4 casos, además: **el flujo se detiene** (no se abre Chrome, no corre nada) y el usuario ve
el mensaje único de Q6.c.

**Revertir todos los parches de prueba al terminar** y confirmar por `grep` que no quedó ninguno —
mismo checklist que ya se usó en la verificación del Bloque A.

> La prueba de bloqueo de **C7/F6** no está en esta tabla: pertenece a la **Fase 3** y está
> documentada en su propia sección (§4, FASE 3).

### 5.3 Release

Checklist estándar de CLAUDE.md: bump de versión → tag → `npm run release` → versión visible en los
5 lugares (portal `app.js` + landing ×4) → deploy → verificar en vivo.

- **Fase 2:** `2.7.44 → 2.7.45`, tag `electron-v2.7.45`.
- **Fase 3:** `2.7.45 → 2.7.46`, tag `electron-v2.7.46` (mismo checklist, se repite completo).

**Presupuestar el bug recurrente de `npm run release`** (8 releases seguidos: v2.7.38 a v2.7.44) —
el release queda incompleto y hay que subir `.blockmap` + `latest.yml` regenerado a mano vía la API
de GitHub. No es una sorpresa, es el procedimiento; está documentado en CLAUDE.md.

---

## 6. Orden de ejecución (no negociable) — 3 fases

```
Sesión 1 · Sonnet MEDIO ── FASE 1: backend (C1)  ~6 líneas, 1 archivo
                           └─ staging → prod → smoke → 13/13 scripts firmados
                                      ↓
                    ⏸️  ESPERA 24-48 h monitoreando error.log
                       · grep "[SEGURIDAD] No se pudo firmar"
                       · si aparece aunque sea 1 vez → DETENER el plan
                       · 💡 aprovechar la ventana para las verificaciones
                         operativas pendientes del Bloque C (ver nota abajo)
                                      ↓
Sesión 2 · Sonnet ALTO  ── FASE 2: cliente, endurecer (C2…C6)
                           └─ verificación §5 completa → release v2.7.45
                                      ↓
                    ⏸️  Confirmar que v2.7.45 corre bien unos días
                                      ↓
Sesión 3 · Sonnet ALTO  ── FASE 3: cliente, etapa 3 real (C7)
                           └─ verificación → release v2.7.46
```

**Por qué la espera de la Fase 1 no es opcional:** es la única forma de saber si el firmador del
servidor falla alguna vez en condiciones reales. Endurecer el cliente sin ese dato es apostar a que
nunca falla — y si falla, el síntoma es *todos los usuarios sin poder ejecutar nada*, con el
agravante de que el fix requiere un release nuevo (horas), no un `pm2 restart` (segundos).
**Sin kill switch (Q6.b), esta espera es el único colchón real del plan.**

> 💡 **Las verificaciones del Bloque C se solapan perfectamente con esta ventana.** Correr los 3
> flujos reales contra el PJN (pendiente desde el Bloque C) **genera exactamente el tráfico de
> descarga de scripts que la Fase 1 necesita monitorear**. En vez de dos esperas separadas, es una
> sola: se corren los flujos, se cierra la verificación funcional del Bloque C, y de paso se
> alimenta el log que decide si es seguro pasar a la Fase 2.

### Modelo y esfuerzo por fase

| Fase | Modelo/esfuerzo | Por qué |
|---|---|---|
| **1** — backend | Sonnet **MEDIO** | Un cambio de ~6 líneas en un archivo, deploy `scp` + restart, verificación mecánica (13 descargas + grep del log). No hay lógica distribuida ni estado async que razonar. Pedir ALTO acá sería inflar el costo sin ganancia |
| **2** — cliente, endurecer | Sonnet **ALTO** | 5 sitios en `authManager.js` donde hay que **respetar el patrón de cada uno** (`return` vs `reject` — el plan lo advierte, es la clase de detalle que rompe en silencio), + 5 pruebas de bloqueo con parches temporales que hay que revertir sin dejar residuo, + release completo con el bug recurrente. La verificación pesa más que el diff |
| **3** — etapa 3 real | Sonnet **ALTO** | El diff es chico pero **agrega lógica nueva en el camino crítico de toda ejecución**, y toca el flujo de escritura↔`fork`. Conceptualmente es el más delicado de los tres |

---

## 7. Decisiones del operador — ✅ LAS 3 RESUELTAS (2026-07-28)

### ✅ Q6.a — C7 (F6, la etapa 3 real) va en **su propio release**, aparte de C2-C6

**Decisión: separado.** C2-C6 son todos el mismo cambio conceptual (un `warn` que pasa a ser
`return`/`reject`), verificables juntos. C7 **agrega lógica nueva** —hashear al escribir, releer y
comparar antes de ejecutar— en el camino crítico de toda ejecución. Mezclarlo significaría que, si
algo falla en la verificación de §5, habría que averiguar cuál de los dos tipos de cambio lo causó.

**Consecuencia práctica:** el plan pasa a tener **3 fases** (backend → cliente/endurecer →
cliente/etapa 3), con **2 releases de Electron** (v2.7.45 y v2.7.46).

### ✅ Q6.b — Sin kill switch remoto

**Decisión: NO.** Un interruptor remoto para desactivar la verificación de firmas es, por
definición, una puerta trasera que anula exactamente la protección que este plan agrega — quien lo
controle (o logre suplantarlo) desactiva el sistema entero.

**El escape ante un problema es el fix-forward** que el proyecto ya usa: publicar la versión
siguiente con el comportamiento corregido. Es más lento que un flag, y esa lentitud es parte del
costo de tener una verificación que verifica de verdad. **Esto refuerza por qué el orden de §6 no
es negociable:** sin kill switch, el único colchón real es haber verificado el backend primero.

### ✅ Q6.c — Mensaje único y accionable para el usuario, detalle técnico solo en el log

**Decisión: mensaje amigable.** Los 4 casos de rechazo (C2, C3, C4, C5) devuelven al usuario **el
mismo texto**:

> **"No se pudo verificar la integridad de los componentes de la aplicación. Cerrá y volvé a abrir;
> si el problema persiste, contactá a soporte."**

El detalle técnico (qué script, qué etapa, qué excepción) va **solo** a `console.error` y a
`securityAudit` — que es donde sirve para diagnosticar.

**Implicancia para C2-C5:** los `error:` de los snippets de §4 son **placeholders**. Al implementar,
los 4 usan el texto de arriba. Sugerencia: definir una constante única al tope del archivo
(ej. `const ERROR_INTEGRIDAD = '…'`) y referenciarla en los 4 sitios, para que no se desincronicen.

**Nota honesta sobre el trade-off:** un mensaje único es mejor para el usuario, pero le quita a
soporte la pista inmediata de qué falló. Por eso el detalle en `securityAudit` no es opcional — es
lo que hace que esta decisión no cueste capacidad de diagnóstico.

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

**Sesión 1** — Sonnet MEDIO:
> «Ejecutá la **Fase 1** del plan `docs/internal/plan-Q6-verificacion-firmas-2026-07-28.md`.»

**Sesión 2** — Sonnet ALTO (tras 24-48 h con log limpio):
> «Ejecutá la **Fase 2** del plan `docs/internal/plan-Q6-verificacion-firmas-2026-07-28.md`.»

**Sesión 3** — Sonnet ALTO (tras confirmar que v2.7.45 corre bien unos días):
> «Ejecutá la **Fase 3** del plan `docs/internal/plan-Q6-verificacion-firmas-2026-07-28.md`.»

**Reglas de ejecución:** backup de DB antes de cualquier cambio · staging antes que prod · verificar
`DB_NAME` antes de cualquier escritura · **nunca** `git add -A` · `node -r dotenv/config <script>
dotenv_config_path=.env.staging` para cualquier script de mantenimiento contra staging (bug de
`dotenv` documentado) · **cero cambios en `electron-app/src/security/`** — si parece necesario,
detenerse y consultar.
