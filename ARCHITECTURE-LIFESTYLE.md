# ARCHITECTURE-LIFESTYLE.md — PresenciaPro Lifestyle

> Decisiones arquitectónicas específicas de `apps/lifestyle/`.
> Lee `ARCHITECTURE.md` y `ARCHITECTURE-SHARED.md` primero.
> Este documento no repite lo que ya está definido allí.

---

## 0. Producto

**PresenciaPro Lifestyle** es un SaaS multi-tenant para negocios de bienestar
y estética en México: barberías, salones de uñas, spas, estéticas.

- Cada negocio opera en su propio subdominio: `[slug].presenciapro.com`
- Un número WhatsApp Business por negocio (alta manual por operador en Fase 1)
- PWA mobile-first — sin app nativa
- Config de cada negocio en Supabase (tabla `businesses`), no en archivos de config
- Onboarding manual hasta Fase 3

---

## 1. Roles

| Rol | Acceso | Descripción |
|---|---|---|
| `admin` | Todo el negocio | Dashboard completo, gestión de staff, servicios, agenda y reportes |
| `barber` | Vista propia | Solo su agenda, sus clientes, sus bloques de disponibilidad |
| `assistant` | Gestión de citas y walk-ins | Fase 2 |

**Decisión de autenticación:** Los roles se almacenan en `staff.role` (tabla DB).
El middleware verifica que el usuario tiene sesión activa (`getUser()`).
La verificación de rol específico es responsabilidad de cada page/route server-side —
nunca en el middleware, para mantenerlo liviano (patrón heredado de sellers-portal).

---

## 2. Multi-tenancy

### Cómo funciona el aislamiento

- Columna discriminadora: `business_id UUID` en todas las tablas operativas
- RLS activo en todas las tablas — aísla negocios entre sí en el anon role
- Operaciones server-side con `service_role_key` usan políticas de aplicación
  (el middleware garantiza que el usuario pertenece al negocio correcto)

### Cómo se resuelve el negocio en el bot

El webhook de WhatsApp envía `phone_number_id` en cada mensaje. El route handler
de `/api/bot` hace:
```
SELECT * FROM businesses WHERE whatsapp_phone_number_id = $1 AND active = TRUE
```
Desde allí se obtiene el `business_id` para todas las operaciones siguientes.

### Cómo se resuelve el negocio en el mini-sitio público

El parámetro `[slug]` de la ruta se mapea a `businesses.slug`. El page.tsx hace:
```
SELECT * FROM businesses WHERE slug = $1 AND active = TRUE
```
Si el slug no existe o el negocio no está activo → `notFound()`.

---

## 3. Schema de Base de Datos

> Schema completo en `supabase/migrations/001_initial_schema.sql`.
> Políticas RLS en `supabase/migrations/002_rls_policies.sql`.

### Tablas

#### `businesses`
Registro de cada negocio cliente en la plataforma.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `name` | TEXT | Nombre del negocio |
| `slug` | TEXT UNIQUE | Subdominio. Kebab-case, inmutable una vez asignado |
| `business_type` | TEXT | `barberia`, `spa`, `estetica`, etc. |
| `whatsapp_number` | TEXT | Número del WA Business (10–15 dígitos, sin +) |
| `whatsapp_phone_number_id` | TEXT | Phone Number ID de Meta — clave de routing del bot |
| `logo_url` | TEXT? | URL en Supabase Storage |
| `cover_image_url` | TEXT? | URL en Supabase Storage |
| `description` | TEXT? | |
| `address` | TEXT | Dirección física del local |
| `social_links` | JSONB | `{ instagram, tiktok, facebook, ... }` |
| `active` | BOOLEAN | `FALSE` = negocio suspendido |
| `created_at` | TIMESTAMPTZ | |

#### `staff`
Personal del negocio. Incluye `auth_id` para vincular con Supabase Auth.

