# Plan · Permiso — la baja existe y manda (S8-PER-01)

> **Estado: pendiente de "va" de Gabriel para ejecutar.**
>
> Aterrizado desde el borrador de Fable el 2026-08-18. **Cada ruta y cada
> afirmación se verificó contra el repo al aterrizar**; lo que el repo
> contradecía está corregido y marcado con **⚠️ CORREGIDO AL ATERRIZAR**. Las
> correcciones no son cosméticas: dos de ellas cambian el alcance de un paso y
> una agrega un caso que el diseño original no cubría.

**Objetivo:** el sistema aprende a decir "ya no". Hoy el modelo solo sabe
"consintió"; un cliente que escribe BAJA recibe *"¿puedes reformularlo?"*, el
handoff humano se traga la baja, ninguna query saliente excluye a nadie, y el
bot linkea un aviso de privacidad que es 404. Este plan cierra las cuatro.

**Reglas del plan:** español mexicano neutro; tests en `tests/` de la raíz;
cierre = gates + red visual + merge; módulo puro para todo cálculo; y **nunca un
fallo mudo** — el `catch {}` vacío de
[`api/customers/[id]/reactivation/route.ts:130`](../../apps/lifestyle/src/app/api/customers/[id]/reactivation/route.ts)
es el anti-ejemplo canónico: hoy un envío que Meta rechaza devuelve HTTP 200 con
`{ sent: false }` y nadie se entera.

---

## La regla de niveles (rige P2, P3 y P4)

La baja **bloquea todo envío proactivo** (marketing, reactivación, solicitud de
reseña). **No bloquea:**

- **(a) respuestas del bot cuando el cliente escribe** — es servicio solicitado,
  dentro de la ventana de 24 h. Suprimirlo convertiría la baja en un castigo:
  el cliente escribe "¿a qué hora abren?" y el sistema lo ignora.
- **(b) recordatorios de citas que el propio cliente creó DESPUÉS de su baja** —
  al agendar, espera su recordatorio. Pedirlo y no recibirlo es peor servicio,
  no más privacidad.

**Esta regla vive en el código como un tipo, no como un comentario.** El
mecanismo es el `purpose` de P3: si alguien agrega un envío nuevo y no declara su
propósito, no compila.

---

## P0 · [SEGURO] El aviso deja de ser 404

**Objetivo:** publicar el aviso de privacidad y dejar de linkear a la nada.

**⚠️ CORREGIDO AL ATERRIZAR — el problema es más grande de lo que decía el
borrador.** El borrador proponía "agregar links en el footer del dashboard y del
mini-sitio". Los links **ya existen, y hay cuatro, y los cuatro están rotos
hoy**:

| Ruta:línea | Superficie | ¿Vivo? |
|---|---|---|
| [`components/site/Footer.tsx:104`](../../apps/lifestyle/src/components/site/Footer.tsx) | mini-sitio público `/[slug]` | sí |
| [`components/admin/DashboardLayout.tsx:204`](../../apps/lifestyle/src/components/admin/DashboardLayout.tsx) | footer del dashboard del dueño | sí |
| [`app/page.tsx:184`](../../apps/lifestyle/src/app/page.tsx) | footer del Home | sí |
| [`app/arco/ArcoForm.tsx:192`](../../apps/lifestyle/src/app/arco/ArcoForm.tsx) | formulario ARCO público | sí |
| `components/staff/AssistantLayout.tsx:408` | — | **no** (componente muerto, ver `dueno-v3.md` Paso 6) |

O sea: P0 **no agrega links**, crea la página que los cuatro ya piden. El
argumento cambia de "falta publicar el aviso" a "hay cuatro enlaces rotos en
producción, uno de ellos en el formulario con el que un titular ejerce sus
derechos".

**Archivos:** **nuevo** `app/aviso-de-privacidad/page.tsx` (estática, sin
`'use client'`).

**Contenido:** responsable = **el negocio**, encargado = **Zentriq**; finalidad
primaria (agendar y atender) separada de la secundaria (mensajes de la
barbería); derechos ARCO con link a `/arco` (que ya existe y funciona); fecha de
versión visible.

**⚠️ CORREGIDO AL ATERRIZAR — la aceptación del borrador no se puede cumplir
solo con código.** El borrador pedía: *"la URL exacta que `buildPrivacyNotice()`
manda responde 200"*. Esa URL es
[`greeting.ts:528`](../../packages/engine/src/bot/lifestyle/states/greeting.ts):

