# ARCHITECTURE.md — PresenciaPro OS
> **Este documento es la única fuente de verdad arquitectónica del sistema.**
> Toda sesión de Claude Code debe comenzar leyendo este archivo completo.
> Ninguna decisión técnica puede contradecir lo definido aquí.
> Si necesitas cambiar algo: propón el cambio, documéntalo aquí primero, luego implementa.

---

## 0. Principio Rector

**Un solo motor. Infinitos clientes. Cero código duplicado.**

Cada cliente es una instancia del mismo sistema activada por su archivo de configuración.
Si para agregar un cliente nuevo necesitas tocar lógica, componentes o módulos del motor — hay un error de arquitectura. Detente y corrígelo antes de continuar.

---

## 1. Stack Tecnológico — Versiones Fijas

| Capa | Herramienta | Versión | Razón |
|---|---|---|---|
| Framework | Next.js | 15.x (App Router) | SEO, RSC, Image optimization |
| Lenguaje | TypeScript | 5.x strict mode | Cero errores silenciosos |
| Estilos | Tailwind CSS | 3.x con design tokens | Consistencia entre instancias |
| Componentes | shadcn/ui | Latest | Base accesible, controlable |
| Validación | Zod | 3.x | Runtime type safety en config y APIs |
| Base de datos | Supabase (Postgres) | Latest | Citas, pacientes, métricas, intake |
| Auth | Supabase Auth | Latest | Login del doctor al dashboard |
| Bot IA | Claude API (claude-sonnet-4-20250514) | Latest | Motor de conversación del bot |
| WhatsApp | WhatsApp Business API (Meta) | v20.0 | Mensajes automatizados |
| Calendario | Google Calendar API | v3 | Motor de disponibilidad |
| Email | Resend | Latest | Confirmaciones y recordatorios |
| Deploy | Vercel | Latest | Un proyecto por cliente |
| Repositorio | GitHub (monorepo) | — | Un repo, carpetas por cliente |

**Regla de versiones:** Nunca actualices una dependencia core sin actualizar este documento primero.

---

## 2. Estructura del Monorepo

```
presenciapro/                          ← raíz del monorepo
│
├── ARCHITECTURE.md                    ← ESTE ARCHIVO — leer siempre primero
├── CHANGELOG.md                       ← registro de cambios por versión
│
├── packages/
│   └── engine/                        ← EL MOTOR — nunca contiene datos de cliente
│       ├── src/
│       │   ├── bot/                   ← motor de WhatsApp + Claude API
│       │   ├── scheduling/            ← motor de Google Calendar
│       │   ├── intake/                ← formulario pre-consulta
│       │   ├── notifications/         ← recordatorios, post-cita, reseñas
│       │   ├── dashboard/             ← componentes del panel del doctor
│       │   └── types/                 ← tipos TypeScript globales exportados
│       └── package.json
│
├── clients/
│   ├── dra-quevedo/                   ← instancia cliente 1
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── layout.tsx
│   │   │   │   ├── page.tsx           ← landing page
│   │   │   │   ├── dashboard/
│   │   │   │   │   └── page.tsx       ← ruta protegida /dashboard
│   │   │   │   └── api/
│   │   │   │       ├── bot/           ← webhook WhatsApp
│   │   │   │       ├── calendar/      ← endpoints de agenda
│   │   │   │       └── intake/        ← guardado de formulario
│   │   │   ├── components/
│   │   │   │   ├── Hero.tsx
│   │   │   │   ├── Services.tsx
│   │   │   │   ├── TrustContext.tsx
│   │   │   │   ├── Contact.tsx
│   │   │   │   └── StickyWhatsAppBar.tsx
│   │   │   └── config/
│   │   │       ├── client.config.ts   ← ÚNICA FUENTE DE VERDAD del cliente
│   │   │       └── client.config.schema.ts ← Zod schema importado del engine
│   │   ├── public/
│   │   │   └── images/
│   │   ├── tailwind.config.ts         ← tokens del cliente (desde client.config)
│   │   ├── .env.local                 ← variables de entorno del cliente
│   │   ├── package.json
│   │   └── vercel.json                ← config de deploy
│   │
│   └── [siguiente-cliente]/           ← copiar estructura de dra-quevedo
│
├── scripts/
│   ├── new-client.ts                  ← script para scaffoldear nuevo cliente
│   └── validate-config.ts             ← valida client.config.ts antes de deploy
│
└── package.json                       ← workspace root
```

