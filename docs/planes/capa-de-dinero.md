# Plan capa de dinero — "el cuadre" (Fase 3)

**Qué es esto.** El mecanismo aprobado (2026-08-12) para hacer confiable el
número de dinero del dueño en `apps/lifestyle`. **El eje:** la comparación
pantalla-vs-caja ocurre DENTRO de la app y el descuadre es dato de primera
clase — la app nunca compite contra el cajón; lo muestra. Tres piezas: el piso
de honestidad (la agenda deja de mentir), los movimientos fuera de agenda
(entradas/salidas firmadas) y el corte a ciegas (la verdad externa, con signo).

**Contexto mínimo que necesitas** (la discusión completa no está en tu
contexto): hoy el ingreso se deriva 100% de la agenda
(`price_charged ?? service.price` sobre `completed`); no existe ningún concepto
de pago, caja, gasto o producto; el precio siempre es el de lista (nada escribe
`price_charged` — solo el trigger `seal_appointment_price`, que rellena SOLO si
es NULL); el cron `dispatch-auto-cancel` está muerto en producción (schedule
manual en el Dashboard, no versionado); el dueño del cliente #1 NO está en el
local (solo administra); la WABA sigue sin verificar; no hay base del cliente
#1 — se decide sin dato de conducta real y por eso la instrumentación es parte
del diseño, no un extra.

## Decisiones cerradas (no re-discutir)

1. **El eje**: el descuadre se calcula, se guarda y se muestra dentro de la
   app. Nunca se esconde, nunca se netea en silencio.
2. **Riel (método de pago) obligatorio** en toda captura de dinero nueva:
   `efectivo | tarjeta | transferencia`. Default efectivo, UN tap para cambiar.
   El riel jamás queda NULL en filas nuevas — por construcción (default), no
   por error de validación.
3. **El corte le llega al dueño el mismo día** (WhatsApp a
   `businesses.report_whatsapp`, la maquinaria del reporte semanal). Si el
   envío falla, la UI dice "aviso no entregado" — prohibido fingir envío.
4. **El signo del descuadre es diagnóstico** y siempre se muestra con signo,
   nunca en valor absoluto. Negativo persistente = falta efectivo (salidas sin
   registrar o fuga). Positivo persistente = ingresos sin capturar
   (típicamente walk-ins).
5. **La raya se difiere pero NO es conveniencia**: es la palanca de retención
   del producto (ver sección "La raya" — con disparador explícito).
6. **Modelo de pago como configuración desde la primera migración**
   (`staff.compensation_model`), sin UI en v1 — para no pagar migración de
   datos después.
7. **Caja única del negocio** (supuesto de trabajo salvo dato del cliente #1;
   la extensión por-barbero para renta de silla se documenta, no se construye).
8. **Tres estados epistémicos** con etiqueta distinta (tabla abajo). Solo lo
   confirmado puede ser héroe.
9. **Control de caja, no contabilidad**: cero fiscal, cero CFDI, conceptos
   como chips coloquiales. La interfaz no debe oler a SAT.
10. **Append-only**: un movimiento o corte no se edita ni se borra — se anula
    con contraentrada firmada o se reemplaza con fila nueva ligada. El pasado
    cerrado no se reescribe en silencio.

## Los tres estados epistémicos

| Estado | Qué es | Etiqueta | ¿Héroe? |
|---|---|---|---|
| **Confirmado** | Eventos firmados: citas cobradas (persona completó con monto+riel), movimientos, cortes | "Cobrado" | SÍ — el único |
| **Derivado** | Agenda futura × precio de lista | "Agendado" | nunca |
| **Estimado** | Proyecciones (potencial del pulso, ocupación) | "Potencial" + tag "estimado" (patrón PR-Neg-1) | nunca |

Nota de frontera: completar sin editar (default lista+efectivo) ES confirmación
humana de bajo esfuerzo — el que completó lo vio y no lo corrigió. El precio
sellado por trigger de citas completadas ANTES de D2 es derivado; el cliente #1
nace con D2 activo, así que no tendrá ninguna.

## Reglas globales (aplican a TODOS los pasos)

- **Un paso = un PR = un problema.** Mergeable solo si la vista queda funcional.
- **Gates por paso**: `cd apps/lifestyle && npx tsc --noEmit` → 0 errores ·
  `npx eslint .` → 0 errores nuevos · `npm test` (raíz) completo en verde.
- **Cálculo nuevo = módulo puro** (sin DB/red/React) en `apps/lifestyle/src/lib/`
  con tests `node:test` — el patrón de `lib/pulso.ts`.
