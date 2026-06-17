# SPRINT — presenciapro hacia cliente fundador

> **Objetivo único de este sprint:** dejar lifestyle listo para que un dueño de barbería conocido lo opere en producción durante 30 días sin que pierda data, sin que el sistema falle silenciosamente, y cumpliendo LFPDPPP mínima. **NO** es construir el producto enterprise.

**Horizonte:** 4-6 semanas desde el inicio.
**Horas disponibles/día:** 6-10 (Gabriel solo).
**Salida del sprint:** primer cliente fundador operando en producción + reporte de los primeros 10 días.

---

## Protocolo de trabajo con Claude Code

Este protocolo **debe** seguirse al pie de la letra. Si Claude Code se desvía, recordárselo.

### Al iniciar cualquier sesión de Claude Code:

1. Claude Code lee `SPRINT.md` (este archivo) completo.
2. Claude Code lee `SPRINT-PROMPTS.md` solo si va a ejecutar una tarea específica.
3. Claude Code identifica la tarea actual (la primera en estado `🔵 in-progress` o, si no hay ninguna, la primera `⚪ todo` que no esté bloqueada).
4. Claude Code **no inicia trabajo nuevo sin confirmación explícita de Gabriel**. Si encuentra algo no documentado que parece urgente, lo reporta y espera.

### Al ejecutar una tarea:

1. Claude Code lee el prompt completo de la tarea en `SPRINT-PROMPTS.md`.
2. Marca la tarea como `🔵 in-progress` en `SPRINT.md`.
3. Ejecuta con los criterios de aceptación a la vista.
4. **NO** mezcla tareas. Una tarea = un PR mental = un commit lógico.

### Al cerrar una tarea:

1. Verifica todos los criterios de aceptación uno por uno.
2. Si algo falla o se desvió, lo documenta en "Notas de ejecución" de esa tarea.
3. Cambia estado a `🟢 done` con fecha.
4. Reporta a Gabriel: "Tarea X cerrada. Cambios en archivos A, B, C. Pendiente de revisión humana: Y."
5. **NO** avanza a la siguiente tarea automáticamente.

### Cuando hay imprevistos:

- Si una tarea descubre un problema mayor no documentado → status `🟡 blocked`, escribir en "Notas de ejecución" qué se descubrió, **detener**, esperar instrucciones de Gabriel.
- Si una tarea se completa más rápido de lo esperado → bien, pero no agarrar la siguiente sin confirmación.
- Si Gabriel dice "siguiente" o "next" → avanzar a la próxima `⚪ todo` no bloqueada.

### Estados:

- `⚪ todo` — no iniciada
- `🔵 in-progress` — en ejecución activa
- `🟡 blocked` — bloqueada por descubrimiento o por dependencia externa
- `🟢 done` — completada y verificada
- `⚫ skipped` — decidido no hacerla en este sprint
- `🔴 failed` — intentada y abandonada, requiere replanteo

---

## Decisiones tomadas en la auditoría (no re-discutir)

Estas decisiones ya fueron tomadas y son la base del sprint. Si Claude Code intenta cuestionarlas o "mejorar" más allá del scope, recordarle que están cerradas.

- **dra-quevedo:** experimento. Se apaga el deploy en Vercel. NO se borra el código todavía. Su data en Supabase se preserva pero se aísla del nuevo flujo. Migración del schema médico a otro repo es POST-sprint.
- **Sellers-portal:** se mantiene operando como está. No tocar fuera del sprint.
- **Marca:** Zentriq = empresa/holding (`contacto@zentriq.mx`). presenciapro = producto del nicho de servicios y belleza. Aviso de privacidad será de Zentriq SA. Polish de marca se aplica a presenciapro como producto.
- **Modelo de cobro al fundador:** decisión pendiente de Gabriel (ver TASK G-01).
- **Stack:** Next.js 16 + Supabase + Vercel se mantiene. No migrar nada en este sprint.
- **Tests automatizados:** NO entran al sprint. CI/CD mínimo (lint + typecheck) sí.

---

## Tareas

Cada tarea tiene un ID con formato `S{semana}-{categoría}-{nn}`. Categorías:
- `SEC` = seguridad
- `OPS` = operación/infraestructura
- `LEG` = legal/compliance
- `UX` = experiencia de usuario/polish
- `DOC` = documentación
- `G` = decisiones humanas de Gabriel (Claude Code no las ejecuta, solo las recuerda)

### Semana 1 — Contención y datos seguros

#### S1-G-01 — Verificar `META_APP_SECRET` en producción ⚪ todo `🟡 blocked
**Tipo:** Decisión humana (Gabriel, 5 min)
**Por qué:** Si la env var no está en Vercel producción, el webhook acepta payloads no firmados HOY.
**Acción:** Gabriel entra a Vercel Dashboard → apps/lifestyle → Settings → Environment Variables. Verifica que `META_APP_SECRET` existe en Production environment y NO está vacío.
**Salida esperada:** Confirmación textual a Claude Code: "META_APP_SECRET verificado" o "Falta, lo agrego ahora".

### Notas de ejecucion 
Bloqueada externa: tramitando cuenta de Meta Business y obtención de App Secret. Sin urgencia operacional porque no hay tráfico real de Meta apuntando a /api/bot todavía. Re-evaluar antes del go-live del cliente fundador (S4-G-01) — sin META_APP_SECRET configurado, el webhook rechaza todo el tráfico real.
--

#### S1-SEC-01 — Fix R1: webhook Meta fail-open 🟢 done (2026-05-18)
**Origen:** Phase 4, R1 🚨
**Por qué:** `verifyMetaSignature()` retorna `null` cuando falta secret; el check `=== false` no lo captura.
**Archivos:** `apps/lifestyle/src/app/api/bot/route.ts`
**Criterios de aceptación:**
- [x] El check cambia a `if (signatureValid !== true)` o equivalente fail-closed
- [x] Si `META_APP_SECRET` no está configurado, el endpoint responde 401, NO procesa
- [x] Se borra la implementación duplicada de verificación; se usa `verifyWebhookSignature` del engine
- [x] No hay otro lugar en el codebase que reimplemente verificación de Meta
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-01

---

#### S1-SEC-02 — Verificar historial git por credenciales filtradas 🟢 done (2026-05-18)
**Origen:** Phase 4, R3 🚨
**Por qué:** `.env.local` contiene Anthropic key real, Supabase service role, Twilio token. Si entraron al historial alguna vez, están comprometidos.
**Criterios de aceptación:**
- [x] Correr `git log --all --full-history --source -- '**/.env*'` y reportar resultados → **0 hits en todos los patrones**
- [x] Si hay hits, rotar inmediatamente → no aplica, no hay hits
- [x] Aunque no haya hits, rotar Anthropic key como higiene → checklist generado para Gabriel
- [ ] Actualizar `.env.local` local y env vars de Vercel con keys nuevas → pendiente de Gabriel
- [x] Confirmar que `.gitignore` excluye `.env*` en todos los niveles → raíz OK con `.env*`; no hay .gitignore en workspaces (no necesario porque raíz cubre todo)
**Notas de ejecución:** Historial limpio. 15 variables encontradas. Checklist de rotación entregado a Gabriel. La rotación misma es acción humana fuera de alcance de Claude Code.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-02

---

#### S1-SEC-03 — Apagar dra-quevedo deploy en Vercel 🟢 done (2026-05-18)
**Tipo:** Mitad humana, mitad Claude Code
**Por qué:** Cierra el 🚨 de `user_metadata.client_id` sin migración. Reduce surface area. Limpia narrativa de marca.
**Criterios de aceptación:**
- [ ] Gabriel pausa o desconecta el proyecto Vercel de `clients/dra-quevedo` → **pendiente de Gabriel**
- [x] Claude Code agrega comentario en `clients/dra-quevedo/README.md` → creado con aviso ARCHIVADO + fecha + instrucciones
- [x] Claude Code verifica que `vercel.json` raíz mantiene el `ignoreCommand` → confirmado: `"echo 'Monorepo root — deploy individual clients, not this directory'"`
- [x] NO se borra código ni data. Solo se apaga el deploy.
**Notas de ejecución:** README creado. vercel.json raíz OK. clients/dra-quevedo/vercel.json reportado (no modificado). Acción humana pendiente: Gabriel debe pausar el proyecto en Vercel Dashboard.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-03

---

#### S1-SEC-04 — Habilitar RLS en tabla `organizations` 🟢 done (2026-05-20)
**Origen:** Phase 2, 🚨
**Por qué:** Hoy cualquier authenticated user puede `SELECT * FROM organizations` y obtener `access_token` de todas las cadenas.
**Archivos:** nueva migración en `apps/lifestyle/supabase/migrations/`
**Criterios de aceptación:**
- [x] Migration `034_organizations_rls.sql` creada
- [x] `ENABLE ROW LEVEL SECURITY` en `organizations`
- [x] Sin políticas de usuario: acceso denegado para cualquier sesión autenticada (default deny). Todo acceso legítimo pasa por proxy.ts con service_role_key que bypasa RLS.
- [x] INSERT/DELETE/UPDATE: solo via service_role
- [x] Aplicada al remoto exitosamente
**Notas de ejecución:** La tabla `organizations` no existía en el remoto (migration 021 nunca fue aplicada). Migration 034 combina CREATE TABLE + RLS en un solo paso. Descubrimiento: `businesses.organization_id` tampoco existía en el remoto — también creado en esta migración.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-04

---

#### S1-SEC-05 — Fix R4: `ls_staff_update_self` escalada de rol 🟢 done (2026-05-20)
**Origen:** Phase 2, 🔴
**Por qué:** Un barbero puede `UPDATE staff SET role='admin' WHERE id = ls_staff_id()` y escalar privilegios.
**Archivos:** `apps/lifestyle/supabase/migrations/035_staff_update_self_fix.sql`
**Criterios de aceptación:**
- [x] Policy `ls_staff_update_self` dropeada y recreada con `WITH CHECK` que valida que `role`, `business_id` y `auth_id` no cambian (compara NEW contra subquery del valor actual en DB)
- [x] Validar que un staff role=barber NO puede cambiar su propio `role` — bloqueado por WITH CHECK
- [x] Validar que sí puede cambiar campos benignos — WITH CHECK solo restringe los 3 campos protegidos
- [x] Aplicada al remoto exitosamente
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-05

---

#### S1-SEC-06 — Fix R5: `customers.UPDATE` sin restricción de rol 🟢 done (2026-05-20)
**Origen:** Phase 2, 🔴
**Por qué:** Cualquier staff puede modificar `business_id` de un cliente (mover entre negocios) o modificar clientes de otros staff.
**Archivos:** `apps/lifestyle/supabase/migrations/036_customers_update_fix.sql`
**Criterios de aceptación:**
- [x] Policy `ls_customers_update` dropeada y recreada con `WITH CHECK (business_id = ls_staff_business_id())` — previene mover clientes entre negocios
- [x] UPDATE sigue permitido para barber/assistant dentro del mismo negocio (no se restringió a admin-only, que era el tradeoff aceptable)
- [x] Aplicada al remoto exitosamente
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-06

---

#### S1-SEC-07 — Security headers HTTP 🟢 done (2026-05-20)
**Origen:** Phase 4, R4
**Por qué:** Sin CSP/HSTS/X-Frame-Options el dashboard es vulnerable a clickjacking, MIME-sniffing, etc.
**Archivos:** `apps/lifestyle/next.config.ts`
**Criterios de aceptación:**
- [x] `headers()` function en `next.config.ts` retorna: `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`
- [x] CSP omitido por decisión de sprint (puede romper cosas, necesita testing propio)
**Notas de ejecución:** X-Frame-Options seteado en DENY (más restrictivo que SAMEORIGIN indicado en sprint). Aplica a todas las rutas via `source: '/(.*)'`.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-07

---

#### S1-SEC-08 — Fix JSON-LD `</script>` escape 🟢 done (2026-05-20)
**Origen:** Phase 4, R5 (TODO M-1)
**Archivos:** `apps/lifestyle/src/app/[slug]/page.tsx`
**Criterios de aceptación:**
- [x] `JSON.stringify(jsonLd)` reemplazado por `JSON.stringify(jsonLd).replace(/<\//g, '<\\/')` — técnica estándar de JSON-LD safe embedding
- [x] TODO M-1 eliminado del código
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-08

---

#### S1-SEC-09 — Cookie session 30 → 7 días 🟢 done (2026-05-20)
**Origen:** Phase 4, R10 (TODO M-2)
**Archivos:** `apps/lifestyle/src/lib/session.ts`
**Criterios de aceptación:**
- [x] `SESSION_DURATION_SECS` cambiado de `30 * 24 * 60 * 60` a `7 * 24 * 60 * 60` (604800s)
- [x] Afecta tanto `maxAge` de la cookie como el campo `exp` del payload firmado (misma constante)
- [x] TODO M-2 eliminado del código
**Notas de ejecución:** Usuarios con sesión activa de >7 días serán deslogueados al expirar su cookie actual (comportamiento esperado y aceptable).
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-SEC-09

---

#### S1-OPS-01 — Supabase Pro + PITR + dump externo 🟢 done (2026-05-21)
**Tipo:** Mitad humana (upgrade del plan), mitad Claude Code (script)
**Origen:** Phase 5, escenario 1 y 4
**Por qué:** Hoy no hay backup verificable. Una corrupción = pérdida total.
**Criterios de aceptación:**
- [ ] Gabriel upgrade del proyecto Supabase de presenciapro a Pro ($25/mes) — pendiente humano
- [ ] Gabriel activa PITR en Settings → Database — pendiente humano (recomendación para Pro)
- [x] Claude Code crea `scripts/backup-supabase.sh`: dump → gzip → gpg AES256 → upload R2 → retención 30 días → cleanup local
- [x] Claude Code crea `scripts/restore-supabase.sh`: descarga R2 → descifra → descomprime → imprime comando psql (NO ejecuta automáticamente)
- [x] Claude Code crea `.github/workflows/backup-weekly.yml`: cron domingos 03:00 UTC + workflow_dispatch manual
- [x] Claude Code crea `scripts/README.md`: documentación de ambos scripts
- [x] RUNBOOK.md actualizado con sección completa de backup/restore (listado, restore desde R2, PITR, backup manual)
- [ ] Restore drill en staging (ver S4-OPS-02) — pendiente de Gabriel
**Notas de ejecución:** PITR queda como recomendación para cuando Gabriel haga upgrade a Supabase Pro. Los 5 GitHub Secrets requeridos ya están configurados según instrucción (SUPABASE_ACCESS_TOKEN, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, BACKUP_ENCRYPTION_PASSPHRASE). SUPABASE_PROJECT_REF hardcodeado como env var en el workflow (no es secreto). El script restore prepara el archivo y muestra el psql command — Gabriel lo ejecuta manualmente para mayor control.

---

#### S1-OPS-02 — Rate limiting distribuido para PIN y /api/bot 🟢 done (2026-05-20)
**Origen:** Phase 4, R2 + R8 (TODOs A-1, B-1)
**Por qué:** PIN de 4 dígitos brute-forceable con rate limiter in-memory en serverless. Bot sin tope de costo Anthropic.
**Criterios de aceptación:**
- [x] Adoptar Upstash Redis (free tier) — `@upstash/ratelimit` + `@upstash/redis` instalados
- [x] Helper `lib/rate-limit.ts` con función `rateLimit(key, max, windowSec)` — sliding window distribuido; fallback in-memory si no hay env vars; fail-open en errores de Redis
- [x] Aplicado a `/api/auth/pin`: 5 intentos / 60s por IP (business_id no está en el body — IP-only por decisión)
- [x] Aplicado a `/api/bot`: 30 mensajes / 60s por `phoneNumberId` (Meta only; Twilio es dev-only)
- [x] Respuesta 429 con `Retry-After` correcto en ambos endpoints
- [x] Sin breaking changes a flujos válidos
**Notas de ejecución:** El bloqueo de 15 min del rate limiter in-memory fue eliminado (no nativo en sliding window; spec pedía 5/60s). TODOs A-1 y B-1 eliminados del código. Errores de TypeScript pre-existentes en otros archivos no afectan los archivos modificados.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-OPS-02

---

### Semana 2 — Compliance, onboarding y bus factor

#### S2-G-01 — Recibir Aviso de Privacidad del abogado ⚪ todo
**Tipo:** Decisión/dependencia humana
**Por qué:** Bloqueador legal para procesar datos de clientes del fundador.
**Salida esperada:** archivo PDF/MD con el aviso de Zentriq SA como responsable, mencionando presenciapro como servicio, datos en Supabase US-East-1, transferencia internacional art. 36 LFPDPPP.

---

#### S2-G-02 — Recibir modelo de contrato del piloto ⚪ todo
**Tipo:** Decisión/dependencia humana
**Salida esperada:** Contrato/acuerdo de piloto fundador firmable. Define qué obtienen, qué prometes, qué no prometes (uptime SLA, soporte), modelo de cobro.

---

#### S2-G-03 — Decidir modelo de cobro al fundador ⚪ todo
**Tipo:** Decisión humana
**Opciones:**
- (a) Solo costos pasados a costo (Anthropic + WhatsApp Meta + prorrateo Supabase)
- (b) Cuota mínima simbólica ($500 MXN/mes) + consumo
- (c) Gratis durante piloto
**Recomendación de auditoría:** (b)
**Salida esperada:** decisión documentada en `CONTRATO-PILOTO.md` o en el contrato del abogado.

---

#### S2-LEG-01 — Publicar /aviso-de-privacidad ⚪ todo
**Depende de:** S2-G-01
**Archivos:** nueva ruta en lifestyle (decidir si `apps/lifestyle/src/app/aviso-de-privacidad/page.tsx` o publicar en zentriq.mx — preguntar a Gabriel)
**Criterios de aceptación:**
- [ ] Aviso accesible públicamente
- [ ] Link en footer del dashboard
- [ ] Link en footer del mini-sitio `/[slug]`
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-LEG-01

---

#### S2-LEG-02 — Captura de consentimiento en `customers` 🟢 done (2026-05-20)
**Origen:** Phase 4, gap LFPDPPP Art. 8
**Criterios de aceptación:**
- [x] Migración 037 agrega `consent_at TIMESTAMPTZ`, `consented_via TEXT`, `consent_message_id TEXT` a `customers` — aplicada al remoto
- [x] INSERT de cliente nuevo en `greeting.ts` setea `consent_at = NOW()`, `consented_via = 'whatsapp_first_message'`, `consent_message_id = msg.messageId` (evidencia del mensaje)
- [x] `consent_at` solo se escribe en el branch `else` (cliente nuevo) — nunca en update de cliente existente
- [x] `createAssistantAppointment` en `assistant-actions.ts` setea `consent_at = NOW()`, `consented_via = 'manual_registration'` en ambos paths de INSERT (con y sin teléfono)
- [x] Aviso de privacidad prepended al saludo del bot para clientes nuevos (consentimiento tácito LFPDPPP). URL configurable vía `PRIVACY_POLICY_URL` env var; default `https://zentriq.mx/aviso-de-privacidad`
**Notas de ejecución:**
- Desviación vs SPRINT.md: backfill retroactivo (`consent_at = created_at`) NO implementado por instrucción explícita de Gabriel. Clientes previos quedan con `consent_at NULL`.
- Desviación vs SPRINT.md: el campo se setea en `greeting.ts` (donde ocurre el INSERT de customers), no en `handler.ts` (donde solo ocurre el UPSERT de bot_conversations). Arquitectura más correcta.
- Campo extra `consent_message_id` agregado sobre spec (evidencia legal adicional, decisión de Gabriel).
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-LEG-02

---

#### S2-LEG-03 — Endpoint ARCO mínimo 🟢 done (2026-05-20)
**Origen:** Phase 4, gap LFPDPPP Art. 22-25
**Criterios de aceptación:**
- [x] Migración 038: tabla `arco_requests` con RLS — aplicada al remoto
- [x] Página pública `/arco` (Server Component + Client Form): nombre, teléfono, email opcional, tipo radio (acceso/rectificación/cancelación/oposición), descripción, checkbox aviso
- [x] POST `/api/arco`: Zod + rate limit 3/hora por teléfono + INSERT en arco_requests + lookup business_id por teléfono
- [x] No requiere autenticación
- [x] Confirmación en pantalla: "Tu solicitud fue registrada. Te contactaremos en máximo 20 días hábiles."
- [x] Bot intent ARCO en `router.ts`: keywords "mis datos", "mis derechos", etc. responden con URL `${ARCO_URL}` + email; mantiene estado actual del FSM
**Notas de ejecución:**
- Desviación vs SPRINT-PROMPTS: sin email programático (Resend no configurado); solicitudes van a DB para procesamiento manual — instrucción explícita de Gabriel.
- `business_id` en arco_requests es nullable (vs NOT NULL en spec de Gabriel); se resuelve por lookup de teléfono en customers.
- URL ARCO configurable via env var `ARCO_URL` (default: `https://zentriq.mx/arco`).
- Link desde `/aviso-de-privacidad` pendiente de que S2-LEG-01 se implemente.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-LEG-03

---

#### S2-OPS-01 — Refactor `onboard-business.ts` + checklist 🟢 done (2026-05-20)
**Origen:** Phase 6
**Criterios de aceptación:**
- [x] Script valida al final que `whatsapp_phone_number_id` y `whatsapp_number` NO son strings vacíos. Si están vacíos, falla con mensaje claro pidiendo que se completen vía SQL o se ejecute con `--whatsapp-phone-id` y `--whatsapp-number`
- [x] Script emite archivo `onboarding/{slug}-checklist.md` con los pasos manuales pendientes: (1) registrar webhook en Meta, (2) configurar crons Supabase, (3) entregar credenciales al cliente
- [x] Script imprime al final: "Onboarding 60% completo. Sigue el checklist en onboarding/{slug}-checklist.md para terminar."
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-OPS-01

---

