🎯 SPRINT ACTIVO
Hay un sprint activo hacia el cliente fundador. Antes de cualquier trabajo, leer SPRINT.md completo.
Reglas innegociables durante el sprint:

Una sesión = una tarea. No mezclar trabajos. Si Gabriel pide algo fuera del sprint, preguntar explícitamente: "Esto no está en SPRINT.md. ¿Lo agregamos como tarea o es ad-hoc?"
Antes de ejecutar cualquier tarea del sprint: localizar el prompt correspondiente en SPRINT-PROMPTS.md y leerlo completo. NO improvisar el plan de ejecución.
Cambios de estado en SPRINT.md son obligatorios:

Al iniciar una tarea: marcarla 🔵 in-progress
Al terminar: marcarla 🟢 done con fecha
Si se bloquea: marcarla 🟡 blocked con detalle en "Notas de ejecución"


Al terminar una tarea, NO avanzar a la siguiente sin confirmación de Gabriel. Reportar lo hecho y esperar.
Si una tarea revela un problema nuevo no documentado:

Documentarlo en "Notas de ejecución" de esa tarea
Si es urgente: marcar la tarea como 🟡 blocked y avisar a Gabriel
Si es nuevo trabajo: proponer como tarea nueva al final del backlog, NO ejecutar sin aprobación


Decisiones cerradas en SPRINT.md: no re-discutir. Si Claude Code tiene una mejor idea, anotarla como propuesta pero respetar la decisión vigente del sprint.
Bitácora: al cerrar sesión productiva, agregar una línea en SPRINT.md → Bitácora de sesiones.

Cuando Gabriel abra una sesión nueva, el primer mensaje productivo de Claude Code es:

"Leí SPRINT.md. Estamos en [tarea ID]. Estado: [estado]. ¿Continuamos o cambias prioridad?"

NO empezar a trabajar sin esa confirmación.
Fuera del sprint (trabajo ad-hoc):
Si Gabriel pide algo claramente fuera del sprint (ej: "ayúdame a entender X concepto", "explora una idea", "haz un quick fix de Y"), proceder normalmente pero confirmar explícitamente: "Esto es ad-hoc, no entra al sprint, ¿correcto?"

@AGENTS.md

---

## Database Schema (as of 2026-05-20)

Schema del proyecto **presenciapro / apps/lifestyle**. Todas las tablas están en `public`, todas tienen RLS habilitado.

### Tabla: `businesses`
Negocio raíz del tenant. Un registro = una barbería/salón.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| name | text | |
| slug | text UNIQUE | usado en /[slug] minisite |
| business_type | text | |
| whatsapp_number | text | número E.164 sin + |
| whatsapp_phone_number_id | text | ID de Meta Cloud API — clave para routing multi-tenant |
| logo_url, cover_image_url | text nullable | |
| description | text nullable | |
| address, timezone | text | timezone: IANA (ej. America/Mexico_City) |
| social_links | jsonb | default `{}` |
| active | bool | default true |
| palette | text | CHECK: obsidian/humo/cuero/bronce/blanco/arena |
| tagline | text nullable | max 60 chars |
| office_hours | jsonb nullable | `{ "0": { start, end }, ... }` por día de semana |
| walk_in_buffer_minutes | int | default 60 |
| bot_name | text | nombre del asistente virtual |
| away_message, fallback_message | text | respuestas del bot |
| report_whatsapp | text nullable | número para reportes semanales |
| report_enabled | bool | default true |
| inactive_threshold_days | int | default 21 |
| review_url | text nullable | Google Reviews u otra plataforma |
| review_requests_enabled | bool | default false |
| whatsapp_message | text nullable | |
| access_token | text nullable UNIQUE | token del dueño → /dashboard?token=XXX (32 chars hex) |
| assistant_token | text nullable UNIQUE | token del asistente (32 chars hex) |
| onboarding_data | jsonb nullable | datos de onboarding fase 2 |
| instagram_url, tiktok_url | text nullable | |
| max_late_minutes | int | default 15; CHECK 0-30. Máx tolerancia de retraso que acepta el negocio. 0 = sin tolerancia |
| auto_cancel_after_minutes | int | default 20; CHECK > 0. Minutos desde starts_at para auto-cancelar si no llega el cliente |
| max_noshows_before_flag | int | default 3. Umbral de no-shows para marcar al cliente como `is_flagged` |

