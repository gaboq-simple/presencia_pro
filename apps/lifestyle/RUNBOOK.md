# RUNBOOK — presenciapro / apps/lifestyle

> Procedimientos operativos para incidentes y mantenimiento en producción.
> Ultima actualizacion: 2026-05-20

---

## Informacion clave

| Recurso | Donde |
|---|---|
| App en produccion | Vercel Dashboard → proyecto `lifestyle` |
| Health endpoint | `GET /api/health` — 200 ok / 503 down. Configurar monitor en uptimerobot.com |
| Supabase Dashboard | https://supabase.com/dashboard/project/[project-id] |
| Meta Business Manager | https://business.facebook.com |
| Anthropic Console | https://console.anthropic.com |
| Upstash Console | https://console.upstash.com |
| Dominio | zentriq.mx |
| Contacto tecnico primario | Gabriel — contacto@zentriq.mx |
| Contacto emergencia | Definir en ACCESS.md (S2-DOC-03) |

---

## Arquitectura

```
WhatsApp (cliente)
  → Meta Cloud API
    → POST /api/bot          (Vercel — Next.js 16 App Router)
      → Supabase DB          (PostgreSQL multi-tenant)
      → Claude API           (Anthropic — motor conversacional)
      → Meta Cloud API       (envio de respuesta)

Supabase Edge Functions (Deno, cron cada minuto):
  dispatch-lifestyle-notifications  — recordatorios y notificaciones
  dispatch-auto-cancel              — auto-cancelacion de no-shows

Panel de staff/admin:
  /staff    — asistente (citas del dia, chat handoff)
  /dashboard — admin (metricas, configuracion)
```

La app corre en Vercel con Fluid Compute (Node.js). No hay workers separados — todo el procesamiento del bot ocurre en `after()` de Vercel para responder 200 inmediatamente a Meta.

---

## 1. El bot deja de responder

### Sintomas
- Clientes reportan que el bot no contesta
- Vercel logs muestran 500s o 401s en `/api/bot`
- El negocio recibe mensajes pero no hay respuesta

### Diagnostico (en orden)

1. **Verificar Vercel deployment status**
   - Vercel Dashboard → proyecto → Deployments
   - Si hay deployment fallido, ver logs de build

2. **Ver logs de /api/bot en Vercel**
   - Vercel Dashboard → proyecto → Logs → filtrar por `/api/bot`
   - Buscar errores 500, 401, o timeouts

3. **Verificar META_APP_SECRET**
   - Si los logs muestran `401 webhook signature invalid`: la env var esta mal o vencio
   - Ver seccion "Env vars" mas abajo
   - En desarrollo/staging donde Meta aun no apunta al webhook, este error es esperado

4. **Verificar Supabase**
   - https://status.supabase.com — hay outage?
   - Supabase Dashboard → Logs → API Logs: hay errores?

5. **Verificar Anthropic**
   - https://status.anthropic.com — hay outage?
   - Anthropic Console → Usage: se agoto la cuota?

6. **Verificar Meta**
   - https://developers.facebook.com/status
   - Meta Business → WhatsApp → Phone Numbers: el numero esta activo?

### Mitigacion

| Causa | Accion |
|---|---|
| Deployment fallido | Rollback en Vercel (ver DEPLOY.md → Rollback) |
| Supabase caido | Esperar recuperacion. Avisar al cliente. |
| Anthropic caido | El bot tiene fallbackMessage por negocio. Avisar al cliente del downgrade. |
| Meta caido | Esperar. No hay fallback para WhatsApp. |
| META_APP_SECRET mal | Actualizar env var en Vercel → trigger redeploy |

---

## 2. Las notificaciones no se envian

Los recordatorios (reminder_1h, reminder_24h, etc.) los despacha la edge function `dispatch-lifestyle-notifications`.

### Verificar que el cron esta activo

1. Supabase Dashboard → Edge Functions → `dispatch-lifestyle-notifications`
2. Confirmar que hay un Schedule configurado: `* * * * *`
3. Si no hay schedule: crearlo manualmente (no esta en codigo — se pierde si se recrea el proyecto)

### Verificar que las notificaciones estan en cola

```sql
-- Ver notificaciones pendientes
SELECT type, scheduled_for, sent_at, failed_at
FROM scheduled_notifications
WHERE sent_at IS NULL AND failed_at IS NULL
ORDER BY scheduled_for
LIMIT 20;

-- Ver notificaciones fallidas recientes
SELECT type, scheduled_for, failed_at, metadata
FROM scheduled_notifications
WHERE failed_at IS NOT NULL
ORDER BY failed_at DESC
LIMIT 10;
```

