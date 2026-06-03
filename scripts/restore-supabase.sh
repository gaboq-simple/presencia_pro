#!/usr/bin/env bash
# restore-supabase.sh — Download, decrypt, and prepare a Supabase backup for manual restore
#
# Usage:
#   ./scripts/restore-supabase.sh backup-2026-05-21-030000.sql.gz.gpg
#
# Required environment variables:
#   BACKUP_ENCRYPTION_PASSPHRASE  — GPG symmetric passphrase used during backup
#   R2_ACCESS_KEY_ID              — Cloudflare R2 access key
#   R2_SECRET_ACCESS_KEY          — Cloudflare R2 secret key
#   R2_ENDPOINT                   — Cloudflare R2 S3-compatible endpoint URL
#
# This script DOES NOT execute the restore automatically.
# It prepares the .sql file and prints the psql command for manual execution.

set -euo pipefail

# ── Validate arguments ────────────────────────────────────────────────────────
if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <backup-filename>"
  echo "Example: $0 backup-2026-05-21-030000.sql.gz.gpg"
  echo ""
  echo "To list available backups:"
  echo "  AWS_ACCESS_KEY_ID=\$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=\$R2_SECRET_ACCESS_KEY \\"
  echo "    aws s3 ls s3://presenciapro-backups/ --endpoint-url \$R2_ENDPOINT --region auto"
  exit 1
fi

OBJECT_KEY="$1"
BUCKET="presenciapro-backups"
WORK_DIR="/tmp/supabase-restore-$$"
ENC_FILE="${WORK_DIR}/${OBJECT_KEY}"
GZ_FILE="${ENC_FILE%.gpg}"
SQL_FILE="${GZ_FILE%.gz}"

# ── Validate required env vars ────────────────────────────────────────────────
: "${BACKUP_ENCRYPTION_PASSPHRASE:?Missing BACKUP_ENCRYPTION_PASSPHRASE}"
: "${R2_ACCESS_KEY_ID:?Missing R2_ACCESS_KEY_ID}"
: "${R2_SECRET_ACCESS_KEY:?Missing R2_SECRET_ACCESS_KEY}"
: "${R2_ENDPOINT:?Missing R2_ENDPOINT}"

echo "[restore] Preparing restore for: ${OBJECT_KEY}"
mkdir -p "${WORK_DIR}"

# ── 1. Download from R2 ───────────────────────────────────────────────────────
echo "[restore] Downloading from R2: s3://${BUCKET}/${OBJECT_KEY}"
AWS_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID}" \
AWS_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY}" \
  aws s3 cp "s3://${BUCKET}/${OBJECT_KEY}" "${ENC_FILE}" \
  --endpoint-url "${R2_ENDPOINT}" \
  --region auto
echo "[restore] Downloaded: $(du -sh "${ENC_FILE}" | cut -f1)"

# ── 2. Decrypt ────────────────────────────────────────────────────────────────
echo "[restore] Decrypting..."
gpg --batch \
    --yes \
    --passphrase "${BACKUP_ENCRYPTION_PASSPHRASE}" \
    --output "${GZ_FILE}" \
    --decrypt "${ENC_FILE}"
rm -f "${ENC_FILE}"
echo "[restore] Decrypted."

# ── 3. Decompress ─────────────────────────────────────────────────────────────
echo "[restore] Decompressing..."
gunzip "${GZ_FILE}"
echo "[restore] Ready: ${SQL_FILE} ($(du -sh "${SQL_FILE}" | cut -f1))"

# ── 4. Print restore instructions ────────────────────────────────────────────
echo ""
echo "=================================================================="
echo " BACKUP READY — DO NOT RUN THIS AUTOMATICALLY"
echo "=================================================================="
echo ""
echo " SQL file prepared at:"
echo "   ${SQL_FILE}"
echo ""
echo " To restore into a Supabase project, run the following command"
echo " replacing DB_URL with your target database connection string:"
echo ""
echo "   psql \"\${DB_URL}\" < ${SQL_FILE}"
echo ""
echo " You can find the DB_URL in:"
echo "   Supabase Dashboard → Settings → Database → Connection string"
echo "   (use the 'URI' format, NOT the pooler)"
echo ""
echo " WARNINGS:"
echo "   - This will OVERWRITE existing data in the target database."
echo "   - Run against a STAGING project first to verify integrity."
echo "   - Verify after restore:"
echo "     psql \"\${DB_URL}\" -c 'SELECT COUNT(*) FROM businesses;'"
echo "     psql \"\${DB_URL}\" -c 'SELECT COUNT(*) FROM customers;'"
echo "     psql \"\${DB_URL}\" -c 'SELECT COUNT(*) FROM appointments;'"
echo ""
echo " To clean up temp files after restore:"
echo "   rm -rf ${WORK_DIR}"
echo "=================================================================="