- **Verificación con `TZ=UTC`**: dev server `TZ=UTC` (config `lifestyle-utc`
  de `.claude/launch.json`, puerto 3210). Los bugs de TZ se esconden si la
  máquina está en hora de México.
- **Tablas nuevas nacen blindadas**: `tenantDb`
  (`packages/engine/src/tenantDb.ts`) en todo acceso; RLS habilitado SIN
  políticas (deny-all — la app entra por service_role); fuera de la
  publicación Realtime; trigger append-only (patrón
  `trg_appt_audit_immutable`). Es el patrón de `appointment_tips`
  (migración `20260720000000_appointment_tips.sql`).
- **Prohibido**: tocar `appointment_tips` en cualquier forma (lint y repo-check
  rompen el build); netear salidas contra entradas en un mismo número; mostrar
  descuadre en valor absoluto; que la UI muestre el esperado del corte ANTES de
  capturar el contado; depender de un cron configurado a mano en el Dashboard;
  juicios en el copy ("descuadre grave") — dato + signo siempre; voseo
  (español mexicano neutro); emoji.
- **Actor siempre**: toda fila de dinero lleva `staff_id` de la sesión. Toda
  sesión humana actual lo porta: PIN → staff directo; dueño por email → fila
  `staff` vía `auth_id` (`lib/auth.ts:93-110`).

## Red de seguridad visual (obligatoria en cada paso)

**Prerrequisito: `scripts/seed-demo-densa.sql` corrido contra la BD demo al
inicio del paso** (antes de la captura "antes") y **prohibido re-sembrarlo
entre el antes y el después del mismo paso**. Capturas a 375px, página
completa, comparadas contra el criterio del paso ("qué debe cambiar / qué no").
Procedimiento Playwright temporal: el bloque de `docs/planes/dueno-v3.md`
(sección "Red de seguridad visual") — mismo script `cap.mjs`, mismas
credenciales del dueño. Para las vistas de staff (pasos D2/D4/D5): mismo
viewport y reglas, login por PIN en `/barberia-demo/staff` (barbero 1234,
asistente 5678).

---

## Paso D1 · [SEGURO] Migración fundacional

**Objetivo:** el esquema completo de la capa, en una sola migración, sin que
ninguna superficie cambie todavía.

**Archivo:** `supabase/migrations/20260812000000_capa_dinero.sql` (siguiente a
`20260720000000_appointment_tips.sql`).

**Contenido (columnas nuevas):**

- `appointments.payment_method` text NULL,
  CHECK (`payment_method IN ('efectivo','tarjeta','transferencia')`).
  NULL = fila legada; la obligatoriedad es del flujo (D2), no del schema —
  las 1,054 completadas del seed no deben romper.
- `businesses.caja_fondo` numeric(10,2) NOT NULL DEFAULT 0 CHECK (>= 0) —
  fondo de cambio del cajón. Sin él, el descuadre de efectivo carga un offset
  sistemático (+fondo) y la señal muere.
- `businesses.owner_last_seen_at` timestamptz NULL — instrumentación del
  riesgo terminal ("el dueño dejó de abrir la app"); hoy no existe ninguna
  analítica (verificado: grep de analytics/last_seen vacío).
- `staff.compensation_model` text NULL,
  CHECK (`IN ('comision','renta','sueldo')`). Sin UI en v1 (decisión 6).

**Tabla `caja_movimientos`:**

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| business_id | uuid NOT NULL FK businesses | |
| type | text NOT NULL | CHECK entrada / salida |
| amount | numeric(10,2) NOT NULL | CHECK > 0 AND <= 99999999.99 (techo de `MAX_TIP`, `staff/actions.ts`) |
| method | text NOT NULL | CHECK efectivo / tarjeta / transferencia — decisión 2 |
| concept | text NOT NULL | CHECK pareado: entrada → walkin / producto / otro; salida → insumos / retiro / otro |
| note | text NULL | libre, corto |
| staff_id | uuid NOT NULL FK staff | autor (sesión) |
| appointment_id | uuid NULL FK appointments | liga opcional |
| reverses_id | uuid NULL FK caja_movimientos | contraentrada; una fila solo puede ser revertida una vez (UNIQUE) |
| occurred_on | date NOT NULL | día LOCAL del negocio, lo calcula la action |
| created_at | timestamptz DEFAULT now() | |

Índice `(business_id, occurred_on)`. Trigger append-only: bloquea UPDATE y
DELETE siempre.