### Tabla: `staff`
Empleados del negocio (admin, barber, assistant).

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| auth_id | uuid nullable FK → auth.users.id | solo si usa Supabase Auth |
| name, phone, whatsapp_id | text NOT NULL | phone y whatsapp_id son NOT NULL en la BD real (no nullable) — insertar staff sin ellos falla |
| role | text | CHECK: admin / barber / assistant |
| active | bool | default true |
| photo_url | text nullable | |
| pin | char(4) nullable | dígitos, UNIQUE por negocio (convención) |

### Tabla: `services`
Catálogo de servicios ofrecidos por el negocio.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| name, description | text | |
| duration_minutes | int | CHECK > 0 |
| price | numeric | CHECK >= 0 |
| currency | text | default 'MXN' |
| active | bool | default true |

### Tabla: `staff_services` (junction)
Qué servicios puede realizar cada barbero.

| Columna | Tipo | Notas |
|---|---|---|
| staff_id | uuid FK → staff.id | PK compuesta |
| service_id | uuid FK → services.id | PK compuesta |

### Tabla: `customers`
Clientes registrados por negocio.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| name | text | |
| phone | text nullable | formato usado por el bot |
| favorite_staff_id | uuid nullable FK → staff.id | |
| favorite_service_id | uuid nullable FK → services.id | |
| notes | text nullable | notas del staff |
| visit_count | int | default 0. Actualizado por `trg_update_visit_stats` |
| last_visit | timestamptz nullable | Actualizado por `trg_update_visit_stats` |
| noshow_count | int | default 0. Incrementado por `trg_update_visit_stats` en cada no-show |
| is_flagged | bool | default false. Se activa cuando noshow_count >= businesses.max_noshows_before_flag |
| created_at | timestamptz | |
| consent_at | timestamptz nullable | Migración 037 (S2-LEG-02, 2026-05-20). NULL = cliente anterior a la feature — **no hubo backfill**, por instrucción explícita |
| consented_via | text nullable | CHECK: whatsapp_first_message / manual_registration / import |
| consent_message_id | text nullable | ID del mensaje de WhatsApp donde el titular recibió el aviso. Evidencia LFPDPPP; solo con consented_via='whatsapp_first_message' |

### Tabla: `appointments`
Citas agendadas (bot, manual, walk-in).

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| staff_id | uuid FK → staff.id | |
| service_id | uuid FK → services.id | |
| customer_id | uuid nullable FK → customers.id | |
| starts_at, ends_at | timestamptz | |
| status | text | CHECK: pending / confirmed / completed / cancelled / no_show / walkin |
| source | text | CHECK: bot / manual / walkin |
| notes, booking_name | text nullable | |
| created_by_staff_id | uuid nullable FK → staff.id | |
| modified_by_staff_id | uuid nullable FK → staff.id | |
| modified_at | timestamptz nullable | |
| adjusted_starts_at | timestamptz nullable | Nueva hora acordada si el cliente reportó retraso. NULL si llegó a tiempo |
| delay_reported_minutes | int nullable | Minutos de retraso reportados por el cliente vía bot |
| late_arrival_acknowledged | bool | default false. TRUE cuando el bot procesó el retraso para esta cita |

### Tabla: `staff_availability`
Horario semanal recurrente de cada barbero.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| staff_id | uuid FK → staff.id | |
| day_of_week | smallint | CHECK 0-6 (domingo=0) |
| start_time, end_time | time | |
| break_start, break_end | time nullable | Ambas NULL o ambas NOT NULL; break_end > break_start |
| is_active | bool | default true. Permite desactivar un día sin borrarlo |

### Tabla: `staff_schedule_exceptions`
Overrides de fecha específica: días libres, horario especial, festivos.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| staff_id | uuid FK → staff.id | |
| business_id | uuid FK → businesses.id | desnormalizado para RLS eficiente |
| exception_date | date | UNIQUE por (staff_id, exception_date) |
| available | bool | default false. FALSE = no trabaja; TRUE = trabaja (horario normal o especial) |
| start_time, end_time | time nullable | Solo si available=TRUE + horario especial ese día |
| reason | text nullable | |
| created_at | timestamptz | |

> Consumida por `get_available_slots()` PG function. Gestionada vía server actions `createScheduleException` / `deleteScheduleException` / `getScheduleExceptions`.

