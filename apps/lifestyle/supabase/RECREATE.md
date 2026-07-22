# RECREATE.md — Recrear el proyecto Supabase de lifestyle desde cero

> **REL-02 (Ola 2).** Procedimiento para reconstruir el proyecto Supabase de
> producción (`hdqazbuxtpavtioufrsv`) si se pierde o hay que recrearlo.
> Escrito 2026-07-22 tras reconciliar el ledger remoto contra el repo
> (verificación por spot-check de objetos en prod: repo = realidad).

---

## 0. La verdad incómoda del ledger (por qué existe este doc)

**El ledger remoto (`supabase_migrations.schema_migrations`) NO sirve para
recrear la base.** Estado real al 2026-07-22:

- El ledger tiene **16 filas** (versiones timestamp generadas por MCP
  `apply_migration`), que corresponden a las migraciones **043 en adelante**
  (aplicadas desde 2026-06-09 vía MCP).
- Las migraciones **001–042** se aplicaron **fuera de banda** (SQL editor,
  antes de la era MCP) y no tienen fila en el ledger.
- Verificado por spot-check en prod: los objetos de 011/031/038/045/053, el
  bucket de 010, las columnas de las migraciones del dir root y el RPC de 048
  **existen todos** → **la fuente de verdad es el REPO, no el ledger**.

La recreación es un **replay del repo en orden**, no un `supabase db push`.

### Mapa ledger remoto → archivo del repo (las 16 filas, 2026-07-22)

| Versión (ledger) | Archivo del repo |
|---|---|
| 20260609194318 enable_rls_conversation_messages | `043_enable_rls_conversation_messages.sql` |
| 20260702020239 businesses_create_appointment_controls | `044_businesses_create_appointment_controls.sql` |
| 20260703024248 appointment_audit_capture | `045_appointment_audit_capture.sql` |
| 20260705012257 allow_overlap | `046_allow_overlap.sql` |
| 20260706184306 actor_attribution_cron | `047_actor_attribution_cron.sql` |
| 20260706190819 actor_attribution_bot | `048_actor_attribution_bot.sql` |
| 20260706232756 appointment_price_snapshot | `049_appointment_price_snapshot.sql` |
| 20260707040753 routing_keys_unique | `050_routing_keys_unique.sql` |
| 20260707081332 staff_photos_drop_public_read_listing | `051_staff_photos_drop_public_read.sql` |
| 20260707082820 appointment_tenant_coherence | `052_appointment_tenant_coherence.sql` |
| 20260712232233 appointment_arrived_at | `../../../supabase/migrations/20260712000000_appointment_arrived_at.sql` ⚠️ |
| 20260715030339 053_management_audit | `053_management_audit.sql` |
| 20260715034543 054_management_audit_businesses_entity | `054_management_audit_businesses_entity.sql` |
| 20260715052234 055_audit_actor_fk_note | `055_audit_actor_fk_note.sql` |
| 20260719000653 appointment_completed_at | `../../../supabase/migrations/20260718000000_appointment_completed_at.sql` ⚠️ |
| 20260720175526 appointment_tips | `../../../supabase/migrations/20260720000000_appointment_tips.sql` ⚠️ |

> ⚠️ **Tres migraciones lifestyle viven en el dir del legacy**
> (`supabase/migrations/` en el root del repo, junto a las de
> dra-quevedo/sellers): `appointment_arrived_at`, `appointment_completed_at`
> y `appointment_tips` (rediseño barbero pasos 5–7). **Deuda propuesta (no
> ejecutada):** moverlas a `apps/lifestyle/supabase/migrations/` con número
> (056–058). Mientras tanto, el replay de abajo las incluye explícitamente.

### Convención para el futuro

Toda migración nueva de lifestyle: (1) se aplica vía MCP `apply_migration`
(queda en el ledger), y (2) **siempre** se guarda copia numerada en
`apps/lifestyle/supabase/migrations/`. Así el repo sigue siendo replayable.

---

## 1. Dos caminos de recreación

**Camino A — restore desde backup (preferido: recupera DATOS).**
Backup semanal cifrado en R2 (workflow `backup-weekly.yml`, domingos 3am UTC).
Procedimiento completo en RUNBOOK.md §6 (`scripts/restore-supabase.sh`:
descarga R2 → descifra → descomprime → imprime el comando psql). El dump es
`pg_dump` completo → trae schema + datos + triggers; tras restaurar, salta a
los pasos 3–6 de abajo (functions, crons, secrets, verificación).

> Gotcha del pooler (aprendido en S6-OPS-01): `SUPABASE_DB_URL` debe ser el
> **session pooler** (`aws-1-us-east-1.pooler.supabase.com`); la conexión
> directa es IPv6-only y falla desde GitHub Actions y muchas redes.

**Camino B — replay de migraciones (schema desde cero, SIN datos).**
Para un proyecto virgen (staging, drill, o pérdida total sin backup):

