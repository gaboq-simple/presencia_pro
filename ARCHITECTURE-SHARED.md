# ARCHITECTURE-SHARED.md — PresenciaPro OS · Capa Compartida

> Este documento captura todo lo que aplica igualmente a **todos los productos**
> del monorepo: `medical` (clientes individuales en `clients/`) y `lifestyle`
> (`apps/lifestyle/`). No duplica — referencia `ARCHITECTURE.md` donde ya está
> definido y solo agrega lo que no estaba explicitado.
>
> Fuente de verdad para decisiones cross-producto.

---

## 0. Principio Rector

Ver `ARCHITECTURE.md §0`. No se repite aquí.

---

## 1. Stack Tecnológico — Versiones Fijas

Ver `ARCHITECTURE.md §1` para la tabla completa. Aplica a todos los productos.

**Adiciones que aplican a `apps/`:**

| Capa | Herramienta | Versión | Alcance |
|---|---|---|---|
| Framework | Next.js | 16.2.2 | `apps/sellers-portal`, `apps/lifestyle` |
| CSS | Tailwind CSS | v4 (`@tailwindcss/postcss`) | `apps/*` |
| Auth | `@supabase/ssr` | ^0.6.1 | `apps/*` — manejo de cookies en App Router |

> **Regla:** Los `clients/` usan Next.js 15.x (ver `ARCHITECTURE.md §1`).
> Los `apps/` usan Next.js 16.x. No mezclar versiones dentro de la misma carpeta.

---

## 2. Estructura del Monorepo

```
presenciapro/
│
├── ARCHITECTURE.md           ← fuente de verdad de medical y monorepo
├── ARCHITECTURE-SHARED.md    ← este archivo
├── ARCHITECTURE-LIFESTYLE.md ← decisiones de lifestyle
│
├── packages/
│   └── engine/               ← motor compartido — ver §5
│
├── clients/                  ← instancias medical (dra-quevedo, etc.)
│   └── [cliente]/
│
├── apps/                     ← productos SaaS independientes
│   ├── sellers-portal/       ← portal de vendedores PresenciaPro
│   └── lifestyle/            ← SaaS multi-tenant bienestar y estética
│
└── scripts/
```

**Regla de workspace:** Todo lo que está en `packages/`, `clients/` y `apps/`
forma parte del workspace npm. Los imports cross-package se hacen via
`@presenciapro/engine/*`.

---

## 3. Motor Compartido — `packages/engine/`

El engine nunca contiene datos de cliente. Toda configuración llega en runtime
como parámetro. Esto aplica tanto a `medical` como a `lifestyle`.

### 3.1 Módulos y uso por producto

| Módulo | `medical` (clients/) | `lifestyle` (apps/lifestyle) |
|---|---|---|
| `engine/bot/` | Flujo completo — QUALIFYING_VISIT_TYPE + QUALIFYING_MODE | Adaptado — flujo simplificado sin modalidades (ver ARCHITECTURE-LIFESTYLE.md §5) |
| `engine/scheduling/` | Google Calendar + slots de emergencia | Extendido para multi-recurso (multi-staff) — Google Calendar opcional Fase 1 |
| `engine/notifications/` | Sin cambios | Sin cambios — mismo contrato |
| `engine/intake/` | Sí — formulario pre-consulta con firma | No aplica |
| `engine/dashboard/` | Componentes React para panel del doctor | No aplica — lifestyle tiene su propio dashboard en `apps/lifestyle/src/` |

### 3.2 Tipos compartidos

Exportados desde `packages/engine/src/types/`:

```typescript
// Perfiles discriminados
ClientConfig       // union = MedicalConfig | LifestyleConfig
MedicalConfig
LifestyleConfig
isMedical(config)  // type guard
isLifestyle(config)

// Lifestyle-específicos (nuevo — ver lifestyle.types.ts)
LifestyleBotState
LifestyleBotContext
LifestyleBotContextSchema  // Zod — para deserializar bot_conversations.context
AppointmentStatus
AppointmentSource
StaffRole
```

### 3.3 Contratos de módulo

Ver `ARCHITECTURE.md §5` para los contratos completos de cada módulo (bot,
scheduling, notifications, intake, dashboard). Son contratos vinculantes para
cualquier producto.

---

## 4. Patrón Orquestador — Edge Functions → API Routes

Ver `ARCHITECTURE.md §6.5` para la descripción completa del patrón.

**Aplica a todos los productos.** Resumen:

- Edge Functions (Deno, Supabase): orquestadores livianos, leen tabla de clientes/negocios activos
- API Routes (Next.js, Vercel): lógica de negocio con acceso a config y credenciales
- Autenticación entre ambos: `CRON_SECRET` (Bearer token)

**Edge Functions existentes y sus targets:**

| Función | Target(s) |
|---|---|
| `dispatch-notifications` | Supabase directo (todos los productos comparten la tabla) |
| `block-emergency-slots` | `POST /api/calendar/block-emergency` (clients/medical) |
| `dispatch-monthly-report` | `POST /api/reports/monthly` (clients/medical) |
| `check-stale-leads` | `POST /api/internal/check-stale-leads` (apps/sellers-portal) |
| `generate-monthly-commissions` | `POST /api/internal/generate-monthly-commissions` (apps/sellers-portal) |

> **Regla de extensión:** Cuando `apps/lifestyle` requiera tareas programadas
> (recordatorios, follow-ups), agregar nuevas Edge Functions que llamen a
> `POST /api/internal/[tarea]` en lifestyle. Documentar en
> `ARCHITECTURE.md §6.5` y aquí.

---

## 5. CRON_SECRET

Variable de entorno compartida entre Supabase Edge Functions y las API Routes
de cada producto. Misma clave en todos los productos.

- En `clients/[cliente]/.env.local`: `CRON_SECRET=`
- En `apps/sellers-portal/.env.local`: `CRON_SECRET=`
- En `apps/lifestyle/.env.local`: `CRON_SECRET=`
- En Supabase Secrets (mismo valor): `CRON_SECRET=`

El API Route valida: `Authorization: Bearer ${CRON_SECRET}`

Ver `ARCHITECTURE.md §6.5` para implementación de referencia.

---

## 6. Convenciones de Código — Aplican a Todo el Monorepo

Ver `ARCHITECTURE.md §8` para la lista completa. Las siguientes son adicionales
o explicitadas para `apps/`:

### Naming
- Archivos de componentes: `PascalCase.tsx`
- Archivos de módulo/utilidad: `camelCase.ts`
- API Routes: siempre `route.ts` (App Router convention)
- Tipos e interfaces: `PascalCase`

### Reglas inamovibles
- Cero `any` en TypeScript — sin excepciones
- Cero strings de negocio hardcodeados en componentes
- Todo API route valida su input con Zod antes de procesarlo
- Los Server Components no reciben props de datos — los fetchean ellos mismos
- Los Client Components no hacen fetch directo a Supabase — usan API routes
- `SUPABASE_SERVICE_ROLE_KEY` nunca en el cliente — solo servidor

### Estructura de imports (mismo orden en todos los archivos)
```typescript
// 1. Imports externos (next, react, zod, etc.)
// 2. Imports del engine (@presenciapro/engine/*)
// 3. Imports locales (@/*)
// 4. Types locales (solo si no pertenecen al engine)
// 5. Componente / función / clase
// 6. Export
```

---

## 7. Supabase — Base de Datos

Un solo proyecto Supabase sirve a todos los clientes y productos. El aislamiento
se hace por columna discriminadora:

| Producto | Columna discriminadora | Tablas |
|---|---|---|
| `medical` | `client_id TEXT` | `patients`, `appointments`, `intakes`, `bot_conversations`, `events` |
| `lifestyle` | `business_id UUID` | `businesses`, `staff`, `services`, `customers`, `appointments`, `bot_conversations`, `scheduled_notifications` |
| `sellers-portal` | — (tabla propia) | `sellers`, `leads`, `commission_payouts` |

> **Regla:** Nunca mezcles tablas entre productos en un mismo query.
> Las tablas `bot_conversations` y `appointments` de medical y lifestyle son
> entidades distintas aunque compartan el nombre — no son la misma tabla.

**RLS activado en todas las tablas de todos los productos.** Sin excepciones.

---

## 8. Variables de Entorno — Estructura Base

Cada producto tiene su propio `.env.local`. Las variables de Supabase son las
mismas instancia (mismo proyecto) pero los tokens de servicio varían por producto.

Variables que **siempre** deben estar en cualquier `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CRON_SECRET=
```

Variables adicionales por producto: ver `.env.local.example` de cada app/client.

---

*PresenciaPro OS · ARCHITECTURE-SHARED.md · v1.0*
*Último cambio: creación inicial — extracción de capa compartida para soporte multi-producto.*