### Tabla: `staff_blocks`
Bloqueos puntuales (vacaciones, emergencias).

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| staff_id | uuid FK → staff.id | |
| starts_at, ends_at | timestamptz | |
| reason | text nullable | |
| status | text | CHECK: pending / approved / rejected; default pending |
| urgent | bool | default false |

### Tabla: `bot_conversations`
Estado de la conversación activa por cliente×negocio. RLS: SELECT + UPDATE para cualquier staff del negocio (migration 033).

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| customer_phone | text | |
| state | text | estado actual del FSM (ej. GREETING, CONFIRMING_APPOINTMENT…) |
| context | jsonb | contexto serializado del FSM (serviceId, staffId, slotTime, etc.) |
| last_message | timestamptz | usado para detectar inactividad >24h → reset a GREETING |
| session_mode | text | CHECK: bot / human / paused; default 'bot'. Controla el handoff gate |
| taken_by | uuid nullable FK → staff.id | Staff que tomó control vía handoff |
| taken_at | timestamptz nullable | Timestamp del takeover. Auto-release si supera 30 min sin actividad |
| UNIQUE | — | (business_id, customer_phone) |

### Tabla: `conversation_messages`
Log de mensajes individuales para el handoff humano. RLS: SELECT + INSERT para cualquier staff del negocio (migration 033).

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| customer_phone | text | |
| direction | text | CHECK: inbound / outbound |
| body | text | |
| sent_by | text | CHECK: bot / human / customer |
| staff_id | uuid nullable FK → staff.id | Presente cuando sent_by='human' |
| created_at | timestamptz | |

### Tabla: `scheduled_notifications`
Cola de notificaciones diferidas (recordatorios, reactivación, waitlist).

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| appointment_id | uuid nullable FK → appointments.id | |
| customer_id | uuid nullable FK → customers.id | |
| type | text | CHECK: reminder_24h / reminder_2h / reminder_1h / follow_up / review_request / waitlist_expiry / reactivation / reschedule_notice / cancellation_notice |
| scheduled_for | timestamptz | cuándo debe enviarse |
| sent_at, failed_at | timestamptz nullable | |
| metadata | jsonb nullable | datos auxiliares por tipo (ej. `{ waitlist_id }`) |

> Despachada por edge function `dispatch-lifestyle-notifications` (cron cada minuto).

### Tabla: `waitlist`
Lista de espera cuando no hay slots disponibles.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| customer_id | uuid FK → customers.id | |
| service_id | uuid FK → services.id | |
| staff_id | uuid nullable FK → staff.id | |
| requested_date | date | |
| requested_time_preference | text nullable | mañana / tarde / cualquiera |
| status | text | CHECK: waiting / notified / confirmed / expired |
| notified_at | timestamptz nullable | |
| expires_at | timestamptz nullable | notified_at + 30 min → libera slot al siguiente |

### Tabla: `bot_logs`
Trazabilidad de transiciones del FSM: estado, evento, modelo, tokens, errores.

| Columna | Tipo | Notas |
|---|---|---|
| id | uuid PK | |
| business_id | uuid FK → businesses.id | |
| customer_phone | text | |
| state_from, state_to | text | transición del FSM |
| event_type | text | tipo de evento |
| model_used | text nullable | modelo Claude usado |
| tokens_total | int nullable | |
| error_code, error_message | text nullable | |
| recovered | bool nullable | |
| duration_ms | int nullable | |
| created_at | timestamptz | |

> Escrita por el handler (best-effort, try/catch). La tabla **ya existe** en la BD.

### Nota
- **`organizations`**: mencionada en SPRINT.md S1-SEC-04 (RLS pendiente) pero **no existe en el schema actual**. Puede vivir en el proyecto Supabase de sellers-portal (compartido).

---

## Message Flow

Cómo viaja un mensaje de WhatsApp desde Meta hasta la respuesta del bot.

```
WhatsApp (usuario)
  → Meta Cloud API
    → POST /api/bot  (apps/lifestyle/src/app/api/bot/route.ts)
```

### 1. Entrada y verificación (`route.ts`)

1. `MESSAGING_PROVIDER` env var selecciona `meta` (prod) o `twilio` (dev sandbox).
2. **Meta**: lee raw body → verifica `X-Hub-Signature-256` con `META_APP_SECRET` usando `verifyWebhookSignature()` del engine. Si falta secret → 401. Si firma inválida → 401.
3. Parsea JSON con `parseMetaPayload()` → extrae `{ phoneNumberId, customerPhone, body, customerName }`.
4. Si es mensaje no-texto (audio, imagen, sticker) → responde con mensaje "solo texto" y sale.
5. **Responde 200 inmediatamente**. El procesamiento real ocurre en `after()` (Vercel Fluid Compute).