```ts
const privacyUrl = process.env['PRIVACY_POLICY_URL'] ?? 'https://zentriq.mx/aviso-de-privacidad';
```

El default apunta a **otro dominio**. Crear la página en `apps/lifestyle` la
sirve en el dominio de la app, no en `zentriq.mx`. Además, `PRIVACY_POLICY_URL`
**no está en `.env.local.example`**, así que hoy nadie sabe que existe.

Se cierra con las tres piezas juntas, no con una:

1. la página en la app;
2. `PRIVACY_POLICY_URL` agregada a `.env.local.example` **documentada**;
3. **dependencia manual (Gabriel):** setear `PRIVACY_POLICY_URL` en Vercel al
   dominio de la app —o publicar el mismo aviso en `zentriq.mx`—. **No bloquea
   el merge**, bloquea el efecto: hasta que se haga, el bot sigue mandando un
   link muerto. Estado honesto y visible, prohibido maquillarlo (regla de
   dependencias manuales de `capa-de-dinero.md`).

**Dependencia manual adicional, NO bloqueante:** revisión de abogado. Se publica
la v1 fechada; la revisión ajusta, no estrena.

**Aceptación:** la ruta de la app responde 200 con el contenido; los cuatro
enlaces vivos resuelven; `PRIVACY_POLICY_URL` documentada; **S2-LEG-01 pasa a
🟢** (sus tres criterios —aviso accesible, link en footer del dashboard, link en
footer del mini-sitio— quedan cubiertos, dos de ellos por código que ya existía).

---

## P1 · [SEGURO] El modelo sabe decir "ya no"

**Objetivo:** que exista la columna. Hoy `customers` sabe decir "consintió"
(tres columnas de la migración 037) y no sabe decir lo contrario.

**Migración:** espejo exacto de las tres de alta.

```sql
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS opted_out_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opted_out_via TEXT
    CHECK (opted_out_via IN ('whatsapp_keyword', 'manual', 'arco'));
```

**Índice parcial** para las queries de exclusión de P3. Verificado: hoy
`customers` tiene tres índices —`customers_pkey`, `customers_business_id_phone_key`
y `idx_customers_business_phone`— y **ninguno sirve** para "los que no se dieron
de baja", así que el parcial es nuevo, no un duplicado.

**Aceptación:** sondeos de escritura y lectura; el CHECK rechaza una vía no
listada. **Sin UI** — el estado "No contactar" en Clientela llega con la capa de
activación, que es donde el dueño lo necesita ver; agregarlo antes sería una
casilla sin nada detrás.

---

## P2 · [SEGURO] "BAJA" se entiende a la primera, sin IA

**Objetivo:** interceptar la baja de forma **determinista**, antes de que nada la
pueda tragar.

**Hoy, paso por paso, lo que le pasa a un "BAJA"** (verificado en el
reconocimiento): rate limit → buffer → **handoff gate** (si `session_mode='human'`
el mensaje se guarda en `conversation_messages` y el FSM no corre: la baja queda
escrita y nadie la ve como baja) → dedup → `isArcoIntent()` no matchea → el
clasificador, que conoce **7 intents** y ninguno es opt-out → `UNCLEAR` →
`fallback_message`: *"Disculpa, no entendí bien tu mensaje. ¿Puedes
reformularlo?"*. El peor mensaje posible para un opt-out.

**⚠️ CORREGIDO AL ATERRIZAR — dónde va la intercepción.** El borrador decía
"ANTES del handoff gate (patrón del comando de test reset)". El patrón es el
correcto, pero la ubicación que el borrador da por sentada no es la que hay:

- el **handoff gate vive en la RUTA**, no en el engine —
  [`api/bot/route.ts:773`](../../apps/lifestyle/src/app/api/bot/route.ts)—, y
  `handler.ts` no menciona `session_mode`. (De paso: CLAUDE.md afirma que el
  gate es el paso 3 del engine. Es falso; corregirlo entra en este plan.)
- el test reset se intercepta en **tres** puntos de esa ruta, no en uno: línea
  **473** (rama Twilio), **526** y **912** (rama Meta).

El interceptor de baja se replica en los mismos tres puntos, o se extrae un
helper común y los tres lo llaman — **lo segundo es lo preferible**: tres copias
de un opt-out es exactamente el tipo de cosa que se desincroniza.

**Detección:** lista cerrada, insensible a mayúsculas y acentos, en un módulo
puro con tests: `baja`, `stop`, `no me manden mensajes`, `no quiero mensajes`,
`dejen de escribir(me)`, `no me escriban`.