---

## 3. El Archivo que Gobierna Todo — client.config.ts

**Regla absoluta:** Todo string de negocio, toda URL, todo número de configuración
de un cliente vive aquí. Si un componente tiene un string hardcodeado de negocio,
es un bug de arquitectura.

```typescript
// clients/[cliente]/src/config/client.config.ts
// Este archivo es la única cosa que diferencia una instancia de otra.

import { ClientConfigSchema } from '@presenciapro/engine/types'

export const clientConfig = {

  // ─── IDENTIDAD ───────────────────────────────────────────────────────────
  client: {
    id: "dra-quevedo",                          // slug único, nunca cambia
    name: "Dra. Jaasiel Quevedo",
    specialty: "Medicina Estética",
    domain: "drajaasielquevedo.com",
    timezone: "America/Mexico_City",
    locale: "es-MX",
  },

  // ─── PERSONALIDAD DEL BOT ────────────────────────────────────────────────
  // Esto es lo que hace que cada instancia se sienta única y premium.
  // No es decorativo — es funcional. El prompt del bot se construye desde aquí.
  bot: {
    assistantName: "Sofía",
    tone: "warm-premium" as const,              // warm-premium | professional | friendly
    greeting: "Hola, soy Sofía 👋 asistente de la Dra. Quevedo. ¿En qué te puedo ayudar?",
    awayMessage: "En este momento estamos fuera de horario 🌙 Te respondo mañana a primera hora.",
    fallbackMessage: "Déjame verificar eso con la Dra. Quevedo y te confirmo en breve 🌸",
    followUpDelayHours: 24,                     // horas antes de mandar seguimiento si no responde
    followUpMessage: "Hola, ¿pudiste revisar la información? 😊 Quedamos a tus órdenes para agendar.",
    officeHours: {
      start: "09:00",
      end: "19:00",
      days: [1, 2, 3, 4, 5],                   // 1=lunes, 7=domingo
    },
  },

  // ─── ESPECIALISTAS ───────────────────────────────────────────────────────
  // Soporta 1 o varios. El bot usa esta lista para calificar al paciente.
  specialists: [
    {
      id: "quevedo",
      name: "Dra. Jaasiel Quevedo",
      area: "Botox y medicina estética",
      whatsapp: "5215558056215",
      calendarId: "jaasiel@gmail.com",          // Google Calendar ID
      photo: "/images/doctor.jpg",
    }
  ],

  // ─── AGENDA ──────────────────────────────────────────────────────────────
  scheduling: {
    slotDurationMinutes: 45,
    bufferBetweenSlotsMinutes: 15,
    emergencySlotsPerDay: 1,                    // huecos bloqueados invisibles al paciente
    advanceBookingDays: 30,                     // días máximo hacia adelante para agendar
    reminderSchedule: [24, 2],                  // horas antes de la cita para recordatorios
    cancellationWindowHours: 12,                // mínimo de horas para cancelar sin penalización
    confirmationRequired: true,                 // el paciente debe confirmar o se libera el slot
    confirmationWindowHours: 2,                 // tiempo para confirmar antes de liberar slot
  },

  // ─── SERVICIOS ───────────────────────────────────────────────────────────
  services: [
    {
      id: "botox-facial",
      name: "Botox Facial",
      description: "Suaviza líneas de expresión con resultados naturales.",
      durationMinutes: 45,
      modes: ["domicilio", "consultorio"] as const,
      specialistId: "quevedo",
      postConsultaProducts: ["serum-vitamina-c", "protector-solar-spf50"],
    },
    {
      id: "consulta-inicial",
      name: "Consulta Inicial",
      description: "Evaluación personalizada y plan de tratamiento.",
      durationMinutes: 30,
      modes: ["domicilio", "consultorio"] as const,
      specialistId: "quevedo",
      postConsultaProducts: [],
    },
  ],

  // ─── MODALIDADES DE ATENCIÓN ─────────────────────────────────────────────
  serviceModes: {
    domicilio: {
      label: "A domicilio",
      description: "La Dra. va a tu casa. CDMX y Zona Esmeralda, EdoMex.",
      availableZones: ["CDMX", "Zona Esmeralda", "Interlomas", "Huixquilucan"],
      additionalCost: 0,                        // 0 = incluido en el precio del servicio
    },
    consultorio: {
      label: "En consultorio",
      description: "Atención en consultorio boutique, Zona Esmeralda.",
      address: "Zona Esmeralda, Estado de México",
      googleMapsUrl: "",                        // pendiente — agregar URL real
      parkingAvailable: true,
    },
  },

  // ─── INTAKE PRE-CONSULTA ──────────────────────────────────────────────────
  intake: {
    fields: [
      "nombre_completo",
      "fecha_nacimiento",
      "alergias_conocidas",
      "medicamentos_actuales",
      "motivo_consulta",
      "tratamientos_previos",
      "datos_facturacion",
    ],
    requiresSignature: true,
    signatureLabel: "Acepto el aviso de privacidad y consentimiento informado",
    privacyUrl: "/privacidad",
  },

  // ─── CONTACTO ─────────────────────────────────────────────────────────────
  contact: {
    whatsapp: "5215558056215",
    whatsappMessage: "Hola Sofía, me gustaría agendar una cita con la Dra. Quevedo",
    email: "",                                  // pendiente
    bookingUrl: "",                             // se genera internamente — no es Cal.com
    instagram: "",                              // pendiente
    tiktok: "",                                 // pendiente
  },

  // ─── POST-CONSULTA ────────────────────────────────────────────────────────
  postConsulta: {
    reviewRequestDelayHours: 24,
    reviewUrl: "",                              // pendiente — Google Reviews URL
    reactivationDays: 60,
    reactivationMessage: "Hola, han pasado 2 meses desde tu última visita con la Dra. Quevedo 🌸 ¿Te gustaría agendar tu seguimiento?",
  },

  // ─── PRODUCTOS POST-CONSULTA ──────────────────────────────────────────────
  products: [
    {
      id: "serum-vitamina-c",
      name: "Sérum Vitamina C",
      description: "Ideal para mantener el resultado de tu tratamiento.",
      price: 850,
      currency: "MXN",
      purchaseUrl: "",                          // pendiente
    },
    {
      id: "protector-solar-spf50",
      name: "Protector Solar SPF 50",
      description: "Protección esencial post-botox.",
      price: 420,
      currency: "MXN",
      purchaseUrl: "",                          // pendiente
    },
  ],

  // ─── SEO ──────────────────────────────────────────────────────────────────
  seo: {
    title: "Dra. Jaasiel Quevedo — Botox a domicilio | Zona Esmeralda, EdoMex",
    description: "Aplicación médica de botox con resultados naturales. Servicio a domicilio en CDMX y Estado de México, o en consultorio boutique en Zona Esmeralda.",
    keywords: [
      "botox a domicilio cdmx",
      "botox zona esmeralda",
      "botox estado de mexico",
      "medicina estetica a domicilio",
      "aplicacion botox domicilio",
    ],
    ogImage: "/images/og-image.jpg",
  },

  // ─── DISEÑO ───────────────────────────────────────────────────────────────
  // Estos tokens se inyectan en tailwind.config.ts automáticamente.
  design: {
    colors: {
      primary: "#8B6F5E",
      primaryLight: "#A68B7A",
      primaryDark: "#6B5248",
      background: "#FAFAF8",
      surface: "#F2F0ED",
      text: "#1A1A1A",
      textMuted: "#6B7280",
      border: "#E5E2DE",
      white: "#FFFFFF",
    },
    fonts: {
      heading: "Playfair Display",
      body: "Inter",
    },
    borderRadius: "0.5rem",
  },

} satisfies ClientConfigSchema  // Zod valida en build time
```

