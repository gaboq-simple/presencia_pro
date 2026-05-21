# ONBOARDING-FRICTION.md

Fricciones, gaps y hallazgos del dry-run parcial de `onboard-business.ts`.
Ejecutado: 2026-05-21 | Branch: sprint/s4-ops-dry-run-and-usage

---

## 1. Dry-run result

El modo `--dry-run` existe y funciona correctamente. No toca la BD.

```
npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json> --dry-run
npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json> --validate
```

Config de prueba ejecutada: `onboarding/dummy-barberia-test.json`

Output validado: organizations, businesses, staff, staff_availability, services, staff_services, onboarding_data JSONB — todo correcto.

---

## 2. Fricciones del script

### F-01 BLOQUEANTE — Criterio S2-OPS-01 no implementado
**Descripcion:** El criterio de aceptacion de S2-OPS-01 dice:
> "Script valida al final que `whatsapp_phone_number_id` y `whatsapp_number` NO son strings vacios. Si estan vacios, falla con mensaje claro."

El codigo en `insertAll()` (lineas 511-512) los inserta como `''` con el comentario
`// Placeholders Fase 1` y nunca valida ni advierte sobre esto post-insert.
`verifyInsert()` solo valida que staff y services fueron creados, no los campos de WhatsApp.

**Impacto:** Si alguien onboardea un negocio y olvida actualizar `whatsapp_phone_number_id`, el bot
no enrutara ningun mensaje (la query busca por ese campo). El sistema fallara silenciosamente.

**Fix propuesto:** En `verifyInsert()`, agregar un check:
```ts
const { data: bizRow } = await supabase
  .from('businesses')
  .select('whatsapp_phone_number_id, whatsapp_number')
  .eq('id', businessId).single();

if (!bizRow?.whatsapp_phone_number_id || !bizRow?.whatsapp_number) {
  console.warn('⚠️  whatsapp_phone_number_id y/o whatsapp_number estan vacios.');
  console.warn('   El bot no enrutara mensajes hasta que se actualicen.');
  console.warn('   Ver paso 2 del checklist.');
}
```
(Advertencia, no fallo — el onboarding puede completarse sin WhatsApp en Fase 1.)

---

### F-02 COSMETIC — `{NEXT_PUBLIC_APP_URL}` no se resuelve en el checklist
**Descripcion:** En `generateChecklist()`, las URLs del checklist usan `{NEXT_PUBLIC_APP_URL}` como
literal string en lugar de resolver `process.env['NEXT_PUBLIC_APP_URL']`.

```md
- URL admin:  `{NEXT_PUBLIC_APP_URL}/dashboard?token=...`
- URL del webhook: `{NEXT_PUBLIC_APP_URL}/api/bot`
```

**Impacto:** El operador que recibe el checklist tiene que sustituir manualmente la URL.

**Fix propuesto:**
```ts
const appUrl = process.env['NEXT_PUBLIC_APP_URL'] ?? '{NEXT_PUBLIC_APP_URL}';
```
Y usar `appUrl` en lugar del literal en el template.

---

### F-03 SCHEMA DRIFT — `staff_availability` no soporta breaks ni `is_active`
**Descripcion:** El schema real de `staff_availability` tiene:
- `break_start time nullable`
- `break_end time nullable`
- `is_active bool default true`

El script (linea 638) inserta solo `{ staff_id, day_of_week, start_time, end_time }` — sin `is_active`.

**Impacto inmediato:** La DB tiene `default true` para `is_active`, asi que los registros se crean
correctamente. Sin embargo, el config JSON no tiene forma de especificar breaks para el staff.
Si un barbero tiene descanso de comida (1pm-2pm), hay que actualizarlo manualmente despues del onboarding.

**Fix propuesto:** Agregar al `DayAvailabilitySchema`:
```ts
const DayAvailabilitySchema = z.object({
  start: TimeSchema,
  end:   TimeSchema,
  break_start: TimeSchema.optional(),
  break_end:   TimeSchema.optional(),
  is_active:   z.boolean().optional().default(true),
});
```
Y pasar los campos al INSERT.

---

### F-04 AUSENTE — `report_whatsapp` y `review_url` no configurable desde JSON
**Descripcion:** `businesses` tiene columnas `report_whatsapp`, `report_enabled`, `review_url`,
`review_requests_enabled`, `max_late_minutes`, `auto_cancel_after_minutes`, `max_noshows_before_flag`.
Ninguna es configurable desde el JSON de onboarding — quedan en sus defaults de DB.

