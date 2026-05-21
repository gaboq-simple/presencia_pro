# scripts/

Utility scripts for presenciapro operations. Run from the repo root unless noted otherwise.

---

## backup-supabase.sh

Dumps the Supabase database, encrypts it with GPG, uploads to Cloudflare R2, and enforces 30-day retention.

### What it does

1. `supabase db dump` — full schema + data dump
2. `gzip -9` — compress
3. `gpg --symmetric --cipher-algo AES256` — encrypt with passphrase
4. `aws s3 cp` to `presenciapro-backups` bucket (S3-compatible Cloudflare R2)
5. Deletes any backup in the bucket older than 30 days
6. Cleans up all local temp files

### Object naming

```
backup-YYYY-MM-DD-HHmmss.sql.gz.gpg
```

### Required environment variables

| Variable | Description |
|---|---|
| `SUPABASE_PROJECT_REF` | Project ref (e.g. `uhhatetytaucucihfyyy`) |
| `SUPABASE_ACCESS_TOKEN` | Supabase PAT with read access |
| `BACKUP_ENCRYPTION_PASSPHRASE` | Passphrase for GPG encryption |
| `R2_ACCESS_KEY_ID` | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloudflare R2 secret key |
| `R2_ENDPOINT` | R2 S3-compatible endpoint URL |

### Run manually

```bash
export SUPABASE_PROJECT_REF=uhhatetytaucucihfyyy
export SUPABASE_ACCESS_TOKEN=...
export BACKUP_ENCRYPTION_PASSPHRASE=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_ENDPOINT=...

bash scripts/backup-supabase.sh
```

### Automated schedule

`.github/workflows/backup-weekly.yml` runs this script every Sunday at 03:00 UTC and on manual trigger (`workflow_dispatch`). Secrets are stored in GitHub → Repository Settings → Secrets.

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