### 2. Resolución de negocio

```sql
SELECT ... FROM businesses
WHERE whatsapp_phone_number_id = $phoneNumberId AND active = true
LIMIT 1
```

Routing multi-tenant: cada negocio tiene su propio `whatsapp_phone_number_id`. Si no hay match → log + silencio.

### 3. Motor conversacional (`handleLifestyleMessage`)

`packages/engine/src/bot/lifestyle/handler.ts`

| Paso | Acción | Tabla |
|---|---|---|
| 1 | Verificar `office_hours` del negocio → si fuera de horario, retornar `away_message` | — |
| 2 | Cargar conversación activa | READ `bot_conversations` |
| 3 | **Handoff gate**: si `session_mode = 'human'`, guardar mensaje en `conversation_messages` y detener FSM | WRITE `conversation_messages` |
| 4 | Dedup por `message_id` → si ya procesado, retornar silencio | — |
| 5 | Si inactividad >24h o estado terminal → reset a GREETING | — |
| 6 | Seleccionar modelo Claude (`modelRouter`) | — |
| 7 | Despachar al estado handler (`router.ts`) | varios (ver abajo) |
| 8 | Persistir nuevo estado/contexto (retry 3x) | UPSERT `bot_conversations` |
| 9 | Escribir a `bot_logs` (best-effort) | INSERT `bot_logs` |

### 4. State Machine (FSM)

Estados posibles en `bot_conversations.state`:

```
GREETING
  → QUALIFYING_SERVICE → QUALIFYING_STAFF → QUALIFYING_DATETIME
    → SHOWING_SLOTS
      → QUALIFYING_WAITLIST (si no hay slots)
      → CONFIRMING_APPOINTMENT
        → AWAITING_CONFIRMATION → AWAITING_BOOKING_NAME
          → CONFIRMED ─┬→ (nueva reserva o closing) → GREETING
                       ├→ (cancelación) → GREETING
                       └→ (retraso detectado) → intent late_arrival procesado inline
AWAY / FALLBACK / ESCALATED / COMPLETED
```

Tablas tocadas por los handlers de estado:

| Handler | Tablas leídas | Tablas escritas |
|---|---|---|
| greeting | customers, services, staff | customers (upsert) |
| qualifyingService | services, staff_services | — |
| qualifyingStaff | staff, staff_services | — |
| qualifyingDatetime | — (parseo determinista) | — |
| showingSlots | staff_availability (+ break_start/end/is_active), staff_schedule_exceptions, staff_blocks, appointments | — |
| confirmingAppointment | — | — |
| awaitingConfirmation / awaitingBookingName | customers | — |
| confirmed (create appt) | customers, services, staff | appointments (INSERT), customers (upsert), scheduled_notifications (INSERT) |
| confirmationResponse (late arrival) | appointments | appointments (UPDATE adjusted_starts_at, delay_reported_minutes, late_arrival_acknowledged) |
| mod/cancel from CONFIRMED | appointments | appointments (UPDATE status→cancelled) |
| waitlist | waitlist | waitlist (INSERT) |

### 5. Envío de respuesta

```
engine/sendMessage()
  → Meta Cloud API (Messages API)
    → WhatsApp (usuario)
```

Se usa `business.whatsappPhoneNumberId` como `from` para el multi-tenant. Si falla el handler → intenta enviar `business.fallbackMessage` como safety net.

---

## Edge Functions

Desplegadas en Supabase. Ambas tienen `verify_jwt: false` (autenticadas por secret interno).

### `dispatch-lifestyle-notifications`
- **Trigger**: cron cada minuto (configurar en Supabase Dashboard → Edge Functions → Schedules)
- **Lógica**: busca registros en `scheduled_notifications` donde `scheduled_for <= NOW()` y `sent_at IS NULL` y `failed_at IS NULL`; envía vía Meta Cloud API; marca `sent_at` o `failed_at`
- **Tipos despachados**: reminder_24h, reminder_2h, reminder_1h, follow_up, review_request, reactivation, waitlist_expiry, reschedule_notice, cancellation_notice