**Tabla `caja_cortes`:**

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid NOT NULL FK | |
| corte_date | date NOT NULL | día local |
| staff_id | uuid NOT NULL FK staff | quien contó |
| cash_counted / card_counted | numeric(10,2) NOT NULL CHECK >= 0 | lo leído de los artefactos físicos |
| expected_cash / expected_card | numeric(10,2) NOT NULL | LA FOTO congelada al instante del corte — no se recalcula jamás |
| fondo_snapshot | numeric(10,2) NOT NULL | el `caja_fondo` vigente al corte (cambiar la config no reescribe histórico) |
| cash_diff / card_diff | numeric GENERATED ALWAYS AS (counted − expected) STORED | CON SIGNO (decisión 4) |
| replaces_id | uuid NULL FK caja_cortes | corrección = fila nueva; la última por día manda, la historia queda |
| notified_at | timestamptz NULL / notify_error text NULL | resultado del aviso (D5) |
| created_at | timestamptz DEFAULT now() | |

Índice `(business_id, corte_date DESC)`. Trigger append-only con UNA
excepción: permite UPDATE que solo toque `notified_at`/`notify_error` (el
resto de columnas inmutables comparando OLD/NEW); DELETE bloqueado siempre.

**Ambas tablas:** RLS enabled sin políticas; fuera de Realtime.

**Qué NO tocar:** ninguna action, ningún componente, el seed.
**Aceptación:** migración aplicada; INSERT sin `method` → falla; UPDATE de un
movimiento → bloqueado por trigger; UPDATE de `cash_counted` en un corte →
bloqueado; UPDATE de solo `notified_at` → pasa; `SELECT` anónimo por
PostgREST → vacío (patrón de verificación de `appointment_tips`).
**Red visual** *(seed corrido)*: capturas idénticas — **nada debe cambiar**.

---

## Paso D1b · [SEGURO] Seed denso de caja (demo)

**Objetivo:** la demo deja de heredar 1,316 citas selladas con CERO cortes,
movimientos y descuadres. Sin esto: (a) la pieza que más diferencia — el
cuadre — se ve vacía justo en las demos de venta, y (b) la red visual de
D4/D5 fotografiaría estados vacíos y los aprobaría como correctos.

**Decisión (paso propio, no prerrequisito de D2):** toca un artefacto
compartido con estándar propio (idempotente, determinista, relativo a hoy) y
su aceptación es distinta (doble corrida = mismo estado). Como prerrequisito
difuso dentro de otro paso se ejecutaría tarde o a medias — exactamente el
hueco que motiva este paso.

**Archivo:** `scripts/seed-demo-densa.sql` (requiere la migración D1 aplicada
a la demo). Mismo pseudo-aleatorio `pg_temp.h`, sin `random()`.

**Qué agrega:**
- **Purga** (sección 1 del script): `caja_movimientos` y `caja_cortes` del
  negocio se suman al borrado inicial.
- `businesses.caja_fondo = 500` — ÚNICA excepción nueva al "NO TOCA
  businesses" del header (config numérica, idempotente; documentarla ahí).
- `payment_method` en las citas completadas del seed: hash ≈75% efectivo /
  22% tarjeta / 3% transferencia.
- **Movimientos de ~30 días**: 0–3 por día por hash — entradas walk-in
  ($100–$250) y producto ($80–$400); 1–2 salidas por semana (insumos/retiro,
  $60–$200); autor = barbero elegido por hash; `occurred_on` local.
- **Cortes diarios de las últimas ~4 semanas, con huecos**: domingos sin
  corte (negocio cerrado) + ~1 día hábil por semana saltado por hash + **HOY
  sin corte** (para poder crearlo en vivo durante una demo). `expected_*`
  calculado del propio seed con LA MISMA regla de `lib/corte.ts` (citas por
  `completed_at` local + entradas − salidas por riel + fondo 500);
  `counted` = expected + ruido chico de **SIGNO MIXTO** por hash
  (−$80…+$80, sin cero sistemático — un cuadre perfecto diario es la señal
  de teatro que el plan mismo vigila); firmado por staff por hash;
  `created_at` ≈ 21:30 local del día.
- **Resumen final del script**: + conteo de movimientos, cortes, días sin
  corte y suma de descuadres.

**Caso de aceptación:** correrlo DOS veces el mismo día → mismos conteos y
mismos descuadres (determinismo); cuando exista la serie del dueño (D5),
muestra signos mezclados y HOY aparece "sin corte aún".

**Qué NO tocar:** bot_conversations / conversation_messages / bot_logs /
`appointment_tips` (igual que hoy); ninguna otra columna de `businesses`.
**Red visual**: capturas idénticas — **ninguna superficie lee estas tablas
todavía**.