**⚠️ CORREGIDO AL ATERRIZAR — el solapamiento con ARCO no existe.** El borrador
pedía "afinar contra los 13 keywords ARCO". Son **15**, no 13
([`router.ts:586`](../../packages/engine/src/bot/lifestyle/router.ts)), y se
verificó una por una: **ninguna de las 15 está contenida en ninguna de las 7
frases de baja**, así que bajo el `includes` que ambos usan no hay colisión
posible. El cuidado real es el otro, y el borrador ya lo tenía en la aceptación:
que `"quiero darme de baja del gimnasio"` **no** dispare.

Sigue valiendo que la baja se intercepte **antes** que ARCO: una baja de
mensajería no es una solicitud ARCO, y responder con un formulario de 20 días
hábiles a quien pidió dejar de recibir mensajes es no haberlo escuchado.

**Una baja jamás pasa por el clasificador.** Un opt-out no puede depender del
humor de un modelo.

**Al match:** `opted_out_at = NOW()`, `opted_out_via = 'whatsapp_keyword'`, y
**una** confirmación final (está dentro de la ventana de 24 h, así que es texto
libre y llega):

> Listo, no te volveremos a enviar mensajes. Si un día quieres agendar de nuevo,
> aquí estamos.

Y nada más: ni oferta de quedarse, ni encuesta de salida.

**Aceptación, por ruta real:**
- BAJA con `session_mode='human'` **también** da de baja (es el caso que hoy se
  traga la baja, y el que prueba que la intercepción está donde debe);
- BAJA a media reserva da de baja **sin romper el FSM**;
- `"quiero darme de baja del gimnasio"` **no** dispara (frontera negativa fijada
  por test).

---

## P3 · [SEGURO] La exclusión vive donde pasa todo — `sendWhatsAppMeta`

**Objetivo:** que la exclusión sea estructural. Un filtro en el despachador
dejaría afuera la reactivación, que manda **inline** y registra después.

**El cuello de botella real** es
[`sendWhatsAppMeta(message, creds)`](../../packages/engine/src/notifications/whatsapp.ts):
**18 llamadas en 13 archivos**. Todo lo que sale pasa por ahí.

**Parámetro nuevo obligatorio:**

```ts
purpose: 'session_reply' | 'appointment_utility' | 'proactive' | 'internal_ops'
```

**⚠️ CORREGIDO AL ATERRIZAR — falta un cuarto valor.** El borrador proponía tres,
y con tres **cuatro archivos no tienen ninguno que los describa**: no le escriben
a un cliente, le escriben al dueño o al staff.

| Ruta | Destinatario |
|---|---|
| [`api/reports/weekly/route.ts:326`](../../apps/lifestyle/src/app/api/reports/weekly/route.ts) | `business.report_whatsapp` (dueño) |
| [`api/internal/corte-nudge/route.ts:120`](../../apps/lifestyle/src/app/api/internal/corte-nudge/route.ts) | `report_whatsapp` (dueño) |
| [`staff/caja-actions.ts:373`](../../apps/lifestyle/src/app/staff/caja-actions.ts) | `report_whatsapp` (dueño) |
| [`api/staff/block-request/route.ts:132`](../../apps/lifestyle/src/app/api/staff/block-request/route.ts) | `adminStaff.whatsapp_id` (staff) |

Sin `internal_ops`, esos cuatro tendrían que declararse `proactive` —y el guard
buscaría un `customers.phone` que no existe, pasando por casualidad— o
`session_reply`, que sería mentira. Un enum que obliga a mentir para compilar
enseña a mentirle al enum.

**El guard:** destinatario con `opted_out_at IS NOT NULL` **y**
`purpose='proactive'` → **no envía** y retorna `{ suppressed: true, reason }` —
visible y registrable, jamás un `catch` mudo. `session_reply` y
`appointment_utility` nunca se suprimen (regla de niveles).
`internal_ops` no consulta `customers`: su destinatario no es uno.

**Migrar los 18 call-sites.** Sin `purpose` no compila: la regla de niveles como
tipo, no como memoria.

