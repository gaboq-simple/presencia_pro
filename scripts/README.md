# scripts/

Utility scripts for presenciapro operations. Run from the repo root unless noted otherwise.

---

## backup-supabase.sh

Dumps the Supabase database, encrypts it with GPG, uploads to Cloudflare R2, and enforces 30-day retention.

### What it does

1. `supabase db dump` en **tres partes** — roles (best-effort) + schema + data —
   concatenadas en orden de restore. Un dump sin flags trae solo el esquema; los
   datos requieren `--data-only`, por eso es explícito.
2. Verifica que el dump no esté vacío/truncado (esquema con contenido + datos con `COPY`/`INSERT`)
3. `gzip -9` — compress
4. `gpg --symmetric --cipher-algo AES256` — encrypt with passphrase
5. `aws s3 cp` to `presenciapro-backups` bucket (S3-compatible Cloudflare R2)
6. **Verifica el objeto en R2** con `head-object` (existe + tamaño > 0) — no confía en que `cp` no falló
7. **Round-trip**: descarga el objeto **de R2**, lo desencripta, lo descomprime y
   **cuenta las filas de cada bloque `COPY`**. Si el total es 0 → aborta. Un Action
   verde no alcanza: esto prueba que los bytes en R2 traen datos (no schema solo).
   Los conteos quedan en el log como líneas `ROWCOUNT <tabla> <n>`.
8. Deletes any backup in the bucket older than 30 days
9. Cleans up all local temp files

### Object naming

```
backup-YYYY-MM-DD-HHmmss.sql.gz.gpg
```

### Required environment variables

| Variable | Description |
|---|---|
| `SUPABASE_DB_URL` | Connection string de Postgres (password percent-encoded). En **GitHub Actions (runners IPv4-only) DEBE ser el SESSION POOLER**: `postgresql://postgres.<ref>:<pwd>@<host>.pooler.supabase.com:5432/postgres` (Dashboard → **Connect → Session pooler**, puerto 5432). La conexión **directa** (`db.<ref>.supabase.co`) es **IPv6-only** → `Network is unreachable` en los runners; el **transaction pooler** (`:6543`) no sirve para `pg_dump`. Proyecto de prod `hdqazbuxtpavtioufrsv`. |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Passphrase de GPG. **⚠️ Si se pierde, TODOS los backups en R2 quedan indescifrables = inservibles.** Vive solo como secret de GitHub Actions → guardá una copia en un gestor de contraseñas durable fuera de GitHub. |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key |
| `R2_ENDPOINT` | R2 S3-compatible endpoint URL |
| `SUPABASE_ACCESS_TOKEN` | (Opcional) Solo para descubrir el host del pooler vía Management API si `SUPABASE_DB_URL` quedara como conexión directa. Necesita scope de lectura del pooler-config (si no, da 403 y usa el fallback). |

> El antiguo `SUPABASE_PROJECT_REF=uhhatetytaucucihfyyy` apuntaba al **proyecto equivocado** y `--project-ref`/`--output` ya no existen en `supabase db dump` (CLI 2.x). Reemplazados por `SUPABASE_DB_URL`.

### Run manually

```bash
export SUPABASE_DB_URL='postgresql://postgres:<password-encoded>@db.hdqazbuxtpavtioufrsv.supabase.co:5432/postgres'
export BACKUP_ENCRYPTION_PASSPHRASE=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT=...

bash scripts/backup-supabase.sh
```

### Automated schedule

`.github/workflows/backup-weekly.yml` runs this script every Sunday at 03:00 UTC (`cron: "0 3 * * 0"`) and on manual trigger (`workflow_dispatch`). Secrets are stored in GitHub → Repository Settings → Secrets.

---

## restore-smoke-test.sh (prueba de restore, CI)

Corre como step de `backup-weekly.yml` **solo en dispatch manual** (`if: github.event_name == 'workflow_dispatch'`), no en el cron semanal. Baja el objeto **más nuevo de R2**, lo desencripta, lo descomprime, y lo **restaura en un contenedor `supabase/postgres` efímero** (NUNCA prod), luego cuenta filas de tablas clave. Prueba que el backup es **restaurable de verdad**, no solo que existe.

Restaura contra la imagen `supabase/postgres` (no Postgres vanilla) porque el dump trae los schemas `auth`/`storage` y roles de Supabase.

---

## restore-supabase.sh

Downloads a backup from R2, decrypts it, decompresses it, and prints the `psql` command to restore manually.

**This script does NOT run the restore automatically.** Gabriel must execute the final `psql` command himself after verifying the target database.

### Usage

```bash
# List available backups first
AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY \
  aws s3 ls s3://presenciapro-backups/ --endpoint-url $R2_ENDPOINT --region auto

# Restore a specific backup
export BACKUP_ENCRYPTION_PASSPHRASE=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT=...

bash scripts/restore-supabase.sh backup-2026-05-21-030000.sql.gz.gpg
```

The script will print the `psql` command to run with the prepared `.sql` file.

### Verify after restore

```sql
SELECT COUNT(*) FROM businesses;
SELECT COUNT(*) FROM customers;
SELECT COUNT(*) FROM appointments;
```

See `RUNBOOK.md` → Section 6 for the full restore procedure.

---

## seed-demo-densa.sql