> **Decisión de diseño:** El campo `auth_id UUID REFERENCES auth.users(id)` no
> estaba en el spec inicial pero es **arquitectónicamente requerido** para que
> las políticas RLS puedan identificar al usuario autenticado y aplicar
> aislamiento por rol. Sin él, las políticas no pueden distinguir qué staff
> es el current user. Se agregó en la migración inicial.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `auth_id` | UUID FK → auth.users | ON DELETE SET NULL — nullable para staff sin acceso al dashboard |
| `name` | TEXT | |
| `phone` | TEXT | Número de contacto |
| `whatsapp_id` | TEXT | Número WhatsApp del staff (para notificaciones internas) |
| `role` | TEXT | `admin \| barber \| assistant` — CHECK constraint en DB |
| `active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |

#### `services`
Catálogo de servicios del negocio. Cacheado con `unstable_cache` TTL 300s.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `name` | TEXT | |
| `description` | TEXT? | |
| `duration_minutes` | INTEGER | CHECK > 0 |
| `price` | NUMERIC(10,2) | CHECK >= 0 |
| `currency` | TEXT | DEFAULT `MXN` |
| `active` | BOOLEAN | |
| `created_at` | TIMESTAMPTZ | |

#### `staff_services`
Tabla pivot — qué servicios ofrece cada staff.

| Campo | Tipo | Notas |
|---|---|---|
| `staff_id` | UUID FK → staff | PK compuesta |
| `service_id` | UUID FK → services | PK compuesta |

#### `customers`
Clientes del negocio. `phone` = whatsapp_id canónico normalizado.
UNIQUE(business_id, phone) garantiza un registro por cliente por negocio.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `name` | TEXT | |
| `phone` | TEXT | whatsapp_id canónico — normalizado sin + ni espacios |
| `favorite_staff_id` | UUID FK → staff? | ON DELETE SET NULL |
| `favorite_service_id` | UUID FK → services? | ON DELETE SET NULL |
| `notes` | TEXT? | Notas libres del staff sobre el cliente |
| `visit_count` | INTEGER | DEFAULT 0 |
| `last_visit` | TIMESTAMPTZ? | |
| `created_at` | TIMESTAMPTZ | |

**UNIQUE(business_id, phone)** — índice y constraint compuesto.

#### `appointments`
Citas. El campo `status` tiene CHECK constraint — nunca cadena libre.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `staff_id` | UUID FK → staff | |
| `service_id` | UUID FK → services | |
| `customer_id` | UUID FK → customers? | ON DELETE SET NULL — NULL permitido en walk-ins sin cliente registrado |
| `starts_at` | TIMESTAMPTZ | |
| `ends_at` | TIMESTAMPTZ | CHECK ends_at > starts_at |
| `status` | TEXT | `pending \| confirmed \| completed \| cancelled \| no_show \| walkin` |
| `source` | TEXT | `bot \| manual \| walkin` |
| `notes` | TEXT? | |
| `created_at` | TIMESTAMPTZ | |

#### `staff_availability`
Disponibilidad semanal recurrente por staff.
UNIQUE(staff_id, day_of_week) — un bloque por día.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `staff_id` | UUID FK → staff | |
| `day_of_week` | SMALLINT | 0=domingo, 6=sábado — CHECK 0–6 |
| `start_time` | TIME | |
| `end_time` | TIME | CHECK end_time > start_time |

#### `staff_blocks`
Bloqueos puntuales (vacaciones, citas personales, etc.).

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `staff_id` | UUID FK → staff | |
| `starts_at` | TIMESTAMPTZ | |
| `ends_at` | TIMESTAMPTZ | CHECK ends_at > starts_at |
| `reason` | TEXT? | |
| `created_at` | TIMESTAMPTZ | |

#### `bot_conversations`
Estado de cada conversación activa en WhatsApp.
`context` se deserializa con `LifestyleBotContextSchema.safeParse()`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `customer_phone` | TEXT | whatsapp_id canónico del cliente |
| `state` | TEXT | `LifestyleBotState` — ver `lifestyle.types.ts` |
| `context` | JSONB | `LifestyleBotContext` — siempre validar con Zod al leer |
| `last_message` | TIMESTAMPTZ | |
| `created_at` | TIMESTAMPTZ | |

#### `waitlist`
Lista de espera de clientes para citas sin disponibilidad inmediata.
Schema definido en `supabase/migrations/011_waitlist_and_review.sql`.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | ON DELETE CASCADE |
| `customer_id` | UUID FK → customers | ON DELETE CASCADE — NOT NULL |
| `service_id` | UUID FK → services | ON DELETE CASCADE — NOT NULL |
| `staff_id` | UUID FK → staff? | ON DELETE SET NULL — preferencia de barbero |
| `requested_date` | DATE | NOT NULL — fecha solicitada |
| `requested_time_preference` | TEXT? | `mañana \| tarde \| cualquiera` |
| `status` | TEXT | `waiting \| notified \| confirmed \| expired` — CHECK constraint |
| `notified_at` | TIMESTAMPTZ? | Se rellena al notificar al cliente |
| `expires_at` | TIMESTAMPTZ? | `notified_at + 30 min` — tras este tiempo el slot se libera |
| `created_at` | TIMESTAMPTZ | |

#### `scheduled_notifications`
Cola de notificaciones programadas (recordatorios, follow-ups).
Idempotencia: `sent_at IS NULL AND failed_at IS NULL` antes de procesar.

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `business_id` | UUID FK → businesses | |
| `appointment_id` | UUID FK → appointments? | ON DELETE CASCADE |
| `type` | TEXT | `reminder_24h \| reminder_2h \| reminder_1h \| follow_up \| review_request \| waitlist_expiry` |
| `scheduled_for` | TIMESTAMPTZ | |
| `sent_at` | TIMESTAMPTZ? | NULL si no enviado |
| `failed_at` | TIMESTAMPTZ? | NULL si sin error |
| `customer_phone` | TEXT? | whatsapp_id canónico del cliente destino |
| `message_body` | TEXT? | Cuerpo pre-construido; si presente el despachador lo usa directamente |
| `customer_id` | UUID FK → customers? | ON DELETE SET NULL |
| `metadata` | JSONB? | Datos auxiliares por tipo — ej: `{ waitlist_id, slot_starts_at }` para `waitlist_expiry` |
| `created_at` | TIMESTAMPTZ | |

### Índices

```sql
-- Queries de agenda por negocio y fecha (más frecuentes)
CREATE INDEX idx_appointments_business_starts ON appointments(business_id, starts_at);

