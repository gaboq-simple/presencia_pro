#!/usr/bin/env bash
# backup-supabase.sh — Dump, encrypt, and upload Supabase DB to Cloudflare R2
#
# Required environment variables:
#   SUPABASE_PROJECT_REF          — Supabase project ref (e.g. uhhatetytaucucihfyyy)
#   SUPABASE_ACCESS_TOKEN         — Supabase PAT with read access
#   BACKUP_ENCRYPTION_PASSPHRASE  — GPG symmetric passphrase
#   R2_ACCESS_KEY_ID              — Cloudflare R2 access key
#   R2_SECRET_ACCESS_KEY          — Cloudflare R2 secret key
#   R2_ENDPOINT                   — Cloudflare R2 S3-compatible endpoint URL
#
# Bucket: presenciapro-backups
# Retention: deletes backups older than 30 days

set -euo pipefail

# ── Validate required env vars ────────────────────────────────────────────────
: "${SUPABASE_PROJECT_REF:?Missing SUPABASE_PROJECT_REF}"
: "${SUPABASE_ACCESS_TOKEN:?Missing SUPABASE_ACCESS_TOKEN}"
: "${BACKUP_ENCRYPTION_PASSPHRASE:?Missing BACKUP_ENCRYPTION_PASSPHRASE}"
: "${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY}"
: "${R2_ENDPOINT:?Missing R2_ENDPOINT}"

BUCKET="presenciapro-backups"
TIMESTAMP=$(date -u +"%Y-%m-%d-%H%M%S")
DUMP_FILE="/tmp/backup-${TIMESTAMP}.sql"
GZ_FILE="${DUMP_FILE}.gz"
ENC_FILE="${GZ_FILE}.gpg"
OBJECT_KEY="backup-${TIMESTAMP}.sql.gz.gpg"
RETENTION_DAYS=30

echo "[backup] Starting Supabase backup — ${TIMESTAMP}"
echo "[backup] Project ref: ${SUPABASE_PROJECT_REF}"

# ── 1. Dump ───────────────────────────────────────────────────────────────────
echo "[backup] Dumping database..."
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN}" \
  supabase db dump \
  --project-ref "${SUPABASE_PROJECT_REF}" \
  --output "${DUMP_FILE}"
echo "[backup] Dump complete: $(du -sh "${DUMP_FILE}" | cut -f1)"

# ── 2. Compress ───────────────────────────────────────────────────────────────
echo "[backup] Compressing..."
gzip -9 "${DUMP_FILE}"
echo "[backup] Compressed: $(du -sh "${GZ_FILE}" | cut -f1)"

# ── 3. Encrypt ────────────────────────────────────────────────────────────────
echo "[backup] Encrypting with GPG..."
gpg --batch \
    --yes \
    --symmetric \
    --cipher-algo AES256 \
    --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    --output "${ENC_FILE}" \
    "${GZ_FILE}"
echo "[backup] Encrypted: $(du -sh "${ENC_FILE}" | cut -f1)"

# ── 4. Upload to R2 ───────────────────────────────────────────────────────────
echo "[backup] Uploading to R2: s3://${BUCKET}/${OBJECT_KEY}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "${ENC_FILE}" "s3://${BUCKET}/${OBJECT_KEY}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto
echo "[backup] Upload complete."

# ── 5. Cleanup local temp files ───────────────────────────────────────────────
echo "[backup] Cleaning up local temp files..."
rm -f "${DUMP_FILE}" "${GZ_FILE}" "${ENC_FILE}"
echo "[backup] Local cleanup done."

# ── 6. Retention — delete backups older than 30 days ─────────────────────────
echo "[backup] Enforcing ${RETENTION_DAYS}-day retention policy..."

CUTOFF_DATE=$(date -u -d "${RETENTION_DAYS} days ago" +"%Y-%m-%d" 2>/dev/null \
  || date -u -v-"${RETENTION_DAYS}"d +"%Y-%m-%d")  # macOS fallback

AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 ls "s3://${BUCKET}/" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto \
| while read -r _date _time _size key; do
    # Key format: backup-YYYY-MM-DD-HHmmss.sql.gz.gpg
    KEY_DATE=$(echo "${key}" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1 || true)
    if [[ -n "${KEY_DATE}" && "${KEY_DATE}" < "${CUTOFF_DATE}" ]]; then
      echo "[backup] Deleting old backup: ${key} (date: ${KEY_DATE})"
      AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
      AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
        aws s3 rm "s3://${BUCKET}/${key}" \
        --endpoint-url "${R2_ENDPOINT}" \
        --region auto
    fi
  done

echo "[backup] Retention cleanup done."
echo "[backup] Backup finished successfully: ${OBJECT_KEY}"
