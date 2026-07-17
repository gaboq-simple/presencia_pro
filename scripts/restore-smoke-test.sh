#!/usr/bin/env bash
# restore-smoke-test.sh — Prueba de RESTORE del último backup de R2 contra una
# DB efímera (NUNCA prod). Baja el objeto más nuevo de R2, lo desencripta, lo
# descomprime, y lo restaura dentro de un contenedor supabase/postgres efímero;
# luego cuenta filas de tablas clave. Un backup que no se puede restaurar no es
# un backup.
#
# Se restaura contra la imagen supabase/postgres (no postgres vanilla) porque el
# dump trae los schemas auth/storage y roles de Supabase; un Postgres vanilla
# daría falsos negativos por roles/extensiones ausentes.
#
# Env: R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT,
#      BACKUP_ENCRYPTION_PASSPHRASE, [PG_IMAGE]

set -euo pipefail

: "${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY}"
: "${R2_ENDPOINT:?Missing R2_ENDPOINT}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?Missing BACKUP_ENCRYPTION_PASSPHRASE}"

BUCKET="presenciapro-backups"
PG_IMAGE="${PG_IMAGE:-ghcr.io/supabase/postgres:17.6.1.075}"
WORK_DIR="/tmp/restore-test-$$"
CONTAINER="restore-smoke-$$"
mkdir -p "${WORK_DIR}"

cleanup() { docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true; rm -rf "${WORK_DIR}"; }
trap cleanup EXIT

# ── 1. Objeto más nuevo de R2 ─────────────────────────────────────────────────
KEY=$(AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 ls "s3://${BUCKET}/" --endpoint-url "${R2_ENDPOINT}" --region auto \
  | sort | tail -1 | awk '{print $4}')
if [[ -z "${KEY}" ]]; then
  echo "[restore] ERROR: no hay objetos en s3://${BUCKET}/" >&2; exit 1
fi
echo "[restore] Objeto más nuevo en R2: ${KEY}"

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "s3://${BUCKET}/${KEY}" "${WORK_DIR}/b.sql.gz.gpg" \
  --endpoint-url "${R2_ENDPOINT}" --region auto

# ── 2. Desencriptar + descomprimir ────────────────────────────────────────────
gpg --batch --yes --decrypt --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    --output "${WORK_DIR}/b.sql.gz" "${WORK_DIR}/b.sql.gz.gpg"
gunzip "${WORK_DIR}/b.sql.gz"   # → ${WORK_DIR}/b.sql
echo "[restore] Dump listo: $(du -sh "${WORK_DIR}/b.sql" | cut -f1)"

# ── 3. Postgres efímero (imagen de Supabase) ──────────────────────────────────
echo "[restore] Levantando ${PG_IMAGE}..."
docker run -d --name "${CONTAINER}" -e POSTGRES_PASSWORD=postgres "${PG_IMAGE}" >/dev/null
for i in $(seq 1 60); do
  if docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 2
done
if ! docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then
  echo "[restore] ERROR: Postgres efímero no quedó ready." >&2; exit 1
fi

# ── 4. Restaurar (comando de restore de Supabase; ON_ERROR_STOP=0 para tolerar
#       objetos ya-existentes en la imagen — la prueba real es el conteo) ───────
echo "[restore] Restaurando el dump con psql..."
docker exec -i "${CONTAINER}" psql -U postgres -d postgres \
  -v ON_ERROR_STOP=0 --quiet \
  -c 'SET session_replication_role = replica;' \
  -f - < "${WORK_DIR}/b.sql" > "${WORK_DIR}/restore.log" 2>&1 || true

# ── 5. Conteo post-restore = prueba de que el restore trajo filas ─────────────
echo "[restore] ── Conteo post-restore (DB efímera restaurada) ──"
FAIL=0
check() { # tabla, esperado_min
  local t="$1" min="$2"
  local c
  c=$(docker exec "${CONTAINER}" psql -U postgres -d postgres -tAc \
        "select count(*) from public.${t}" 2>/dev/null | tr -d '[:space:]' || echo "ERR")
  echo "[restore] public.${t} = ${c} (esperado ≥ ${min})"
  if ! [[ "${c}" =~ ^[0-9]+$ ]] || (( c < min )); then FAIL=1; fi
}
check appointment_audit 1
check bot_logs 1
check customers 9
check staff 3
check services 1
check appointments 1

if (( FAIL != 0 )); then
  echo "[restore] ERROR: el restore no reprodujo las filas esperadas — backup NO restaurable." >&2
  echo "[restore] --- últimas líneas del restore.log ---" >&2
  tail -30 "${WORK_DIR}/restore.log" >&2 || true
  exit 1
fi
echo "[restore] ✓ Restore verificado: las tablas clave se restauraron con datos desde el artefacto de R2."