-- Queries de agenda por barbero y fecha (vista del staff)
CREATE INDEX idx_appointments_staff_starts   ON appointments(staff_id, starts_at);

-- Lookup del estado de conversación por teléfono (bot — cada mensaje entrante)
CREATE INDEX idx_bot_conversations_business_phone ON bot_conversations(business_id, customer_phone);

-- Upsert de cliente por teléfono (bot — cada mensaje nuevo)
CREATE INDEX idx_customers_business_phone ON customers(business_id, phone);
```

---

## 4. RLS — Row Level Security

### Principios

- **Nivel 1 — business_id:** aísla negocios entre sí
- **Nivel 2 — staff_id/role:** dentro del mismo negocio, `barber` solo ve sus propias filas

### Implementación

Tres funciones `SECURITY DEFINER` que leen el staff actual sin ciclos RLS:

```sql
ls_staff_business_id() → UUID  -- business_id del usuario autenticado
ls_staff_role()        → TEXT  -- role del usuario autenticado
ls_staff_id()          → UUID  -- id del staff autenticado
```

Prefijo `ls_` (lifestyle) para evitar colisiones con funciones de otros productos
en el mismo proyecto Supabase.

### Acceso del mini-sitio público (`[slug]/page.tsx`)

El mini-sitio es público (sin auth) pero corre en un Server Component.
Usa `createClient(url, SUPABASE_SERVICE_ROLE_KEY)` directamente para leer
`businesses`, `services` y `staff` activos. El service_role bypassa RLS.

> **Regla:** El `SUPABASE_SERVICE_ROLE_KEY` nunca sale del servidor.
> El Server Component no hace ninguna serialización de esta clave al cliente.

---

## 5. Módulos del Engine que Lifestyle Reutiliza

### `engine/bot/` — con adaptaciones

El flujo conversacional de lifestyle es un subconjunto del de medical:

```
medical:   GREETING → QUALIFYING_VISIT_TYPE → QUALIFYING_SERVICE → QUALIFYING_MODE → SHOWING_SLOTS → ...
lifestyle: GREETING → QUALIFYING_SERVICE → [QUALIFYING_STAFF] → SHOWING_SLOTS → ...
```

Los estados propios de lifestyle (`LifestyleBotState`) están en
`packages/engine/src/types/lifestyle.types.ts` — no en `bot/types.ts` de medical.

**Adaptaciones pendientes (Bot Engineer — lifestyle):**
- `bot/flow.ts`: cuando `isLifestyle(config)`, omitir `QUALIFYING_VISIT_TYPE` y `QUALIFYING_MODE`
- `bot/prompt.ts`: cuando `isLifestyle(config)`, agregar dirección del local en lugar de modalidades
- Nuevo flujo `QUALIFYING_STAFF`: solo cuando el negocio tiene >1 staff activo para el servicio

**No implementar sin sesión dedicada de Bot Engineer.**

### `engine/notifications/` — sin cambios

Mismo contrato. El número WhatsApp de origen se toma de `businesses.whatsapp_number`.

### `engine/scheduling/` — extensión multi-recurso

El scheduling de medical es 1 especialista con 1 Google Calendar.
Lifestyle tiene N staff en el mismo negocio.

**Diferencias clave:**
- Disponibilidad: `staff_availability` + `staff_blocks` en DB (no en Google Calendar para Fase 1)
- Sin slots de emergencia (no aplica al modelo lifestyle)
- Consulta disponibilidad cruzando `staff_availability` + `appointments` existentes

**Google Calendar:** Opcional en Fase 1. El sistema de slots corre sobre la DB.
Integración GCal se planifica para Fase 3.

### `engine/intake/` — no aplica

El perfil lifestyle no tiene formulario pre-consulta ni firma digital.

### `engine/dashboard/` — no aplica

Los componentes del dashboard de medical son para el perfil del doctor.
Lifestyle tiene su propio dashboard en `apps/lifestyle/src/app/dashboard/`.

---

## 6. Cache de Catálogo

- **Función:** `GET /api/catalog?businessId=...`
- **Implementación:** `unstable_cache` de Next.js
- **TTL:** 300 segundos
- **Tag de invalidación:** `catalog-${businessId}`
- **Cuándo invalidar:** Al guardar cambios en `services` desde el dashboard
  — llamar `revalidateTag(`catalog-${businessId}`)` en el Server Action o
  API Route que actualiza servicios

```typescript
const getCatalog = (businessId: string) =>
  unstable_cache(
    async () => { /* fetch activos */ },
    [`catalog-${businessId}`],
    { revalidate: 300, tags: [`catalog-${businessId}`] },
  )();