Resetea la barbería demo (`barberia-demo`) a un estado **denso y conocido**: 5
barberos con horarios distintos, 8 servicios, ~125 clientes y ~3 meses de citas
(no-shows, walk-ins, clientes enfriándose, días libres). Para demos a barberías
reales y para diseñar vistas con densidad real.

- **Idempotente y determinista**: purga las citas del negocio y re-siembra con
  pseudo-aleatorio por hash (sin `random()`). Fechas relativas a HOY en la
  timezone del negocio — corre fresco cualquier día.
- **El día de HOY depende de la HORA de corrida** (dv3-5') y **el MES en curso
  depende de la FECHA** (dv3-6: cuántos clientes nacen este mes escala con los
  días transcurridos, ~0.3/día, piso 2 y techo 10 — sin eso, el "+N este mes"
  del héroe de Clientela es 0 para siempre y el crecimiento se ve muerto en cada
  demo). El pasado y el futuro no dependen de nada. Las citas de hoy cuya
  hora de fin ya pasó nacen `completed` con cobro (monto + riel); las demás,
  `confirmed`. Dos corridas a la misma hora dan el mismo estado; a horas
  distintas del mismo día, no — y eso es a propósito. Medido: corridas de 16:20 y
  16:22 dieron huellas de contenido idénticas en pasado/hoy/futuro; entre 16:19 y
  16:20 cambió solo la de hoy, por el fin de una cita. Al comparar corridas, la
  huella va sobre el CONTENIDO, nunca sobre los `id` (se regeneran por diseño).
- **Siembra las conversaciones del bot** (`bot_conversations` +
  `conversation_messages`, bloques 8c/8d): una por PERSONA con reserva por bot,
  más las que preguntaron y no agendaron, y dos tomadas por el asistente. Sin
  ellas la ventana al bot de Análisis leía **"0 conversaciones"** al lado de las
  decenas de citas que el propio seed le atribuye al bot. Solo purga y re-siembra
  **lo suyo** (marcado con `context->>'seed'`): las conversaciones reales de los
  smokes por WhatsApp sobreviven intactas, con su hilo.
  El conteo semanal de conversaciones **no empata** con el de citas del bot y no
  hay que forzarlo: la tabla guarda una fila por persona (estado actual de la
  charla, no un log) y el mismo mes se mide contra ventanas distintas.
- **⚠️ Destructivo** para el negocio objetivo (borra citas, waitlist,
  notificaciones y su audit — suspende momentáneamente el trigger append-only
  de `appointment_audit`). **Solo BD demo, nunca producción con datos reales.**
- Limpia las filas de Actividad con "Acción sin identificar" (SQL directo).

```bash
psql "$SUPABASE_DB_URL" -f scripts/seed-demo-densa.sql
```

O pegar el archivo completo en el SQL editor de Supabase / MCP `execute_sql`
(en la máquina de trabajo no hay `psql` ni `SUPABASE_DB_URL`; si lo pegás, primero
verificá por `diff` que lo pegado sea idéntico al archivo versionado). Para otro
negocio, cambiar el slug en `seed_cfg` (primera línea de configuración del archivo).

### ⚠️ El seed CADUCA — correrlo es prerrequisito, no un extra

Las fechas son relativas a HOY (citas de hoy−90 a hoy+7), así que **el estado se
pudre solo en días**: una semana después de la última corrida, el negocio demo se
queda **sin citas hoy y sin futuras**, y las vistas del dueño (pulso de hoy, la
semana que viene, la fuga) rinden estados degradados o vacíos.

Esto no es cosmético: la **red de seguridad visual** de los planes
(`docs/planes/dueno-v3.md`, `docs/planes/capa-de-dinero.md`) compara capturas
antes/después de cada paso, y sobre un demo vencido comparás dos pantallas vacías
idénticas y firmás "no se rompió nada" sin haber probado nada — un sello de goma.
Lo mismo vale para enseñar el producto: un demo vencido se ve muerto.

**Regla:** correr el seed al inicio de CUALQUIER paso, antes de la captura
"antes", y **no volver a correrlo** entre el antes y el después del mismo paso.

**Antes de una demo en vivo, dispararlo a mano** — no basta con la corrida
automática de las 05:00 CDMX. A esa hora no terminó ninguna cita del día, así
que el día entero nace `confirmed`, y para la tarde el cron de auto-cancel ya
convirtió lo vencido en no-shows: el dueño abre y ve **$0 y faltas**, que es
justo lo contrario de lo que hay que enseñar. Una corrida a mano media hora
antes deja el día con sus citas cobradas:

```bash
gh workflow run reseed-demo.yml
```

(o Actions → *Reseed demo barbershop* → **Run workflow**). Verificado el
2026-08-18: a las 05:20 el día daba 0 completadas y $0; re-sembrado a las 16:19,
**3 completadas y $460**, las tres con monto y riel.

**Señal de vencimiento** (chequear sin adivinar; `<business_id>` = el de la demo):

```sql
select max(starts_at)::date as ultima,
       count(*) filter (where starts_at > now()) as futuras,
       count(*) filter (where starts_at::date = (now() at time zone 'America/Mexico_City')::date) as hoy
from appointments where business_id = '<business_id>';
```

`futuras = 0` o `hoy = 0` → **vencido, re-sembrar antes de capturar nada**. Recién
corrido se ven ~45 futuras y varias decenas hoy.