**Impacto:** El operador tiene que actualizar estos campos manualmente en SQL o en el panel admin
despues del onboarding. El reporte semanal por WhatsApp no llega hasta que se configure
`report_whatsapp`.

**Fix propuesto:** Agregar seccion opcional `settings` al config JSON:
```json
"settings": {
  "report_whatsapp": "5512345678",
  "review_url": "https://maps.google.com/...",
  "review_requests_enabled": true,
  "max_late_minutes": 15
}
```

---

### F-05 AUSENTE — Sin validacion de IANA timezone
**Descripcion:** `BusinessSchema.timezone` solo valida `z.string().min(1)`. Un typo como
`"America/Mexico_city"` (minuscula) pasa la validacion pero falla silenciosamente en la DB
o produce calculos de tiempo incorrectos en el bot.

**Fix propuesto:** Usar `Intl.supportedValuesOf('timeZone')` para validar:
```ts
timezone: z.string().refine(
  (tz) => {
    try { Intl.DateTimeFormat(undefined, { timeZone: tz }); return true; }
    catch { return false; }
  },
  { message: 'Timezone IANA invalida (ej: America/Mexico_City)' }
),
```

---

### F-06 DATA — `staff.phone` y `staff.whatsapp_id` se insertan como `''`
**Descripcion:** El schema de `staff` requiere estos campos (no nullable) y el script
los inserta como strings vacios. No hay paso en el checklist que recuerde actualizarlos.

**Impacto:** Si el panel muestra o usa estos campos en el futuro, apareceran vacios.
Actualmente no causan errores funcionales pero es tech debt.

---

## 3. Gaps del checklist generado vs estado actual del sistema

El checklist generado cubre 5 pasos. Comparado contra todo lo que se implemento en el sprint:

### Pasos que faltan (no estan en el checklist actual)

**3.1 Variables de entorno criticas no documentadas**

El checklist no recuerda verificar que estas env vars esten configuradas en Vercel:

| Env Var | Proposito | Estado en .env.local.example |
|---|---|---|
| `SESSION_SECRET` | Firma de cookies de sesion — si falta, login no funciona | AUSENTE del example |
| `UPSTASH_REDIS_REST_URL` | Rate limiting distribuido (S1-OPS-02) | AUSENTE del example |
| `UPSTASH_REDIS_REST_TOKEN` | Rate limiting distribuido (S1-OPS-02) | AUSENTE del example |
| `PRIVACY_POLICY_URL` | URL del aviso de privacidad en el bot (S2-LEG-02) | AUSENTE del example |
| `ARCO_URL` | URL del formulario ARCO en el bot (S2-LEG-03) | AUSENTE del example |
| `NEXT_PUBLIC_SITE_URL` | URL publica (variante de NEXT_PUBLIC_APP_URL) | AUSENTE del example |
| `INTAKE_SECRET` | Secret para intake endpoints | AUSENTE del example |

**Accion:** Agregar estas 7 variables a `.env.local.example` con documentacion.

**3.2 Aviso de privacidad publicado (S2-LEG-01)**

El checklist no incluye un paso para verificar que `/aviso-de-privacidad` esta publicado.
Sin este paso, el bot envia la URL del aviso en el primer mensaje de cada cliente nuevo,
pero la URL puede retornar 404 si la pagina no existe todavia.

**3.3 Configurar UptimeRobot (S3-OPS-01)**

El checklist no menciona registrar el health endpoint en UptimeRobot.
URL: `{NEXT_PUBLIC_APP_URL}/api/health`

**3.4 Verificar `META_APP_SECRET` configurado (S1-G-01)**

El checklist menciona registrar el webhook pero no menciona que `META_APP_SECRET` debe
estar en Vercel Environment Variables. Sin el, el webhook rechaza todos los mensajes
de Meta (fail-closed, implementado en S1-SEC-01).

**3.5 Consentimiento y ARCO funcionales**

No hay paso que verifique que el formulario ARCO (`/arco`) esta accesible ni que
`ARCO_URL` apunta al lugar correcto.

**3.6 Crons — nombre incorrecto**

El checklist menciona `dispatch-weekly-report` como tercer cron, pero este nombre
puede no coincidir con el edge function deployado. Verificar el nombre exacto en
Supabase Dashboard → Edge Functions.