```

---

## 7. Mini-Sitio Público (`[slug]`)

- **Ruta:** `apps/lifestyle/src/app/[slug]/page.tsx`
- **Tipo:** Server Component puro — sin hidratación de cliente
- **Auth:** Ninguna
- **Data:** `businesses`, `services` activos, `staff` activos
- **SEO:** `generateMetadata` dinámico por negocio
- **LCP < 2.5s en móvil 4G:** Garantizado por:
  - Server Component (HTML completo en la primera respuesta)
  - `next/image` para logo y cover (optimización automática)
  - Cero JS bloqueante en el crítico path de renderizado

**Contenido renderizado:**
1. Nombre y descripción del negocio
2. Cover image + logo
3. Catálogo de servicios activos (nombre, duración, precio)
4. Staff activo (nombres)
5. Dirección física del local
6. Botón WhatsApp (`wa.me/[whatsapp_number]`)

---

## 8. Autenticación y Middleware

**Patrón:** Heredado de `apps/sellers-portal/src/middleware.ts`.

```
[slug]/*    → público — sin auth
dashboard/* → requiere sesión activa (Supabase Auth)
staff/*     → requiere sesión activa (Supabase Auth)
login       → redirige a /dashboard si ya hay sesión
```

**Roles en middleware:** El middleware solo verifica que existe una sesión
(`getUser()`). La verificación de rol específico (`admin` vs `barber`) es
responsabilidad de cada page server-side. Esto mantiene el middleware liviano
y corriendo en Edge Runtime sin imports adicionales.

**Verificación de sesión:** Siempre `getUser()` — nunca `getSession()`.
`getSession()` solo lee el cookie local y puede ser spoofed.

---

## 9. WhatsApp Multi-Tenant

Cada negocio tiene su propio número WhatsApp Business (`businesses.whatsapp_number`
y `businesses.whatsapp_phone_number_id`). Todos comparten el mismo webhook URL
(`/api/bot`) y el mismo `WHATSAPP_ACCESS_TOKEN` del operador (Meta Business Account).

**Routing de mensajes entrantes:**
```
Webhook POST /api/bot
→ extraer phone_number_id del payload de Meta
→ SELECT * FROM businesses WHERE whatsapp_phone_number_id = $1 AND active = TRUE
→ procesar con el engine usando business como contexto
```

**Razón de usar un solo access token:** Meta permite enviar mensajes desde
cualquier Phone Number ID del Business Account con un único System User Token.
Esto simplifica la gestión de credenciales en Fase 1 con onboarding manual.

---

## 10. Edge Functions — Lifestyle

Edge Functions en `supabase/functions/` que sirven a `apps/lifestyle`.
Patrón orquestador descrito en `ARCHITECTURE-SHARED.md §4`.

| Función | Schedule | Target | Descripción |
|---|---|---|---|
| `dispatch-lifestyle-notifications` | `* * * * *` (cada minuto) | Supabase directo | Despacha recordatorios y follow-ups pendientes de `scheduled_notifications` |
| `dispatch-weekly-report` | `0 10 * * 1` (lunes 10:00 UTC / 04:00 CDMX) | `POST /api/reports/weekly` | Envía reporte semanal por WhatsApp a cada negocio con `report_enabled = true` |

### Variables de Supabase Secrets (lifestyle)

```bash
SUPABASE_URL              # URL del proyecto Supabase
SUPABASE_SERVICE_ROLE_KEY # service role key
WHATSAPP_ACCESS_TOKEN     # System User Token de Meta Business Account
CRON_SECRET               # token compartido con API Routes
APP_URL                   # URL base del app lifestyle
                          # (ej: https://lifestyle.presenciapro.com)
```

### Patrón `dispatch-weekly-report`

- Lee `businesses WHERE active = true AND report_enabled = true`
- Por cada negocio: `POST {APP_URL}/api/reports/weekly` con `Authorization: Bearer {CRON_SECRET}` y `business_id` en el body
- La lógica de negocio (métricas + envío WhatsApp) vive íntegramente en el API Route
- Best-effort por negocio — fallo en uno no detiene los demás

---

## 11. Fases del Producto

### Fase 1 — MVP (actual)

**Alcance:**
- Mini-sitio público por negocio (`[slug].presenciapro.com`)
- Bot WhatsApp: agendamiento simple (QUALIFYING_SERVICE → SHOWING_SLOTS → COMPLETED)
- Dashboard admin: vista de agenda del día, gestión de citas
- Vista staff (barber): su agenda propia
- Alta de negocios: manual por operador (inserción directa en DB)
- Disponibilidad: basada en `staff_availability` + `appointments` en DB

**Bloqueado en Fase 1:**
- QUALIFYING_STAFF en el bot (implementar cuando haya múltiples barberos activos en un negocio)
- Vista assistant (rol)
- Notificaciones automáticas de recordatorio
- Integración Google Calendar

### Fase 2 — Operaciones

**Alcance:**
- Rol `assistant`: gestión de citas y walk-ins
- Notificaciones automáticas (recordatorios 24h, 2h via Edge Functions)
- Follow-up automático post-cita
- Cancelaciones vía bot
- Walk-in registration sin cita previa

### Fase 3 — Escala

**Alcance:**
- Onboarding self-service (formulario de alta + configuración por el admin del negocio)
- Integración Google Calendar por staff
- Reportes y métricas por negocio
- Multi-sucursal (misma marca, distintas ubicaciones)

---

## 12. Variables de Entorno — `apps/lifestyle`

Ver `.env.local.example` para la lista completa con comentarios.

```bash
# Supabase (mismo proyecto que el resto del monorepo)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# WhatsApp Business API (token del operador — aplica a todos los negocios)
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=

# Claude API
ANTHROPIC_API_KEY=

# Edge Functions auth
CRON_SECRET=

# App
NEXT_PUBLIC_APP_URL=    # ej: https://lifestyle.presenciapro.com
```

---

---

## 13. Providers de Mensajería — Swap Twilio ↔ Meta

### Por qué existe esta capa

Meta Business Manager requiere aprobación antes de poder enviar mensajes en
producción. Twilio Sandbox permite probar el flujo completo sin esa aprobación.
Esta capa de abstracción permite hacer el swap sin tocar lógica de negocio.

### Archivos

| Archivo | Rol |
|---|---|
| `packages/engine/src/notifications/messaging.ts` | Interface `MessagingProvider`, `TwilioProvider`, `MetaProvider`, `getMessagingProvider()`, `sendMessage()` |
| `packages/engine/src/bot/lifestyle/adapters/twilioAdapter.ts` | Normaliza payload `x-www-form-urlencoded` de Twilio → `LifestyleIncomingMessage` |
| `packages/engine/src/bot/lifestyle/adapters/metaAdapter.ts` | Normaliza payload JSON de Meta → `LifestyleIncomingMessage` |

### Variable de control

```bash
MESSAGING_PROVIDER=twilio   # desarrollo — Twilio Sandbox
MESSAGING_PROVIDER=meta     # producción — Meta Business Cloud API
```

### Cómo hacer el swap a Meta (cuando llegue la aprobación)

1. Configurar webhook URL en Meta Developers Console → tu app → Webhooks.
2. Cambiar `MESSAGING_PROVIDER=meta` en el entorno de producción (Vercel env vars).
3. Verificar que `WHATSAPP_ACCESS_TOKEN` y `whatsapp_phone_number_id` en cada fila de
   `businesses` estén correctos.
4. Las variables `TWILIO_*` pueden quedarse — no afectan el flujo Meta.

### Variables de entorno asociadas

```bash
# Desarrollo (Twilio)
TWILIO_ACCOUNT_SID=           # twilio.com/console → Account Info
TWILIO_AUTH_TOKEN=            # twilio.com/console → Account Info
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
NGROK_URL=                    # URL pública del túnel local
TWILIO_DEV_BUSINESS_ID=       # UUID del negocio de prueba en DB
MESSAGING_PROVIDER=twilio

# Producción (Meta) — ya existentes
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
MESSAGING_PROVIDER=meta
```

---

*PresenciaPro OS · ARCHITECTURE-LIFESTYLE.md · v1.0*
*Último cambio: §13 providers de mensajería — integración Twilio Sandbox para desarrollo.*