---

## 3.5 Perfiles de Cliente — `medical` y `lifestyle`

El campo discriminador `profile` en `client.config.ts` determina qué módulos activa el engine
para cada instancia. El motor es el mismo. La diferencia vive en el config.

### Perfiles disponibles

| Perfil | Para quién | Bot | Intake | Modalidades | Productos |
|---|---|---|---|---|---|
| `medical` | Médicos, dentistas, psicólogos, nutriólogos | Flujo completo: visita → servicio → modalidad | Sí — con firma digital | Sí — domicilio y/o consultorio | Sí — productos post-consulta |
| `lifestyle` | Peluquería, uñas, spa, estética | Simplificado: solo servicio → agenda directa | No | No — siempre en local | No |

### Regla de extensión para futuros módulos

Antes de agregar un campo nuevo al engine:

1. **¿Aplica a todos los perfiles?** → Va en `BaseConfigSchema` (en `client.config.schema.ts`)
2. **¿Solo a `medical`?** → Va en `MedicalConfigSchema`
3. **¿Solo a `lifestyle`?** → Va en `LifestyleConfigSchema`
4. **¿A un subconjunto nuevo?** → Crea un nuevo perfil con `z.literal()` y agrégalo al `discriminatedUnion`

Nunca uses `any`, `as unknown`, ni opcionales (`?.`) para esquivar el discriminador.
Usa type guards para acceder a campos de un perfil específico.