### Verificar logs de la edge function

Supabase Dashboard → Edge Functions → `dispatch-lifestyle-notifications` → Logs

Errores comunes:
- `WHATSAPP_ACCESS_TOKEN not set`: el secret no esta configurado en Supabase Secrets
- `Error sending WhatsApp`: token vencido o numero de destino invalido

### Configurar secrets de edge functions

Los secrets de las edge functions NO son los mismos que las env vars de Vercel. Se configuran en:

Supabase Dashboard → Settings → Edge Functions → Secrets

Variables requeridas por ambas edge functions:
- `SUPABASE_URL` — URL del proyecto (ya disponible automaticamente como variable de entorno en Deno)
- `SUPABASE_SERVICE_ROLE_KEY` — service role key
- `WHATSAPP_ACCESS_TOKEN` — System User Token de Meta

---

## 3. Un cliente reporta que no puede agendar

### Checklist de diagnostico

1. **El bot responde?** — Si no, ver seccion 1

2. **El negocio tiene horario configurado?**
   ```sql
   SELECT day_of_week, start_time, end_time, is_active
   FROM staff_availability
   WHERE staff_id = '[staff_id]'
   ORDER BY day_of_week;
   ```

3. **Hay una excepcion o bloqueo para ese dia?**
   ```sql
   SELECT exception_date, available, reason
   FROM staff_schedule_exceptions
   WHERE staff_id = '[staff_id]'
   AND exception_date = '[fecha]';

   SELECT starts_at, ends_at, reason, status
   FROM staff_blocks
   WHERE staff_id = '[staff_id]'
   AND starts_at::date = '[fecha]'
   AND status = 'approved';
   ```

4. **El servicio solicitado esta activo?**
   ```sql
   SELECT name, active FROM services
   WHERE business_id = '[business_id]';
   ```

5. **El cliente esta marcado como flagged?** (no es un bloqueador tecnico, pero el asistente ve una advertencia)
   ```sql
   SELECT name, is_flagged, noshow_count FROM customers
   WHERE phone = '[telefono]';
   ```

---

## 4. Rotar WHATSAPP_ACCESS_TOKEN

### Cuando
- Token comprometido
- Rotacion regular (cada 60 dias sugerido)
- Despues de un incidente de seguridad

### Procedimiento

1. Entrar a Meta Business → System Users
2. Seleccionar el System User → Generate New Token
3. Permisos requeridos: `whatsapp_business_messaging`, `whatsapp_business_management`
4. Copiar el nuevo token
5. **En Vercel**: Settings → Environment Variables → `WHATSAPP_ACCESS_TOKEN` → editar → pegar nuevo valor → Save
6. **En Supabase Secrets**: Settings → Edge Functions → Secrets → actualizar `WHATSAPP_ACCESS_TOKEN`
7. Trigger redeploy de la app (o esperar el siguiente deploy natural)
8. Verificar enviando un mensaje de prueba al bot
9. Documentar la rotacion en INCIDENTS.md

---

## 5. Regenerar access_token de un negocio

El `access_token` da acceso al dashboard del dueno. Si se compromete o el dueno lo pierde:

```sql
-- Generar nuevo token y devolver el valor
UPDATE businesses
SET access_token = encode(gen_random_bytes(32), 'hex')
WHERE slug = '[slug]'
RETURNING slug, access_token;
```

Ejecutar en Supabase Dashboard → SQL Editor.

Entregar el nuevo token al dueno por canal seguro (1Password share link, en persona). NUNCA por email.

La URL de acceso es: `https://[NEXT_PUBLIC_APP_URL]/dashboard?token=[access_token]`

---

## 6. Backup y restauracion de base de datos

### Backups automaticos

El workflow `.github/workflows/backup-weekly.yml` ejecuta `scripts/backup-supabase.sh` cada domingo a las 03:00 UTC (y on-demand via `workflow_dispatch`).

Cada backup:
- Es un dump completo (`supabase db dump` — schema + data)
- Se comprime con gzip
- Se encripta con GPG AES256 (passphrase en secret `BACKUP_ENCRYPTION_PASSPHRASE`)
- Se sube a Cloudflare R2: bucket `presenciapro-backups`
- Naming: `backup-YYYY-MM-DD-HHmmss.sql.gz.gpg`
- Retencion: 30 dias (el script elimina backups mas antiguos automaticamente)

### Listar backups disponibles en R2

```bash
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
  aws s3 ls s3://presenciapro-backups/ \
  --endpoint-url $R2_ENDPOINT --region auto
```

### Restaurar desde backup externo (R2)