```bash
# Desde la raíz del repo. SUPABASE_DB_URL = session pooler del proyecto nuevo.
cd apps/lifestyle/supabase/migrations

# 001–055 en orden lexicográfico (018b queda después de 018 — orden correcto):
for f in $(ls [0-9]*.sql | sort); do
  echo "== $f"; psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done

# Las 3 lifestyle del dir root (rediseño barbero p5–7), en este orden:
cd ../../../../supabase/migrations
for f in 20260712000000_appointment_arrived_at.sql \
         20260718000000_appointment_completed_at.sql \
         20260720000000_appointment_tips.sql; do
  echo "== $f"; psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f "$f" || break
done
```

Notas del replay:
- `010_staff_photos_bucket.sql` crea el bucket `staff-photos` (idempotente,
  `ON CONFLICT`); `051` le quita el listing público. No hay pasos manuales de
  Storage.
- `021/034_organizations*`: la tabla `organizations` fue retirada del flujo
  (PR #152); si el replay falla ahí en un proyecto virgen, es seguro saltar
  esas dos y anotar el porqué.
- El replay NO llena el ledger (`schema_migrations`) — es cosmético; si se
  quiere, registrar las nuevas con MCP `apply_migration` de ahí en adelante.

---

## 2. Datos mínimos (solo camino B)

Sin backup no hay negocios. Sembrar con `onboard-business.ts` (RUNBOOK §8) o
restaurar los INSERT del negocio demo. Campos críticos del routing:
`businesses.whatsapp_phone_number_id` (llave del multi-tenant, UNIQUE parcial
por migración 050) y `whatsapp_number`.

---

## 3. Edge functions (código en `supabase/functions/` del root)

Solo 2 son críticas para lifestyle:

```bash
supabase functions deploy dispatch-lifestyle-notifications --project-ref <ref>
supabase functions deploy dispatch-auto-cancel             --project-ref <ref>
```

Secrets de las functions (Dashboard → Edge Functions → Secrets, o
`supabase secrets set`): `WHATSAPP_ACCESS_TOKEN` (SUPABASE_URL y
SERVICE_ROLE_KEY las inyecta la plataforma).

> **Estado real verificado 2026-07-22:** `list_edge_functions` del proyecto
> prod devolvió **VACÍO** y el último `sent_at` de `scheduled_notifications`
> es del **2026-07-09** — las functions NO están desplegadas y los
> recordatorios/auto-cancel llevan ~2 semanas sin correr. El "redeploy
> pendiente" de AUD-07f es en realidad un **deploy desde cero + schedules**
> (ver REL-03).

## 4. Crons / schedules — MANUALES, no están en código

`pg_cron` NO está instalado en el proyecto; los schedules son configuración
de Dashboard y **se pierden al recrear** (y no aparecen en ningún export):

1. Dashboard → Edge Functions → `dispatch-lifestyle-notifications` →
   Schedules → Add Schedule → `* * * * *`.
2. Ídem para `dispatch-auto-cancel`.
3. Verificar en Logs que hay ejecuciones cada ~1 min y que
   `SELECT MAX(sent_at) FROM scheduled_notifications;` avanza.

## 5. Lo que vive FUERA de la base (checklist de reconexión)

- **Vercel (app):** env vars completas en RUNBOOK §11 (SUPABASE_URL y llaves
  nuevas del proyecto recreado, META_APP_SECRET, WHATSAPP_ACCESS_TOKEN,
  ANTHROPIC_API_KEY, MESSAGING_PROVIDER…).
- **Meta Cloud API:** el webhook apunta a la app (no cambia), pero
  `whatsapp_phone_number_id` de cada negocio debe coincidir con la fila de
  `businesses` sembrada.
- **Auth del dueño:** el dueño entra por email (Supabase Auth) — crear el
  usuario en Auth del proyecto nuevo y religar `staff.auth_id` si aplica.
  Barbero/asistente entran por PIN (viven en `staff`, vienen en el
  backup/seed).
- **GitHub Secrets del backup** (RUNBOOK §6): actualizar
  `SUPABASE_DB_URL`/`SUPABASE_ACCESS_TOKEN` al proyecto nuevo — si no, el
  backup semanal seguiría respaldando el proyecto muerto (o nada).

## 6. Verificación post-recreación

1. `npx tsc` no aplica — verificación de DB: correr los spot-checks:
   ```sql
   SELECT to_regclass('public.appointment_audit'),
          to_regclass('public.appointment_tips'),
          (SELECT COUNT(*) FROM storage.buckets WHERE id='staff-photos'),
          (SELECT COUNT(*) FROM pg_proc WHERE proname='bot_set_appointment_status');
   ```
2. Advisors de seguridad del Dashboard (o MCP `get_advisors`): sin RLS
   deshabilitado en tablas public.
3. Smoke del bot por WhatsApp (agendar de punta a punta) — verifica routing,
   FSM, INSERT de cita y recordatorio encolado.
4. A los 5 min: `MAX(sent_at)` avanzando (crons vivos).
5. Dry run del workflow de backup (`backup-weekly.yml` → run manual).