### Type guards

Exportados desde `packages/engine/src/types/client.config.schema.ts`:

```typescript
isMedical(config: ClientConfig): config is MedicalConfig
isLifestyle(config: ClientConfig): config is LifestyleConfig
```

**Uso correcto en el engine:**
```typescript
import { isMedical } from '@presenciapro/engine/types';

if (isMedical(config)) {
  // TypeScript sabe que config.intake, config.serviceModes y config.products existen
  const intakeUrl = generateIntakeUrl({ appointmentId, patientId, clientId });
}
```

### Inventario de módulos que requieren type guards

Estos módulos acceden a campos exclusivos de `medical`. Cuando se implementen,
deben envolver el acceso con `isMedical()`:

| Módulo | Campo médico accedido | Guard requerido |
|---|---|---|
| `packages/engine/src/intake/` | `config.intake` | `isMedical(config)` antes de cualquier acceso |
| `packages/engine/src/bot/flow.ts` | Paso `QUALIFYING_MODE` del flujo de calificación | `isMedical(config)` para incluir la pregunta de modalidad |
| `packages/engine/src/bot/prompt.ts` | `config.serviceModes` en el prompt del bot | `isMedical(config)` antes de mencionar domicilio/consultorio |
| `packages/engine/src/notifications/` | `config.products` en mensajes post-consulta | `isMedical(config)` para incluir productos recomendados |

### Contrato del flujo de calificación del bot (para Bot Engineer)

El engine detecta el perfil y adapta los pasos del flujo:

```
medical:   QUALIFYING_VISIT_TYPE → QUALIFYING_SERVICE → QUALIFYING_MODE → agenda
lifestyle: QUALIFYING_SERVICE → agenda (directo, sin modalidad)
```

Este contrato debe implementarse en `packages/engine/src/bot/flow.ts` y `prompt.ts`.
**No implementar sin sesión dedicada de Bot Engineer.**

### Diferencias en `services[]`

| Campo | `MedicalService` | `LifestyleService` |
|---|---|---|
| `modes[]` | Requerido (≥ 1) | No existe |
| `postConsultaProducts[]` | Requerido (puede ser `[]`) | No existe |

Los campos de `BaseService` son compartidos: `id`, `name`, `description`,
`durationMinutes`, `icon`, `specialistId`.

### Tipos exportados

```typescript
ClientConfig   // union = MedicalConfig | LifestyleConfig
MedicalConfig  // z.infer<typeof MedicalConfigSchema>
LifestyleConfig // z.infer<typeof LifestyleConfigSchema>
MedicalService  // z.infer<typeof MedicalServiceSchema>
LifestyleService // z.infer<typeof LifestyleServiceSchema>
```

---

## 4. Base de Datos — Supabase Schema

Todas las tablas tienen el prefijo del `client_id` como foreign key.
Un solo Supabase project sirve a todos los clientes.