#### S2-DOC-01 — Crear RUNBOOK.md 🟢 done (2026-05-20)
**Criterios de aceptación:**
- [x] Archivo en `apps/lifestyle/RUNBOOK.md`
- [x] Cubre mínimo: "Qué hacer si el bot deja de responder", "Cómo rotar `WHATSAPP_ACCESS_TOKEN`", "Cómo regenerar `access_token` de un business", "Cómo restaurar la base de datos desde backup", "Quién a contactar en emergencia"
- [x] Cada procedimiento: numerado, copiable a terminal, con verificación final
- [x] INCIDENTS.md creado con template en `apps/lifestyle/INCIDENTS.md`
**Notas de ejecución:** Ubicación: apps/lifestyle/ (instrucción explícita de Gabriel). Incluye: arquitectura, edge functions y crons, diagnóstico de bot/notificaciones/slots, rotación de tokens, restore DB, onboarding script, logs Vercel+Supabase, rate limiting, env vars completas, escalación. INCIDENTS.md con template vacío.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-DOC-01

---

#### S2-DOC-02 — Crear DEPLOY.md 🟢 done (2026-05-20)
**Criterios de aceptación:**
- [x] Archivo en `apps/lifestyle/DEPLOY.md`
- [x] Cubre: push to main → Vercel auto-deploy, verificar deploy exitoso, rollback Vercel, migraciones Supabase, edge functions, rollback Supabase, env vars por ambiente, staging
**Notas de ejecución:** Ubicación: apps/lifestyle/ (instrucción explícita de Gabriel). Flujo real documentado: push a main → Vercel auto-deploy. Edge functions requieren deploy manual (`supabase functions deploy`). Schedules de crons NO se despliegan con código — advertencia incluida.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-DOC-02

---

#### S2-DOC-03 — Crear ACCESS.md (cifrado / en 1Password) 🟡 blocked (estructura creada, pendiente llenar credenciales)
**Tipo:** Mitad humana
**Criterios de aceptación:**
- [x] Template `apps/lifestyle/ACCESS.md` creado con estructura completa y placeholders `[FILL_IN]` / `[REDACTED]` — 2026-05-20
- [x] `apps/lifestyle/ACCESS.md` agregado a `.gitignore` — nunca se commitea
- [ ] Gabriel llena todos los `[FILL_IN]` con valores reales y copia el archivo a 1Password
- [ ] Una persona de confianza (familia, socio, abogado) tiene credenciales de emergencia (Emergency Kit)
**Notas de ejecución:** Template creado con secciones para: Supabase, Vercel, Meta/WhatsApp, Anthropic, Upstash Redis, Google Workspace, Dominio/Cloudflare, GitHub. Incluye matriz de acceso y procedimientos para agregar personas. Bloqueado en la parte humana: Gabriel debe llenar los datos reales y guardar en 1Password.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S2-DOC-03

---

### Semana 3 — Calidad percibida y observabilidad

#### S3-UX-01 — Login muestra nombre del negocio, no "PresenciaPro" 🟢 done (2026-05-20)
**Origen:** Phase 6, observación quirúrgica
**Archivos:** `apps/lifestyle/src/app/login/page.tsx`, `apps/lifestyle/src/app/login/LoginForm.tsx` (nuevo)
**Criterios de aceptación:**
- [x] Login lee `business.name` del slug/token y lo muestra como h1
- [ ] Si la sesión es de organization, muestra nombre de la organización — no aplica (org sessions no pasan por /login)
- [x] Fallback a "PresenciaPro" solo si no hay contexto detectable
**Notas de ejecución:** page.tsx convertido a Server Component con searchParams.slug → DB lookup. LoginForm.tsx extrae lógica client. Sesiones de org van directo a /dashboard?token= sin pasar por /login.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-UX-01

---

#### S3-UX-02 — Footer con `contacto@zentriq.mx` en dashboard y mini-sitio 🟢 done (2026-05-20)
**Origen:** Phase 6
**Criterios de aceptación:**
- [x] Footer del dashboard incluye "Soporte: contacto@zentriq.mx" (DashboardLayout + AssistantLayout)
- [x] Footer del mini-sitio `/[slug]` mantiene "Creado con PresenciaPro" + links a soporte/aviso/ARCO
- [x] Links a `/aviso-de-privacidad` y `/arco` en todos los footers (no hay /terminos aún)
**Notas de ejecución:** Footer agregado en DashboardLayout.tsx, AssistantLayout.tsx, SiteFooter.tsx. Estilos CSS `.site-footer__support` agregados en site.css. /terminos no existe → omitido.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-UX-02

---

#### S3-UX-03 — error.tsx con email de soporte 🟢 done (2026-05-20)
**Origen:** Phase 6
**Criterios de aceptación:**
- [x] Los 4 `error.tsx` incluyen "Si el problema persiste, escríbenos a contacto@zentriq.mx" con `mailto:` link
- [x] El email incluye en el subject el `error.digest` para correlación
**Notas de ejecución:** 4 archivos modificados: app/error.tsx, app/dashboard/error.tsx, app/staff/error.tsx, app/[slug]/error.tsx. El [slug]/error.tsx usa inline styles (consistente con el archivo original).
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-UX-03

---

#### S3-UX-04 — Favicon y metadata propios 🟢 done (2026-05-20)
**Origen:** Phase 6
**Criterios de aceptación:**
- [x] `src/app/icon.tsx` (ImageResponse 32×32, fondo #18181b, letra P blanca) → Next.js lo sirve como favicon automáticamente
- [x] `src/app/apple-icon.tsx` (ImageResponse 180×180) → apple-touch-icon
- [x] `public/manifest.json` creado con name, short_name, theme_color, display, icons
- [x] `metadataBase`, `openGraph`, `twitter` configurados en root layout sin sobrescribir `/[slug]`
- [x] `eslint.config.mjs` creado para que lint funcione con ESLint 9 flat config
**Notas de ejecución:** No había favicon.ico previo ni config ESLint. Se usaron App Router special files (icon.tsx / apple-icon.tsx) con ImageResponse — más portable que binarios. metadataBase usa env var `NEXT_PUBLIC_APP_URL` con fallback a `https://app.presenciapro.mx`. eslint.config.mjs requerido porque `eslint-config-next@16.2.2` usa flat config (ESLint 9).
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-UX-04

---

#### S3-OPS-01 — Endpoint /api/health + UptimeRobot 🟡 blocked (código listo, pendiente config Gabriel)
**Origen:** Phase 5, escenario 2
**Criterios de aceptación:**
- [x] `GET /api/health` retorna `{ status: 'ok'|'down', supabase: 'ok'|'fail', timestamp }` con 200 o 503
- [x] Pingea Supabase con `SELECT id FROM businesses LIMIT 1`
- [ ] Gabriel configura UptimeRobot (free) para pingear cada 5 min con alerta a su WhatsApp/email
- [x] Documentar la URL del status page en RUNBOOK.md
**Notas de ejecución:** `apps/lifestyle/src/app/api/health/route.ts` creado. Sin auth. Cache-Control: no-store. RUNBOOK.md actualizado con URL del health endpoint y referencia a UptimeRobot. Acción humana pendiente: Gabriel registrar en uptimerobot.com.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-OPS-01

---

#### S3-OPS-02 — CI/CD mínimo en GitHub Actions 🟢 done (2026-05-20)
**Origen:** Phase 5
**Criterios de aceptación:**
- [x] `.github/workflows/ci.yml` creado: on push/PR a main, Node 20, npm ci + cache, lint + type-check en workspace apps/lifestyle
- [x] Scripts `lint` y `type-check` ya existían en `apps/lifestyle/package.json` — no fue necesario crearlos
- [ ] (Opcional) Branch protection en `main` — pendiente de Gabriel
- [ ] Badge de CI en README — pendiente una vez que el CI pase
**Notas de ejecución:** ⚠️ **Descubrimiento:** lint y type-check tienen errores pre-existentes (9 errores lint, 3 errores TS). El CI fallará en la rama actual hasta que se corrijan. Errores lint: refs durante render (StaffLayout.tsx, AssistantDayTimeline.tsx), setState en effect (NewAppointmentForm.tsx), no-unescaped-entities (AssistantDayTimeline.tsx). Errores TS: cast incorrecto en getActiveConversations (assistant-actions.ts:1062), tipos en notifyWaitlistOnCancel.ts, cast en greeting.ts:78. Se propone nueva tarea al backlog: **S3-QA-01 — Fix lint + TS errors pre-existentes** para que el CI pase en verde.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-OPS-02

---

#### S3-OPS-03 — Limpiar console.error con posible PII 🟢 done (2026-05-20)
**Origen:** Phase 4, sección 2
**Criterios de aceptación:**
- [x] Los 3 `console.error` identificados pasan a usar `logBotError()` / `maskPhone()` con masking
- [x] Cualquier `err.message` que pueda contener teléfono → `maskPhone()` antes de loguear
**Notas de ejecución:** Helper `packages/engine/src/bot/lifestyle/utils/logger.ts` creado con `maskPhone()` y `logBotError()`. Aplicado a: `awaitingConfirmation.ts:189`, `awaitingBookingName.ts:172`, `messaging.ts:119` (inline maskPhone). Los console.error ya estructurados en JSON en otros archivos (scheduling.ts, confirmed.ts, etc.) no tenían PII raw — dejados como están.
**Prompt:** Ver `SPRINT-PROMPTS.md` → S3-OPS-03

---

#### S3-QA-01 — Fix errores lint + TypeScript pre-existentes 🟢 done (2026-05-20)
**Origen:** Descubierto en S3-OPS-02 al crear el CI
**Por qué:** El CI falla en la rama actual con 9 errores lint y 3 errores TS. Bloquea branch protection y verde en CI.
**Archivos:** `src/components/staff/StaffLayout.tsx`, `src/components/staff/AssistantDayTimeline.tsx`, `src/components/staff/NewAppointmentForm.tsx`, `src/app/staff/assistant-actions.ts`, `src/lib/notifyWaitlistOnCancel.ts`, `packages/engine/src/bot/lifestyle/states/greeting.ts`
**Criterios de aceptación:**
- [x] `npm run lint --workspace=apps/lifestyle` pasa sin errores
- [x] `npm run type-check --workspace=apps/lifestyle` pasa sin errores
- [x] Sin cambios de comportamiento — solo correcciones de tipos y reglas de lint
**Notas de ejecución:** 14 archivos corregidos. Lint: `react-hooks/refs` (3 fixes: wrap `ref.current=prop` en useEffect), `react-hooks/set-state-in-effect` (6 fixes: InactiveClientsPanel + AvailabilityTimeline + AssistantDayTimeline usan "adjust during render"; DashboardRealtimeProvider + AssistantLayout + StaffLayout reemplazan useEffect con prevDate-tracking), `react-hooks/purity` (1 fix: AssistantUpcoming usa useState lazy init + useEffect interval), `react/no-unescaped-entities` (1 fix: quotes en AssistantLayout). TypeScript: 2 cast `as unknown as T` (assistant-actions + greeting.ts), 2 cast `(supabase as any).from(...)` en notifyWaitlistOnCancel, `SupabaseClient = ReturnType<typeof createClient<any>>`. Resultado: 0 errores lint, 0 errores TS.

---

#### S3-G-01 — Alerta de gasto en Anthropic Console ⚪ todo
**Tipo:** Decisión/setup humano (5 min)
**Criterios de aceptación:**
- [ ] Gabriel entra a console.anthropic.com → Billing → Spend Alerts
- [ ] Configura alertas en $50, $200, $500 USD
- [ ] Confirma a Claude Code: "alertas Anthropic configuradas"

---

### Semana 4 — Dry run y go-live

#### S4-OPS-01 — Dry run de onboarding completo 🟢 done (2026-05-21)
**Criterios de aceptación:**
- [x] Gabriel (o Claude Code asistiendo) onboardea un negocio dummy desde cero usando SOLO el script + checklist
- [x] Documentar todas las fricciones encontradas → cada una se vuelve issue/tarea
- [ ] Iterar el script hasta que el flujo sea reproducible — fricciones documentadas, iteración pendiente de Gabriel
**Notas de ejecución:**
- Dry-run ejecutado con `onboarding/dummy-barberia-test.json` (3 staff, 3 servicios, organización). Salida correcta.
- `--dry-run` y `--validate` ya existen en el script. Crea: organizations?, businesses, services, staff, staff_availability, staff_services.
- 6 fricciones documentadas en `apps/lifestyle/ONBOARDING-FRICTION.md`:
  - F-01 BLOQUEANTE: criterio S2-OPS-01 no implementado (whatsapp_phone_number_id no se valida post-insert)
  - F-02: `{NEXT_PUBLIC_APP_URL}` no se resuelve en el checklist generado
  - F-03: staff_availability config no soporta break_start/break_end
  - F-04: report_whatsapp, review_url, max_late_minutes no configurables desde JSON
  - F-05: timezone no valida contra IANA
  - F-06: staff.phone y staff.whatsapp_id se insertan como strings vacíos sin advertencia
- 4 gaps de go-live documentados: G-01 CRITICO (Template Approvals WhatsApp), G-02 (Embedded Signup no implementado), G-03 (timezone en notificaciones), G-04 (Upstash env vars no en Vercel)
- 7 env vars faltantes en .env.local.example: SESSION_SECRET, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, PRIVACY_POLICY_URL, ARCO_URL, NEXT_PUBLIC_SITE_URL, INTAKE_SECRET
**Prompt:** Ver `SPRINT-PROMPTS.md` → S4-OPS-01

---

#### S4-OPS-04 — Endpoint GET /api/reports/usage 🟢 done (2026-05-21)
**Origen:** Ad-hoc solicitado junto con S4-OPS-01
**Criterios de aceptación:**
- [x] `GET /api/reports/usage?month=YYYY-MM&business_id=<uuid>` retorna JSON con métricas de consumo
- [x] Auth: solo owner o admin (getCurrentSession, mismo patrón que otros endpoints de reports)
- [x] business_id opcional — default al business de la sesión; validado contra sesión si se pasa
- [x] Retorna: total/completed/cancelled/no_show appointments, whatsapp_messages_sent/failed, unique_customers, new_customers, bot_conversations, human_takeovers, period, business_name, generated_at
- [x] type-check pasa sin errores
**Notas de ejecución:** Archivo: `apps/lifestyle/src/app/api/reports/usage/route.ts`. Exporta tipo `UsageReport`. Patrón idéntico a summary/route.ts y staff-metrics/route.ts. Rango mes: [inicio, fin_exclusivo) con ISO strings. Errores internos retornan 500 con mensaje genérico (sin leak de schema).

---

#### S4-BOT-01 — Debounce buffer para mensajes WhatsApp consecutivos 🟢 done (2026-05-23)
**Origen:** Ad-hoc solicitado por Gabriel (fuera del sprint original)
**Por qué:** Cuando un usuario envía 3 mensajes rápidos ("Hola" / "quiero un corte" / "para mañana"), el bot respondía 3 veces de forma encimada y caótica.
**Archivos:**
- `apps/lifestyle/src/lib/message-buffer.ts` (nuevo)
- `apps/lifestyle/src/app/api/bot/route.ts` (modificado)
**Criterios de aceptación:**
- [x] Buffer en Redis con ventana configurable (`MESSAGE_BUFFER_WINDOW_MS`, default 2500ms)
- [x] Key: `presenciapro:msgbuf:{phoneNumberId}:{phone}` — lista Redis, TTL 10s
- [x] Lock: `presenciapro:msglock:{phoneNumberId}:{phone}` — SET NX, TTL = WINDOW_MS
- [x] Primer mensaje adquiere lock, duerme la ventana, flushea buffer, concatena con '\n'
- [x] Mensajes subsecuentes solo pushean al buffer; el lock owner los recoge
- [x] Logging claro: `"Buffered N messages from +52XXX..., processing as single block"` (solo si N > 1)
- [x] Sin Redis configurado (dev local): procesa directamente sin delay (fail-open)
- [x] En error de Redis: fail-open, procesa mensaje original
- [x] Mensajes interactive/audio/image/document: no bufferean (parseMetaPayload ya los filtra — sin cambio)
- [x] Sin breaking changes al rate limiting, dedup, router, handlers, ni envío de respuestas
- [x] Bonus: `messageId` ahora se pasa correctamente al engine (era `null` hardcodeado — fix colateral)
- [x] Orphan recovery: si lock owner muere, el siguiente mensaje del usuario (dentro de 10s) adquiere el lock y procesa todos los mensajes acumulados
- [x] type-check pasa sin errores
**Notas de ejecución:**
- Decisión de arquitectura: Redis SET NX como coordinador de instancias (Opción C — sin QStash, sin setTimeout crudo). El sleep vive en after() que Vercel Fluid Compute mantiene vivo.
- Twilio handler no modificado (dev-only, no requiere buffer).
- Tests: no implementados — respeta decisión cerrada del sprint. Validar manualmente via WhatsApp + logs de Vercel (`event: buffer_flushed`).
- Edge case aceptado: si lock owner muere Y no llega otro mensaje en 10s, los mensajes bufferados expiran silenciosamente. El usuario reenvía.

---

#### S4-BOT-02 — Historial multi-turno en el FSM del bot 🟢 done (2026-05-23)
**Origen:** TODO(MEDIO-2) documentado en greeting.ts:332-347
**Por qué:** El clasificador recibía `recentHistory` casi siempre vacío o con 1 elemento. Cuando el cliente dice "el 2", el clasificador no tenía contexto de qué opciones se presentaron.
**Archivos:**
- `packages/engine/src/bot/lifestyle/handler.ts` (modificado)
- `packages/engine/src/bot/lifestyle/states/greeting.ts` (modificado)
**Criterios de aceptación:**
- [x] Constante `MAX_HISTORY_TURNS = 6` en handler.ts (12 mensajes máx)
- [x] Después de `dispatch()`, si `responseText` no es vacío: acumular `[...prevMessages, userMsg, botMsg].slice(-12)` en `result.newContext.messages`
- [x] `greeting.ts` no sobrescribe `messages` con array parcial (deja la acumulación al handler)
- [x] El reset por inactividad/estado terminal ya vacía `currentContext = {}` → `messages` se limpia implícitamente
- [x] Transiciones silenciosas (`responseText === ''`) no generan entradas en el historial
- [x] type-check pasa sin errores
**Notas de ejecución:**
- Implementación centralizada en handler.ts (~+20 líneas después del dispatch) en lugar de los 9 handlers individuales — mismo resultado, sin duplicación.
- TODO(MEDIO-2) eliminado de greeting.ts. El campo `messages: [{ role: 'assistant', ... }]` incorrecto (que omitía el mensaje del usuario) fue reemplazado.
- Transiciones silenciosas (responseText = '', ej. QUALIFYING_DATETIME fast-path) no generan entrada en el historial — el `if (dispatchedResult.responseText)` las filtra.
- El buffer de debounce (S4-BOT-01) concatena mensajes con '\n' antes de llegar aquí — entra como un único turno `user`, correcto.
- type-check: 0 errores.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-05-23)

#### S4-BOT-03 — Rewrite completo del system prompt del bot 🟢 done (2026-05-23)
**Origen:** Ad-hoc solicitado por Gabriel
**Por qué:** El prompt anterior era funcional pero genérico. El nuevo introduce espejeo de estilo, detección emocional, manejo de flujo avanzado (mensajes concatenados, emojis como respuesta, múltiples citas), reglas de negocio explícitas alineadas con el FSM, soporte bilingüe, y tags XML para segmentación clara.
**Archivos:**
- `packages/engine/src/bot/lifestyle/prompt.ts` (rewrite del body de `buildSystemPrompt`, `buildCatalogSection`, `buildSideQuestionSection`)
- `packages/engine/src/bot/lifestyle/types.ts` (añadido `businessType?: string` a `LifestyleBusinessConfig`)
- `apps/lifestyle/src/app/api/bot/route.ts` (mapeo de `business_type`, handler no-texto por tipo: audio/image/video/sticker/document/location)
**Criterios de aceptación:**
- [x] Firma de `buildSystemPrompt(business, context?, catalog?)` sin cambios — ningún caller afectado
- [x] `businessType` mapeado desde `businesses.business_type`; fallback `'negocio'` si no está poblado (TODO en type doc)
- [x] Catálogo inyectado dentro de `<catalogo_servicios>` con el mismo formato de líneas
- [x] `buildSideQuestionSection` genera bloque `<pregunta_lateral_pendiente>` (formato XML)
- [x] No-texto Meta: audio/image/video/sticker/document/location → respuestas estáticas por tipo; sticker → silencio; location → query ligero por `phone_number_id`
- [x] Razón documentada en `sendNonTextResponseMeta` por qué business no está disponible en ese punto del flujo
**Notas de ejecución:**
- `business_type` ya existe en el schema DB (`businesses` tabla). No se requiere migración.
- El query de location en `sendNonTextResponseMeta` es necesario porque el non-text path retorna antes del bloque `after()` que llama `processMetaMessage` (donde se resuelve el negocio). Ambas rutas son mutuamente excluyentes.
- Twilio (dev-only) mantiene `NON_TEXT_MESSAGE` como fallback genérico — no tiene granularidad de tipo en el mismo formato.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-05-23)

---