**Pregunta abierta que se decide EN este paso (no antes, no por el ejecutor):
¿re-siembra programada del demo de madrugada?** El seed es relativo a HOY y
caduca en días: verificado el 2026-08-12, el demo llevaba una semana vencido y
estaba **sin citas hoy y sin futuras** (documentado en `scripts/README.md`). Eso
degrada dos cosas a la vez — el demo como herramienta de venta se ve muerto, y
la red de seguridad visual se vuelve un sello de goma (dos pantallas vacías
idénticas "prueban" que nada se rompió). Con `pg_cron` ya versionado por D3, un
`cron.schedule` nocturno que re-siembre `barberia-demo` es barato de construir.
**El riesgo a sopesar, y por eso no se decide de antemano:** el seed es
DESTRUCTIVO — borra las citas del negocio — así que una re-siembra automática
puede tirar el estado creado EN VIVO durante una demo o una verificación (una
cita agendada delante del cliente, un corte capturado a mano). Variantes a
considerar cuando toque: no hacer nada (seguir corriéndolo a mano, con la señal
de vencimiento del README), cron nocturno a secas, cron con guardia (saltar si
hubo escritura de la app en las últimas N horas), o re-siembra sin purga
(extender la ventana de fechas en vez de borrar). **Dependencia:** cualquier
variante con cron va DESPUÉS de D3.

---

## Paso D2 · [SEGURO] El cobro real: monto + riel al completar

**Objetivo:** completar una cita registra cuánto entró de verdad y por qué
riel, sin romper la ergonomía del swipe de 2 segundos.

**Archivos (verificados):**
- `apps/lifestyle/src/lib/cobro.ts` **nuevo** (puro) + `tests/cobro.test.ts`:
  `resolveCobro(input, listPrice)` → valida monto (0 < x ≤ 99,999,999.99) y
  riel; defaults `{ amount: undefined, method: 'efectivo' }`.
- `apps/lifestyle/src/app/staff/actions.ts:57`
  (`updateAppointmentStatusAsBarber`): firma extendida
  `(appointmentId, status, cobro?)`. Al completar escribe en el MISMO update:
  `payment_method: cobro?.method ?? 'efectivo'` SIEMPRE, y `price_charged:
  cobro.amount` SOLO si el usuario lo editó — el default de precio lo pone el
  trigger `seal_appointment_price` (verificado: rellena únicamente si
  `price_charged IS NULL`, así que respeta el monto explícito). Cero fetch
  extra de catálogo.
- `apps/lifestyle/src/app/staff/assistant-actions.ts:252`
  (`completeAppointment`): misma extensión.
- `apps/lifestyle/src/app/dashboard/actions.ts:23`
  (`updateAppointmentStatus`): misma extensión. Firmas retrocompatibles
  (`cobro` opcional) — localizar callers con grep en ejecución; siguen
  funcionando sin cambio.
- UI barbero: `components/staff/AppointmentThread.tsx` + `HeroCard.tsx` — en
  la ventana de delay-commit del swipe "Terminó" aparece el chip
  **"$200 · Efectivo — toca para cambiar"**; tocarlo abre el detalle en
  `AppointmentSheet.tsx` (monto editable + 3 chips de riel). No tocar nada →
  defaults. `TipSheet.tsx` NO cambia (sus % ahora corren sobre el cobrado
  real — mejora gratis, ya lee `price_charged`).
- UI asistente: `components/staff/AssistantControlDesk.tsx` — el control de
  completar gana monto + chips riel, default efectivo.
- `lib/dashboard.types.ts`: `payment_method` en los tipos donde se escriba.

**Regla de cálculo:** ninguna nueva — cambia solo la FUENTE del dato (humano
en vez de catálogo, riel explícito). `no_show`/`cancelled` no llevan cobro.

**Caso numérico:** cita con servicio de lista $200. (a) Swipe sin tocar →
fila queda `price_charged=200` (sellada por el trigger), `payment_method=
'efectivo'`. (b) Cobro editado a $150 tarjeta (cortesía) → `price_charged=150`
(el sello NO lo pisa), `payment_method='tarjeta'`; `appointment_audit` de ese
UPDATE lleva `changed_fields ⊇ {status, price_charged, payment_method}` con
actor staff real (trigger `log_appointment_audit`, verificado en vivo).

**Qué NO tocar:** `seal_appointment_price` (queda como red para completadas
sin monto explícito); el flujo del bot (el bot nunca completa citas);
`setAppointmentTip`.
**Red visual** *(seed corrido; prohibido re-sembrar entre antes/después)*:
cambia SOLO la vista del barbero (chip en delay-commit) y el control del
asistente; TODO lo del dueño idéntico píxel a píxel.

---

## Paso D2b · [SEGURO] El desglose a un tap: drawer de historial por cita