```sql
-- Pacientes
CREATE TABLE patients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL,               -- 'dra-quevedo'
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,               -- número WhatsApp
  email         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_visit    TIMESTAMPTZ,
  UNIQUE(client_id, phone)
);

-- Citas
CREATE TABLE appointments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       TEXT NOT NULL,
  patient_id      UUID REFERENCES patients(id),  -- NULL solo para emergency_blocked
  specialist_id   TEXT NOT NULL,
  service_id      TEXT NOT NULL,
  service_mode    TEXT NOT NULL,             -- 'domicilio' | 'consultorio'
  starts_at       TIMESTAMPTZ NOT NULL,
  ends_at         TIMESTAMPTZ NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending',
                                             -- pending              → sin acción requerida del paciente
                                             -- pending_confirmation → confirmationRequired=true; el paciente
                                             --                        tiene confirmationWindowHours para
                                             --                        confirmar o el slot se libera
                                             -- confirmed            → paciente confirmó
                                             -- cancelled            → cancelada (paciente, sistema o doctor)
                                             -- completed            → cita realizada
                                             -- no_show              → doctor marcó como no presentado
                                             -- emergency_blocked    → slot reservado para emergencias;
                                             --                        invisible al paciente; patient_id = NULL
  google_event_id TEXT,                      -- ID del evento en Google Calendar
  intake_id       UUID,                      -- referencia al intake completado
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Intake pre-consulta
CREATE TABLE intakes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id           TEXT NOT NULL,
  patient_id          UUID REFERENCES patients(id),
  appointment_id      UUID REFERENCES appointments(id),
  fields              JSONB NOT NULL,        -- datos del formulario
  signature_url       TEXT,                 -- URL del archivo de firma
  signed_at           TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Conversaciones del bot
CREATE TABLE bot_conversations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     TEXT NOT NULL,
  patient_phone TEXT NOT NULL,
  state         TEXT NOT NULL,              -- estado actual del flujo conversacional
  context       JSONB DEFAULT '{}',         -- contexto acumulado de la conversación
  last_message  TIMESTAMPTZ DEFAULT NOW(),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Métricas de eventos
CREATE TABLE events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   TEXT NOT NULL,
  type        TEXT NOT NULL,               -- 'whatsapp_click' | 'booking_started' | 'booking_completed' | 'review_sent' etc.
  patient_id  UUID REFERENCES patients(id),
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
```

**Reglas de base de datos:**
- Todo query lleva `WHERE client_id = ?` — nunca se mezclan datos entre clientes
- Row Level Security (RLS) activado en Supabase para todas las tablas
- El doctor solo ve datos de su `client_id` — validado en el servidor, nunca en el cliente
- Nunca expongas la `service_role_key` de Supabase en el frontend

---

## 5. Módulos del Motor — Contratos de Interfaz

Cada módulo es independiente. Se comunica con los demás solo a través de estos contratos.
Nunca importes lógica interna de un módulo desde otro módulo.

### 5.1 Bot (`packages/engine/src/bot/`)

**Responsabilidad:** Recibir mensajes de WhatsApp, mantener estado de conversación,
generar respuestas con Claude API, disparar acciones (agendar, notificar).

**Entrada:**
```typescript
type IncomingMessage = {
  from: string          // número WhatsApp del paciente
  body: string          // texto del mensaje
  clientId: string      // para cargar config del cliente correcto
  timestamp: Date
}
```

**Salida:**
```typescript
type BotResponse = {
  message: string       // texto a enviar al paciente
  action?: BotAction    // acción a ejecutar además de responder
}

type BotAction =
  | { type: 'CREATE_APPOINTMENT'; data: AppointmentRequest }
  | { type: 'SEND_INTAKE_LINK'; appointmentId: string }
  | { type: 'ESCALATE_TO_HUMAN'; reason: string }
  | { type: 'SEND_LOCATION'; specialistId: string }
```

**Lo que NO hace el bot:**
- No escribe directamente a la base de datos de citas (delega a `scheduling`)
- No envía mensajes directamente a WhatsApp (delega a `notifications`)
- No conoce el diseño del frontend

### 5.2 Scheduling (`packages/engine/src/scheduling/`)

**Responsabilidad:** Disponibilidad real, creación y cancelación de citas,
bloqueo de huecos de emergencia, sincronización con Google Calendar.

**Funciones exportadas:**
```typescript
getAvailableSlots(params: {
  clientId: string
  specialistId: string
  serviceId: string
  dateRange: { from: Date; to: Date }
}): Promise<TimeSlot[]>

createAppointment(params: AppointmentRequest): Promise<Appointment>

cancelAppointment(params: {
  appointmentId: string
  clientId: string
  reason?: string
}): Promise<void>

blockEmergencySlot(params: {
  clientId: string
  specialistId: string
  date: Date
}): Promise<void>
```
### Trabajo pendiente — Bot Engineer (lifestyle)
- `bot/prompt.ts` → `buildModesBlock()`: agregar bloque de dirección
  del local cuando `isLifestyle(config)`