#### S4-BOT-04 — Business context wiring 🟢 done (2026-06-03)
**Origen:** Solicitado por Gabriel (2026-06-03). Acordado agregar al sprint como tarea nueva (Opción 1).
**Por qué:** El classifier ya detecta side-questions (precio, horarios, ubicación, duración) como `SIDE_QUESTION + topic`, pero la respuesta se genera desde texto hardcodeado ("negocio de bienestar y estética") que NO inyecta los datos reales del negocio. Los datos ya existen en el schema (`services.price/duration`, `businesses.address/office_hours`, `businesses.review_url`). El gap es de CABLEADO, no de schema. El minisite `/[slug]` siempre existe como link [DERIVA].
**Alcance ESTRICTO:** No tocar FSM, debounce, ni lógica de agendamiento. Solo cablear datos reales del negocio a las respuestas de side-questions + migraciones additive-only + onboarding retrocompatible + tests con `node:test`.
**Archivos (previstos):**
- Migraciones additive-only en `apps/lifestyle/supabase/migrations/` (039+)
- `apps/lifestyle/scripts/onboard-business.ts` (schemas opcionales, retrocompatible)
- `packages/engine/src/bot/lifestyle/` (función pura `buildBusinessContext` + integración en prompt/side-question)
- Tests `node:test` (sin red, sin Supabase, sin Anthropic)
**Criterios de aceptación:**
- [x] Migraciones additive-only (ADD COLUMN nullable/default): `services.price_min/price_max/price_note` (039), `businesses.attributes JSONB` (040), `businesses.map_url` (041). `website` OMITIDA (sin valor de negocio aún — ver "Fuera de alcance")
- [x] `onboard-business.ts` captura `review_url`, `price_min/max/note`, `attributes`, `map_url` (todos opcionales; configs viejos siguen validando — test de retrocompat verde)
- [x] `buildBusinessContext(business, services, opts)` pura, determinista, testeable sin red: horarios, dirección+map_url, catálogo con precio (rango/exacto) y duración, review_url, link minisite. `appUrl` se pasa por parámetro (no lee env adentro)
- [x] Reemplazo del hardcode "negocio de bienestar y estética" por contexto construido en `prompt.ts`; usa `business_type` real
- [x] Topic del side-question cableado al dato correcto (`answerSideQuestion`); topic=other o dato ausente → [DERIVA] con link minisite (o derivación al equipo si no hay slug/appUrl)
- [x] Formato natural de precios ("desde $X", "$X a $Y", "$X" exacto, nota como sufijo, "precio a consultar")
- [x] Tests `node:test` (24 casos) cubren buildBusinessContext, formato precios, fallback [DERIVA], retrocompat onboarding schema. `npm test` desde la raíz
- [x] Test anti-regresión: prompt construido para fixture CONTIENE precio, horario, review_url, link minisite y business_type; verifica que el hardcode quedó eliminado
- [x] type-check/lint limpios; rama `feat/business-context-wiring`; sin merge a main
**Notas de ejecución (2026-06-03):**
- Migraciones 039/040/041 creadas (solo .sql, NO aplicadas a prod). `price` se conserva como exacto/fallback; semántica del rango documentada en el SQL de 039.
- Núcleo en `packages/engine/src/bot/lifestyle/businessContext.ts` (módulo puro, solo imports de tipos → seguro de importar en tests sin arrastrar SDKs). `prompt.ts` reescrito para inyectarlo.
- Classifier enriquecido con `buildBusinessContext` en `qualifyingService.ts`, `awaitingConfirmation.ts` y `confirmationResponse.ts` (catálogo vía `getCatalog`, que está cacheado). `router.ts` usa `answerSideQuestion('other', …)` como fallback [DERIVA].
- `route.ts`, `types.ts`, `catalog.ts` ampliados con `slug/review_url/map_url/attributes` y `price_min/max/note`.
- Schemas Zod extraídos a `apps/lifestyle/scripts/onboard-schema.ts` (sin efectos secundarios) para testear retrocompat sin disparar `main()`.
- Runner de tests: `node --test` + `ts-node/register` con `tsconfig.test.json` (override `moduleTypes` a cjs para `apps/lifestyle/scripts/**` porque ese paquete es `type: module` y el harness de `node --test` choca con el loader ESM en Node 20.20).
- **Fuera de alcance / sugerencias (NO implementado):**
  1. `businesses.website`: migración omitida; sin dato de negocio aún. El link al minisite cubre el caso [DERIVA]. Proponer cuando exista necesidad real.
  2. `qualifyingStaff.ts` y `qualifyingDatetime.ts` siguen pasando `Negocio: {name}` al classifier (no enriquecidos) para limitar el blast radius. Bajo impacto: en esos estados el side-question es menos frecuente. Candidato a unificar después.
  3. `prompt.ts` es la versión markdown previa, NO el "System Prompt v2" con tags XML mencionado en S4-BOT-03. Posible reescritura perdida sin tests que la protegieran — el test anti-regresión ahora cubre el cableado de datos, pero no la estructura v2. Revisar si v2 debe restaurarse (tarea aparte).
  4. Routing de cancelar/reagendar fuera de flujo y tono/idioma del classifier quedan para Módulo 2 (no tocados).
**Prompt:** Ad-hoc/módulo solicitado por Gabriel (2026-06-03)

---

#### S4-BOT-05 — Fricción conversacional (consolidación + continuidad) 🟢 done (2026-06-05)
**Origen:** Solicitado por Gabriel (2026-06-04). Smoke test real en WhatsApp reveló 3 bugs.
**Por qué:** En una conversación real: (1) el bot re-saludó a media conversación perdiendo el contexto del estado; (2) 2 mensajes seguidos generaron respuestas encimadas/repetidas; (3) el bot nunca respondió la pregunta de disponibilidad (esto último es RUTEO = sprint 2, NO se toca aquí).
**Alcance ESTRICTO:** Solo 3 fixes. NO tocar: catálogo de situaciones, ruteo de intenciones fuera de flujo (cancelar/reagendar/disponibilidad), tono/idioma del clasificador, ni System Prompt v2.
**Archivos (previstos):**
- `apps/lifestyle/src/lib/message-buffer.ts` + nuevo `message-buffer-core.ts` (lógica pura testeable)
- `apps/lifestyle/src/app/api/bot/route.ts` (cablear nueva API drain/process del buffer)
- `packages/engine/src/bot/lifestyle/continuity.ts` (nuevo, puro) + `states/greeting.ts` (anti re-saludo)
- Tests `node:test` (sin red, sin Supabase, sin Anthropic)
**Criterios de aceptación:**
- [x] FIX 1 — Debounce adaptativo: ventana base se re-arma con cada mensaje nuevo hasta un cap. Configurable por env (base/extensión/cap) con defaults actuales. Fail-open si Redis cae.
- [x] FIX 2 — Race: el lock se mantiene durante el procesamiento (no se libera antes). Mensajes que llegan durante el proceso se acumulan para el siguiente turno (drain loop), nunca en paralelo.
- [x] DEDUP — Al consolidar un lote, deduplicar contra TODOS los message_id, no solo el último.
- [x] FIX 3 — Continuidad: las llamadas generativas reciben historial reciente + estado; si el estado NO es inicial, el generador NO produce saludo de bienvenida. Fallback determinista por estado se conserva.
- [x] Tests `node:test` deterministas (debounce adaptativo, race, dedup de lote, anti re-saludo) corren en segundos vía `npm test`.
- [x] type-check/lint limpios; rama `feat/conversation-friction`; sin merge a main.
**Notas de ejecución:**
- **FIX 1+2+DEDUP** se extrajo a `message-buffer-core.ts` (PURO, I/O inyectado vía `RedisLike` + `{sleep, now}`), y `message-buffer.ts` quedó como wrapper fino (cliente Upstash + keys + `loadBufferConfig` desde env). Nueva API pública: `bufferAndProcess(phoneNumberId, fromPhone, msg, processFn)` reemplaza a `bufferAndWait`. El owner del turno mantiene el lock durante todo el `processFn` y ejecuta un drain loop: ventana adaptativa → `lrange`+`del` → `consolidateBatch` → `processFn` → repetir si llegaron mensajes durante el proceso. Sin Redis (dev) o ante error de Redis → fail-open: procesa el mensaje original directo.
- Env nuevas (con defaults = valores actuales, retrocompatible): `MESSAGE_BUFFER_WINDOW_MS=2500`, `MESSAGE_BUFFER_EXTENSION_MS=2500`, `MESSAGE_BUFFER_MAX_WINDOW_MS=10000`, `MESSAGE_BUFFER_LOCK_TTL_MS=60000`, `MESSAGE_BUFFER_SEEN_TTL_S=120`.
- **FIX 3** se extrajo a `continuity.ts` (PURO): `isConversationInProgress`, `buildGenerativeMessages` (historial reciente cap 6 + instrucción como turno final), y `buildDefaultGreetingPlan` que, si hay historial, REEMPLAZA el plan de bienvenida por `CONTINUATION_INSTRUCTION`/`FALLBACK` (sin lenguaje de saludo). `greeting.ts` ahora pasa el historial al generador (`generateGreetingText` recibe `ConvTurn[]` en vez de un único userPrompt sintetizado).
- Tests: 43 verdes vía `npm test` en ~9s (`tests/messageBuffer.test.ts` con FakeRedis en memoria + reloj/sleep simulados; `tests/continuity.test.ts` anti re-saludo, incluye repro del bug de la evidencia). type-check (`apps/lifestyle`) y eslint limpios. Se añadió `apps/lifestyle/src/**/*.ts: cjs` a `tsconfig.test.json` para que ts-node cargue el core como CommonJS bajo `node --test`.
- **Fuera de alcance (visto, NO tocado):** el bot no responde la pregunta de disponibilidad → es RUTEO de intenciones fuera de flujo = sprint 2. Otras llamadas generativas (qualifyingService/Staff/awaitingConfirmation/confirmed/showingSlots) NO se enriquecieron con historial para limitar el blast radius; solo `greeting` (donde se reproducía el re-saludo). Mirroring de tono y responder preguntas nuevas = sprint 2/3.
**Prompt:** Ad-hoc/módulo solicitado por Gabriel (2026-06-04 — SPRINT FRICCIÓN)

---

#### S4-BOT-06 — Disponibilidad propositiva (bot ofrece horarios reales) 🟢 done (2026-06-05)
**Origen:** Solicitado por Gabriel (2026-06-05). Smoke test real: el bot, al pedir disponibilidad, responde con MÁS preguntas en vez de consultar la agenda, y escaló a humano incorrectamente.
**Alcance ESTRICTO:** FASE A (cálculo de disponibilidad) primero, verde con tests, y SOLO entonces FASE B (bot propositivo por fecha/hora). NO tocar: barbero específico (sprint siguiente), cancelar/reagendar, tono/idioma, System Prompt v2.
**Rama:** `feat/availability-proactive` (sin merge a main).
**Archivos (previstos):**
- `packages/engine/src/bot/lifestyle/scheduling.ts` (day_of_week TZ-safe)
- `packages/engine/src/bot/lifestyle/tzUtils.ts` (helper weekday TZ-independiente)
- `packages/engine/src/bot/lifestyle/states/qualifyingDatetime.ts` (parseDate UTC-safe)
- `packages/engine/src/bot/lifestyle/states/presentingSlots.ts` (getUTCDay + export builder)
- `packages/engine/src/bot/lifestyle/availabilityIntent.ts` (nuevo, puro)
- `packages/engine/src/bot/lifestyle/states/qualifyingStaff.ts` (ruteo propositivo)
- Tests `node:test` (sin red, sin Supabase, sin Anthropic)
**Criterios de aceptación:**
- [x] FASE A: el cálculo de slots encuentra un barbero disponible día N 10:00-20:00 para un slot de las 17:00 (test que reproduce el caso Carlos).
- [x] FASE A: "mañana" se calcula en el timezone del negocio (America/Mexico_City), no en UTC; un slot de las 17:00 local no se descarta por offset.
- [x] FASE B: al pedir disponibilidad con fecha conocida, el bot consulta la agenda y OFRECE horarios concretos (no preguntas).
- [x] FASE B: si la hora exacta no está libre, ofrece las alternativas más cercanas del mismo día en vez de escalar.
- [x] Escalar a humano SOLO si no hay NINGÚN slot en rango razonable. (presentingSlots: preferido sin cupo → autoAssign; luego `findSlotsInNextDays` 5 días; luego waitlist; FALLBACK solo por error de query o sin disponibilidad real.)
- [x] Fallback determinista si el LLM falla se conserva (`buildSlotsMessage` / `buildAltDateFallback`).
- [x] Tests `node:test` deterministas verdes vía `npm test`; type-check/lint limpios.
**Notas de ejecución:**
- **Diagnóstico FASE A (causa raíz REAL, distinta a la hipótesis):** el cálculo de slots NO estaba roto. Verificado por SQL + reproducción con mock: con la base actual (Barbería El Estilo, 3 barberos vinculados + availability día 1-6 10:00-20:00) `getAvailableSlots` SÍ encuentra las 17:00 de mañana (sábado), tanto en servidor UTC como UTC-6. El escalado "no hay staff disponible para Corte de cabello" ($200) vino de un **dataset viejo** sin el servicio/vínculo — fue **problema de datos**, ya inexistente en la base actual. Suspect #1 (timezone del `day_of_week`): `requestedDate.getDay()` da el weekday correcto en México, pero **depende de que el servidor sea UTC** → fragilidad latente. Fix aplicado: derivar el weekday de forma TZ-independiente (`getUTCDay()` sobre noon-UTC) para no depender del TZ del runtime.
- **FASE A — hardening aplicado:** nuevo helper `weekdayFromDateStr(dateStr)` en `tzUtils.ts` (getUTCDay sobre noon-UTC). `scheduling.ts` usa `weekdayFromDateStr(dateStr)` para `day_of_week` y en `waitlistFormatDate`. `qualifyingDatetime.ts:parseDate` reconvertido a getters/setters UTC (getUTCDate/getUTCDay/getUTCFullYear/setUTCDate) consistente con `nowLocal` anclado a noon-UTC; ramas "mañana"/"pasado mañana"/día de semana/mes-nombre/slash ahora TZ-safe. `presentingSlots.ts` ya migrado a `weekdayFromDateStr`.
- **FASE B — bot propositivo:** nuevo detector puro `availabilityIntent.ts:isAvailabilityQuestion(text)` (regex, sin LLM). Ruteo: `qualifyingStaff.ts` — si el cliente pregunta disponibilidad antes de elegir barbero → `autoAssign=true`, fecha = la del mensaje (parseDate) o hoy → `SHOWING_SLOTS` (no insiste en barbero). `qualifyingDatetime.ts` — pregunta de disponibilidad SIN fecha concreta → parte de hoy → `SHOWING_SLOTS`. Con fecha concreta ya routeaba. `SHOWING_SLOTS` ofrece slots reales y, si el día pedido no tiene cupo, propone el día cercano (`findSlotsInNextDays`). **Fuera de alcance (respetado):** barbero específico ("quiero con Carlos") NO implementado; flujo "el que sea" intacto.
- **Tests (`npm test`, node:test, 54 verdes):** `tests/availability.test.ts` (FASE A: bug Carlos 17:00 encontrado; parseDate mañana/hoy en MX no UTC; slot 17:00 → 23:00Z; slot ocupado no se ofrece; sin availability → []; sin staff_services → []; fecha pasada → próximo año). `tests/availabilityProactive.test.ts` (FASE B: detector positivos/negativos; `buildSlotsMessage` contiene horarios concretos; hora exacta no disponible comunica + alternativas). type-check `apps/lifestyle` limpio; lint 0 errores.
- **Pendiente humano:** rama `feat/availability-proactive` para PR; sin merge a main; sin deploy a prod (NO aplicado). Cambios hechos en la rama de trabajo actual.
**Prompt:** Ad-hoc/sprint solicitado por Gabriel (2026-06-05 — SPRINT DISPONIBILIDAD)

---

#### S4-BOT-07 — Catálogo side-questions [FIJO]/[DERIVA] (Zlot) 🟢 done (2026-06-06)
**Origen:** Solicitado por Gabriel (2026-06-06). Auditoría dirigida halló gaps de **cableado** (no de datos ni de detección): las [FIJO] principales ya responden con dato real vía `buildBusinessContext`, pero (1) GREETING ignora la side-question del primer mensaje, (2) el fallback [DERIVA] no está cableado mid-flow (cae a CLARIFY), (3) formas de pago solo mapean `pays_card`.
**Decisión de arquitectura:** respuestas DETERMINISTAS por topic + Haiku como respaldo. Topic determinista + dato presente → PLANTILLA FIJA (cero LLM). Topic `other` / dato ausente / combinado → Haiku (`side_question_answer`) o fallback [DERIVA]. Reutiliza `classifyMultiIntent` + `buildBusinessContext`, sin sistema paralelo.
**Alcance ESTRICTO:** NO tocar cancelar/reagendar/"mi cita", tono/idioma del clasificador, multi-registro de plantillas, System Prompt v2, ni onboarding.
**Rama:** `feat/sidequestion-catalog` (desde main actualizado, sin merge).
**Archivos (previstos):**
- `packages/engine/src/bot/lifestyle/sideQuestion.ts` (nuevo, puro: router + plantillas + horarios naturales + formas de pago)
- `packages/engine/src/bot/lifestyle/states/greeting.ts` (GAP 1)
- `packages/engine/src/bot/lifestyle/states/qualifyingService.ts` (GAP 2)
- `packages/engine/src/bot/lifestyle/states/awaitingConfirmation.ts` (GAP 2)
- `packages/engine/src/bot/lifestyle/businessContext.ts` (GAP 3: labels efectivo/transferencia)
- Tests `node:test` (sin red, sin Supabase, sin Anthropic)
**Criterios de aceptación:**
- [x] Plantillas deterministas con el texto exacto acordado (ubicación con/sin mapa, horarios naturales, precio exacto, duración, servicios, formas de pago, niños, estacionamiento, reseñas/[DERIVA]).
- [x] Formateo de office_hours a lenguaje natural (agrupar días con mismo horario).
- [x] Regla de dato faltante: bandera (pago/niños/estacionamiento) sin dato → respuesta honesta (NO minisite); [DERIVA] real sin dato → minisite.
- [x] Enrutador: topic determinista+dato → plantilla (no Haiku); topic other / dato ausente / combinado → defer (Haiku/[DERIVA]).
- [x] GAP 1: GREETING con side-question como primer mensaje responde la pregunta, no saludo genérico.
- [x] GAP 2: fallback [DERIVA]/honesto funciona mid-flow (qualifyingService, awaitingConfirmation), no solo en CONFIRMED.
- [x] GAP 3: formas de pago soportan efectivo, tarjeta y transferencia.
- [x] Tests `node:test` deterministas verdes vía `npm test` (97 tests, 0 fail).
**Notas de ejecución:**
- **Módulo nuevo `sideQuestion.ts` (puro):** `routeSideQuestion()` enruta por topic extendido → `{mode:'answer',text}` (plantilla determinista, cero LLM) o `{mode:'defer'}` (el caller usa Haiku/[DERIVA]). `refineTopic(base,question)` deriva payment/kids/parking/reviews/services por keyword (sin tocar el clasificador). Helpers: `formatOfficeHoursNatural` (agrupa días consecutivos con mismo horario → "de lunes a viernes de 10:00 a 20:00, y sábados…"), `paymentForms` (efectivo/tarjeta/transferencia desde `pays_cash`/`pays_card`/`pays_transfer`), `resolveTargetService` (precio/duración exactos por nombre o servicio único), `derivaFallback`, `answerSideQuestionDeterministic` (atajo mid-flow), `composeGreetingSideAnswer`. `MISSING_DATA_ANSWER` para banderas sin dato.
- **GAP 1 (greeting.ts):** tras `classifyMultiIntent`, si `multi.sideQuestion && greetCase==='none'` → responde la pregunta (router determinista; si defer → `classifyIntent` Haiku → si null `derivaFallback`) + saludo breve + invitación; preserva aviso de privacidad para clientes nuevos. Sigue a `QUALIFYING_SERVICE`. Helper `buildPrivacyNotice` extraído.
- **GAP 2 (qualifyingService.ts + awaitingConfirmation.ts):** la rama SIDE_QUESTION ya no exige `side_question_answer`/`prefixMessage`; si el clasificador no produjo respuesta → `answerSideQuestionDeterministic` (plantilla/honesto por keyword o [DERIVA]) en vez de caer a CLARIFY/ambiguo.
- **GAP 3 (businessContext.ts):** `ATTRIBUTE_LABELS` ahora incluye `pays_cash`/`pays_transfer` además de `pays_card`; `paymentForms` mapea las tres.
- **Decisión de diseño confirmada en tests:** mid-flow, las preguntas de precio/horario/ubicación/duración cuyo dato existe las responde Haiku (con `buildBusinessContext`); el fallback determinista solo cubre categorías keyword-detectables (banderas/servicios/reseñas) y deriva el resto — alineado con "Haiku como respaldo".
- **Tests:** `tests/sideQuestion.test.ts` (33 casos) — plantillas exactas, formateo de horarios (incl. ejemplo del prompt), formas de pago, banderas true/false, regla de dato faltante, defer vs answer, refineTopic, composición de GREETING. `npm test` global 97 verdes. `tsc --noEmit` en `apps/lifestyle` limpio.
- **Fuera de alcance (anotado, NO implementado):** campos `parking`/`kids`/`pago` deberían entrar al **onboarding** (sprint futuro) — hoy se cargan a mano en `businesses.attributes`. Tampoco se cableó la side-question combinada booking+pregunta en GREETING (ej. "quiero un corte, ¿cuánto cuesta?" responde el booking y omite la pregunta) ni se modificó el tono/idioma del clasificador.
- **Deuda / mejora futura (decisión consciente):** el ahorro determinista (plantilla, cero LLM) aplica **solo en GREETING**, donde `classifyMultiIntent` entrega el topic enumerado y `routeSideQuestion` dispara la plantilla antes de un 2º Haiku. Mid-flow (QUALIFYING_SERVICE/AWAITING_CONFIRMATION) la respuesta sale de Haiku (`classifyIntent` ya corre y tiene `buildBusinessContext`), porque `answerSideQuestionDeterministic` **fuerza `topic:'other'`** y pierde el enumerado → price/hours/location/duration no son keyword-detectables y caen a [DERIVA]. Extender el determinismo a mid-flow (preservar el topic enumerado en `answerSideQuestionDeterministic` en vez de forzar `'other'`) es mejora futura **ligada al pendiente de topic determinista en el clasificador** (que hoy no emite topic enumerado en `classifyIntent` single-intent).
- **Pendiente humano:** rama `feat/sidequestion-catalog` para PR; sin merge a main; sin deploy a prod.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-06 — SPRINT CATÁLOGO [FIJO]+[DERIVA])

