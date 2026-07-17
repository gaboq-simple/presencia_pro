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

# ── Connection variant: forzar el SESSION POOLER (IPv4) ───────────────────────
# La conexión DIRECTA (db.<ref>.supabase.co) es IPv6-only y los runners de GitHub
# Actions son IPv4-only → "Network is unreachable". El transaction pooler (:6543)
# no sirve para pg_dump. El SESSION POOLER (<host>.pooler.supabase.com:5432, user
# postgres.<ref>) es IPv4 y compatible con pg_dump.
#
# El subdominio del pooler NO es derivable de forma fiable (aws-0/aws-1/…) — un
# host equivocado da "tenant not found". Se DESCUBRE determinísticamente vía
# Management API (campo db_host) usando SUPABASE_ACCESS_TOKEN; fallback:
# aws-0-<region>. Si SUPABASE_DB_URL ya es un pooler, se usa tal cual (idempotente).
# El password NUNCA se extrae ni se loguea: se sustituye SOLO host+user sobre la
# URL (que vive en env). El puerto directo (5432) coincide con el del session pooler.
SUPABASE_POOLER_REGION="${SUPABASE_POOLER_REGION:-us-east-1}"
DB_URL="${SUPABASE_DB_URL}"
if [[ "${DB_URL}" == *"@db."*".supabase.co"* ]]; then
  REF=$(printf '%s' "${DB_URL}" | sed -E 's#.*@db\.([a-z0-9]+)\.supabase\.co.*#\1#')

  POOLER_HOST=""
  if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    echo "[backup] Descubriendo el host del session pooler vía Management API..."
    POOLER_JSON_FILE="$(mktemp)"
    HTTP_CODE=$(curl -sS -o "${POOLER_JSON_FILE}" -w '%{http_code}' \
      -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
      "https://api.supabase.com/v1/projects/${REF}/config/database/pooler" 2>/dev/null || echo "000")
    echo "[backup] Management API /config/database/pooler → HTTP ${HTTP_CODE}"
    if [[ "${HTTP_CODE}" == "200" ]]; then
      # El host aparece en db_host o dentro del connection_string. Se extrae SOLO
      # el host (nunca se loguea el body: el connection_string trae el password).
      POOLER_HOST=$(grep -oE '[a-z0-9-]+\.pooler\.supabase\.com' "${POOLER_JSON_FILE}" | head -1 || true)
    fi
    rm -f "${POOLER_JSON_FILE}"
  fi
  if [[ -z "${POOLER_HOST}" ]]; then
    POOLER_HOST="aws-0-${SUPABASE_POOLER_REGION}.pooler.supabase.com"
    echo "[backup] WARN: no se descubrió el pooler vía API — fallback por región: ${POOLER_HOST}"
  fi

  DB_URL=$(printf '%s' "${DB_URL}" \
    | sed -E "s#://postgres:#://postgres.${REF}:#" \
    | sed -E "s#@db\.${REF}\.supabase\.co#@${POOLER_HOST}#")
  echo "[backup] Conexión directa (IPv6-only) → session pooler: ${POOLER_HOST} (user postgres.${REF}, puerto 5432)"
else
  # Diagnóstico sin exponer credenciales: solo el host.
  echo "[backup] Usando SUPABASE_DB_URL provisto (host: $(printf '%s' "${DB_URL}" | sed -E 's#.*@([^:/?]+).*#\1#'))"
fi

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
if ! supabase db dump --db-url "${DB_URL}" --role-only -f "${ROLES_FILE}"; then
  echo "[backup] WARN: role dump failed (puede requerir permisos elevados) — continúo sin roles."
  : > "${ROLES_FILE}"
fi

echo "[backup] Dumping schema..."
supabase db dump --db-url "${DB_URL}" -f "${SCHEMA_FILE}"

echo "[backup] Dumping data..."
supabase db dump --db-url "${DB_URL}" --data-only --use-copy -f "${DATA_FILE}"

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

# ── 4c. ROUND-TRIP: bajar el objeto DE R2, desencriptar, descomprimir y CONTAR ─
# FILAS por tabla. La lección de S6-OPS-01: un Action verde ≠ backup. El modo de
# falla peligroso es "el archivo existe, pesa, y está vacío de datos" (solo
# schema). Acá se descarga el objeto REAL de R2 (no el local pre-upload), se
# desencripta con el passphrase, se descomprime, y se cuentan las filas de cada
# bloque COPY. Si el total de filas es 0 → aborta (causa #4 viva).
echo "[verify] Round-trip: descargando el objeto desde R2 para inspeccionarlo..."
RT_DIR="${WORK_DIR}/roundtrip"
mkdir -p "${RT_DIR}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "s3://${BUCKET}/${OBJECT_KEY}" "${RT_DIR}/dl.sql.gz.gpg" \
  --endpoint-url "${R2_ENDPOINT}" --region auto

gpg --batch --yes --decrypt --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    --output "${RT_DIR}/dl.sql.gz" "${RT_DIR}/dl.sql.gz.gpg"
gunzip "${RT_DIR}/dl.sql.gz"   # → ${RT_DIR}/dl.sql
RT_SQL="${RT_DIR}/dl.sql"

RT_BYTES=$(wc -c < "${RT_SQL}")
echo "[verify] Dump desencriptado desde R2: ${RT_BYTES} bytes ($(du -sh "${RT_SQL}" | cut -f1))"

# Conteo de filas por bloque COPY (formato pg_dump --data-only --use-copy):
#   COPY public.<tabla> (...) FROM stdin;   <fila>...   \.
echo "[verify] ── Conteo de filas por tabla (bloques COPY del artefacto de R2) ──"
awk '
  /^COPY /        { tbl=$2; inc=1; n=0; next }
  inc && /^\\\.$/ { printf "ROWCOUNT %s %d\n", tbl, n; total+=n; tables++; inc=0; next }
  inc             { n++ }
  END             { printf "ROWCOUNT __TABLES__ %d\n", tables; printf "ROWCOUNT __TOTAL__ %d\n", total }
' "${RT_SQL}" > "${RT_DIR}/rowcounts.txt"
sort "${RT_DIR}/rowcounts.txt"

RT_TOTAL=$(awk '/__TOTAL__/{print $3}' "${RT_DIR}/rowcounts.txt")
RT_TABLES=$(awk '/__TABLES__/{print $3}' "${RT_DIR}/rowcounts.txt")
if [[ -z "${RT_TOTAL}" || "${RT_TOTAL}" -le 0 ]]; then
  echo "[verify] ERROR: el artefacto de R2 NO contiene filas de datos (0 filas COPY)." >&2
  echo "[verify]        El backup es solo-schema — causa #4 viva. Abortando." >&2
  exit 1
fi
echo "[verify] ✓ Artefacto de R2 verificado: ${RT_TABLES} tablas con datos, ${RT_TOTAL} filas COPY en total."

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