- `bot/flow.ts`: omitir estados `QUALIFYING_VISIT_TYPE` y
  `QUALIFYING_MODE` cuando `isLifestyle(config)`
- Contrato: lifestyle sigue el flujo
  `QUALIFYING_SERVICE → PRESENTING_SLOTS → AWAITING_CONFIRMATION`

### 5.3 Notifications (`packages/engine/src/notifications/`)

**Responsabilidad:** Envío de todos los mensajes salientes — WhatsApp, email.
Es el único módulo que habla directamente con WhatsApp API y Resend.

**Funciones exportadas:**
```typescript
sendWhatsApp(params: {
  to: string
  message: string
  clientId: string
}): Promise<void>

sendEmail(params: {
  to: string
  subject: string
  template: EmailTemplate
  data: Record<string, unknown>
  clientId: string
}): Promise<void>

scheduleReminder(params: {
  appointmentId: string
  type: 'confirmation' | 'reminder_24h' | 'reminder_2h' | 'post_consulta' | 'review_request' | 'reactivation'
  clientId: string
}): Promise<void>
```

### 5.4 Intake (`packages/engine/src/intake/`)

**Responsabilidad:** Generar, servir y guardar el formulario pre-consulta.

**Funciones exportadas:**
```typescript
generateIntakeUrl(params: {
  appointmentId: string
  patientId: string
  clientId: string
}): string   // URL firmada con token de acceso único

saveIntake(params: {
  token: string
  fields: Record<string, unknown>
  signatureDataUrl?: string
}): Promise<Intake>

getIntakeForAppointment(params: {
  appointmentId: string
  clientId: string
}): Promise<Intake | null>
```

### 5.5 Dashboard (`packages/engine/src/dashboard/`)

**Responsabilidad:** Componentes React y datos para el panel del doctor.
Solo lee datos — nunca los crea ni modifica directamente.

**Componentes exportados:**
```typescript
<DayView clientId={string} date={Date} />
<WeekMetrics clientId={string} />
<PatientList clientId={string} />
<IntakeViewer appointmentId={string} clientId={string} />
<ReviewAlerts clientId={string} />
```

---

## 6. Flujo de una Cita — de Principio a Fin

```
1. Paciente comenta en Instagram/TikTok
         ↓
2. ManyChat detecta keyword → envía DM con link de WhatsApp
         ↓
3. Paciente escribe al WhatsApp de la doctora
         ↓
4. Webhook recibe mensaje → bot/index.ts lo procesa
         ↓
5. Claude API genera respuesta con personalidad del cliente
         ↓
6. Bot califica: ¿primera vez? ¿qué servicio? ¿qué modalidad?
         ↓
7. Bot llama a scheduling.getAvailableSlots()
         ↓
8. Bot presenta horarios como opciones numeradas
         ↓
9. Paciente elige → scheduling.createAppointment()
         ↓
10. Google Calendar event creado
         ↓
11. notifications.sendWhatsApp() → confirmación al paciente
         ↓
12. notifications.sendWhatsApp() → notificación a la doctora
         ↓
13. Bot envía link de intake → intake.generateIntakeUrl()
         ↓
14. Paciente llena formulario pre-consulta
         ↓
15. [24h antes] notifications.scheduleReminder('reminder_24h')
         ↓
16. [2h antes]  notifications.scheduleReminder('reminder_2h')
         ↓
17. Cita realizada → doctor marca como 'completed' en dashboard
         ↓
18. [24h después] notifications.scheduleReminder('review_request')
         ↓
19. [60 días sin nueva cita] notifications.scheduleReminder('reactivation')
```

---
## 6.5 Patrón Orquestador — Edge Functions → API Routes

### El problema
Las Supabase Edge Functions corren en Deno y no tienen acceso a:
- Los archivos `client.config.ts` del monorepo
- Las variables de entorno de Vercel (Google Calendar, WhatsApp, etc.)
- Las dependencias Node.js del engine (`Buffer`, módulos npm)