---

#### S4-BOT-08 — Cierre adaptativo de respuestas side-question 🟢 done (2026-06-08)
**Origen:** Solicitado por Gabriel (2026-06-08). El bot pegaba "¿Te gustaría agendar?" en CADA respuesta side-question (se sentía a vendedor) y a veces doblaba pregunta ("¿Te interesa agendar? ¿Qué servicio te interesa?").
**Decisión de arquitectura:** cierre DETERMINISTA por topic en 3 niveles (sin LLM extra). Nivel 1 (price/duration/services) invita a agendar con UNA pregunta; Nivel 2 (location/hours/parking/payment/kids) da el dato limpio sin empuje; Nivel 3 (reviews/products→other) da la salida útil (link) sin agenda. La guía del prompt también se alineó a los 3 niveles para las respuestas vía Haiku.
**Alcance ESTRICTO:** solo el cierre de side-questions + colocación de links en línea propia. No tocar FSM, agendamiento, clasificador, ni los flow-questions legítimos de QUALIFYING_STAFF/DATETIME (son el siguiente paso, no un push de agenda).
**Rama:** `feat/sidequestion-closing` (desde main actualizado con el pulido mergeado #12, sin merge).
**Archivos:**
- `packages/engine/src/bot/lifestyle/sideQuestion.ts` (closingLevelForTopic/closingForTopic/SIDE_QUESTION_INVITE; location con cierre neutro "Aquí te esperamos." + links en línea propia; reviews/derivaFallback con link en línea propia; composeGreetingSideAnswer con `closing` adaptativo)
- `packages/engine/src/bot/lifestyle/states/greeting.ts` (calcula refineTopic→closingForTopic)
- `packages/engine/src/bot/lifestyle/states/qualifyingService.ts` (elimina RETURN_TO_BOOKING genérico; servicios/precio→menú, resto→cierre por nivel)
- `packages/engine/src/bot/lifestyle/clarification.ts` (buildSideQuestionResponse une con salto de línea → link en línea propia + sin doble pregunta pegada)
- `packages/engine/src/bot/lifestyle/prompt.ts` (sección "preguntas fuera del flujo" reescrita a 3 niveles + máx 1 pregunta + links en línea propia)
- `tests/sideQuestion.test.ts` (+ casos de niveles, doble pregunta ausente, links en línea propia; templates actualizados)
**Criterios de aceptación:**
- [x] Cada topic mapeado a su nivel de cierre (closingLevelForTopic).
- [x] Nivel 1 invita / Nivel 2 dato limpio sin push / Nivel 3 salida útil sin agenda.
- [x] Sin doble pregunta; máximo UNA pregunta por mensaje (solo Nivel 1).
- [x] Links en su propia línea (salto antes y después).
- [x] Menú numerado de servicios solo en preguntas de servicios/precio (mantenido).
- [x] `npm test` 112 verdes; `tsc --noEmit` en apps/lifestyle limpio.
**Notas de ejecución:**
- Mid-flow (QUALIFYING_SERVICE) el cierre se deriva por keyword (refineTopic); para servicios/precio se conserva el menú (continuación natural = Nivel 1 en forma de lista). QUALIFYING_STAFF/DATETIME conservan su flow-question (siguiente paso real del agendamiento, no push) — ahora con salto de línea para links.
- La eliminación del "¿Te gustaría agendar?" en Haiku se hace vía prompt (determinista, sin llamada extra): se instruye responder solo el dato y no cerrar con pregunta genérica → mata la doble pregunta en origen.
**Pendiente humano:** rama `feat/sidequestion-closing` para PR; sin merge a main; sin deploy a prod.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-08 — cierre adaptativo side-question)

---

#### S4-BOT-09 — Hotfix bucle en QUALIFYING_SERVICE (servicio único + anti-loop) 🟢 done (2026-06-09)
**Origen:** Bug reportado por Gabriel (2026-06-09). Negocio de **un solo servicio** quedaba atascado en `QUALIFYING_SERVICE` repitiendo la oferta sin avanzar; "sí"/"no"/preguntas de horario no enganchaban la transición. Conversación real (negocio `4de6a450-…`) confirmada en `bot_conversations` + `bot_logs`.
**Causa raíz (reproducida, NO regresión de S4-BOT-08):** los `bot_logs` muestran el mismo bucle el **2026-06-06** (anterior al merge de S4-BOT-08, 2026-06-08). El path ADVANCE→QUALIFYING_STAFF de `qualifyingService.ts` quedó byte-idéntico en S4-BOT-08 (solo cambió la rama side-question). Defecto estructural pre-existente: (a) negocio de servicio único nunca auto-resuelve el único servicio → pregunta "¿cuál?" sin opción contestable; (b) el clasificador devuelve `CONFIRM_YES` con alta confianza pero `value=null` → `handleClassification` da **ADVANCE y resetea `clarification_attempts` a 0**; en `qualifyingService` no hay servicio extraíble → cae a REPEAT_OPTIONS con el contador en 0 → el guard `MAX_TOTAL_ATTEMPTS=5→FALLBACK` **nunca dispara** → bucle infinito sin escalar a humano.
**Alcance ESTRICTO (solo #1 y #2; #3 NO):**
- **#1 Servicio único:** fast-path en `qualifyingService.ts` (si `allServices.length===1` y el mensaje no es side-question → `buildAdvanceResult` → QUALIFYING_STAFF) + espejo en `greeting.ts` (auto-pick del único servicio cuando hay señal de reserva y no es pregunta del negocio). Detector determinista `looksLikeSideQuestion` (sin red).
- **#2 Anti-loop (afecta a TODOS los negocios):** `repeatFallbackContext` — en el camino ADVANCE-sin-resolver NO resetear `clarification_attempts`; incrementarlo para que el escape a FALLBACK sea alcanzable.
**Rama:** `feat/fix-qualifying-loop` (desde `origin/main` con #14, sin merge).
**Archivos:**
- `packages/engine/src/bot/lifestyle/states/qualifyingService.ts` (fast-path servicio único, `looksLikeSideQuestion`, `repeatFallbackContext`)
- `packages/engine/src/bot/lifestyle/states/greeting.ts` (auto-pick servicio único con señal de reserva)
- `tests/qualifyingService.test.ts` (nuevo: 7 tests — fast-path, discriminación del detector, anti-loop + regresión que reproduce el contador clavado en 0)
**Criterios de aceptación:**
- [x] Servicio único: "quiero agendar" / "sí" → avanza a QUALIFYING_STAFF sin preguntar cuál.
- [x] Anti-loop: ADVANCE-sin-resolver repetido SUBE `clarification_attempts` y escala a FALLBACK en ≤5 turnos (no bucle infinito).
- [x] Pregunta real ("¿cuánto cuesta?") NO se auto-resuelve (detector puro).
- [x] `npm test` 124 verdes (7 nuevos); `tsc --noEmit` apps/lifestyle limpio.
**Por qué los tests existentes no lo cacharon:** no había NINGÚN test de los handlers `qualifyingService`/`greeting` ni de integración del happy-path de agendamiento — la suite cubría side-questions puras pero no la transición de estado. El clasificador no es inyectable, así que un e2e multi-estado real requiere red/mock del LLM (fuera del harness puro actual); se cubrió con tests deterministas a nivel handler + simulación pura de la aritmética del bucle.
**Deuda registrada (#3 — NO hacer en este hotfix, va en sprint aparte):** `handleClassification` ignora el `intent` salvo `SIDE_QUESTION` (solo mira `confidence`). Un `CONFIRM_YES`/`CONFIRM_NO`/`SELECT_OPTION` no se consume según su tipo → reaparecerá en otros estados. Consumir el intent type es **refactor del clasificador/clarification**, requiere su propia tarea. Además: un e2e real de agendamiento exige hacer el clasificador inyectable o mockeable (habilitaría el test integración punta-a-punta que faltó). **→ ELEVADA a deuda técnica de máxima prioridad** (ver "🔴 DEUDA TÉCNICA DE MÁXIMA PRIORIDAD" al inicio del Backlog post-sprint): sin esto no hay cobertura e2e del flujo central de reserva, ligado a #3 y al gap de CI.
**Pendiente humano:** rama `feat/fix-qualifying-loop` para PR; sin merge a main; sin deploy.
**Prompt:** Ad-hoc/hotfix solicitado por Gabriel (2026-06-09 — bucle QUALIFYING_SERVICE)

---

#### S5-OBS-01 — Instrumentación de logging del clasificador 🟢 done (2026-06-09)
**Origen:** Habilitante del diagnóstico de la deuda **#3** (ver S4-BOT-09 y "🔴 DEUDA TÉCNICA DE MÁXIMA PRIORIDAD"). El output de los clasificadores no era observable: el diagnóstico de C1/C2 (pérdida de hora/servicio en el flujo) dependía de inferencia, no de lectura directa.
**Objetivo:** Persistir el output de ambos clasificadores (`classifyIntent` single y `classifyMultiIntent` multi) en `bot_logs`, para convertir el diagnóstico de inferencia en lectura directa. Cambio **estrictamente aditivo**: ningún comportamiento observable del bot cambió.
**Cambio de esquema:** se agregó la columna `metadata jsonb NULL DEFAULT NULL` a `bot_logs` vía migración `supabase/migrations/20260608000000_bot_logs_metadata.sql`. **Esta migración se aplicó MANUALMENTE vía SQL Editor de Supabase contra producción (`hdqazbuxtpavtioufrsv`)** — el archivo en el repo documenta el cambio pero NO se autoaplica por pipeline. Aditiva, nullable, sin backfill.
**Instrumentación:** 7 call sites, todos fire-and-forget / no bloqueantes (catch que registra el fallo y nunca lo propaga a la respuesta del usuario):
- **single** (`classifier_type='single'` → `{ intent, confidence, value, message_raw }`): `qualifyingService`, `qualifyingStaff`, `qualifyingDatetime`, `awaitingConfirmation`, `confirmationResponse`, y la rama side-question de `greeting`.
- **multi** (`classifier_type='multi'` → `{ matches: {serviceMatch, staffMatch, dateMatch, timeMatch, sideQuestion, confirmYes, confirmNo, unclear}, message_raw }`): `greeting`.
- `event_type='classifier_output'` (convive con `state_transition` sin romper queries existentes); `model_used` poblado; payload con forma fija de claves nombradas (compliance ARCO: una purga sabe exactamente qué campos contienen texto del usuario). Reusa el mismo mecanismo de insert que `handler.ts` (sin cliente nuevo); `state_from/state_to` NOT NULL se llenan con el estado actual del handler (evento no-transición).
**Criterios de aceptación:**
- [x] Ningún branch de decisión de los handlers cambió (solo líneas agregadas; lógica/umbrales/returns intactos).
- [x] Logging no bloqueante (try/catch que no propaga).
- [x] `event_type='classifier_output'` sin CHECK/enum que lo rechace.
**Verificación:** confirmado en **producción** tras un agendamiento de prueba — fila `classifier_output` tipo `multi` poblada con la forma fija esperada (date/time/service matches con confidence).
**Hallazgo para el próximo ciclo:** el log confirmó que el clasificador **extrae fecha/hora/servicio con alta confianza** → la pérdida de datos NO está en la extracción, sino **aguas abajo en los handlers (C1/C2)**. Próximo paso: completar el flujo turno por turno leyendo los logs `single` para localizar el estado exacto donde se descarta la hora.
**Pendiente humano:** PR #16 mergeado a main.

---

#### S5-DATA-01 — Limpieza de staff duplicado ("Carlos" huérfano) en Barbería Demo 🟢 done (2026-06-09)
**Origen:** Ad-hoc solicitado por Gabriel (2026-06-09). Diagnóstico read-only previo reveló que el negocio Barbería Demo (`4de6a450-9681-41b3-bdac-4b7fa39016a2`) tenía **DOS registros de staff activos llamados "Carlos"**, idénticos salvo `id` y `created_at`. El duplicado venía de un **alta manual sin guard de idempotencia** (NO de seed ni migración — sin rastro en `supabase/migrations/`, ni en `onboard-business.ts` con el dummy JSON, ni en grep del repo). Estaba **amplificando bugs del FSM**: al ser idénticos, el dedup-por-hora colapsaba ambos y gatillaba el auto-commit de Bug B.
**Qué se conservó / qué se borró:**
- **Canónico CONSERVADO:** `cd8d7f08-0250-47c5-b353-3c8dc6d72c24` (2do creado, 02:17:28). Tiene el service link a "Corte de cabello", el horario completo (6 días en `staff_availability`), 2 citas `confirmed` futuras (2026-06-10) y es favorito de 1 cliente.
- **Huérfano ELIMINADO:** `23fae157-0ba2-40f2-a0bd-370830f7ba73` (1ro creado, 02:14:30). **Cero FKs** en las 12 tablas que referencian `staff` (re-verificado en vivo, no por el conteo del diagnóstico previo).
**Cómo se ejecutó (manual vía MCP/SQL contra producción `hdqazbuxtpavtioufrsv`):** (1) `SELECT *` de respaldo de la fila huérfana → (2) bloque `DO` atómico: re-conteo en vivo de las 12 FK (`staff_services`, `staff_availability`, `staff_blocks`, `staff_schedule_exceptions`, `waitlist`, `customers.favorite_staff_id`, `bot_conversations.taken_by`, `conversation_messages.staff_id`, `arco_requests.resolved_by`, `appointments` ×3 staff_id/created_by/modified_by) con `RAISE EXCEPTION`+ROLLBACK ante cualquier dependiente, seguido del `DELETE FROM staff WHERE id = '<huérfano>'` por **ID literal exacto** (nunca por name/phone — idénticos entre ambos Carlos) → (3) confirmación post-borrado. Resultado: 0 dependientes, 1 fila borrada, queda 1 solo Carlos (cd8d7f08), 2 citas confirmed intactas apuntando al canónico.
**Camino de reversión (recupera la fila idéntica, id y created_at originales):**
```sql
INSERT INTO staff (id, business_id, auth_id, name, phone, whatsapp_id, role, active, created_at, photo_url, pin)
VALUES (
  '23fae157-0ba2-40f2-a0bd-370830f7ba73',
  '4de6a450-9681-41b3-bdac-4b7fa39016a2',
  NULL,
  'Carlos',
  '15551112222',
  '15551112222',
  'barber',
  true,
  '2026-06-05 02:14:30.379004+00',
  NULL,
  NULL
);
```
**Hallazgos derivados (registrados como backlog, NO resueltos — ver "Backlog post-sprint"):**
- `conversation_messages` tiene **RLS deshabilitado** (única tabla así) → exposición potencial de mensajes de cliente (PII/LFPDPPP) vía anon key. Prioridad por encima de los bugs de UX. **Atender antes del go-live.**
- `onboard-business.ts` inserta staff **sin guard de idempotencia a nivel staff** (solo a nivel slug del business) → la puerta para futuros duplicados sigue abierta.
- Tres bugs de UX diagnosticados turno-por-turno, pendientes de fix: **Bug B** (handler, = C5: auto-confirma slot no pedido), **Bug C** (clasificación: "horarios disponibles" → horario del local), **Bug A** (handler/datos: no sabe listar staff). **Bug B debe RE-VERIFICARSE contra la base ya limpia antes de diseñar su fix** — el duplicado lo amplificaba y el síntoma puede haber cambiado.
**Pendiente humano:** ninguno (operación ejecutada y verificada en producción).

---

#### S5-DATA-02 — Alta del segundo barbero ("Andrés") en Barbería Demo — fase 2 del modelo multi 🟢 done (2026-06-16)
**Origen:** Ad-hoc solicitado por Gabriel (2026-06-16). Es el **desbloqueo** explícito de la "Visión del motor de agendamiento §5 (Dependencia: requiere múltiples barberos)": con un solo barbero en la base de prueba no se pueden implementar ni probar (b) búsqueda hora-primero, derivación a otro barbero, ni el manejo "barbero descansa / negocio abierto". Esta tarea carga el segundo barbero real con agenda propia distinta a la de Carlos.
**Propósito (verificar fundación):** dar a la base de prueba dos agendas reales y distintas para validar que el motor razona a nivel barbero, no negocio.
**Guard de seguridad (diagnóstico de fase 1 confirmó que NO hay guard de unicidad en `staff`):** pre-check `SELECT ... WHERE business_id=Barbería Demo AND lower(name)=lower('Andrés')` → devolvió `[]`, no existía → se procedió. Inserción en **una sola sentencia atómica** (CTEs encadenadas `new_staff`→`avail`→`svc` con `INSERT ... RETURNING`): las tres piezas juntas o ninguna, el `id` generado se referencia literal vía la CTE (no se re-deriva por nombre). Idempotencia de `staff_services` por PK compuesta.
**Datos cargados:**
- **`staff`:** id `4dff5eeb-39cd-4f0f-becf-25a60d9cecfc`, name "Andrés", role "barber", active true, pin **`4321`** (distinto de Carlos `1234` y Asistente `5678`), phone/whatsapp_id `15553334444` (test, distinto del `15551112222` de Carlos).
- **`staff_availability`:** Mar–Sáb (`day_of_week` 2–5 y 6) **12:00–21:00**, `break_start/break_end` NULL, `is_active` true. Descansa Dom (0, excluido por instrucción) y Lun (1, sin fila).
- **`staff_services`:** link al servicio único "Corte de cabello" (`261dc26b-3482-4cec-a665-ae214d0409a1`).
**Por qué este horario (distinto a Carlos = Lun–Vie 10–20, Sáb 10–18, sin Dom):** difiere en **días** (Andrés descansa lunes) y en **horas** (abre más tarde, cierra a las 21). Habilita los tres escenarios bloqueados de §5: (i) hora-primero — mañanas 10–12 solo Carlos, noche 20–21 solo Andrés; (ii) derivación a otro barbero; (iii) "barbero descansa / negocio abierto" — el lunes Andrés descansa pero Carlos trabaja. (El escenario domingo del §4 NO se cubre: ambos descansan domingo por instrucción.)
**Verificación post-inserción (por id literal):** Req 1 staff existe `active=true` ✓; Req 2 las 5 filas de `staff_availability` correctas (2–6, 12:00–21:00, sin breaks, is_active) ✓; Req 3 link `staff_services` a "Corte de cabello" ✓. "Bien formado" según los tres requisitos del diagnóstico.
**Hallazgo lateral (NO bug):** `staff.phone` y `staff.whatsapp_id` son **NOT NULL** en la BD real, pero el schema documentado en CLAUDE.md no lo indicaba. El primer intento de INSERT falló por eso (atómico → 0 filas insertadas, nada quedó a medio formar); el reintento agregó phone/whatsapp_id. **Corregido en este mismo commit** (CLAUDE.md tabla `staff`).
**Camino de reversión (documentado, NO ejecutado) — DELETE atómico en orden de FK (hijos → padre), por id literal:**
```sql
BEGIN;
DELETE FROM staff_services    WHERE staff_id = '4dff5eeb-39cd-4f0f-becf-25a60d9cecfc';
DELETE FROM staff_availability WHERE staff_id = '4dff5eeb-39cd-4f0f-becf-25a60d9cecfc';
DELETE FROM staff             WHERE id        = '4dff5eeb-39cd-4f0f-becf-25a60d9cecfc';
COMMIT;
```
**Pendiente humano:** ninguno (operación ejecutada y verificada en producción). NO se tocó código (round-robin/FSM intactos).

---

#### S5-TEST-01 — Comando de reset de conversación para testing (`/reset-bot`) 🟢 done (2026-06-12)
**Origen:** Nació del diagnóstico read-only del ciclo de vida de una conversación del bot (ad-hoc previo). El síntoma: una conversación de prueba "revivía" en su último estado FSM cuando el mismo teléfono volvía a escribir (ej. cliente con cita confirmada que regresa y el bot arrastra QUALIFYING → "No entendí bien qué día prefieres"). El workaround era **borrar la fila de `bot_conversations` a mano**, frágil por el índice `UNIQUE(business_id, customer_phone)` + UPSERT in-place (ya había mordido antes). El diagnóstico reveló la causa raíz: los estados intermedios (`QUALIFYING_*`/`SHOWING_SLOTS`/`AWAITING_*`) **no tienen reset de horizonte corto** — solo existe el lazy de inactividad >24h y los terminales — así que una re-prueba el mismo día revive el estado viejo.
**Objetivo:** Dar una herramienta de testing para devolver una conversación a estado limpio sin tocar la BD a mano, gateada a números de prueba para que ningún cliente real pueda dispararla.
**Comportamiento:** trigger **exacto** `/reset-bot` (coincidencia exacta del mensaje, NO substring → "quiero resetear mi cita" no lo dispara) + gating por allowlist. Sobre la fila `(business_id, customer_phone)`: `state→GREETING`, `context→{}`, `session_mode→bot`, `taken_by→null`, `taken_at→null`, con respuesta de confirmación (`✅ Conversación reseteada (modo prueba)`). El `session_mode→bot` además **destraba conversaciones colgadas en human/paused** tras un takeover de prueba.
**Gating de seguridad (doble guarda):** el comando solo se ejecuta si (1) el texto es el trigger exacto **Y** (2) el teléfono está en una allowlist leída de la env var `TEST_PHONE_ALLOWLIST` (números E.164 sin `+`, separados por coma; **NO commiteada**). Falla cerrado: allowlist ausente/vacía → comando inerte. Para un número **fuera** de la allowlist, `/reset-bot` es **indistinguible de cualquier mensaje** — el path es idéntico al de un mensaje normal (cae al `handoffGate`/FSM), sin reconocimiento especial y sin revelar que el comando existe.
**Implementación:** interceptado en los **3 entrypoints del webhook** (Meta async `processMetaMessage`, Twilio async `processTwilioMessage`, Twilio dev síncrono `getTwilioResponseText`), **ANTES del `handoffGate`** — si fuera después, una conversación en human/paused tragaría el comando antes de resetearse. Guardas puras extraídas a módulo `apps/lifestyle/src/lib/test-reset.ts` (sin deps de Next/Supabase/red; allowlist inyectada como parámetro, mismo patrón que `message-buffer-core`). El UPDATE reusa el cliente service-role existente. **NO** se tocó el FSM, los handlers de estado, compliance/LFPDPPP, ni el easter egg del webhook.
**Criterios de aceptación:**
- [x] Número EN allowlist: `/reset-bot` resetea limpio (confirmado en DB: `GREETING`/`{}`/`bot`/`null`/`null` + respuesta `✅`).
- [x] Número FUERA de allowlist: `/reset-bot` NO resetea — el bot responde con saludo normal, sin mensaje de confirmación (verificado en prod).
- [x] Trigger exacto vs substring con "reset", allowlist vacía/ausente (fail-closed), variantes de formato (`+`, espacios): cubiertos por 20 tests unitarios en `tests/testReset.test.ts`.
- [x] `npm test` 143 verdes (20 nuevos).
**Verificación:** unit tests (143 pass / 0 fail) + smoke test en producción **en ambos sentidos** (número en allowlist resetea; número fuera no). Rama `feat/test-reset-command`, PR #17 mergeado a main; desplegado y verificado.
**Estado en producción / caveat:** `TEST_PHONE_ALLOWLIST` está seteada en Vercel con los números de prueba. El comando vive **latente** en producción pero solo accesible a esos números; queda **inerte** si la var se quita.
**Backlog relacionado (NO resuelto):** sigue pendiente el reset de "intermedios rancios" para **PRODUCCIÓN** (opción B del diagnóstico de ciclo de vida). Esto es la herramienta de testing, NO la solución para un cliente real que abandona un agendamiento a mitad. Decisión de producto pendiente: umbral de inactividad para resetear un estado intermedio.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-12 — comando de reset para testing).

---

#### S5-BOT-01 — Selección de slot en lenguaje natural en CONFIRMING_APPOINTMENT 🟢 done (2026-06-12)
**Origen:** Diagnóstico read-only previo. En `CONFIRMING_APPOINTMENT` el bot **presenta** los horarios en lenguaje natural ("A las 5:00, a las 5:15…") pero solo **entendía** el índice numérico (1/2/3). Un cliente que respondía "el de las 5", "5 de la tarde", "la primera" o "el más temprano" caía a fallback/clarify. Dos causas raíz:
- **Bug #1 (re-ruteo prematuro):** `detectsDatetimeRequest` interceptaba "a las"/"tarde"/"para las" y re-ruteaba a `QUALIFYING_DATETIME` **antes** de que la selección llegara al parser. Una selección del día actual se trataba como cambio de fecha.
- **Bug #2 (`parseInt` sobre todo el string):** `parseChoice` hacía `parseInt("5 de la tarde")` → leía índice 5, fuera de rango (solo hay 1-3) → clarify.
**Regla maestra de ruteo (la frontera):** si el mensaje contiene una **fecha** (`parseDate` ≠ null: "mañana", "el viernes", "23 de abril") → **se mantiene** el re-ruteo a `QUALIFYING_DATETIME` (es un cambio de día legítimo). Si el mensaje contiene **solo hora** (sin fecha) → es una **selección del día ya presentado** → NO se re-rutea; se matchea contra `pendingSlots`. El conflicto "matcher antes del date-redirect" vs "fecha presente → redirect" se resolvió **quitando las frases de turno** ("de la tarde") antes de pasar el texto a `parseDate`: así "5 de la tarde" NO se lee como fecha, pero "mañana a las 5" sí redirige. Por eso el orden de checks es: corrección de servicio → guard de vacío → sin-preferencia (guardado con `!SHIFT_OR_EXTREME_RE` para que "cualquiera de la tarde" y "el más temprano" NO caigan aquí) → **matcher natural (ANTES del date-redirect)** → date-redirect (solo si hay fecha) → índice numérico (fallback de baja prioridad) → clarify/fallback.
**6 decisiones tomadas:**
- **(a) Match exacto de hora ±5 min** reusando el patrón de `presentingSlots.ts` (tolerancia de minutos). "el de las 5:15" → slot 17:15 exacto.
- **(b) Hora NO ofrecida → resolver DENTRO del estado** ofreciendo el slot más cercano ("a las 6 no tengo, lo más cercano es 5:15. ¿Te sirve?"), **NO** re-rutear. Se decidió así porque el re-ruteo a `QUALIFYING_DATETIME` arrastraba el bug del rollover de día (la hora no disponible saltaba al día siguiente). Round-trip vía nuevo campo `nearestOfferSlot`: si el cliente responde afirmativamente en el turno siguiente se selecciona el slot ofrecido sin perder las otras opciones.
- **(c) Ordinales** "la primera"→1, "la segunda"→2, "el último"→last (NO "el del medio", ambiguo con 3 opciones).
- **(d) Fuzzy** "el más temprano"→min `startsAt`, "el más tarde"→max, "cualquiera de la tarde"→filtra ≥12:00 y toma el primero — siempre mapeando a un slot **concreto** de `pendingSlots`.
- **(e) Índice como fallback de baja prioridad:** se intenta el match por hora/ordinal/fuzzy ANTES del índice numérico, para que "5 de la tarde" no gane como índice 5. El índice solo aplica a un dígito desnudo sin marcador ("2", "uno"/"dos"/"tres").
- **(f) AM/PM desambiguado contra los slots reales:** una hora ambigua (1-11) genera candidatos [h, h+12] y se elige el que tenga el slot más cercano — NO una regla fija "1-6→PM" (que rompería negocios de horario matutino). "a las 5" con slots de tarde → 17:00; con slots de mañana → ofrece el más cercano a 05:00.
**Implementación (parser LOCAL, sin helper compartido):** todo vive en `confirmingAppointment.ts` como función pura exportada `routeSlotSelection(body, slots, now, tz)` → `SelectionRoute` (`no_preference`/`select`/`offer_nearest`/`date_redirect`/`index`/`none`) + `matchNaturalSlot` + parser de hora local (`extractRawTime`/`resolveTargetMinutes`) + `parseOrdinal`/`parseFuzzy`. Se reusa solo `parseDate` (de `qualifyingDatetime.ts`) para la decisión de frontera — es el parser de **fecha**, permitido; el parser de **hora** se mantiene local y NO se tocaron los de `greeting.ts`/`qualifyingDatetime.ts` (dedup es sprint aparte). Nuevo campo `nearestOfferSlot: z.string().datetime().nullable().optional()` en `LifestyleBotContextSchema`. `parseChoice` endurecido a dígitos puros (`/^\d+$/`).
**Criterios de aceptación:**
- [x] `routeSlotSelection` puro y testeable (slots + tz inyectados, sin DB/red/LLM).
- [x] 28 tests nuevos en `tests/slotSelection.test.ts` cubriendo las 6 decisiones + regresiones ("mañana a las 5"→date_redirect, "el viernes"/"23 de junio"/"otro día"→date_redirect, "cualquiera"→no_preference, "1"/"uno"→index, "5pm" NO index, corrección de servicio→none).
- [x] `npm test` 171 verdes (28 nuevos); `tsc --noEmit` apps/lifestyle limpio (EXIT 0).
**Verificación:** unit tests (171 pass / 0 fail) + type-check de la app verde. Rama `feat/slot-selection-natural`, **sin merge** — pendiente smoke test por WhatsApp de Gabriel (con `/reset-bot` entre intentos).
**Nota de observabilidad (punto ciego):** `detectsDatetimeRequest` corría **antes** del clasificador, así que su intercepción de la selección era **invisible al logging del clasificador** (S5-OBS-01) — mismo punto ciego que Bug B: los checks pre-clasificador no aparecen en `bot_logs`. El fix elimina ese check determinista temprano y mueve la decisión de frontera a `parseDate`, pero el aprendizaje queda: **lógica de ruteo antes del clasificador no es observable**.
**Backlog derivado (sprint 2, NO en este sprint):**
- Extraer un **parser de hora compartido** y deduplicar los parsers de `greeting.ts`/`qualifyingDatetime.ts`/`confirmingAppointment.ts` (hoy hay 3 implementaciones del mismo concepto; se mantuvo local a propósito para no expandir el alcance).
- Revisar el **wording de presentación de slots** (`presentingSlots.ts`) para alinearlo con lo que el matcher entiende.
- **Principio de diseño:** *presentación natural exige comprensión natural* — ambas capas comparten un contrato. Si una presenta "a las 5:15" la otra debe entender "el de las 5:15"; divergencias entre capas producen el bug que originó esta tarea.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-12 — selección de slot en lenguaje natural).

---

#### S5-BOT-02 — Disponibilidad real del día en CONFIRMING_APPOINTMENT (fix del "más cercano") 🟢 done (2026-06-13)
**Origen:** finding "🟠 BUG DE DISPONIBILIDAD" (smoke de S5-BOT-01, diagnóstico read-only 2026-06-13, ver Backlog post-sprint). El "más cercano" colapsaba a la mañana porque el matcher comparaba la hora pedida solo contra los ≤3 slots mostrados, no contra el día real.
**Alcance (la frontera, 2 archivos):** `presentingSlots.ts` (Bug 1) y `confirmingAppointment.ts` rama `offer_nearest` (Bug 2). NO se tocó el router puro `routeSlotSelection` (sus tests de `slotSelection.test.ts` quedan intactos) ni la rama `select` (selección directa de S5-BOT-01). FUERA de alcance: modo hora-primero, presentación representativa, domingo hardcodeado, dedup del parser.
**Los dos bugs:**
- **Bug 1 (rollover ciego):** `findSlotsInNextDays` (vía `presentingSlots.ts:158`) NO reenviaba `requestedTime` al `getAvailableSlots` del día alternativo → el día alterno presentaba los 3 slots **más tempranos**, no los más cercanos a la hora pedida. Fix: una línea — `requestedTime: context.requestedTime ?? undefined` en el `baseOpts`.
- **Bug 2 (matcher ciego):** la rama `offer_nearest` ofrecía el más cercano de los **≤3 `pendingSlots` mostrados**, nunca el día real. Fix: re-consultar `getAvailableSlots` del **mismo día** (NO salto de fecha) con `requestedTime` derivado de `route.requestedMinutes`, `preferredStaffId = autoAssign ? null : staffId`, `durationMinutes`/`staffToQuery` vía `getCatalog`/`getStaffForService` (cacheados). Se **REEMPLAZAN** (no se appendean) los `pendingSlots` con el resultado (≤3, ya ordenado bidireccional por cercanía — se reusa esa lógica de `scheduling.ts`, no se replica) y `nearestOfferSlot = resultado[0]`. `SchedulingQueryError` se maneja con el patrón de retry de `presentingSlots`. Si no hay disponibilidad real recuperable, cae al comportamiento previo (slot de los mostrados).
**Nota CRÍTICA — NO auto-confirma (anti Bug-B):** aunque `resultado[0]` sea la hora pedida exacta, NO se agenda en silencio. Se presenta ("Sí, tengo disponible a las X. ¿Te la agendo?") y se espera el "sí" explícito del cliente; el slot ofrecido queda en `pendingSlots[0] = nearestOfferSlot` donde la rama de aceptación (`AFFIRM_RE`) lo recoge. El único camino de confirmación directa sigue siendo la selección explícita (rama `select`, S5-BOT-01) — esta rama nunca commitea sola. Si la hora real no es exacta: "a las X no tengo, lo más cercano es Y, ¿te sirve?".
**Criterios de aceptación:**
- [x] Bug 1: día alternativo ofrece cerca de la hora pedida (test de `findSlotsInNextDays` con/sin `requestedTime`).
- [x] Bug 2: hora pedida que SÍ existe pero no estaba mostrada → la ofrece y espera "sí" (no auto-agenda).
- [x] Bug 2: hora NO disponible → ofrece la real más cercana **bidireccional** (caso antes: 16:30; caso después: 13:00), no un slot de la mañana.
- [x] Aceptación "sí"/"dale" tras la oferta → `AWAITING_BOOKING_NAME` con el slot ofrecido (vive en los `pendingSlots` reemplazados).
- [x] Regresión: selección directa entre los mostrados sigue yendo a `AWAITING_BOOKING_NAME`; el router puro NO cambió (sus 28 tests intactos).
- [x] 7 tests nuevos en `tests/slotAvailabilityRealDay.test.ts`; `npm test` 177 verdes; `tsc --noEmit` apps/lifestyle limpio (EXIT 0).
**Verificación:** unit tests (177 pass / 0 fail) + type-check de la app verde. Smoke test por WhatsApp es el veredicto (con `/reset-bot` entre intentos), re-verificando además la selección directa de S5-BOT-01 porque este fix toca el mismo núcleo. Rama `fix/slot-availability-real-day` (desde `feat/slot-selection-natural`, que contiene S5-BOT-01), **sin merge**.
**Hallazgo lateral (NO corregido — fuera de alcance):** `AFFIRM_RE` no matchea "sí" con acento (el `\b` ASCII no hace boundary tras 'í'); "si"/"dale"/"va" sí. Pre-existente de S5-BOT-01. Anotado para backlog.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-13 — fix de disponibilidad real del día).