**Objetivo:** que ningún número del dueño sea un número sin origen — tocar una
cita abre su historial (quién la creó, quién la movió, quién la cobró, cuánto y
por qué riel), leído del audit que ya se captura.

**De dónde sale este paso (no es alcance nuevo):** era la mitad no construida de
la capa visible del audit de S6-SEC-01 (Fase 2c-i previó "drawer por cita +
panel del dueño"). El panel ya vive en la pestaña **Actividad**
(`lib/activityFeed.ts` → `ActividadView`); el drawer no existe —
`appointment_audit` no tiene otro lector en la app. **Decisión de Gabriel
(2026-08-12):** deja de estar diferido sin fecha y se ancla acá, **después de
D2**, porque antes de D2 el historial de una cita muestra poco más que cambios
de estado; con D2 el audit ya trae `price_charged` y `payment_method` en
`new_data`/`changed_fields` (el caso numérico de D2 lo fija: `changed_fields ⊇
{status, price_charged, payment_method}` con actor staff real) y el drawer se
vuelve el desglose a un tap del principio de trazabilidad.

**Secuencia:** en cualquier punto **después de D2**; NO bloquea D3–D6 ni
dv3-3'…6 (nadie depende de él). Si el orden aprieta, va al final.

**Superficie (v1 = el dueño):** la lectura del audit está restringida a
admin/owner por decisión de 045 — el JSONB lleva PII (`booking_name`, `notes`,
teléfono por join) y barberos/asistentes NO la leen. El drawer v1 cuelga
entonces de una superficie del dueño; llevarlo a la ficha del barbero
(`AppointmentSheet.tsx`) sería **reabrir esa decisión de PII**, no un detalle de
implementación: si se quiere, se decide aparte.

**Qué NO está especificado todavía (y no se improvisa):** de qué superficie
exacta del dueño cuelga, y con qué componentes. Este plan no lo fija porque se
escribió antes de que existieran D2 y el restyle de dv3-3'/4', que son los que
definen dónde vive un número tocable. Cuando le toque el turno, este paso pide
el mismo pase de verificación ruta-y-línea que los demás — no arrancar sin él.

**Qué NO tocar:** el trigger de captura (045) y la inmutabilidad — el drawer es
SOLO lectura; `appointment_tips` (jamás); la RLS de 045.

---

## Paso D3 · [SEGURO] Cabos sueltos + crons versionados

**Objetivo:** lo pasado sin resolver se ve (nunca se absorbe en un total), y
los crons dejan de vivir en el Dashboard.

**Archivos:**
- `apps/lifestyle/src/lib/cabos.ts` **nuevo**: citas `pending|confirmed` con
  `starts_at < ahora`, ventana 14 días, count + lista. Puro + query scopeada.
- Superficies mínimas v1 (el restyle llega con dv3-4'):
  `components/staff/AssistantControlDesk.tsx` (fila "N sin resolver" con
  resolución inline vía las actions existentes) y
  `components/admin/DashboardLayout.tsx` (línea de conteo para el dueño).
- **Migración** `supabase/migrations/<fecha>_crons_versionados.sql`:
  `CREATE EXTENSION pg_cron` + `pg_net` (ambas disponibles en el proyecto,
  verificado; `supabase_vault` ya instalada). Función `invoke_edge(fn text)`
  SECURITY DEFINER: lee `edge_base_url` y `edge_invoke_secret` de
  `vault.decrypted_secrets` y hace `net.http_post` con Authorization.
  `cron.schedule` cada minuto para `dispatch-auto-cancel` y
  `dispatch-lifestyle-notifications`. **El schedule queda versionado; el
  secret se siembra UNA vez en Vault** (documentarlo en `scripts/README.md` —
  operación manual inevitable: los secretos no viven en el repo).
- Ajuste del RPC `mark_appointment_no_show` (lo usa
  `supabase/functions/dispatch-auto-cancel/index.ts:295`): `set_config(
  'app.actor_type','system',true)` antes del UPDATE si no lo hace ya (leer
  `pg_get_functiondef` en ejecución) — `actor_type` admite `'system'`
  (CHECK verificado en vivo).

**Caso de aceptación (evidencia de vida):** las ~25 `confirmed` vencidas de la
demo (31-jul → 6-ago) pasan a `no_show` tras un ciclo del cron, con
`actor_type='system'` en su fila de audit; `cron.job_run_details` muestra
corridas OK. (Nota: el trigger de stats moverá `noshow_count`/`is_flagged` de
clientes demo — ruido aceptable; el seed re-corre y lo normaliza.)

**Qué NO tocar:** la lógica interna de las edge functions; los schedules
manuales existentes se ELIMINAN del Dashboard al verificar el cron nuevo
(anotarlo en el PR).
**Red visual**: cambia SOLO la línea de cabos en asistente y dueño.

---

## Paso D4 · [SEGURO] Movimientos fuera de agenda

**Objetivo:** el dinero que no pasa por la agenda (walk-in sin cita, producto,
salida de caja) entra al sistema en 3 taps, firmado.

**Archivos:**
- `apps/lifestyle/src/app/staff/caja-actions.ts` **nuevo**:
  - `createCajaMovimiento(input)` — sesión vía `requireBusinessSession`
    (`lib/auth.ts:175`, allowlist owner/admin/barber/assistant); valida con
    `lib/cobro.ts`; `occurred_on` = fecha LOCAL vía `getBusinessTimezone`
    (`lib/auth.ts:211`) + helpers de `lib/dayWindow.ts`; inserta con
    `staff_id` de la sesión y `tenantDb`.
  - `reverseCajaMovimiento(id)` — contraentrada: INSERT espejo con
    `reverses_id`, jamás UPDATE.
  - `listCajaDia(date)` — movimientos del día local, con nombre del autor.
- UI: botón "+ Movimiento" en `AssistantControlDesk.tsx` y en la vista del
  barbero (pestaña Hoy). Sheet: monto → chips de concepto → riel (default
  efectivo) → nota opcional. Lista del día con autor + hora; anulado se
  muestra tachado con su contraentrada (ambas filas visibles — decisión 10).
- `apps/lifestyle/src/lib/activityFeed.ts`: `caja_movimientos` como tercera
  fuente del feed (hoy mezcla `appointment_audit` + `management_audit` por
  `created_at` — verificado en el encabezado del módulo; mismo patrón de
  merge). Con esto todo movimiento es trazable a un tap desde Actividad.

**Regla de cálculo:** ninguna — captura pura. El titular del dueño NO cambia
todavía (eso es D6).

**Caso numérico (TZ, a mano):** negocio en `America/Mexico_City` (UTC−6
fijo). El asistente registra un walk-in de $150 efectivo a las 21:40 local del
martes = `03:40Z` del miércoles → `occurred_on` = **martes** (día local, no
UTC). Su contraentrada deja el neto del martes en $0 pero AMBAS filas
aparecen en la lista y en Actividad.

**Qué NO tocar:** `assistant-actions.ts` (los movimientos viven en módulo
propio); el titular del dueño; el corte (no existe aún).
**Red visual**: cambian asistente/barbero (botón + lista) y Actividad (filas
nuevas); Panorama y el resto del dueño idénticos.

---

## Paso D5 · [SEGURO] El corte a ciegas + aviso al dueño

**Objetivo:** la verdad externa entra al sistema: dos números leídos de
artefactos físicos, capturados a ciegas, congelados, firmados — y el dueño
ausente se entera el mismo día.

**Archivos:**
- `apps/lifestyle/src/lib/corte.ts` **nuevo** (puro) + `tests/corte.test.ts`:
  - `expectedByRail(citasCobradasDia, movimientosDia, fondo)` →
    `{ efectivo: fondo + Σ citas ef + Σ entradas ef − Σ salidas ef,`
    `  tarjeta: Σ citas tj + Σ entradas tj − Σ salidas tj }`.
  - **Día de caja de una cita = fecha LOCAL de `completed_at`** (el dinero
    cuenta cuando se cobró, no cuando se agendó) — la única regla de
    atribución de toda la capa; el titular (D6) usa la misma.
  - Transferencias: FUERA de la comparación v1 (no hay artefacto físico); se
    muestran como línea informativa ("transferencias del día $X").
  - `signedDiff` — con signo, siempre.
- `caja-actions.ts`: `createCorte({cashCounted, cardCounted})` — el server
  calcula la foto esperada EN ese instante y la congela en la fila
  (`expected_*`, `fondo_snapshot`); **la UI jamás recibe el esperado antes de
  enviar** (el fetch no existe en el cliente — a ciegas por construcción);
  corrección = fila nueva con `replaces_id`. Tras el INSERT, la MISMA action
  envía el aviso al dueño: `sendWhatsAppMeta` de
  `@presenciapro/engine/notifications` a `businesses.report_whatsapp` usando
  `whatsapp_phone_number_id` — el patrón exacto de
  `app/api/reports/weekly/route.ts:28,294`. Éxito → `notified_at`; fallo →
  `notify_error` y la card muestra "aviso no entregado" (decisión 3).
  Texto: `Corte de hoy · Efectivo $1,180 (−$50) · Tarjeta $850 ($0) ·
  firmado por Marcos 9:04pm`.
- UI captura: card "El corte" en `AssistantControlDesk.tsx` — dos inputs
  (efectivo contado, voucher terminal) + guardar; el resultado (esperado,
  diferencia con signo) se revela DESPUÉS.
- UI dueño: card de solo lectura en `components/admin/DashboardLayout.tsx`:
  sin corte aún / resultado del día con firma y hora + serie de 7 días con
  signo (negativo `--color-red-ink`, positivo ámbar — atención, no alarma;
  tokens ya existentes).
- **Seed**: ya denso desde D1b (payment_method + movimientos + cortes con
  descuadres de signo mixto) — correrlo al inicio del paso como siempre; la
  serie del dueño y la card nacen con datos, no vacías.

**Caso numérico (a mano, negocio `America/Mexico_City`, servidor `TZ=UTC`):**
fondo $500. Citas completadas HOY (por `completed_at` local): $200 ef + $320
ef + $180 ef (cobro editado, lista $200) + $150 tj + $450 tj → ef $700, tj
$600. Movimientos: entrada walk-in $150 ef; entrada producto $250 tj; salida
insumos $120 ef. **Esperado: ef = 500+700+150−120 = $1,230 · tj = 600+250 =
$850.** Contado: $1,180 y $850 → **diffs −$50 y $0** (el −$50 se guarda y se
muestra CON signo). Una cita completada a las 23:40 local de AYER (`05:40Z`
de hoy) NO entra al corte de hoy. Una cita cobrada DESPUÉS del corte no
altera la fila congelada — aparece como "después del corte" en la card.

**Prerrequisito operativo (documentar, no código):** registrar el
`report_whatsapp` del dueño como destinatario de prueba de la WABA mientras
siga sin verificar; sin eso el aviso mostrará "no entregado" (estado honesto,
la captura y el descuadre funcionan igual).

**Qué NO tocar:** el titular del dueño (D6); `appointment_tips`; el esperado
jamás viaja al cliente antes del contado.
**Red visual**: cambian asistente (card corte) y dueño (card corte); el resto
idéntico.

---

## Paso D6 · [SEGURO] El titular cambia de fuente + el loop diario

**Objetivo:** el número que el dueño ve a diario pasa a ser "Cobrado"
(eventos), consistente centavo a centavo con lo que el corte compara, y el
hábito del dueño no depende de que se acuerde de abrir la app.

**Archivos:**
- `apps/lifestyle/src/lib/cobrado.ts` **nuevo** (puro) + tests — LA regla
  única del titular:
  `Cobrado(día) = Σ price_charged de citas completed con completed_at local
  ∈ día + Σ movimientos entrada con occurred_on ∈ día` (los 3 rieles,
  transferencia incluida). **Salidas: línea aparte, JAMÁS neteadas.**
- `apps/lifestyle/src/lib/pulsoHoy.ts` (piso hoy = `price_charged ??
  service.price`, línea 80): el "piso" del pulso pasa a `cobrado(hoy)` +
  dos líneas nuevas ("entradas fuera de agenda", "salidas"). Las demás
  superficies (semana/mes: `dashboard.types.ts:566,626`,
  `negocioMetrics.ts:58`, reportes) NO se tocan aquí — migran con dv3-3'/4';
  mientras tanto sus encabezados dicen "de agenda" (una palabra, no un
  rediseño).
- `app/dashboard/page.tsx`: touch best-effort de
  `businesses.owner_last_seen_at` al cargar con sesión de dueño.
- **Nudge "sin corte"**: ruta interna `app/api/internal/corte-nudge/route.ts`
  (Bearer `CRON_SECRET`, patrón de `api/reports/weekly`): negocios activos
  con `report_enabled` y sin corte del día local → aviso "hoy no hubo corte"
  por el mismo canal del D5. Schedule en la migración de crons:
  `0 5 * * *` UTC = 23:00 CDMX (México sin horario de verano desde 2022).

**Caso numérico (mismo día del caso D5):** agenda cobrada $1,300 (ef $700 +
tj $600) + entradas $400 → **"Cobrado hoy $1,700"**, con "Salidas $120"
aparte. NUNCA $1,580. El pulso, la card del corte y el aviso de WhatsApp
muestran los mismos números — una sola regla (`lib/cobrado.ts` +
`lib/corte.ts` comparten la atribución por `completed_at` local).

**Qué NO tocar:** `lib/pulso.ts` (la ocupación no cambia); las superficies
semana/mes (van con dv3); `appointment_tips` (el cobrado JAMÁS suma propinas).
**Red visual**: cambia SOLO el pulso del dueño (número + 2 líneas); las demás
pestañas idénticas.

---

## La raya — palanca de retención (NO es un paso de este plan)

La raya (liquidación por barbero según `compensation_model`) se difiere por
secuencia, no por valor: construir nómina sobre captura no confiable produce
el peor bug posible — un conflicto de dinero con el equipo. **Es el candado de
retención del producto: el día que la raya sale del sistema, dejar la app
cuesta volver al cuaderno del domingo.**

**Disparador explícito (revisar a las 2–3 semanas del cliente #1):** se
planifica como plan propio si (a) el descuadre mediano supera 10% del
capturado sostenido — la captura necesita el incentivo de la nómina — o (b)
el modelo confirmado del cliente es comisión. Este plan ya le deja lista la
base: `compensation_model` en staff, cobros reales por barbero y movimientos
con autor.

---

## Qué cambia de dueno-v3.md

- **Se conservan tal cual:** Pasos 1, 2, 5 y 6.
- **Congelados y re-especificados (no se pierden — cambian fuente y
  etiqueta):** el **Paso 3** (su héroe LA SEMANA pasa de ingreso-de-agenda a
  **"Cobrado"** con la regla de `lib/cobrado.ts` extendida a semana + chip del
  corte/descuadre del día; su caso numérico se rehace) y el **Paso 4** (la
  card del corte se re-estiliza al sistema; el $ del día ya viene de la
  fuente nueva; los agregados "de agenda" de equipo/servicios conservan su
  etiqueta).
- **Orden combinado (dependencias):**
  `S6-SEC-01 (cierre, fuera de este plan) → dv3-1 → dv3-2 → D1 → D1b → D2 →
  D3 → D4 → D5 → D6 → dv3-3' → dv3-4' → dv3-5 → dv3-6`.
  dv3-1/2 no comparten archivos con D1–D3 y pueden traslaparse. **D2b** (el
  drawer) no está en la ruta crítica: cualquier punto después de D2, sin
  bloquear a nadie. Cada paso deja `main` deployable.

## Cómo se ve el fracaso (instrumentación desde el día 1)

Todo sale de las tablas de este plan — nada extra que construir:

| Señal | Umbral de fracaso | Cuándo se sabe |
|---|---|---|
| El ritual no prende | <5 de los primeros 7 días hábiles con corte firmado | 1 semana |
| El cuadre no converge | descuadre mediano >10% del capturado, sin tendencia a la baja | 2 sábados (~15 días) |
| La señal es teatro | cortes en $0.00 exacto sistemáticos (conteos reales tienen ruido) · sábados llenos con cero movimientos | 1–2 semanas |
| El riesgo terminal | `owner_last_seen_at` sin moverse >7 días tras el primer mes · el dueño pide el número por WhatsApp en vez de abrir la app | 4–6 semanas |

Si aparecen las dos primeras → se adelanta la raya (la captura se vuelve la
nómina). Si aparece solo la última con las demás en verde → el problema no
era el dinero; re-examinar la premisa del producto para dueños ausentes.

## Dependencias manuales, por paso

**Regla para el ejecutor:** ninguna dependencia manual bloquea el MERGE de su
paso — bloquea solo el efecto externo, que debe quedar en su **estado honesto
y visible**. PROHIBIDO improvisar fallbacks (email, console.log-como-aviso,
invocar el cron a mano "para que pase"): un efecto bloqueado que se ve
bloqueado es correcto; uno maquillado es un bug.

| Paso | Dependencia manual (quién: Gabriel) | Si no está lista al ejecutar |
|---|---|---|
| D1 · D1b · D2 · D4 | **ninguna** | — |
| D3 | Vault: `edge_base_url` + `edge_invoke_secret` (documentar siembra en `scripts/README.md`) | la migración aplica igual; el cron corre y falla VISIBLE en `cron.job_run_details` — esa es la aceptación parcial |
| D5 | número del dueño (`report_whatsapp`) registrado como destinatario de prueba de la WABA (sigue sin verificar) | captura, foto congelada y descuadre funcionan COMPLETOS; el aviso queda "no entregado" (`notify_error`) — estado honesto, no fallo del paso |
| D6 | Vault: `app_base_url` + `cron_secret` (nudge) · la misma WABA de D5 | titular "Cobrado" y `owner_last_seen_at` funcionan; el nudge no dispara — visible en `cron.job_run_details` |

**Operativos no ligados a un paso:**
1. Cliente #1: confirmar modelo de pago y quién cierra el local (si no llega
   en 48 h desde 2026-08-12: caja única, decisión 7). Configurar `caja_fondo`
   y `report_whatsapp` al onboardear.
2. Al verificar los crons de pg_cron (D3/D6), ELIMINAR los schedules manuales
   del Dashboard de Supabase.