### La solución
Las Edge Functions actúan como **orquestadores livianos**: leen la tabla `clients`
en Supabase y llaman a API Routes de Next.js en cada cliente activo.
El API Route tiene acceso completo al config y credenciales de entorno.
Edge Function (Deno, Supabase)
→ lee tabla clients WHERE active = TRUE
→ POST /api/[endpoint] en cada cliente  ← autenticado con CRON_SECRET
→ API Route (Next.js, Vercel)
→ ejecuta lógica del engine con config y credenciales completas

### Implementación actual

| Edge Function | Schedule | Llama a | Hace |
|---|---|---|---|
| `dispatch-notifications` | `* * * * *` | Supabase directo | Lee `scheduled_notifications`, envía WhatsApp/email vía fetch, marca `sent_at` |
| `block-emergency-slots` | `0 13 * * 1-5` (UTC = 07:00 CDMX) | `POST /api/calendar/block-emergency` | Bloquea huecos de emergencia del día en cada cliente activo |
| `dispatch-monthly-report` | `0 10 1 * *` (UTC = 04:00 CDMX, día 1) | `POST /api/reports/monthly` | Envía reporte mensual (WhatsApp + email HTML) al doctor de cada cliente activo |

### Idempotencia en `dispatch-notifications`
El worker reclama cada fila atómicamente:
```sql
UPDATE scheduled_notifications
SET sent_at = NOW()
WHERE id = ? AND sent_at IS NULL AND failed_at IS NULL
```
Si dos workers corren en paralelo, solo uno setea `sent_at`.
Si el envío falla: `sent_at` se revierte a `NULL`, se registra `failed_at`.

### CRON_SECRET
Variable requerida para autenticar llamadas Edge Function → API Route.
- Agregar a `.env.local` de cada cliente: `CRON_SECRET=`
- Agregar a Supabase Secrets (mismo valor)
- El API Route valida: `Authorization: Bearer ${CRON_SECRET}`
- Nunca expongas este valor en el frontend ni en logs

### Configuración manual requerida en Supabase Dashboard
Edge Functions → Schedules:
- `dispatch-notifications` → `* * * * *`
- `block-emergency-slots` → `0 13 * * 1-5`

Esta configuración no está en código — debe hacerse una vez por ambiente (staging, producción).

### Regla de extensión
Cada vez que agregues una nueva Edge Function que requiera lógica de negocio:
1. La Edge Function solo orquesta (lee `clients`, llama API Routes)
2. La lógica vive en el API Route con acceso al engine completo
3. Agrega la nueva función a la tabla de implementación actual (arriba)
4. Documenta el `CRON_SECRET` si el endpoint es nuevo

## 7. Variables de Entorno por Cliente

Cada cliente tiene su propio `.env.local`. Nunca compartas variables entre clientes.

```bash
# ─── SUPABASE ────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=           # solo en servidor, nunca en cliente

# ─── GOOGLE CALENDAR ──────────────────────────────────────
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=                # un token por especialista

# ─── WHATSAPP BUSINESS API ────────────────────────────────
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=       # string aleatorio para verificar webhook

# ─── CLAUDE API ───────────────────────────────────────────
ANTHROPIC_API_KEY=                   # una sola key para todos los clientes

# ─── RESEND ───────────────────────────────────────────────
RESEND_API_KEY=
RESEND_FROM_EMAIL=

# ─── CLIENTE ──────────────────────────────────────────────
NEXT_PUBLIC_CLIENT_ID=dra-quevedo    # debe coincidir con client.config.ts
```

---

## 8. Convenciones de Código

### Naming
- Archivos de componentes: `PascalCase.tsx`
- Archivos de utilidades y módulos: `camelCase.ts`
- Constantes globales: `UPPER_SNAKE_CASE`
- Variables y funciones: `camelCase`
- Tipos e interfaces: `PascalCase`
- IDs de base de datos en client.config: `kebab-case`

### Estructura de un componente
```typescript
// 1. Imports externos
// 2. Imports del engine
// 3. Imports locales
// 4. Types locales (solo si no pertenecen al engine)
// 5. Componente
// 6. Export default
```