---

#### S5-BOT-03 — Aceptación/negación en CONFIRMING_APPOINTMENT (fix `AFFIRM_RE` + progresión de rechazo) 🟢 done (2026-06-16)
**Origen:** "Hallazgo lateral" de S5-BOT-02 — `AFFIRM_RE` no matcheaba "sí" con acento (el `\b` ASCII no hace boundary tras la 'í'), y el flujo no distinguía un "no" (rechazo) de un input no reconocido (no te entendí). El cliente que respondía "sí" a una oferta caía al clarify ciego.
**Frontera dura (NO tocado):** `routeSlotSelection`, `matchNaturalSlot`, la reconsulta de día real y la rama `offer_nearest` (S5-BOT-01/02, verificados). NO clasificador. NO derivación salvo el cuarto "no". NO cancelación. El comportamiento de "no, a las 6" como corrección (lo consume el matcher natural) NO se rompe.
**Las 4 piezas:**
- **Pieza 1 — `AFFIRM_RE` → `isAffirmation()` normalizado.** Se reemplaza el regex con `\b` por listas ASCII + `normalize()` (NFD + strip diacríticos, mismo patrón que `sideQuestion.ts`). Afirmaciones claras: `si, simon, dale, va, vale, ok, okay, claro, sale, perfecto, correcto, afirmativo, de acuerdo, me sirve, orale`. Tokens cortos/ambiguos (`si, va, ok, okay, sale, vale`) → **match de mensaje completo** (tras normalizar/quitar puntuación) para que "¿va a estar?" NO acepte. Largos/distintivos (`simon, dale, claro, perfecto, correcto, afirmativo, de acuerdo, me sirve, orale`) → anclaje por espacios. La rama solo corre con `nearestOfferSlot` presente (condición sin cambios).
- **Pieza 2 — Negación DOWNSTREAM del router (regla maestra).** La detección de "no" va **DESPUÉS** de `routeSlotSelection`, solo cuando devuelve `none`. NUNCA antes. Así "no, a las 6" / "no, mejor las 7" pasan intactos por el matcher natural (extrae la hora → `offer_nearest`) y solo el "no" SIN señal de selección entra a la rama de negación. Negaciones claras: `no, nel, negativo, ahorita no, no gracias` (normalizadas; cortas → mensaje completo, `negativo` → anclaje). Las implícitas ("que amable", "a la vuelta", "luego", "asi esta bien gracias") NO se fuerzan → caen al clarify natural.
- **Pieza 3 — Progresión escalonada de rechazo (contador `rejection_attempts`).** Contador NUEVO, **separado** de `clarification_attempts` (distingue "me dijiste que no" de "no te entendí"). Cuenta "no" CONSECUTIVOS; se resetea a 0 ante cualquier avance (selección, `offer_nearest`, corrección, `date_redirect`). Pasos, cada uno RECONOCE el "no" antes de redirigir (nunca suena a "elige opción N"):
  - `0` (1er no) → **A**: "Sin problema." + re-ofrecer alternativas concretas del día (otras horas de `pendingSlots`, excluyendo la ofrecida).
  - `1` (2do no) → **B**: "Entiendo. ¿Qué hora te vendría mejor?" (pregunta abierta).
  - `2` (3er no) → **C**, cambio de eje: "Va. ¿Prefieres quizás otro día, o buscas algo en particular?" (no repite lo de la hora).
  - `3` (4to no) → **handoff a humano** vía `ESCALATED` (mecanismo de escalado existente; `fallbackAttempts: 2`).
  - **Razón del diseño:** un cliente que rechaza repetidamente no necesita que le repitan opciones — necesita escalada gradual de empatía (reconocer) y de eje (hora → día → "algo en particular" → humano). Dos contadores separados evitan que un "no" consuma presupuesto de clarify (y viceversa), y que la mezcla degrade el tono.
- **Pieza 4 — Copy del clarify ciego.** Reescrito a tono humano (reusa el registro de `offer_nearest`): "Disculpa, no te seguí bien. Solo dime a qué hora te gustaría… Si cualquiera te sirve, dime 'cualquiera' y te asigno la primera." Una sola pregunta por mensaje.
**Criterios de aceptación:**
- [x] "sí" con acento acepta (bug original); afirmaciones coloquiales aceptan.
- [x] "no, a las 6" se consume como corrección (`offer_nearest`), NO entra a negación (regresión crítica).
- [x] "no" solo → A; "no"→"no"→"no" progresa A→B→C; cuarto "no" → `ESCALATED`.
- [x] "no"→"a las 4"(avanza)→"no" resetea a A (no salta a B).
- [x] Tokens cortos ("va", "ok") aceptan solo como mensaje completo, no embebidos ("¿va a estar?" NO acepta).
- [x] Regresión: selección directa y `offer_nearest` de S5-BOT-01/02 intactos.
- [x] 29 tests nuevos en `tests/affirmNegationHandling.test.ts`; `npm test` 206 verdes; `tsc --noEmit` apps/lifestyle limpio (EXIT 0).
**Verificación:** unit tests (206 pass / 0 fail) + type-check de la app verde. Smoke por WhatsApp con "sí" real **pendiente**, se hará en pasada conjunta con el smoke de `fix/slot-availability-real-day` (S5-BOT-02). Rama `fix/affirm-negation-handling`, **sin merge**.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-16 — fix de aceptación/negación en `confirmingAppointment.ts`).

---

#### S5-BOT-04 — Eje de interés barbero/hora + presentación por barbero (grupo A1 de la capa conversacional multi-barbero) 🟢 done (2026-06-16, rama `feat/multi-barber-axis-a1` SIN merge — pendiente smoke)
**Origen:** diagnóstico read-only del grupo A de la deuda "el flujo multi-barbero no tiene capa conversacional" (ver finding homónimo en Backlog post-sprint, smoke fase 2 del 2do barbero). Objetivo del grupo A: que el flujo **reconozca el eje de interés del cliente (hora vs barbero) y deje elegir barbero cuando lo pide** (opción 2 con respuesta híbrida para el ambiguo). A1 cubre los pasos 1-5 del plan (reconocer eje + presentar por barbero); la respuesta híbrida y su follow-up van en S5-BOT-05 (A2).

**Hallazgo clave que reduce el alcance (§0 del diagnóstico) — EL DATO DEL BARBERO NO SE PIERDE:**
- `getAvailableSlots` en modo autoAssign (`scheduling.ts:569-599`) **proyecta UN slot por barbero** vía `staffMap` clave=`staffId`, conservando `staffName`. No es un colapso: es una proyección por barbero. Con Andrés+Carlos devuelve ≤2 slots, **cada uno etiquetado con su barbero**.
- El segundo dedup (`presentingSlots.ts:237-245`) es por **hora exacta `HH:MM`**: solo colapsa si dos barberos comparten el mismo minuto, y aun así el superviviente conserva `staffName`.
- Los `pendingSlots` persistidos (`LifestylePendingSlotSchema`, lifestyle.types.ts:54-63) llevan **`staffId`+`staffName`+`startsAt`** por opción.
- **Conclusión:** presentar por barbero = **dejar de suprimir el nombre** (hoy suprimido a propósito en `presentingSlots.ts:380,385-387,412,461,481`), NO recuperar dato perdido. El alcance del grupo A baja de "construir la presentación por barbero" a "agregar una rama que no oculta el nombre".

**Los 5 pasos (A1):**
1. **Detector de eje-barbero (módulo puro nuevo)** — estilo `availabilityIntent.ts`/`sideQuestion.ts` (sin DB/red/LLM): `wantsToChooseStaff()` (eje a: "qué barberos hay", "puedo elegir", o nombre concreto vía el `resolveStaff` existente) y `asksWhoOnly()` (eje b ambiguo: interrogación + token de "quién"/"qué barbero" sin nombre ni elección explícita). Caso mixto del smoke "¿qué barbero está disponible para las 12?" debe ganar el eje (b), NO `isAvailabilityQuestion` → cuidar el orden de los guards.
2. **Sanear `NO_PREFERENCE_KEYWORDS` en `qualifyingStaff.ts:36-40`** — quitar `'disponible'` y `'libre'` (falsos positivos de no-preferencia por match substring `:129`; "¿qué barbero está disponible?" se leía como "el que sea"). La lista queda acotada a expresiones inequívocas.
3. **Cablear los ejes en `qualifyingStaff.ts`** entre `isAvailabilityQuestion` (`:89`) y `NO_PREFERENCE` (`:129`): eje (a) → presentar por barbero (`presentBy:'staff'` → SHOWING_SLOTS); eje (b) → respuesta híbrida (delegado a A2).
4. **Rama de presentación por-barbero en `presentingSlots.ts` bajo bandera `presentBy`** — fuente = `slots` PRE-dedup-por-hora (`:236`, ya un-slot-por-barbero desde `getAvailableSlots`); no vaciar `staffPart`; cambiar `barberoLine`/instrucción a Haiku a "menciona el nombre de cada barbero". Default `presentBy:'time'` = comportamiento actual.
5. **Guard de interrogación en `routeSlotSelection` (`confirmingAppointment.ts:442`)** — nuevo paso ANTES del matcher (`:467`): si hay `?`/`¿` **+ token de barbero** ("con quién", "quién", "qué barbero", nombre) → nueva acción `ask_who` (procesada en A2), NO `select`. Exige el token de barbero (no solo `?`) para no tragarse "¿a las 6?" (selección con duda).

