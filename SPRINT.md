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

#### S1-OPS-01 — Supabase Pro + PITR + dump externo ⚪ todo
**Tipo:** Mitad humana (upgrade del plan), mitad Claude Code (script)
**Origen:** Phase 5, escenario 1 y 4
**Por qué:** Hoy no hay backup verificable. Una corrupción = pérdida total.
**Criterios de aceptación:**
- [ ] Gabriel upgrade del proyecto Supabase de presenciapro a Pro ($25/mes)
- [ ] Gabriel activa PITR en Settings → Database
- [ ] Claude Code crea un script `scripts/backup-supabase.sh` que: corre `supabase db dump`, lo encripta con `gpg --symmetric` usando passphrase de env var, sube a Cloudflare R2 o S3 con timestamp
- [ ] Documentar en `RUNBOOK.md` (que se crea en S2-DOC-01) el procedimiento de restore
- [ ] Ejecutar restore drill al menos UNA vez en proyecto staging Supabase y cronometrar
**Prompt:** Ver `SPRINT-PROMPTS.md` → S1-OPS-01

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

#### S4-OPS-01 — Dry run de onboarding completo ⚪ todo
**Criterios de aceptación:**
- [ ] Gabriel (o Claude Code asistiendo) onboardea un negocio dummy desde cero usando SOLO el script + checklist
- [ ] Documentar todas las fricciones encontradas → cada una se vuelve issue/tarea
- [ ] Iterar el script hasta que el flujo sea reproducible por una persona razonable siguiendo el checklist
**Prompt:** Ver `SPRINT-PROMPTS.md` → S4-OPS-01

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
---

## Métricas del sprint

Al cierre de cada semana, Gabriel actualiza:

| Semana | Tareas done | Tareas totales | % avance | Horas reales | Bloqueos abiertos |
|---|---|---|---|---|---|
| 1 | 9 | 12 | 75% | — | S1-G-01 bloqueada (Meta Business pendiente) |
| 2 | 5 | 9 | 56% | — | S2-G-01/02/03 bloqueadas (humanas); S2-LEG-01 bloqueada por S2-G-01 |
| 3 | 8 | 8 | 100% | — | S3-OPS-01 bloqueada (UptimeRobot pendiente de Gabriel); S3-G-01 humana |
| 4 | 0 | 4 | 0% | 0 | — |
