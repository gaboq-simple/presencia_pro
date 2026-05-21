# onboarding/

Esta carpeta contiene los checklists generados por `apps/lifestyle/scripts/onboard-business.ts` al provisionar cada negocio.

## Archivos

- `{slug}-checklist.md` — generado automáticamente al correr el script de onboarding.
  Contiene tokens de acceso y PINs del staff — **NO commitear al repo** (ver .gitignore).

## Uso

```bash
npx tsx apps/lifestyle/scripts/onboard-business.ts <config.json>
```

Al terminar, el script crea `onboarding/{slug}-checklist.md` con los pasos manuales pendientes (webhook Meta, phone_number_id, crons Supabase, entrega de credenciales).