### Pasos del checklist que siguen siendo validos

| Paso | Estado | Notas |
|---|---|---|
| 1. Registrar webhook en Meta | Valido | Agregar: verificar META_APP_SECRET |
| 2. Obtener phone_number_id | Valido | |
| 3. Configurar crons Supabase | Valido (parcial) | Verificar nombre de dispatch-weekly-report |
| 4. Entregar credenciales | Valido | Agregar: guardar en 1Password (ACCESS.md) |
| 5. Probar | Valido | Agregar: verificar reminder de 2h ademas de 24h |

---

## 4. Gaps de go-live (fuera del script)

Problemas que no detecta el script ni el checklist pero que bloquean o degradan
la operacion con un cliente real:

### G-01 Template Approvals de WhatsApp (BLOQUEANTE para notificaciones)

Los recordatorios de citas (reminder_24h, reminder_2h, etc.) se envian via
Meta Cloud API. Para enviar mensajes a usuarios que no han iniciado conversacion
en las ultimas 24h, se requieren **Message Templates aprobados por Meta**.

El sistema usa `sendMessage()` para notificaciones, que puede estar enviando
texto libre fuera de ventana de 24h — esto falla silenciosamente con error 131026
de Meta ("Message failed to send because more than 24 hours have passed since the
customer last replied to the business").

**Accion requerida antes del go-live:**
1. Crear templates en Meta Business Manager → WhatsApp Manager → Message Templates
2. Tipos necesarios: reminder (con parametros: nombre, hora, barbero), follow_up, review_request
3. Esperar aprobacion de Meta (24-72h tipicamente)
4. Actualizar `dispatch-lifestyle-notifications` para usar `sendTemplate()` en lugar de
   `sendMessage()` para notificaciones proactivas

### G-02 Embedded Signup — flujo no implementado

El onboarding de un nuevo numero de WhatsApp requiere **Meta Embedded Signup**,
un flujo OAuth que el usuario final completa en el panel. Este flujo no existe en
el dashboard actual.

El workaround actual: Gabriel configura manualmente el `whatsapp_phone_number_id`
via SQL. Esto funciona para el cliente fundador (1 negocio) pero no escala.

### G-03 Timezone en notificaciones programadas

`scheduled_notifications.scheduled_for` se guarda en UTC. El bot calcula las
horas de recordatorio como UTC. Si el negocio esta en `America/Mexico_City` (UTC-6),
un recordatorio programado para "24h antes de las 10am" se envia a las 4am UTC,
que es 10pm del dia anterior en Mexico — incorrecto.

Verificar que `dispatch-lifestyle-notifications` convierte correctamente a la
timezone del negocio antes de hacer el INSERT en `scheduled_notifications`.

### G-04 Rate limiting — env vars no en Vercel

`UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` deben estar configurados
en Vercel Production. Si no estan, el rate limiter cae en modo in-memory (fallback),
que no es distribuido y se pierde en cada cold start. El PIN de 4 digitos seria
brute-forceable nuevamente.

### G-05 `SESSION_SECRET` no documentada en .env.local.example

La firma de cookies de sesion depende de `SESSION_SECRET`. Si esta ausente o
diferente entre deployments, todas las sesiones activas se invalidan en cada deploy.

---

## 5. Acciones recomendadas (priorizadas)

| # | Accion | Prioridad | Responsable |
|---|---|---|---|
| 1 | Agregar 7 env vars faltantes a `.env.local.example` | ALTA | Claude Code |
| 2 | Agregar paso de env vars criticas al checklist del script | ALTA | Claude Code |
| 3 | Resolver G-01: Template Approvals de WhatsApp | CRITICA (bloquea notificaciones) | Gabriel + Meta |
| 4 | Resolver F-01: Validacion/advertencia de whatsapp fields vacios | MEDIA | Claude Code |
| 5 | Resolver F-02: URL `{NEXT_PUBLIC_APP_URL}` no resuelta | BAJA | Claude Code |
| 6 | Resolver F-03: Soporte de breaks en staff_availability config | BAJA | Claude Code |
| 7 | Verificar G-03: Timezone en scheduled_notifications | ALTA | Gabriel (prueba manual) |
| 8 | Configurar UptimeRobot (S3-OPS-01 pendiente) | MEDIA | Gabriel |
| 9 | Publicar /aviso-de-privacidad (S2-LEG-01 pendiente) | ALTA (legal) | Gabriel + abogado |