```bash
# 1. Preparar el archivo SQL (descarga + descifra + descomprime)
export BACKUP_ENCRYPTION_PASSPHRASE=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT=...

bash scripts/restore-supabase.sh backup-YYYY-MM-DD-HHmmss.sql.gz.gpg

# El script imprime el comando psql a ejecutar:
# psql "${DB_URL}" < /tmp/supabase-restore-NNNNN/backup-YYYY-MM-DD-HHmmss.sql

# 2. Ejecutar el restore (sustituir DB_URL con connection string del proyecto destino)
#    Supabase Dashboard → Settings → Database → Connection string → URI (NOT pooler)
psql "${DB_URL}" < /tmp/supabase-restore-NNNNN/backup-YYYY-MM-DD-HHmmss.sql

# 3. Verificar integridad
psql "${DB_URL}" -c 'SELECT COUNT(*) FROM businesses;'
psql "${DB_URL}" -c 'SELECT COUNT(*) FROM customers;'
psql "${DB_URL}" -c 'SELECT COUNT(*) FROM appointments;'

# 4. Limpiar archivo temporal
rm -rf /tmp/supabase-restore-NNNNN/
```

**ADVERTENCIAS:**
- El restore SOBREESCRIBE datos en el proyecto destino. Usar siempre un proyecto staging primero.
- La `DB_URL` del proyecto destino se encuentra en: Supabase Dashboard → Settings → Database → Connection string → URI

### Con PITR (requiere Supabase Pro)

Si el plan Pro esta activo y el incidente ocurrio en las ultimas horas/dias:

1. Supabase Dashboard → Settings → Database → Point in Time Recovery
2. Seleccionar fecha y hora del punto de restauracion
3. Iniciar restauracion
4. Verificar integridad: contar filas en `businesses`, `customers`, `appointments`

> Recomendacion: hacer upgrade a Supabase Pro para habilitar PITR (mayor granularidad de recuperacion).

### Tiempo estimado de recuperacion (RTO)

Pendiente de drill (ver S4-OPS-02). Documentar aqui al completar.

### Ejecutar backup manual inmediato

Si necesitas un backup fuera del ciclo semanal:

1. GitHub → repositorio → Actions → "Weekly Supabase Backup" → Run workflow
2. O localmente con las env vars configuradas: `bash scripts/backup-supabase.sh`

---

## 7. Edge functions y crons

Dos edge functions criticas con cron `* * * * *` (cada minuto):

| Edge Function | Que hace | Variables de entorno requeridas |
|---|---|---|
| `dispatch-lifestyle-notifications` | Envia recordatorios y notificaciones pendientes de `scheduled_notifications` | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_ACCESS_TOKEN |
| `dispatch-auto-cancel` | Marca como `no_show` citas confirmadas que superaron `auto_cancel_after_minutes` sin llegada | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_ACCESS_TOKEN |

**IMPORTANTE:** Los schedules (cron) NO estan en codigo. Se configuran manualmente en:
Supabase Dashboard → Edge Functions → [nombre de funcion] → Schedules → Add Schedule

Si se recrea el proyecto Supabase, los crons deben reconfigurarse manualmente.

### Verificar que los crons estan activos

1. Supabase Dashboard → Edge Functions
2. Para cada funcion: verificar que aparece un Schedule con expresion `* * * * *`
3. Verificar en los Logs que hay ejecuciones recientes (cada ~1 minuto)

### Desplegar/actualizar una edge function

```bash
# Desde la raiz del repo
supabase functions deploy dispatch-lifestyle-notifications --project-ref [project-ref]
supabase functions deploy dispatch-auto-cancel --project-ref [project-ref]
```

Ver DEPLOY.md para el proceso completo.

---

## 8. Onboarding de un nuevo negocio

```bash
# Desde apps/lifestyle/
npx tsx scripts/onboard-business.ts \
  --config onboarding/[slug].json \
  --whatsapp-phone-id [phone_number_id_de_meta] \
  --whatsapp-number [numero_e164_sin_+]

# Para validar sin escribir a la BD:
npx tsx scripts/onboard-business.ts --config onboarding/[slug].json --dry-run
```

El script genera `onboarding/[slug]-checklist.md` con los pasos manuales pendientes (webhook Meta, crons Supabase, entrega de credenciales, prueba).

Los archivos `onboarding/*.md` estan en `.gitignore` porque contienen tokens y PINs. Guardar en 1Password antes de eliminar.

---

## 9. Ver logs

### Vercel (app Next.js)

- Vercel Dashboard → proyecto → Logs
- Filtrar por ruta: `/api/bot`, `/api/auth/pin`, `/api/arco`
- Nivel de error: buscar `Error`, `500`, `401`
- Para logs en tiempo real durante un incidente: `vercel logs --follow` (requiere Vercel CLI)