### Reglas inamovibles
- Cero strings de negocio hardcodeados en componentes
- Cero `any` en TypeScript
- Cero `console.log` en producción — usa el logger del engine
- Todo API route valida su input con Zod antes de procesarlo
- Todo query a Supabase incluye `client_id` en el WHERE
- Los Server Components no reciben props de datos — los fetchen ellos mismos
- Los Client Components no hacen fetch directo a Supabase — usan API routes

---

## 9. Cómo Agregar un Nuevo Cliente

El proceso completo toma menos de 30 minutos una vez que el motor está construido.

```bash
# 1. Ejecutar el script de scaffolding
npx ts-node scripts/new-client.ts --id=dr-nuevo --name="Dr. Nombre"

# El script crea automáticamente:
# clients/dr-nuevo/ con toda la estructura
# Copia client.config.ts con valores placeholder
# Crea .env.local vacío con todas las variables necesarias
# Agrega el proyecto a vercel.json del monorepo

# 2. Llenar clients/dr-nuevo/src/config/client.config.ts
# con los datos reales del cliente

# 3. Validar la configuración
npx ts-node scripts/validate-config.ts --client=dr-nuevo

# 4. Deploy en Vercel
vercel --cwd clients/dr-nuevo
```

---

## 10. Definición de "Terminado" por Módulo

### Landing page
- [ ] Lighthouse ≥ 90 en Performance, Accessibility, SEO
- [ ] Mobile-first desde 375px
- [ ] CTAs en el 60% inferior en móvil
- [ ] Cero strings hardcodeados
- [ ] Build limpio sin errores TypeScript
- [ ] Open Graph configurado
- [ ] Schema.org MedicalBusiness implementado

### Bot de WhatsApp
- [ ] Webhook verificado con Meta
- [ ] Flujo de calificación completo (3 preguntas máximo)
- [ ] Manejo de respuestas fuera del flujo (fallback elegante)
- [ ] Seguimiento automático a 24h si no responde
- [ ] Estado de conversación persiste en Supabase
- [ ] Horario de atención respetado (away message fuera de horario)

### Motor de agenda
- [ ] Slots de emergencia bloqueados correctamente
- [ ] Sin double-booking posible
- [ ] Sincronización Google Calendar bidireccional
- [ ] Recordatorios 24h y 2h antes funcionando
- [ ] Cancelación libera slot en Google Calendar

### Intake pre-consulta
- [ ] Formulario carga en menos de 2s en móvil 4G
- [ ] Firma digital funciona con el dedo en iOS y Android
- [ ] Datos cifrados en Supabase
- [ ] Link de acceso único expira después de 48h o de firmado

### Dashboard del doctor
- [ ] Login con Supabase Auth
- [ ] Vista del día carga en menos de 1s
- [ ] Intake de cada cita visible antes de la consulta
- [ ] Control de huecos de emergencia funcional
- [ ] Funciona correctamente en móvil

---

## 11. Roles de Sesión para Claude Code

Cada sesión de Claude Code tiene un rol específico. Nunca mezcles roles en una sola sesión.
Al inicio de cada sesión, pega este archivo completo + el rol correspondiente.

| Rol | Contexto adicional a pegar | Output esperado |
|---|---|---|
| **Arquitecto** | Solo este archivo | ARCHITECTURE.md actualizado, schema Zod maestro |
| **Ingeniero de Bot** | Este archivo + tipos del engine | packages/engine/src/bot/ completo |
| **Ingeniero de Agenda** | Este archivo + tipos del engine | packages/engine/src/scheduling/ completo |
| **Ingeniero de Frontend** | Este archivo + client.config.ts del cliente | components/ de la instancia del cliente |
| **Ingeniero de Dashboard** | Este archivo + tipos exportados de todos los módulos | dashboard/ components |
| **Ingeniero de Automatizaciones** | Este archivo + contratos de notifications/ | flujos post-cita, recordatorios, reactivación |
| **Ingeniero de Infraestructura** | Este archivo + .env.local template | scripts/, vercel.json, Supabase migrations |

---

*PresenciaPro OS · ARCHITECTURE.md · v1.1*
*Actualiza la versión cada vez que modifiques este documento.*
*Último cambio: sección 3.5 — Perfiles de Cliente (medical / lifestyle), discriminatedUnion en ClientConfigSchema, type guards isMedical / isLifestyle, inventario de módulos afectados, contrato de flujo de bot por perfil.*