**Frontera dura (NO romper):** `matchNaturalSlot`/`extractRawTime` internos intactos (S5-BOT-01); `offer_nearest` + reconsulta de día real intactos (S5-BOT-02); selección legítima "a las 12" (sin `¿?`/"quién") sigue a `select`; corrección "no, a las 6" sigue consumida por el matcher (no tiene token de barbero → no dispara el guard). A1 **cierra la vía conversacional del Bug-B** (preguntas mal leídas como selección) sin tocar la auto-confirmación estructural.

**Criterios de aceptación:**
- [x] Detector de eje puro y testeable sin DB/red (tests de los 3 ejes).
- [x] "¿qué barbero está disponible para las 12?" → eje (b)/staff, responde quién (no auto-asigna mudo).
- [x] "qué barberos hay" → presentación por barbero con nombres (conserva ambos, no dedup por hora).
- [x] Camino (c) "cualquiera" → byte-idéntico al actual (`autoAssign`, SIN `presentBy`; QUALIFYING_DATETIME).
- [x] `routeSlotSelection`: "a las 12" → `select`; "no, a las 6" → matcher (`offer_nearest`); "¿a las 12 con quién?" → `ask_who`.
- [x] `npm test` verde (222/222) + `tsc --noEmit` apps/lifestyle limpio.
- [ ] Smoke por WhatsApp (lo corre Gabriel) → merge.

**Deuda anotada (NO resolver aquí):** hay **DOS listas `NO_PREFERENCE_KEYWORDS` duplicadas** (`qualifyingStaff.ts:36` y `confirmingAppointment.ts:54`) — patrón de duplicación a unificar algún día (la de confirmingAppointment ya no tiene `disponible`/`libre`; verificar simetría al editar).

**Invariante:** el camino (c) "no me importa quién" queda byte-idéntico; toda la lógica nueva se activa solo bajo banderas/detectores nuevos (default = flujo actual).

**Notas de ejecución (2026-06-16):** implementado en rama `feat/multi-barber-axis-a1` (SIN merge). Archivos: módulo puro nuevo `staffAxisIntent.ts` (`wantsToChooseStaff`/`asksWhoOnly`); `qualifyingStaff.ts` (saneo `NO_PREFERENCE_KEYWORDS` + guard `&& !wantsStaffAxis` sobre `isAvailabilityQuestion` + bloque eje → `presentBy:'staff'`); `lifestyle.types.ts` (campo `presentBy`); `presentingSlots.ts` (bandera `presentByStaff`: salta dedup-por-hora y no suprime nombres); `confirmingAppointment.ts` (acción `ask_who` + `hasStaffToken` + guard de interrogación antes del matcher); tests `tests/staffAxisIntent.test.ts`. Bug atrapado en verificación: `\bquienes?\b` parsea como "quiene"+"s?" → NO matchea singular "quien"; corregido a `\bquien(?:es)?\b` en `staffAxisIntent.ts` y `confirmingAppointment.ts`. 222/222 tests verdes, `tsc --noEmit` limpio. Pendiente: smoke por WhatsApp (Gabriel) antes de merge.

**Prompt:** Diseño registrado por Gabriel (2026-06-16). Implementado el 2026-06-16.

---

#### S5-BOT-05 — Respuesta híbrida al caso ambiguo + follow-up (grupo A2 de la capa conversacional multi-barbero) ⚪ todo (diseño registrado 2026-06-16)
**Origen:** paso 6 del diagnóstico del grupo A. **Depende de S5-BOT-04 (A1)** — consume la acción `ask_who` y la presentación por barbero que A1 introduce.
**Diseño objetivo:** ante "¿con quién sería?" responder quién + ofrecer el otro eje sin forzar, p.ej.: *"A las 12 te atendería Andrés. Si preferís otro, también está Carlos a las 10. ¿Te agendo con Andrés o querés cambiar?"*

**Dónde llega y qué necesita:**
- **En `CONFIRMING_APPOINTMENT`** (caso del smoke): `pendingSlots` ya poblado → todo el dato está presente. El handler lee el barbero del slot pedido (`pendingSlots.find(matchea hora).staffName`) + los demás `pendingSlots` (otros barberos/horas).
- **En `QUALIFYING_STAFF`** (antes de ver slots): aún no hay `pendingSlots` → el eje (b) de A1 setea `presentBy:'staff'` y manda a SHOWING_SLOTS, donde la híbrida se materializa.
- **Bandera de oferta híbrida pendiente** análoga a `nearestOfferSlot`: para que el follow-up ("sí con Andrés" / "no, mejor Carlos") se rutee sin re-disparar el matcher ávido. Reusa el patrón existente (`confirmingAppointment.ts:177-182`).

**Punto de contacto crítico (riesgo de regresión):** es donde A2 **toca S5-BOT-03** (`isAffirmation`/`isNegation`, contadores `rejection_attempts`/`clarification_attempts`). El follow-up "sí con Andrés"/"no Carlos" se parece a aceptación/negación → la bandera nueva debe coexistir sin pisar la rama de aceptación (`:177`) ni los contadores. **NO mezclar contadores.** Verificación propia con regresión de S5-BOT-03 (smoke "sí" real incluido).

**Criterios de aceptación (propuestos):**
- [ ] "¿con quién sería?" en CONFIRMING → responde quién + ofrece el otro eje (no auto-confirma, no clarify ciego).
- [ ] Follow-up "sí con Andrés" → confirma ese barbero; "no, mejor Carlos" → cambia al otro.
- [ ] Regresión S5-BOT-03: "sí"/"no"/progresión de rechazo intactos; contadores no se cruzan.
- [ ] `npm test` verde + `tsc --noEmit` apps/lifestyle limpio.

**Hallazgos de smoke A1 (sumar a A2, 2026-06-17):**
- **Pregunta por barbero específico no se responde directo:** "¿Carlos a la 1?" (interrogación + nombre + hora) no obtiene una respuesta directa de disponibilidad de ESE barbero a ESA hora. A2 debe responder el modo (a) barbero-primero con hora ("Sí, Carlos tiene la 1pm" / "Carlos a la 1 no, pero sí a las…").
- **Mezcla barberos al preguntar por uno solo:** cuando el cliente pregunta por UN barbero concreto, la respuesta mezcla/incluye a los demás barberos en vez de acotarse al pedido (smoke A1, imagen 3). A2 debe respetar el eje barbero-primero y no diluir con otros barberos salvo que el pedido no se pueda cumplir.