### Supabase (DB + Edge Functions)

- Supabase Dashboard → Logs → API Logs (errores de DB)
- Supabase Dashboard → Logs → Edge Function Logs
- Supabase Dashboard → Edge Functions → [nombre] → Logs
- Para trazabilidad del bot: tabla `bot_logs`

```sql
-- Ver logs recientes del bot para un cliente
SELECT state_from, state_to, event_type, error_code, error_message, created_at
FROM bot_logs
WHERE customer_phone = '[telefono]'
ORDER BY created_at DESC
LIMIT 20;

-- Ver errores del bot en las ultimas 24h
SELECT customer_phone, state_from, error_code, error_message, created_at
FROM bot_logs
WHERE error_code IS NOT NULL
AND created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

---

## 10. Rate limiting

El rate limiting usa Upstash Redis (sliding window). Si Redis no esta configurado, cae a rate limiter in-memory (se pierde en cold starts).

| Endpoint | Limite | Clave |
|---|---|---|
| POST `/api/auth/pin` | 5 intentos / 60s | por IP |
| POST `/api/bot` | 30 mensajes / 60s | por `phoneNumberId` de Meta |
| POST `/api/arco` | 3 solicitudes / hora | por telefono |

Cuando se alcanza el limite, el endpoint responde `429 Too Many Requests` con header `Retry-After`.

Si un cliente legitimo es bloqueado (ej: IP compartida en salon), se puede limpiar el estado en Upstash Console → Data Browser → buscar la clave y eliminarla.

---

## 11. Variables de entorno

Configuradas en Vercel Dashboard → proyecto → Settings → Environment Variables.

### Requeridas en produccion

| Variable | Proposito |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clave anonima de Supabase (cliente) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (server only — bypasea RLS) |
| `WHATSAPP_ACCESS_TOKEN` | System User Token de Meta Business |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Token de verificacion del webhook GET /api/bot |
| `META_APP_SECRET` | App Secret de Meta — verifica firma X-Hub-Signature-256 |
| `ANTHROPIC_API_KEY` | Clave de Anthropic para el motor conversacional |
| `SESSION_SECRET` | Secret para firmar cookies de sesion (minimo 32 chars) |
| `NEXT_PUBLIC_APP_URL` | URL publica del app (ej: https://lifestyle.presenciapro.com) |
| `MESSAGING_PROVIDER` | `meta` en produccion |
| `CRON_SECRET` | Secret compartido entre app y edge functions para el reporte semanal |

### Opcionales (con defaults)

| Variable | Default | Proposito |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | — | Rate limiting distribuido (sin esto: in-memory) |
| `UPSTASH_REDIS_REST_TOKEN` | — | Token de Upstash Redis |
| `PRIVACY_POLICY_URL` | `https://zentriq.mx/aviso-de-privacidad` | URL del aviso de privacidad en el bot |
| `ARCO_URL` | `https://zentriq.mx/arco` | URL del formulario ARCO en el bot |
| `NEXT_PUBLIC_SITE_URL` | — | URL base para tokens de cancelacion |
| `INTAKE_SECRET` | — | JWT secret para flujos de intake |

### Solo desarrollo (no configurar en produccion)

| Variable | Proposito |
|---|---|
| `TWILIO_ACCOUNT_SID` | Sandbox Twilio para desarrollo local |
| `TWILIO_AUTH_TOKEN` | Auth token de Twilio |
| `TWILIO_WHATSAPP_FROM` | Numero Twilio sandbox (fijo: whatsapp:+14155238886) |
| `NGROK_URL` | URL publica del webhook local |
| `TWILIO_DEV_BUSINESS_ID` | UUID del negocio de prueba en desarrollo |

---

## 12. Escalacion

| Nivel | Trigger | Tiempo de respuesta | Accion |
|---|---|---|---|
| L1 | Cualquier issue reportado | <2h en horario laboral | Diagnostico normal |
| L2 | Bot caido, dashboard inaccesible, data no visible | <1h, 24/7 durante piloto | Diagnostico urgente + avisar al cliente |
| L3 | Incidente de seguridad, posible data leak | Inmediato | Notificar abogado + documentar en INCIDENTS.md |

**Contacto primario:** Gabriel Quevedo — contacto@zentriq.mx

Para L2/L3:
1. Notificar al cliente: "Estamos atendiendo el problema. Te aviso en X minutos."
2. Abrir entrada en INCIDENTS.md
3. Diagnosticar y mitigar
4. Notificar resolucion
5. Post-mortem en INCIDENTS.md
