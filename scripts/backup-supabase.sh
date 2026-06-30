#!/usr/bin/env bash
# backup-supabase.sh — Dump, encrypt, and upload Supabase DB to Cloudflare R2
#
# Required environment variables:
#   SUPABASE_DB_URL               — Postgres connection string (percent-encoded
#                                   password). Direct connection o session pooler,
#                                   NO el transaction pooler (pg_dump no funciona ahí).
#                                   Dashboard → Project Settings → Database →
#                                   Connection string (URI). Apunta al proyecto de
#                                   prod: hdqazbuxtpavtioufrsv.
#   BACKUP_ENCRYPTION_PASSPHRASE  — GPG symmetric passphrase
#   R2_ACCESS_KEY_ID              — Cloudflare R2 access key
#   R2_SECRET_ACCESS_KEY          — Cloudflare R2 secret key
#   R2_ENDPOINT                   — Cloudflare R2 S3-compatible endpoint URL
#
# Bucket: presenciapro-backups
# Retention: deletes backups older than 30 days
#
# El dump usa `supabase db dump` (trae su propio pg_dump con la versión correcta
# del servidor) en TRES partes — roles + esquema + datos — concatenadas en el
# orden de restore. Un dump sin flags trae SOLO el esquema (sin datos): por eso
# es explícito.

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${SUPABASE_DB_URL:?Missing SUPABASE_DB_URL}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?Missing BACKUP_ENCRYPTION_PASSPHRASE}"
: "${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY}"
: "${R2_ENDPOINT:?Missing R2_ENDPOINT}"

BUCKET="presenciapro-backups"
TIMESTAMP=$(date -u +"%Y-%m-%d-%H%M%S")
WORK_DIR="/tmp/supabase-backup-${TIMESTAMP}"
DUMP_FILE="${WORK_DIR}/backup-${TIMESTAMP}.sql"
GZ_FILE="${DUMP_FILE}.gz"
ENC_FILE="${GZ_FILE}.gpg"
OBJECT_KEY="backup-${TIMESTAMP}.sql.gz.gpg"
RETENTION_DAYS=30

mkdir -p "${WORK_DIR}"
echo "[backup] Starting Supabase backup — ${TIMESTAMP}"

# ── 1. Dump (roles + schema + data) ──────────────────────────────────────────
# `supabase db dump` sin flags = esquema. --data-only = datos. --role-only = roles.
# Orden de concatenación = orden de restore: roles → schema → data.
ROLES_FILE="${WORK_DIR}/roles.sql"
SCHEMA_FILE="${WORK_DIR}/schema.sql"
DATA_FILE="${WORK_DIR}/data.sql"

echo "[backup] Dumping roles (best-effort)..."
if ! supabase db dump --db-url "${SUPABASE_DB_URL}" --role-only -f "${ROLES_FILE}"; then
  echo "[backup] WARN: role dump failed (puede requerir permisos elevados) — continúo sin roles."
  : > "${ROLES_FILE}"
fi

echo "[backup] Dumping schema..."
supabase db dump --db-url "${SUPABASE_DB_URL}" -f "${SCHEMA_FILE}"

echo "[backup] Dumping data..."
supabase db dump --db-url "${SUPABASE_DB_URL}" --data-only --use-copy -f "${DATA_FILE}"

cat "${ROLES_FILE}" "${SCHEMA_FILE}" "${DATA_FILE}" > "${DUMP_FILE}"

# ── 1b. Verificar que el dump NO está vacío/truncado ─────────────────────────
# El esquema solo debe pesar algo y el dump combinado debe traer datos (COPY/INSERT).
if [[ ! -s "${DUMP_FILE}" ]]; then
  echo "[backup] ERROR: dump combinado vacío — abortando." >&2
  exit 1
fi
if [[ ! -s "${SCHEMA_FILE}" ]]; then
  echo "[backup] ERROR: dump de esquema vacío — abortando." >&2
  exit 1
fi
if ! grep -qiE '^(COPY |INSERT INTO )' "${DATA_FILE}"; then
  echo "[backup] ERROR: el dump de datos no contiene filas (sin COPY/INSERT) — abortando." >&2
  exit 1
fi
DUMP_BYTES=$(wc -c < "${DUMP_FILE}")
echo "[backup] Dump OK: ${DUMP_BYTES} bytes ($(du -sh "${DUMP_FILE}" | cut -f1))"

# ── 2. Compress ───────────────────────────────────────────────────────────────
echo "[backup] Compressing..."
gzip -9 "${DUMP_FILE}"
echo "[backup] Compressed: $(du -sh "${GZ_FILE}" | cut -f1)"

# ── 3. Encrypt ────────────────────────────────────────────────────────────────
echo "[backup] Encrypting with GPG (AES256)..."
gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    --output "${ENC_FILE}" "${GZ_FILE}"
echo "[backup] Encrypted: $(du -sh "${ENC_FILE}" | cut -f1)"

# ── 4. Upload to R2 ───────────────────────────────────────────────────────────
echo "[backup] Uploading to R2: s3://${BUCKET}/${OBJECT_KEY}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "${ENC_FILE}" "s3://${BUCKET}/${OBJECT_KEY}" \
  --endpoint-url "${R2_ENDPOINT}" --region auto

# ── 4b. VERIFICAR que el objeto existe en R2 con tamaño > 0 ───────────────────
# No confiar en "el cp no falló" — listar el objeto y confirmar tamaño.
echo "[backup] Verificando el objeto en R2..."
REMOTE_SIZE=$(AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
  AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3api head-object \
    --bucket "${BUCKET}" --key "${OBJECT_KEY}" \
    --endpoint-url "${R2_ENDPOINT}" --region auto \
    --query 'ContentLength' --output text)

if [[ -z "${REMOTE_SIZE}" || "${REMOTE_SIZE}" == "None" || "${REMOTE_SIZE}" -le 0 ]]; then
  echo "[backup] ERROR: el objeto no existe en R2 o tiene tamaño 0 — backup NO verificado." >&2
  exit 1
fi
echo "[backup] ✓ Verificado en R2: ${OBJECT_KEY} (${REMOTE_SIZE} bytes)"

# ── 5. Cleanup local temp files ───────────────────────────────────────────────
rm -rf "${WORK_DIR}"
echo "[backup] Local cleanup done."

# ── 6. Retention — delete backups older than 30 days ─────────────────────────
echo "[backup] Enforcing ${RETENTION_DAYS}-day retention policy..."
CUTOFF_DATE=$(date -u -d "${RETENTION_DAYS} days ago" +"%Y-%m-%d" 2>/dev/null \
  || date -u -v-"${RETENTION_DAYS}"d +"%Y-%m-%d")  # macOS fallback

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 ls "s3://${BUCKET}/" \
  --endpoint-url "${R2_ENDPOINT}" --region auto \
| while read -r _date _time _size key; do
    KEY_DATE=$(echo "${key}" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)
    if [[ -n "${KEY_DATE}" && "${KEY_DATE}" < "${CUTOFF_DATE}" ]]; then
      echo "[backup] Deleting old backup: ${key} (date: ${KEY_DATE})"
      AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
      AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
        aws s3 rm "s3://${BUCKET}/${key}" \
        --endpoint-url "${R2_ENDPOINT}" --region auto
    fi
  done

echo "[backup] Retention cleanup done."
echo "[backup] ✓ Backup finished successfully: ${OBJECT_KEY} (${REMOTE_SIZE} bytes en R2)"