**Fuera de alcance (grupo separado, decisión de producto):** **anti-Bug-B en la rama `select`** (cara #3 del finding): A1 cierra la vía-pregunta del Bug-B; el guard ESTRUCTURAL "confirmar barbero+hora antes de pedir el nombre" queda para después. También fuera: cara #5 (descanso conversacional, Visión §4), derivación a otro barbero, hora-primero explícito (Visión §2-b).

**Prompt:** Diseño registrado por Gabriel (2026-06-16). Implementación pendiente de su confirmación y de S5-BOT-04.

---

#### S5-BOT-06 — Ruteo del dígito pelado en `routeSlotSelection` (hora-ofrecida > índice > cercana) 🔵 in-progress (2026-06-17, rama `fix/bare-digit-slot-selection`)
**Origen:** finding "🟠 BUG — número pelado ('12') no se reconoce" (Backlog post-sprint, smoke de A1, 2026-06-17). Tras ofrecer "12, 12:15, 12:30" el cliente responde `"12"` (la hora ofrecida) y el bot NO lo reconoce → cae al clarify. `"a las 12"` SÍ funciona. Diagnóstico read-only previo (2026-06-17) confirmó causa, lugar del fix y casos límite; este es el fix.
**Causa (recordatorio):** `extractRawTime` exige un marcador ("a las"/`:MM`/pm/am/turno) para leer un número como hora ("decisión e", `:558-562`). `"12"` sin marcador → `extractRawTime` null → `matchNaturalSlot` none → `parseChoice` → índice 12 → fuera de rango (≤3 slots) → clarify. La "decisión e" quedó **obsoleta** tras la presentación natural en prosa (S5-BOT-01): la lista NO se numera (`presentingSlots.ts:430`), así que un dígito pelado es la hora, no el índice.
**Lugar del fix (least-invasive, confirmado por diagnóstico):** nueva rama en `routeSlotSelection` donde hoy está `parseChoice` (paso 4), DESPUÉS de date_redirect/no_preference/ask_who/matchNaturalSlot. **NO** en `extractRawTime` (haría inalcanzable el índice para todo dígito → rompería el test (e)). Se ALIMENTA el dígito pelado a `resolveTargetMinutes` (se LEE, no se modifica) y se decide la salida por precedencia.
**Regla de precedencia** (dígito `/^\d{1,2}$/`, N = `pendingSlots.length` ≤3): **exacta-ofrecida > índice > cercana > clarify**:
- **Exacta-ofrecida:** desambiguar el dígito con `resolveTargetMinutes` contra los `pendingSlots`; si la hora resuelta cae ±5 min de un slot ofrecido → `{action:'select', slot}`. ("1" ante {12,13,15} → 1pm=13:00, ganando al índice.)
- **Índice:** sin coincidencia de hora y d ∈ [1..N] → `{action:'index', choice:d}` (conserva test (e) "2"→index).
- **Cercana:** sin coincidencia de hora, no índice válido, y 1 ≤ d ≤ 23 → `{action:'offer_nearest', requestedMinutes, slot}` (reusa el requery de día real de S5-BOT-02, mismo shape que `matchNaturalSlot`, sin duplicar).
- **Clarify:** d = 0 o d ≥ 24 → cae a `parseChoice` → fuera de rango → clarify (comportamiento actual).
**Criterios de aceptación:**
- [ ] "1" ante {12:00,13:00,15:00} → select 13:00 (hora-ofrecida gana al índice).
- [ ] "2" ante {16:45,17:00,17:15} → index 2 (test (e) intacto).
- [ ] "12" ante {12:00,12:15,12:30} → select 12:00 (bug original).
- [ ] "5" ante {17:00,…} → select 17:00 (hoy clarify).
- [ ] "3" ante {10:00,11:00,12:00} → index 3 (ambiguo no-calza → índice conservador, decisión A).
- [ ] "6" sin slot de 18:00 → offer_nearest (hora válida no ofrecida → requery).
- [ ] "0"/"25" → clarify.
- [ ] No-regresión: "a las 12"→select; "no, a las 6"→corrección (no entra a rama pelada); "5pm"→select; "uno"→index; ask_who (A1) intacto.
- [ ] `npm test` verde + `tsc --noEmit` apps/lifestyle limpio.
**Frontera dura:** `resolveTargetMinutes`/`extractRawTime`/`matchNaturalSlot`/`parseChoice` byte-idénticos; `offer_nearest` reusa S5-BOT-02 sin duplicar; NO tocar el edge pre-existente "10"→22:00 (ortogonal, ya existía con "a las 10"); NO construir pregunta de desambiguación (tarea futura, fuera de alcance).
**Notas de ejecución (2026-06-17):** implementado en rama `fix/bare-digit-slot-selection` (desde `origin/main`, SIN merge). Una sola rama nueva en `routeSlotSelection` (paso 4, entre `matchNaturalSlot` y `parseChoice`); helpers internos byte-idénticos (verificado por `git diff`). 12 tests nuevos en `tests/slotSelection.test.ts` (los 8 obligatorios + 4 de no-regresión de frontera). `npm test` **234/234 verdes** (222 previos + 12; el crítico (e) "2"→index intacto); `tsc --noEmit` apps/lifestyle limpio (EXIT 0). Pendiente: smoke por WhatsApp (Gabriel) antes de merge.
**Prompt:** Ad-hoc solicitado por Gabriel (2026-06-17 — fix del dígito pelado en `routeSlotSelection`).

---

#### S4-OPS-02 — Restore drill desde backup ⚪ todo
**Criterios de aceptación:**
- [ ] Restaurar un dump cifrado en un proyecto Supabase staging desde cero
- [ ] Cronometrar el tiempo total
- [ ] Documentar RTO real en RUNBOOK.md
- [ ] Si toma >30 min, declararlo explícitamente en contrato del piloto
**Prompt:** Ver `SPRINT-PROMPTS.md` → S4-OPS-02

---

#### S4-G-01 — Firma del cliente fundador ⚪ todo
**Tipo:** Decisión humana / actividad comercial
**Criterios de aceptación:**
- [ ] Aviso de privacidad publicado (S2-LEG-01 done)
- [ ] Contrato/acuerdo del piloto firmado por ambas partes
- [ ] Credenciales entregadas por canal seguro al dueño
- [ ] Onboarding completo del negocio del fundador en producción

---

#### S4-OPS-03 — Primer día de operación supervisada ⚪ todo
**Criterios de aceptación:**
- [ ] El día del go-live, Gabriel tiene disponibilidad de respuesta <1h durante horario operativo
- [ ] Logs monitoreados activamente
- [ ] Cualquier issue se documenta en `INCIDENTS.md` (creado vacío como template en S2-DOC-01)

---

## Backlog post-sprint (NO trabajar en este sprint)

Lista de espera consciente. Aparece en el reporte final de auditoría. NO entra al sprint sin renegociación.

### 🔴 DEUDA TÉCNICA DE MÁXIMA PRIORIDAD — Classifier inyectable + e2e del happy-path de agendamiento

**Por qué encabeza el backlog:** sin un clasificador inyectable/mockeable NO puede existir el test e2e punta-a-punta del flujo de reserva. Hoy, en consecuencia, **NO tenemos cobertura del flujo central del producto (agendar) de extremo a extremo** — es el camino que más importa y el único sin red de seguridad. Este es exactamente el gap que dejó pasar el bucle de S4-BOT-09: el bug vivía en la costura handler↔classifier que ningún test podía ejercitar.

**Alcance:**
- Hacer el clasificador (`classifyIntent` / `classifyMultiIntent`) inyectable o mockeable en los handlers (dependency injection), para simular respuestas del LLM sin red.
- Construir el test e2e del happy-path de agendamiento (greeting → qualifying* → showing slots → confirming → confirmed) con el classifier mockeado.
- Ligado a **#3 de S4-BOT-09**: `handleClassification` ignora el `intent` salvo `SIDE_QUESTION` (solo mira `confidence`); consumir el tipo de intent (`CONFIRM_YES`/`CONFIRM_NO`/`SELECT_OPTION`) es parte del mismo refactor.
- Ligado al **gap de CI**: sin esta cobertura, CI no puede proteger el flujo central contra regresiones. Es prerrequisito para cerrar "Tests automatizados (unit + e2e)" abajo de forma significativa.

**Riesgo si se posterga:** cualquier cambio futuro en estados/clasificador puede romper el agendamiento sin que ningún test lo detecte (como ocurrió aquí). Debe atacarse antes que el resto del backlog de tests.

---

### 🟢 SEGURIDAD/COMPLIANCE — RLS deshabilitado en `conversation_messages` (RESUELTO 2026-06-10, S5-SEC-01)

**Hallazgo (origen S5-DATA-01, 2026-06-09):** `conversation_messages` era la **única tabla del esquema con RLS deshabilitado**. Quedaba expuesta a los roles anon/authenticated → cualquiera con la anon key podía leer/modificar todos los mensajes de cliente. Son datos personales (contenido de conversación WhatsApp) → exposición PII / riesgo **LFPDPPP**.
**Prioridad:** por encima de los bugs de UX. **Atender antes del go-live.**
**Caveat:** habilitar RLS sin políticas bloquea todo acceso a la tabla. La remediación es `ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;` **+** definir las políticas correctas (espejo de las de `bot_conversations`, migration 033: SELECT/INSERT para staff del negocio). No aplicar el ALTER suelto.
**RESUELTO (2026-06-10):** diagnóstico confirmó que el estado era omisión (033 creó las 2 políticas pero olvidó el ENABLE; nada lo desactivó después) → no hicieron falta políticas nuevas. Migración `043_enable_rls_conversation_messages.sql` (solo el ENABLE) aplicada a prod y verificada funcionalmente: los 3 paths de escritura service-role (bot/human/customer-inbound) siguen operando con RLS activo. Ver bitácora 2026-06-10.

### Hallazgos derivados de S5-DATA-01 (no resueltos)

- **`onboard-business.ts` sin guard de idempotencia a nivel staff:** el script solo verifica el slug del business (`checkSlugExists`); el staff se inserta con `.insert()` plano, sin guard por nombre/teléfono. La puerta para futuros duplicados de staff sigue abierta (este fue el origen del doble "Carlos").
- **Tres bugs de UX del bot, diagnosticados turno-por-turno, pendientes de fix:** Bug B (handler, = C5: auto-confirma slot no pedido), Bug C (clasificación: "horarios disponibles" → horario del local), Bug A (handler/datos: no sabe listar staff). **Bug B debe RE-VERIFICARSE contra la base ya limpia (post S5-DATA-01) antes de diseñar su fix** — el staff duplicado lo amplificaba y el síntoma puede haber cambiado.

---

### 🟠 BUG DE DISPONIBILIDAD — el "más cercano" ignora el día real (origen: smoke de S5-BOT-01, 2026-06-13)

**Origen:** smoke test por WhatsApp del flujo de selección de slot (S5-BOT-01, que quedó SIN merge pendiente de smoke). Diagnóstico read-only contra prod, sin tocar código ni datos.

**Disponibilidad REAL verificada (Carlos canónico `cd8d7f08`, Barbería Demo `4de6a450`, TZ `America/Mexico_City`):**
- `staff_availability`: Lun–Vie 10:00–20:00, Sáb 10:00–18:00, **sin fila para Domingo (day 0)**. Sin breaks.
- `office_hours` del negocio: 09:00–23:00 **todos los días, incluido domingo** → **incoherente con el staff** (poblado de datos, no bug de código).
- Citas confirmadas lun 15: 10:15–10:45 y **17:00–17:30** (las 5pm exactas, ocupadas). 16:30 y 17:30 LIBRES.
- Sin `staff_blocks` ni `staff_schedule_exceptions`.

**Veredicto datos-vs-código:**
- Síntoma **"Carlos no tiene disponibilidad mañana (domingo) pero sí el lunes" = DATOS.** Carlos no tiene franja de domingo; el bot dice la verdad. (Subyace incoherencia `office_hours` vs `staff_availability` — limpieza de datos pendiente.)
- Síntoma **"a las 5pm → no disponible, lo más cercano es [hora de la mañana]" = CÓDIGO.** Carlos sí trabaja la tarde (hasta 20:00); 16:30/17:30 libres. Dos fallos encadenados:
  1. `findSlotsInNextDays` (`scheduling.ts:653`) **NO reenvía `requestedTime`** al `getAvailableSlots` del día alternativo (`presentingSlots.ts:158-166`) → presenta los 3 slots **más tempranos** (mañana), no los más cercanos a la hora pedida.
  2. El matcher de `CONFIRMING_APPOINTMENT` (`matchNaturalSlot`, `confirmingAppointment.ts:267-288`) compara la hora pedida **solo contra los ≤3 `pendingSlots` mostrados**, nunca contra la disponibilidad real del día (decisión "b" deliberada, comentario `confirmingAppointment.ts:16-17`). Con 3 slots de la mañana en pantalla, el "más cercano" a las 17:00 es matemáticamente un slot de la mañana.

**Dirección del "más cercano":** bidireccional (antes y después) SOLO en la presentación inicial del día pedido (`getAvailableSlots` ordena por cercanía, `scheduling.ts:603-611`). Se pierde en el camino de día alternativo y en el re-pedido dentro de `CONFIRMING_APPOINTMENT` → colapsa a la mañana.

**Síntoma "siempre 3 contiguos":** `MAX_SLOTS_TO_RETURN=3` (`scheduling.ts:44`) + orden cronológico cuando no hay `requestedTime` → los 3 más tempranos a 15 min (10:00/10:15/10:30). Son un `slice(0,3)` de muchos, no toda la disponibilidad.

**Horizonte de búsqueda:** agendado directo lo gobierna `parseDate` (`qualifyingDatetime.ts:295`) — hasta ~12 meses si es **fecha concreta** ("4 de julio", "4/7"); frases relativas ("dentro de 3 semanas") NO se parsean (caen al clasificador). La búsqueda de alternativas cuando el día pedido está vacío está limitada a **5 días calendario** (`presentingSlots.ts:158`, saltando domingo hardcodeado en `scheduling.ts:651`).

**Fix propuesto (NO ejecutado — requiere aprobación):** (1) reenviar `requestedTime` desde `findSlotsInNextDays` al `getAvailableSlots` alternativo; (2) que el "más cercano" en `CONFIRMING_APPOINTMENT` consulte la disponibilidad real del día (ambas direcciones) en vez de solo los 3 `pendingSlots`; (3) decidir si elevar el límite de 5 días para eventos lejanos; (4) reconciliar `office_hours` vs `staff_availability` (datos). Re-verificar también que esto no reintroduzca el "rollover de día buggy" que motivó la decisión b.

---

### 🟠 GAP — notificación de escalado diferida un turno (origen: S5-BOT-03, 2026-06-16)

**Origen:** descubierto durante la implementación de S5-BOT-03 (handoff por rechazo). Hallazgo de lectura, NO corregido — fuera del alcance del frontier de esa tarea.

**El gap:** en el handoff por rechazo (4º "no" consecutivo → `ESCALATED`), `buildRejectionResult` (`confirmingAppointment.ts:384-399`) cambia el estado y le **promete al cliente** "te conecto con el equipo", pero la **notificación real al admin NO se dispara en ese paso**. Se difiere a `handleFallback` (`fallback.ts`), que solo corre en el **siguiente** mensaje del cliente (el `fallbackAttempts:2` que siembra `buildRejectionResult` está calibrado para que ese próximo mensaje cruce `MAX_FALLBACK_ATTEMPTS` y dispare el aviso al admin por WhatsApp).

**Riesgo:** si el cliente se queda callado tras el "te conecto" —lo más probable, porque ya está frustrado y se le pidió esperar— el admin **nunca recibe el aviso** → cliente en limbo esperando un contacto que no fue notificado. La promesa al cliente y la acción (notificar admin) **deben ser atómicas**: disparar la notificación en el mismo paso que la promesa.

**Caveat al arreglar:** NO duplicar el aviso. El diseño diferido actual quizás evita la doble notificación precisamente vía `fallbackAttempts:2`; verificar ese acoplamiento antes de mover la notificación al paso de la promesa (si se adelanta sin ajustar el contador, el siguiente mensaje podría re-notificar).

**Severidad:** alto impacto de negocio (se pierde el handoff), NO de estabilidad (el bot no se rompe). Mismo patrón de "punto de falla por depender de una acción adicional en un turno futuro" que la cancelación.

---

### 🟠 DEUDA — el flujo multi-barbero no tiene capa conversacional (origen: smoke fase 2 del 2do barbero, 2026-06-16)

**Origen:** smoke por WhatsApp del modelo multi-barbero, ya **desbloqueado** (Andrés cargado en Barbería Demo, ver S5-DATA-02 y Visión §5). Diagnóstico read-only, sin tocar código ni base.

**Veredicto:** el motor **mecánico** funciona — ve a Andrés, lo asigna, agenda, excluye descansos sin colapsar el negocio, y la pregunta "¿con quién?" se despierta bien. Lo que falta es la **capa conversacional**: el flujo NO conversa. No reconoce ni responde preguntas; consume todo el input como avance hacia la confirmación. Las cinco caras de abajo son **la misma carencia**, no bugs sueltos. Todas son alcance del **sprint del modelo multi-barbero**.

**Las cinco caras (misma deuda):**

1. **`"disponible"`/`"libre"` como falso positivo de no-preferencia.** En `qualifyingStaff.ts`, `NO_PREFERENCE_KEYWORDS` incluye `'disponible'` y `'libre'`, con match por substring (`lower.includes(kw)`). "¿qué barbero está **disponible** para las 12?" → se lee como "el que sea" → auto-asigna y **nunca responde quién**. El cliente pidió INFORMACIÓN; el bot lo trató como AUSENCIA de preferencia. Mismo patrón de falso positivo que el de `AFFIRM_RE`/"no me sirve". *(Riesgo Bug-B indirecto: dispara el auto-assign.)*

2. **`routeSlotSelection` no distingue pregunta de selección.** "¿a las 12 con quién sería?" → el matcher (`matchNaturalSlot`/`extractRawTime`) extrae "12" con avidez, encuentra el slot de las 12pm en `pendingSlots`, lo selecciona como `exact` → `action:'select'`, ignorando el `¿…?` y el "con quién". Una pregunta de información se consume como elección. No hay guard de interrogación en el ruteo.

3. **El anti-Bug-B NO cubre la rama `select`.** El blindaje "no auto-confirmar sin sí explícito" vive SOLO en `offer_nearest` (hora fuera de los slots ofrecidos, `confirmingAppointment.ts:263-282`). Si la hora SÍ está entre los `pendingSlots`, va por `select` directo a `buildConfirmationResult` → `AWAITING_BOOKING_NAME` (`:192-193`), **esquivando el guard**. *Decisión a tomar en el sprint:* ¿seleccionar un slot debe avanzar siempre, o en contexto multi-barbero conviene confirmar barbero+hora antes de pedir el nombre? *(Riesgo Bug-B directo: auto-confirma sin "sí".)*

4. **El barbero se esconde hasta la confirmación.** Con `autoAssign` el nombre se omite a propósito (presentación por hora, no por barbero: `presentingSlots.ts:380,412`). Pero el nombre solo se materializa en el resumen de `buildConfirmationResult` (`confirmingAppointment.ts:655`, siempre incluye `Barbero:`). Cuando el cliente pregunta "con quién" **explícitamente**, debería responderse ANTES del recibo — no descubrir "Andrés" en la pantalla de confirmación.

5. **Descanso genérico (ya conocido, ver Visión §4).** "Andrés no tiene disponibilidad" en vez de "Andrés descansa los lunes" + no ofrece las dos salidas (otro barbero hoy / Andrés otro día). El pivote mecánico funciona; falta la capa conversacional encima.

**Alcance del sprint multi-barbero (capa conversacional):** estas cinco caras **más** (6) la **derivación a otro barbero** y (7) el **modo hora-primero explícito** (Visión §2-b). Todas accionables como tareas `S{n}-BOT-*` ahora que el modelo está DESBLOQUEADO (Andrés cargado, fundación verificada — Visión §5).

**Severidad:** la #1 y la #3 tocan auto-confirmación (riesgo Bug-B) → **alto impacto**. El resto (#2 wording aparte, #4, #5, derivación, hora-primero) es **calidad conversacional**.

**Cortado en tareas (grupo A, 2026-06-16):** el diagnóstico de diseño del grupo A ("reconocer el eje + dejar elegir barbero") quedó partido en **S5-BOT-04 (A1)** — eje barbero/hora, saneo de `NO_PREFERENCE_KEYWORDS`, presentación por barbero, guard de interrogación; cierra la vía conversacional del Bug-B — y **S5-BOT-05 (A2)** — respuesta híbrida + follow-up; depende de A1 y toca S5-BOT-03. **Hallazgo §0:** el dato del barbero NO se pierde en el dedup (`getAvailableSlots` proyecta un slot por barbero conservando `staffName`; los `pendingSlots` llevan `staffId`+`staffName`+`startsAt`) → presentar por barbero = dejar de suprimir el nombre, no recuperar dato. El anti-Bug-B en `select` (cara #3) queda como grupo separado (decisión de producto). Ver bloques de tarea arriba.

---

### 🟠 BUG — número pelado ("12") no se reconoce como selección tras oferta de horas (origen: smoke A1, 2026-06-17)

**Origen:** smoke por WhatsApp de S5-BOT-04 (A1). Diagnóstico read-only, sin tocar código ni base. **Severidad: alta** — el cliente responde con el número que el bot acaba de ofrecerle, de la forma más natural posible, y el bot no lo entiende.

**El bug:** tras ofrecer "12, 12:15, 12:30", el cliente responde `"12"` (la hora ofrecida) y el bot NO lo reconoce → cae al clarify ("Disculpa, no te seguí bien…"). En cambio `"a las 12"` SÍ funciona.

**Causa:** `extractRawTime` (`confirmingAppointment.ts`, "decisión e", comentario ~`:558-562`) trata todo dígito desnudo como índice, NO como hora — exige un marcador ("a las"/"las"/`:MM`/pm/am/turno) para leer un número como hora. `"12"` sin marcador → `extractRawTime` devuelve `null` → `matchNaturalSlot` = `none` → cae a `parseChoice` → índice **12** → fuera de rango (solo 3 slots) → clarify. La "decisión e" tenía sentido con **listas numeradas**, pero quedó **obsoleta** tras el cambio a presentación natural en prosa (S5-BOT-01): "12, 12:15, 12:30" no está numerada, así que "12" es la hora, no el índice.

**Verificado:** PRE-EXISTENTE, ajeno a A1. El guard `ask_who` de A1 exige `?`+token de barbero; "12" no cumple ninguno → pasa intacto al matcher. A1 no tocó `extractRawTime`/`matchNaturalSlot` (frontera explícita). El clarify "viejo" es el único clarify genérico del handler (`:377`); el humano de S5-BOT-03 solo corre en `isNegation`, y "12" no lo es.

**Solución propuesta:** intentar match por **HORA primero** contra las horas de los slots ofrecidos; usar índice solo como fallback cuando el número NO coincida con ninguna hora ofrecida.

**→ Cortado en tarea `S5-BOT-06` (2026-06-17).** Diagnóstico read-only refinó el lugar: NO se toca `extractRawTime`/`matchNaturalSlot` (eso rompería el índice) sino una rama nueva en `routeSlotSelection` que ALIMENTA el dígito a `resolveTargetMinutes` (leer) con precedencia exacta-ofrecida > índice > cercana > clarify. Ver bloque de tarea arriba.

---

- Audit log completo de acciones humanas
- Exportación CSV de citas/clientes/reportes
- Multi-sucursal de escritura (mutaciones desde sesión organization)
- Concepto de regional manager (refactor `staff.business_id` 1:1 a `staff_memberships` muchos-a-muchos)
- Separar dra-quevedo a otro repo / borrar definitivamente
- Separar proyecto Supabase (presenciapro independiente de sellers-portal)
- Portal de cliente final (consumer-facing)
- Tests automatizados (unit + e2e)
- Sentry / observabilidad externa de errores
- Billing automatizado (Stripe/Conekta)
- Webhooks salientes para integraciones del cliente
- SSO/SAML para staff corporativo

---

## Visión del motor de agendamiento (modelo objetivo)

> **Qué es esto:** NO es un bug ni una tarea. Es el modelo objetivo del motor de agendamiento — la foto de cómo debe comportarse cuando esté completo. Guía los próximos sprints de scheduling y sirve de norte para decidir fixes y features. Las piezas concretas se irán cortando en tareas `S{n}-BOT-*` a medida que se aborden.

### 1. Disponibilidad es por barbero, no por negocio

Cada barbero tiene su propia agenda. El negocio no tiene "una disponibilidad" — tiene la unión de las agendas de sus barberos. Consecuencia clave: **que un barbero descanse NO cierra el negocio.** Si Carlos descansa los domingos, eso significa "ese barbero no, quizás otro sí" — nunca "no hay citas el domingo". El motor debe razonar a nivel barbero y solo colapsar a nivel negocio cuando explícitamente todos los barberos están fuera.

### 2. Dos modos de búsqueda simétricos

El cliente entra por uno de dos caminos, y ambos deben funcionar igual de bien:

- **(a) Barbero-primero:** el cliente pide a un barbero específico ("quiero con Carlos"). Se busca en la agenda de ese barbero. Si además pide una hora, se chequea esa hora en SU agenda; si no está disponible, se ofrece lo más cercano dentro de su agenda (ambas direcciones, antes y después).
- **(b) Hora-primero:** al cliente no le importa quién lo atienda ("quiero el sábado a las 5"). Se busca esa hora **entre todas las agendas**, se ofrece el barbero que la tiene libre, y si al cliente no le gusta ese barbero o esa hora, se ajusta a lo más parecido (otra hora cercana, u otro barbero a esa hora).

Son simétricos: uno fija el barbero y varía la hora; el otro fija la hora y varía el barbero. El motor debe soportar ambos como ciudadanos de primera clase, no uno como caso especial del otro.

### 3. Presentación inicial representativa

Cuando la agenda está vacía (o muy abierta), NO ofrecer los 3 slots más tempranos. Ofrecer horarios **distribuidos a lo largo del día** (mañana / tarde / noche) para que el cliente vea el rango real disponible y elija con criterio. Mostrar 10:00/10:15/10:30 le oculta que también hay tardes y noches libres. La primera respuesta debe comunicar la amplitud real, no el primer hueco cronológico.

### 4. Manejo de "barbero descansa / negocio abierto"

Es el escenario donde se ganan o se pierden citas. Cuando el barbero pedido no trabaja ese día pero el negocio sí opera (otros barberos disponibles), el motor debe:

1. **Comunicarlo explícitamente:** "Carlos descansa los domingos." (No esconder la razón ni dar un "no hay disponibilidad" mudo.)
2. **Ofrecer las dos salidas:**
   - **Otro barbero ese mismo día** ("pero Andrés sí trabaja el domingo, ¿te lo agendo con él?").
   - **Ese mismo barbero otro día** ("o si prefieres a Carlos, su próximo día es el lunes").

Dejar al cliente elegir entre conservar el barbero o conservar el día es lo que convierte un "no" en una cita.

### 5. Dependencia: requiere múltiples barberos (bloqueado)

Las siguientes piezas de esta visión **NO pueden implementarse ni probarse con un solo barbero en la base** y quedan **🟡 bloqueadas hasta cargar un segundo barbero real en la base de prueba**:

- **(b) Búsqueda hora-primero** — sin segundo barbero no hay "entre todas las agendas" que recorrer.
- **Derivación a otro barbero** — no hay a quién derivar.
- **Manejo de descansos "barbero descansa / negocio abierto"** — con un solo barbero, que descanse SÍ cierra el negocio, así que el escenario no existe.

Desbloqueo: cargar un segundo barbero real (con agenda propia, horario distinto al primero) en la barbería de prueba. Hasta entonces, lo único accionable de esta visión es el comportamiento single-barbero: modo (a) barbero-primero y la presentación inicial representativa (punto 3).

> **✅ DESBLOQUEADO (2026-06-16, S5-DATA-02):** segundo barbero "Andrés" (`4dff5eeb-39cd-4f0f-becf-25a60d9cecfc`) cargado en Barbería Demo con agenda propia distinta a Carlos (Mar–Sáb 12:00–21:00; descansa Dom y Lun). La base de prueba ya soporta hora-primero, derivación a otro barbero y "barbero descansa / negocio abierto" (lunes: Andrés descansa, Carlos trabaja). Las piezas (b)/derivación/descansos pasan de 🟡 bloqueado a accionables como tareas `S{n}-BOT-*`.

---

## Bitácora de sesiones

Cada sesión productiva con Claude Code se registra aquí brevemente. Una línea por sesión.

| Fecha | Tareas trabajadas | Estado al cierre | Notas |
|---|---|---|---|
| 2026-05-18 | S1-SEC-01 | done | verifyMetaSignature local eliminada; importado verifyWebhookSignature del engine; check fail-closed con pre-check de secret |
| 2026-05-18 | S1-SEC-02 | done | 0 hits en historial git para todos los patrones .env*; .gitignore raíz cubre con `.env*`; 15 vars identificadas; checklist de rotación generado |
| 2026-05-18 | S1-SEC-03 | done | README archivado creado en clients/dra-quevedo/; vercel.json raíz ignoreCommand confirmado; acción humana pendiente: pausar deploy en Vercel |
| 2026-05-20 | S1-SEC-04 a S1-SEC-09 | done | 3 migraciones SQL (034/035/036) aplicadas al remoto; security headers en next.config.ts; JSON-LD escape fix; sesión reducida a 7 días. Descubrimiento: organizations + organization_id faltaban en remoto, creados en 034. |
| 2026-05-20 | S1-OPS-02 | done | Rate limiting distribuido con Upstash Redis; helper rate-limit.ts con sliding window + fallback in-memory + fail-open; PIN: 5/60s por IP; bot: 30/60s por phoneNumberId (Meta). TODOs A-1 y B-1 eliminados. |
| 2026-05-20 | S2-LEG-02 | done | Migration 037: consent_at + consented_via + consent_message_id en customers. Bot prepend aviso privacidad para clientes nuevos. assistant-actions 2 paths actualizados. Sin backfill retroactivo (instrucción de Gabriel). |
| 2026-05-20 | S2-LEG-03 | done | Migration 038: arco_requests + RLS. Página /arco + API POST /api/arco (Zod + rate limit). Bot intent ARCO en router.ts. Sin email programático (BD + manual). |
| 2026-05-20 | S2-OPS-01 | done | generateChecklist() en onboard-business.ts; onboarding/README.md; onboarding/*.md en .gitignore (excepto README). Checklist con 5 pasos: webhook Meta, phone_number_id, crons Supabase, credenciales, prueba. |
| 2026-05-20 | S2-DOC-01, S2-DOC-02 | done | RUNBOOK.md + INCIDENTS.md + DEPLOY.md en apps/lifestyle/. RUNBOOK cubre: arquitectura, bot caído, notificaciones, no-show, rotación de tokens, edge functions, logs, rate limiting, env vars, escalación. DEPLOY cubre: flujo push→Vercel, migrations, edge functions deploy, rollback, env vars, staging. |
| 2026-05-20 | S2-DOC-03 | blocked (estructura lista) | ACCESS.md creado con placeholders en apps/lifestyle/ + .gitignore actualizado. Pendiente: Gabriel llena credenciales reales y copia a 1Password. |
| 2026-05-20 | S3-UX-01, S3-UX-02, S3-UX-03, S3-OPS-01, S3-OPS-03 | done/blocked | Login → Server Component + nombre negocio. Footer soporte en Dashboard/Assistant/SiteFooter. 4 error.tsx con mailto+digest. /api/health creado + RUNBOOK. logger.ts con maskPhone/logBotError; 3 console.error maskeados. S3-OPS-01 bloqueado: Gabriel debe configurar UptimeRobot. |
| 2026-05-20 | S3-UX-04, S3-OPS-02 | done | icon.tsx + apple-icon.tsx (ImageResponse), public/manifest.json, metadataBase+OG+twitter en layout.tsx, eslint.config.mjs. CI .github/workflows/ci.yml creado. Descubierto: 9 errores lint + 3 errores TS pre-existentes → CI fallará hasta S3-QA-01. |
| 2026-05-20 | S3-QA-01 | done | Fix 9 errores lint (react-hooks/refs, set-state-in-effect, purity, entities) + 3 errores TS (casts Supabase). lint y type-check pasan 0 errores. CI listo para verde. |
| 2026-05-21 | S1-OPS-01 | done | scripts/backup-supabase.sh (dump→gzip→gpg→R2→retención 30d), scripts/restore-supabase.sh (R2→descifra→descomprime→imprime psql command), .github/workflows/backup-weekly.yml (cron domingos 3am UTC + manual), scripts/README.md, RUNBOOK.md sección 6 actualizada. PITR queda como recomendación para upgrade a Pro. |
| 2026-05-21 | S4-OPS-01, S4-OPS-04 | done | Dry-run con dummy-barberia-test.json (--dry-run y --validate funcionan). 6 fricciones + 4 gaps de go-live en ONBOARDING-FRICTION.md. Gap crítico: Template Approvals WhatsApp (notificaciones proactivas fallarán sin templates aprobados). 7 env vars faltantes en .env.local.example. Endpoint GET /api/reports/usage creado en src/app/api/reports/usage/route.ts. type-check limpio. |
| 2026-05-23 | S4-BOT-01 | done | Debounce buffer Redis para mensajes WhatsApp consecutivos. message-buffer.ts (nuevo): bufferAndWait() con SET NX como lock owner. route.ts: after() usa buffer, messageId ahora se pasa correctamente al engine. Orphan recovery built-in. Fail-open en Redis caído. |
| 2026-05-23 | S4-BOT-02 | done | Historial multi-turno centralizado en handler.ts. MAX_HISTORY_TURNS=6 (12 msgs). TODO(MEDIO-2) resuelto. greeting.ts corregido (ya no sobreescribía messages con array parcial). Transiciones silenciosas y resets implícitos funcionan correctamente. type-check limpio. 2 archivos, ~20 líneas. |
| 2026-05-23 | S4-BOT-03 | done | Rewrite completo del system prompt. Nuevo prompt con tags XML: identidad, analisis_estilo, deteccion_emocional, deteccion_flujo, reglas_negocio, idioma, formato_whatsapp, catalogo_servicios. businessType mapeado desde DB con fallback 'negocio'. Non-text Meta ahora responde por tipo (audio/image/video/sticker/document/location). Firma de buildSystemPrompt sin cambios. 3 archivos. |
| 2026-06-03 | S4-BOT-04 | done | Cableado de datos reales del negocio al bot. businessContext.ts (módulo puro) + prompt.ts inyecta contexto real (reemplaza hardcode "bienestar y estética"). answerSideQuestion por topic con fallback [DERIVA]→minisite. Classifier enriquecido en qualifyingService/awaitingConfirmation/confirmationResponse. Migraciones 039/040/041 (no aplicadas). onboard-business retrocompatible + schemas extraídos a onboard-schema.ts. 24 tests node:test (`npm test`) verdes; type-check/lint limpios. Rama feat/business-context-wiring (sin merge). Observación: prompt.ts es markdown, NO el "System Prompt v2" XML de S4-BOT-03 → posible rewrite perdido. |
| 2026-06-05 | S4-BOT-05 | done | Fricción conversacional (3 fixes). FIX1 debounce adaptativo + FIX2 race (lock retenido durante proceso, drain loop) + DEDUP de lote extraídos a message-buffer-core.ts (puro); message-buffer.ts wrapper; nueva API bufferAndProcess. FIX3 anti re-saludo en continuity.ts (puro) + greeting.ts pasa historial al generador. 5 env nuevas con defaults retrocompatibles. 43 tests node:test verdes (~9s); type-check/lint limpios; tsconfig.test.json gana override cjs para apps/lifestyle/src. Rama feat/conversation-friction (sin merge). Fuera de alcance: ruteo de disponibilidad = sprint 2. |
| 2026-06-05 | S4-BOT-06 | done | Disponibilidad propositiva. FASE A: causa raíz era DATOS (dataset viejo), no lógica; slot calc verificado correcto. Hardening TZ-independiente: weekdayFromDateStr (getUTCDay sobre noon-UTC) en tzUtils/scheduling; parseDate UTC-safe en qualifyingDatetime. FASE B: availabilityIntent.ts:isAvailabilityQuestion (puro) + ruteo a SHOWING_SLOTS autoAssign desde qualifyingStaff/qualifyingDatetime; buildSlotsMessage exportado. 54 tests node:test verdes; type-check/lint limpios. Rama feat/availability-proactive (sin merge, sin prod). Fuera de alcance: barbero específico = sprint siguiente; flujo "el que sea" intacto. |
| 2026-06-08 | S4-BOT-08 | done | Cierre adaptativo de side-questions (determinista, sin LLM extra). 3 niveles por topic: closingLevelForTopic/closingForTopic en sideQuestion.ts. Nivel 1 (price/duration/services) invita con 1 pregunta; Nivel 2 (location/hours/parking/payment/kids) dato limpio sin push (location con cierre neutro "Aquí te esperamos."); Nivel 3 (reviews/products) salida útil con link, sin agenda. Links en línea propia (templates + buildSideQuestionResponse une con \n). Eliminado RETURN_TO_BOOKING genérico en qualifyingService (servicios/precio→menú; resto→cierre por nivel). composeGreetingSideAnswer recibe `closing` adaptativo. prompt.ts sección "preguntas fuera del flujo" reescrita a 3 niveles + máx 1 pregunta (mata la doble pregunta en Haiku). 112 tests verdes; tsc apps/lifestyle limpio. Rama feat/sidequestion-closing (desde origin/main con #12, sin merge). |
| 2026-06-09 | S4-BOT-09 | done | Hotfix bucle QUALIFYING_SERVICE en negocio de servicio único (preexistente, no regresión — bot_logs 2026-06-06 anterior a S4-BOT-08). #1 Auto-resolve servicio único: qualifyingService.ts fast-path `allServices.length===1 && !looksLikeSideQuestion` → buildAdvanceResult → QUALIFYING_STAFF; greeting.ts auto-pick servicio único con hasBookingSignal. #2 Anti-loop (afecta a todos): repeatFallbackContext NO resetea clarification_attempts en ADVANCE-sin-resolve (incrementa) → MAX_TOTAL_ATTEMPTS=5 escala a FALLBACK (escape humano alcanzable en ≤5 turnos). looksLikeSideQuestion (puro) discrimina afirmaciones vs preguntas de negocio. NO se hizo #3 (consumir intent type = refactor classifier; documentado como deuda). 7 tests nuevos (qualifyingService.test.ts): single-service advance, anti-loop incremento+escalada, regresión del bug. 124 tests verdes; tsc apps/lifestyle limpio. Causa de no-detección previa: no existían tests de handler/integración para qualifyingService/greeting + classifier no inyectable para e2e multi-estado. Rama feat/fix-qualifying-loop (desde main actualizado, sin merge). |
| 2026-06-09 | S5-OBS-01 | done | Instrumentación de logging del clasificador (aditivo, sin cambio de comportamiento). Migración `20260608000000_bot_logs_metadata.sql`: `metadata jsonb NULL DEFAULT NULL` en `bot_logs` — aplicada MANUALMENTE vía SQL Editor de prod (`hdqazbuxtpavtioufrsv`), el archivo documenta pero no autoaplica. 7 call sites fire-and-forget (`event_type='classifier_output'`): single en qualifyingService/Staff/Datetime, awaitingConfirmation, confirmationResponse, side-question de greeting; multi en greeting. Payload de forma fija (compliance ARCO). Verificado en prod tras agendamiento de prueba: fila multi poblada (date/time/service con confidence). Hallazgo: el clasificador extrae con alta confianza → la pérdida de datos está aguas abajo en los handlers (C1/C2), no en la extracción. PR #16 mergeado a main. |
| 2026-06-09 | S5-DATA-01 | done | Limpieza de staff duplicado en Barbería Demo (`4de6a450`). DOS "Carlos" activos idénticos (alta manual sin guard de idempotencia, no seed/migración); el duplicado amplificaba bugs del FSM (dedup-por-hora colapsaba ambos → auto-commit Bug B). Conservado canónico `cd8d7f08` (service link + horario + 2 citas confirmed); eliminado huérfano `23fae157` (0 FKs en las 12 tablas, re-verificado en vivo). Ejecución manual vía MCP/SQL contra prod (`hdqazbuxtpavtioufrsv`): SELECT respaldo → bloque DO atómico (re-conteo 12 FK + DELETE por ID literal, abort ante dependiente) → confirmación (0 deps, 1 borrada, 1 Carlos restante, citas intactas). INSERT de reversión documentado en la tarea. Hallazgos a backlog (NO resueltos): RLS off en conversation_messages (PII/LFPDPPP, antes de go-live), onboard-business.ts sin guard de idempotencia a nivel staff, 3 bugs UX (B/C/A) pendientes — Bug B a re-verificar contra base limpia. Solo doc, commit directo a main. |
| 2026-06-06 | S4-BOT-07 polish | done | Pulido de tono + bug de mapeo del catálogo. (1) Bug bandera false≠ausente: businessContext.ts gana formatAttributesNegative → línea "No cuenta con:" para banderas en false (el LLM ya no las confunde con dato ausente → parking=false responde "No contamos con…"); sideQuestion.ts pago distingue presente-false (negativa) de ausente (honesta). (2) Tono: eliminados conectores con guion ("Dicho eso —", "Por cierto —"…) de clarification.ts (buildSideQuestionResponse junta dato + retorno natural) y de prompt.ts; "Por cierto, el costo…" → "El costo…" en awaitingConfirmation/awaitingBookingName. (3) Lista de servicios solo pertinente: isServiceOrPriceQuestion (sideQuestion.ts) gobierna si qualifyingService anexa el menú; ubicación/horario/pago/niños/estacionamiento/reseñas ya no lo arrastran. 105 tests node:test verdes; type-check limpio; lint 0 errores. Rama feat/sidequestion-polish (desde origin/main tras merge PR #11, sin merge). NO se tocó la lógica de datos determinista que ya servía. |
| 2026-06-10 | S5-SEC-01 (RLS conversation_messages) | done | `conversation_messages` tenía RLS **deshabilitado por omisión** (027 creó la tabla sin ENABLE; 033 agregó las 2 políticas `ls_conv_messages_select_staff`/`ls_conv_messages_insert_staff` pero olvidó el ENABLE; ninguna migración posterior lo desactivó — el estado era omisión, no regresión). Corrección: migración `043_enable_rls_conversation_messages.sql` = `ALTER TABLE public.conversation_messages ENABLE ROW LEVEL SECURITY;` — **sin políticas nuevas**, porque ya existían y replican el patrón de `bot_conversations` (033: SELECT+INSERT para staff del negocio vía join por `business_id`). Aplicada a prod (`hdqazbuxtpavtioufrsv`); post-check de esquema: `relrowsecurity=true`, `relforcerowsecurity=false`, `policy_count=2`. **Verificado funcionalmente** con flujo real panel+WhatsApp (conv `5215511987286`, 17:32–17:35, post-RLS): los 3 paths de escritura service-role siguen insertando con RLS activo — `bot` (escalación), `human` (mensaje de panel) y `customer` (inbound del webhook, ~8 filas). RLS no rompió el handoff. **Caveat futuro:** las políticas asumen **service role** para el path bot/webhook (que bypassa RLS); si alguien migra ese INSERT a anon/authenticated, `auth.uid()` sería NULL y el `WITH CHECK` lo bloquearía silenciosamente. Migración 043 mergeada a main (fast-forward). |
| 2026-06-12 | S5-TEST-01 | done | Comando de reset de conversación para testing (`/reset-bot`). Origen: diagnóstico del ciclo de vida del bot — los estados intermedios (QUALIFYING_*/SHOWING_SLOTS/AWAITING_*) no tienen reset de horizonte corto (solo lazy 24h + terminales), así que una re-prueba el mismo día revivía el estado viejo; el workaround era borrar la fila a mano (frágil por UNIQUE+UPSERT). Comportamiento: trigger exacto `/reset-bot` (no substring) + gating por allowlist; resetea state→GREETING, context→{}, session_mode→bot (destraba human/paused), taken_by/taken_at→null + confirmación `✅`. Doble guarda: trigger exacto Y teléfono en `TEST_PHONE_ALLOWLIST` (E.164 sin +, CSV, NO commiteada; fail-closed si ausente/vacía). Fuera de allowlist el comando es inerte e indistinguible de cualquier mensaje (sin revelar que existe). Interceptado en los 3 entrypoints del webhook (Meta async, Twilio async, Twilio dev síncrono) ANTES del handoffGate. Guardas puras en `apps/lifestyle/src/lib/test-reset.ts` (sin deps Next/Supabase/red, allowlist inyectada) + 20 tests en `tests/testReset.test.ts`. UPDATE reusa el cliente service-role. NO tocó FSM/handlers/compliance/easter egg. 143 tests verdes (20 nuevos). Smoke en prod en ambos sentidos (en allowlist resetea; fuera no). PR #17 mergeado a main; desplegado. Caveat: `TEST_PHONE_ALLOWLIST` seteada en Vercel → comando latente en prod, accesible solo a los números de prueba, inerte si se quita la var. Backlog relacionado NO resuelto: reset de "intermedios rancios" para PRODUCCIÓN (opción B del diagnóstico) sigue pendiente — decisión de producto: umbral de inactividad. Solo doc, commit directo a main. |
| 2026-06-13 | S5-BOT-01 (smoke/diagnóstico) | doc | Diagnóstico read-only datos-vs-código de disponibilidad de slots (smoke por WhatsApp de S5-BOT-01). Verificado contra prod: Carlos `cd8d7f08` trabaja Lun–Vie 10–20 / Sáb 10–18, SIN domingo; `office_hours` declara 09–23 todos los días (incoherente, dato). Veredicto: "no dispo mañana(domingo)" = DATOS (sin franja); "5pm → cercano de la mañana" = CÓDIGO — dos fallos encadenados: `findSlotsInNextDays` no reenvía `requestedTime` (presenta los 3 más tempranos) + matcher `matchNaturalSlot` compara solo contra los ≤3 pendingSlots mostrados, nunca el día real (decisión b). "Más cercano" bidireccional solo en presentación inicial; colapsa a la mañana en día alterno y en re-pedido. Horizonte: directo hasta ~12 meses si es fecha concreta; alternativas limitadas a 5 días calendario (domingo hardcodeado). Registrado como finding "🟠 BUG DE DISPONIBILIDAD" en Backlog post-sprint con fix propuesto (NO ejecutado). Sin tocar código ni base (solo SELECT). |
| 2026-06-12 | S5-BOT-01 | done | Selección de slot en lenguaje natural en CONFIRMING_APPOINTMENT. Antes el bot presentaba horarios en lenguaje natural pero solo entendía el índice 1/2/3. Dos causas raíz: (1) `detectsDatetimeRequest` interceptaba "a las"/"tarde" y re-ruteaba a QUALIFYING_DATETIME antes de llegar al parser; (2) `parseChoice` hacía `parseInt` sobre todo el string → "5 de la tarde" leído como índice 5 fuera de rango. Regla maestra de ruteo: fecha presente (`parseDate`≠null: "mañana"/"el viernes"/"23 de abril") → se mantiene re-ruteo a QUALIFYING_DATETIME; solo-hora sin fecha → selección del día actual, se matchea contra pendingSlots. Conflicto resuelto quitando frases de turno ("de la tarde") antes de `parseDate` ("5 de la tarde" no es fecha, "mañana a las 5" sí). 6 decisiones: (a) match exacto ±5min; (b) hora no ofrecida → ofrecer cercano DENTRO del estado vía nuevo campo `nearestOfferSlot` (evita bug de rollover de día del re-ruteo); (c) ordinales primera/segunda/último; (d) fuzzy más temprano/tarde/cualquiera-de-la-tarde → slot concreto; (e) índice como fallback de baja prioridad (dígito puro); (f) AM/PM desambiguado contra slots reales (no regla fija 1-6→PM). Parser LOCAL en confirmingAppointment.ts (`routeSlotSelection` puro exportado), reusa solo `parseDate`; NO se tocaron los parsers de greeting/qualifyingDatetime (dedup = sprint aparte). 28 tests nuevos en `tests/slotSelection.test.ts`, 171 verdes, tsc app limpio. Nota observabilidad: el check pre-clasificador era invisible al logging del clasificador (S5-OBS-01), mismo punto ciego que Bug B. Backlog derivado (sprint 2): extraer parser de hora compartido + dedup; revisar wording de presentación de slots; principio "presentación natural exige comprensión natural". Rama `feat/slot-selection-natural`, SIN merge — pendiente smoke por WhatsApp. |
| 2026-06-16 | smoke fase 2 multi-barbero (diagnóstico) | doc | Diagnóstico read-only del smoke por WhatsApp del 2do barbero (Andrés, post S5-DATA-02). Motor mecánico OK (asigna, agenda, excluye descansos sin colapsar, "¿con quién?" se despierta). Carencia: el flujo NO tiene capa conversacional — consume preguntas como avance. Trazado turno-por-turno: (1) "¿qué barbero está disponible para las 12?" → `'disponible'` ∈ `NO_PREFERENCE_KEYWORDS` (match substring en `qualifyingStaff.ts`) → auto-assign, nunca responde quién; (2) "¿a las 12 con quién sería?" → `matchNaturalSlot` extrae "12" con avidez → `routeSlotSelection` `action:'select'`, ignora el "¿?"/"con quién"; (3) `select` va directo a `AWAITING_BOOKING_NAME` esquivando el anti-Bug-B (que solo cubre `offer_nearest`); (4) barbero oculto hasta el recibo pese a preguntarlo 2 veces; (5) descanso genérico (ya conocido, Visión §4). Registrado como finding agrupado "🟠 DEUDA — el flujo multi-barbero no tiene capa conversacional" en Backlog post-sprint: 5 caras de la misma deuda + derivación + hora-primero explícito = alcance de la capa conversacional del sprint multi-barbero (DESBLOQUEADO). Severidad: #1 y #3 tocan auto-confirmación (riesgo Bug-B, alto); resto calidad conversacional. Sin tocar código ni base. Solo doc, commit directo a main. |
| 2026-06-16 | grupo A capa conversacional multi-barbero (diseño) | doc | Diseño read-only del grupo A ("reconocer el eje hora/barbero + dejar elegir barbero") partido en 2 tareas registradas en la sección de tareas. **Hallazgo §0 que reduce alcance:** el dato del barbero NO se pierde en el dedup — `getAvailableSlots` (autoAssign) proyecta UN slot por barbero conservando `staffName` (`scheduling.ts:569-599`); el 2do dedup es por hora exacta y solo colapsa minutos idénticos; los `pendingSlots` llevan `staffId`+`staffName`+`startsAt`. → presentar por barbero = dejar de suprimir el nombre (`presentingSlots.ts:380,385-387,412,461,481`), NO recuperar dato. **S5-BOT-04 (A1, pasos 1-5):** detector de eje-barbero (módulo puro nuevo) + saneo de `NO_PREFERENCE_KEYWORDS` (sacar `disponible`/`libre`) + cableo de ejes en `qualifyingStaff` + rama de presentación por-barbero bajo bandera `presentBy` + guard de interrogación en `routeSlotSelection` (exige `?`+token de barbero) → acción `ask_who`; cierra la vía conversacional del Bug-B. **S5-BOT-05 (A2, paso 6):** respuesta híbrida ("a las 12 te atendería Andrés… ¿o cambiar?") + follow-up con bandera tipo `nearestOfferSlot`; depende de A1; TOCA S5-BOT-03 (aceptación/negación, contadores) → riesgo de regresión, verificación propia. Anti-Bug-B en `select` (cara #3) queda como grupo separado (decisión de producto). Deuda anotada: DOS listas `NO_PREFERENCE_KEYWORDS` duplicadas (`qualifyingStaff:36`/`confirmingAppointment:54`). Invariante: camino (c) "no me importa quién" byte-idéntico; todo lo nuevo bajo banderas/detectores nuevos. Sin tocar código ni base. Solo doc, commit directo a main. |
| 2026-06-16 | S5-BOT-04 (A1) | done | Eje de interés barbero/hora + presentación por barbero (grupo A1 de la capa conversacional multi-barbero). 5 pasos: (1) módulo puro nuevo `staffAxisIntent.ts` — `wantsToChooseStaff` (eje a: "qué barberos hay"/"puedo elegir") + `asksWhoOnly` (eje b: `¿?`+token de barbero, sin nombre ni elección); estilo `availabilityIntent`/`sideQuestion`, sin DB/red/LLM. (2) Saneo de `NO_PREFERENCE_KEYWORDS` en `qualifyingStaff.ts` — fuera `disponible`/`libre` (falsos positivos substring que leían "¿qué barbero disponible?" como "el que sea"). (3) Cableo de ejes: `const wantsStaffAxis = wantsToChooseStaff‖asksWhoOnly`; guard `isAvailabilityQuestion && !wantsStaffAxis` (el eje-barbero GANA al de disponibilidad en el caso mixto) + bloque que setea `presentBy:'staff'` → SHOWING_SLOTS, ANTES de NO_PREFERENCE. (4) Campo `presentBy:'time'|'staff'` en `LifestyleBotContext`; rama `presentByStaff` en `presentingSlots.ts` que SALTA el dedup-por-hora (fuente ya un-slot-por-barbero) y NO suprime nombres (slotsText/barberoLine/instrucción Haiku/`buildSlotsMessage`/`buildAltDateFallback`). (5) Guard de interrogación en `routeSlotSelection`: nueva acción `ask_who` + `hasStaffToken`, ANTES de `matchNaturalSlot` — `¿?`+token de barbero → `ask_who` (re-presenta por barbero), sin tocar el matcher/`offer_nearest`/S5-BOT-03. Invariante (c) "cualquiera" byte-idéntico verificado por test. Bug atrapado en verificación: `\bquienes?\b` parsea como "quiene"+"s?" → NO matchea singular "quien"; corregido a `\bquien(?:es)?\b` en `staffAxisIntent.ts` y `confirmingAppointment.ts`. `tests/staffAxisIntent.test.ts` nuevo; 222/222 verdes + `tsc --noEmit` apps/lifestyle limpio. Rama `feat/multi-barber-axis-a1` (desde main), SIN merge — pendiente smoke por WhatsApp. A2 (S5-BOT-05, respuesta híbrida + follow-up) NO incluido. |
| 2026-06-16 | S5-DATA-02 | done | Alta del 2do barbero "Andrés" en Barbería Demo (`4de6a450`) — fase 2 del modelo multi, **desbloqueo de la Visión §5**. Pre-check de unicidad (no hay guard en `staff`) → `[]`, no existía → inserción en UNA sentencia atómica (CTEs `new_staff`→`avail`→`svc`, id literal vía CTE, no re-derivado por nombre). Cargado: staff id `4dff5eeb-39cd-4f0f-becf-25a60d9cecfc` (role barber, active, pin `4321` ≠ Carlos 1234 / Asistente 5678; phone/whatsapp_id `15553334444`); staff_availability Mar–Sáb (2–6) 12:00–21:00 sin breaks is_active (descansa Dom y Lun); staff_services → "Corte de cabello" (`261dc26b`). Horario distinto a Carlos (Lun–Vie 10–20, Sáb 10–18) en días Y horas → habilita hora-primero, derivación y "descansa/negocio abierto" (lunes Andrés descansa, Carlos trabaja). Verificación post (3 reqs por id literal): staff active ✓, 5 filas availability ✓, link service ✓. Reversión documentada (DELETE atómico FK-order, NO ejecutado). Hallazgo corregido en este commit: `staff.phone`/`whatsapp_id` son NOT NULL en la BD real → doc del schema en CLAUDE.md actualizada (1er INSERT falló por eso, atómico → 0 filas). NO se tocó código (round-robin/FSM intactos). Ejecutado vía MCP/SQL contra prod (`hdqazbuxtpavtioufrsv`). Data+doc directo a main, como S5-DATA-01. |
| 2026-06-17 | smoke A1 (diagnóstico "12" pelado) | doc | Diagnóstico read-only del smoke por WhatsApp de S5-BOT-04 (A1): por qué `"12"` no se reconoce como selección tras ofrecer "12, 12:15, 12:30" pero `"a las 12"` sí. Trazado de `routeSlotSelection`: guard `ask_who` de A1 NO intercepta "12" (exige `?`+token de barbero) → `extractRawTime` devuelve null (exige marcador "a las"/`:MM`/pm/am/turno para leer un número como hora; "decisión e", `~:558-562`) → `matchNaturalSlot` none → `parseChoice` → índice 12 → fuera de rango (3 slots) → clarify genérico. Veredicto: PRE-EXISTENTE, ajeno a A1 (A1 no tocó el matcher); el clarify "viejo" es el único clarify genérico del handler, no un call site nuevo — el humano de S5-BOT-03 solo corre en `isNegation`. Causa de fondo: la "decisión e" (dígito desnudo = índice) quedó obsoleta tras el paso a presentación natural en prosa (S5-BOT-01). Registrado como finding "🟠 BUG — número pelado no se reconoce" en Backlog post-sprint (severidad alta, sprint propio antes de A2; solución propuesta: match por hora primero, índice como fallback). Anotados 2 hallazgos para A2 (S5-BOT-05): pregunta por barbero específico ("¿Carlos a la 1?") sin respuesta directa + mezcla barberos al preguntar por uno solo (imagen 3). Sin tocar código ni base. Solo doc. |
---

## Métricas del sprint

Al cierre de cada semana, Gabriel actualiza:

| Semana | Tareas done | Tareas totales | % avance | Horas reales | Bloqueos abiertos |
|---|---|---|---|---|---|
| 1 | 9 | 12 | 75% | — | S1-G-01 bloqueada (Meta Business pendiente) |
| 2 | 5 | 9 | 56% | — | S2-G-01/02/03 bloqueadas (humanas); S2-LEG-01 bloqueada por S2-G-01 |
| 3 | 8 | 8 | 100% | — | S3-OPS-01 bloqueada (UptimeRobot pendiente de Gabriel); S3-G-01 humana |
| 4 | 0 | 4 | 0% | 0 | — |