### `dispatch-auto-cancel`
- **Trigger**: cron cada minuto (configurar en Supabase Dashboard → Edge Functions → Schedules)
- **Lógica**: busca citas con status `confirmed` cuyo `starts_at + businesses.auto_cancel_after_minutes <= NOW()` y `late_arrival_acknowledged = false`; las marca como `no_show`; el trigger `trg_update_visit_stats` se encarga de incrementar `noshow_count` y evaluar `is_flagged`

> **⚠️ Estado real de los crons (verificado 2026-08-18).** Desde D3 los schedules son **código versionado** (`supabase/migrations/20260813000000_crons_versionados.sql`, pg_cron + pg_net + Vault), no configuración del Dashboard. Pero solo `dispatch-auto-cancel` está **desplegada y agendada**: `dispatch-lifestyle-notifications` **nunca se desplegó** —el proyecto tiene una sola edge function— y su `cron.schedule` está comentado a propósito en esa migración para no dejar un job dando 404 cada minuto. Con ella sin desplegar, **toda la cola de `scheduled_notifications` se encola y nadie la despacha** (hoy sin daño: la tabla está vacía). Ver SPRINT.md → **S7-NOTIF-01**, con disparador antes del primer cliente real que agende por el bot.

---

## Server Actions (`assistant-actions.ts`)

Todas en `apps/lifestyle/src/app/staff/assistant-actions.ts`. Requieren sesión válida vía `requireAssistantSession()` (acepta roles: assistant, owner, admin, barber). Usan service_role_key — nunca exponer al cliente.

| Acción | Firma resumida | Descripción |
|---|---|---|
| `refreshAssistantAppointments` | `(date: string) → DashboardAppointment[]` | Recarga citas del día para polling |
| `cancelAppointment` | `(id, reason) → void` | Cancela cita + notifica cliente WA + notifica waitlist |
| `updateAppointmentNotes` | `(id, notes) → void` | Guarda notas operativas inline |
| `completeAppointment` | `(id) → void` | Marca status=completed (idempotente) |
| `noShowAppointment` | `(id) → void` | Marca status=no_show (idempotente) |
| `createAssistantAppointment` | `(input: CreateAppointmentInput) → { id, warning? }` | Crea cita desde panel; lookup/create customer; retorna warning si is_flagged |
| `rescheduleAppointment` | `(input: RescheduleInput) → void` | Reagenda + verifica conflictos + notifica cliente WA + nuevos reminders |
| `getStaffBlocksForDay` | `(date) → StaffBlockForDay[]` | Bloqueos aprobados del día (para AvailabilityTimeline) |
| `searchCustomers` | `(query) → CustomerSearchResult[]` | Busca por nombre/teléfono (ILIKE, max 5 resultados) |
| `takeoverConversation` | `(customerPhone) → void` | Pone session_mode='human'; bloquea FSM para ese cliente |
| `releaseConversation` | `(customerPhone) → void` | Devuelve session_mode='bot' (idempotente) |
| `sendMessageFromPanel` | `(customerPhone, message) → { sent }` | Envía WA directo; requiere session_mode='human'; renueva taken_at |
| `getActiveConversations` | `() → ConversationSummary[]` | Lista bot_conversations del negocio; orden: human→paused→bot; max 50 |
| `getConversationMessages` | `(customerPhone) → ConversationMessage[]` | Historial de conversation_messages para una conversación; max 100; ASC |
| `updateStaffSchedule` | `(staffId, slots[]) → void` | Reemplaza horario semanal (DELETE+INSERT); soporta break_start/end, is_active |
| `createScheduleException` | `(data) → ScheduleException` | UPSERT en staff_schedule_exceptions por (staff_id, exception_date) |
| `deleteScheduleException` | `(exceptionId) → void` | DELETE con guard business_id |
| `getScheduleExceptions` | `(staffId, month?) → ScheduleException[]` | Excepciones del mes o futuras; ordena por exception_date ASC |

---

## Triggers

### `trg_update_visit_stats`
- **Tabla**: `appointments`
- **Evento**: AFTER UPDATE
- **Función**: `update_visit_stats()`
- **Lógica**:
  - Si `NEW.status = 'completed'` y antes no lo era → `customers.visit_count += 1`, `customers.last_visit = NOW()`
  - Si `NEW.status = 'no_show'` y antes no lo era → `customers.noshow_count += 1`; si `noshow_count >= businesses.max_noshows_before_flag` → `customers.is_flagged = TRUE`