**★ Aceptación estrella** (patrón de la ceguera de D5 — probar con filas
presentes, nunca contra tablas vacías): un cliente del demo manda `"BAJA"` por la
ruta real, y después, **a nivel server**, ninguna de las cuatro queries salientes
lo incluye —inactivos
([`api/customers/inactive/route.ts:121`](../../apps/lifestyle/src/app/api/customers/inactive/route.ts)),
rescate ([`lib/retentionFeed.ts`](../../apps/lifestyle/src/lib/retentionFeed.ts)),
waitlist, y la cola de `scheduled_notifications`— **y un intento directo de
reactivación retorna `suppressed` visible**, no un `{ sent: false }` silencioso.

---

## P4 · [SEGURO] El walk-in deja de fabricar consentimiento

**El problema:** [`assistant-actions.ts:541`](../../apps/lifestyle/src/app/staff/assistant-actions.ts)
escribe `consent_at = NOW(), consented_via = 'manual_registration'` porque una
recepcionista tecleó un nombre. El titular no vio nada. Es la vía por la que más
rápido crece la base y la de evidencia más débil.

**Cambios:**

- La hoja de captura del walk-in pide **teléfono por default** — la costumbre de
  la libreta es nombre y teléfono, ese es el ritual (dato de Gabriel). Sigue
  **opcional**: no bloquea el alta. Hoy `businesses.require_customer_phone` es
  `false` por default y el campo se rinde como "(opcional)".
- `consented_via` gana `'pending_notice'`: el walk-in tecleado nace ahí. **El
  dato existe, el consentimiento no**, hasta que el titular ve el aviso — y su
  primer mensaje al bot lo consolida por la vía que ya existe
  (`whatsapp_first_message`, [`greeting.ts:104`](../../packages/engine/src/bot/lifestyle/states/greeting.ts)).
- `pending_notice` cuenta como **no consentido** para todo lo proactivo: el guard
  de P3 lo trata igual que una baja.

**⚠️ CORREGIDO AL ATERRIZAR — hay dos poblaciones, no una.** El borrador decía
"los `manual_registration` del demo se degradan a `pending_notice`". Medido en el
demo: **39 `manual_registration`**, **2 `whatsapp_first_message`** y **84 con
`consented_via` NULL** (clientes anteriores a la 037; el backfill se omitió por
instrucción explícita de Gabriel, ver S2-LEG-02).

Los 84 NULL **no se tocan** —reescribir su historia sería inventarla, que es el
error opuesto al que este paso corrige— pero **el guard tiene que tratarlos como
no consentidos**, igual que `pending_notice`. Si no, el agujero se muda: hoy
`consent_at IS NULL` no bloquea nada.

**Aceptación:** un walk-in nuevo nace `pending_notice`; ese mismo cliente escribe
al bot y se consolida; sondeo de que **ni un `pending_notice` ni un NULL** pasa el
guard de P3.

---

## Dependencias manuales

Ninguna bloquea un merge. Todo el plan es **pre-WABA**: no necesita el número
verificado ni plantillas aprobadas, porque no manda nada nuevo — deja de mandar.

| Paso | Dependencia (quién: Gabriel) | Si no está lista |
|---|---|---|
| P0 | `PRIVACY_POLICY_URL` en Vercel apuntando al dominio de la app (o publicar el aviso en `zentriq.mx`) | La página existe y los 4 links del producto funcionan; **el link que manda el bot sigue muerto**, visible y anotado |
| P0 | Revisión de abogado | Se publica la v1 fechada; la revisión ajusta, no estrena |

## Criterio de éxito, pre-registrado

1. La **★ aceptación de P3**: tras una baja por ruta real, cero queries salientes
   incluyen a ese cliente y la reactivación retorna `suppressed` visible.
2. El aviso responde **200** en la ruta de la app y los cuatro enlaces resuelven.
3. Suite completa verde + gates + red visual de cada paso.

**Orden P0 → P4, estricto.** P0 puede salir el mismo día del "va": no depende de
ninguno de los otros y apaga cuatro enlaces rotos que hoy están en producción.

## Lo que este plan NO hace

- **No construye la capa de activación.** No hay UI de "No contactar", ni
  segmentos de marketing, ni topes de frecuencia. Eso es otro plan y necesita la
  WABA.
- **No toca los topes de envío.** Hoy no existe **ningún** límite de frecuencia
  por cliente (anotado en CLAUDE.md → Pending gaps). Sigue sin existir al
  terminar: la baja es un interruptor, no una dosis.
- **No resuelve la retención de datos.** `appointment_audit`,
  `conversation_messages`, `bot_logs` y `scheduled_notifications` guardan PII sin
  política de purga. Es la deuda de SPRINT.md:1311, con su tensión
  purga-vs-inmutabilidad, y no cabe acá.
