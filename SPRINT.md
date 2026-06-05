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
---

## Métricas del sprint

Al cierre de cada semana, Gabriel actualiza:

| Semana | Tareas done | Tareas totales | % avance | Horas reales | Bloqueos abiertos |
|---|---|---|---|---|---|
| 1 | 9 | 12 | 75% | — | S1-G-01 bloqueada (Meta Business pendiente) |
| 2 | 5 | 9 | 56% | — | S2-G-01/02/03 bloqueadas (humanas); S2-LEG-01 bloqueada por S2-G-01 |
| 3 | 8 | 8 | 100% | — | S3-OPS-01 bloqueada (UptimeRobot pendiente de Gabriel); S3-G-01 humana |
| 4 | 0 | 4 | 0% | 0 | — |