- Solo actúa si `customer_id IS NOT NULL`

---

## UI Components

Componentes principales del panel. Todos en `apps/lifestyle/src/components/`.

### Vista del asistente (`staff/`)
| Componente | Descripción |
|---|---|
| `AssistantLayout.tsx` | Orquestador de la vista del asistente. Contiene: buscador de clientes, botón "+ Nueva cita", AvailabilityTimeline, AssistantUpcoming, AssistantDayTimeline. Polling cada 30s. Header con botón de chat (badge amarillo si hay convs. humanas). |
| `ConversationList.tsx` | Bottom sheet con lista de bot_conversations activas. Orden: human→paused→bot. Polling cada 10s. Click → abre ChatPanel en overlay. |
| `ChatPanel.tsx` | Panel de chat 85vh. Header con modo + "Tomar control"/"Devolver al bot". Burbujas: cliente=izquierda/gris, bot=derecha/oscuro, staff=derecha/azul. Polling cada 5s. Input deshabilitado si modo≠human. |
| `AvailabilityTimeline.tsx` | Grid horizontal staff×hora. Línea "ahora" en rojo. Slots clickables. |
| `NewAppointmentForm.tsx` | Bottom sheet para crear cita. Fetch catálogo vía GET /api/catalog. Server action `createAssistantAppointment`. |
| `AssistantDayTimeline.tsx` | Lista del día con formularios inline de cancelar/notas/reagendar. |
| `RecurringAvailability.tsx` | Server Component read-only. Muestra horario semanal del barbero + "Descanso: HH:MM–HH:MM" si existen breaks. |

### Vista del admin (`admin/`)
| Componente | Descripción |
|---|---|
| `DashboardLayout.tsx` | Vista lineal del admin: ingresos, BlockRequestsInbox, DashboardRealtimeProvider, MetricsSummary, StaffMetricsPanel, InactiveClientsPanel, WaitlistPanel, ReportsConfigPanel, ReviewConfigPanel, StaffManagementPanel, StaffPhotoManager. |
| `StaffManagementPanel.tsx` | Lista de staff con toggle activo/inactivo, editor de PIN, botón "Horario" → StaffScheduleEditor, "Día libre" → QuickDayOff. Modal con `overflow-y-auto max-h-[90vh]`. |
| `StaffScheduleEditor.tsx` | Edita horario semanal recurrente. Toggle por día + inputs start/end + checkbox "Descanso" con break_start/break_end. Payload incluye breaks e is_active. Monta ScheduleExceptionsPanel debajo. |
| `ScheduleExceptionsPanel.tsx` | Gestiona excepciones por fecha (días libres u horario especial). Lista futuras + formulario agregar (date + tipo + horas + razón) + botón eliminar. Usa server actions directamente. |
| `QuickDayOff.tsx` | Crea un `staff_block` de día completo con status='approved'. **No** crea staff_schedule_exception. |
| `WaitlistPanel.tsx` | Accordion `<details>`. Fetch GET /api/waitlist. Botón notificar manual. |

---

## Pending / Known Gaps

| Gap | Detalle |
|---|---|
| `waitlist.status = 'confirmed'` | Nunca se escribe en el código actual. El flow termina en 'notified'. Backlog pendiente |
| Rate limiting de PIN | El límite de intentos de PIN es in-memory (Map en proceso Node.js). Se pierde en cada cold start. Sin persistencia en DB |
| Despachador de notificaciones sin desplegar | `dispatch-lifestyle-notifications` no está desplegada (el proyecto tiene una sola edge function: `dispatch-auto-cancel`) y su schedule queda comentado hasta que lo esté. Los schedules SÍ están versionados desde D3. Tarea **S7-NOTIF-01**, disparador: antes del primer cliente real que agende por el bot |
| `organizations` RLS | Mencionado en SPRINT.md S1-SEC-04. La tabla no existe en este proyecto; puede vivir en sellers-portal |
| Consent LFPDPPP sin backfill | Las columnas existen (migración 037), pero los clientes anteriores a 2026-05-20 quedaron con `consent_at` NULL — sin backfill, por decisión explícita. Sigue sin publicarse el aviso de privacidad (SPRINT.md S2-LEG-01 ⚪ todo) al que apunta el bot |
| Sin tests automatizados | No existen tests unitarios ni e2e para ninguna feature implementada |
