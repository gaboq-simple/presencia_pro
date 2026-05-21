# DEPLOY — presenciapro / apps/lifestyle

> Guia de deployment para la app de lifestyle (Next.js 16 + Supabase + Edge Functions).

---

## Flujo normal de produccion

```
git push origin main
  → Vercel webhook detecta el push
    → Build automatico de apps/lifestyle (rootDirectory configurado en Vercel)
      → Deploy a produccion si el build pasa
```

No hay paso de aprovacion manual. Cualquier push a `main` despliega a produccion.

**Por eso: nunca pushear directo a main sin haber probado localmente o en preview.**

---

## Prerequisitos

- Node.js 20+ (el proyecto usa Next.js 16 con Turbopack)
- Vercel CLI: `npm i -g vercel` (opcional, para inspeccionar y rollback)
- Supabase CLI: `npm i -g supabase` (para migraciones y edge functions)
- Acceso a Vercel con permisos de deployment
- Acceso a Supabase con permisos de admin

---

## Pre-deploy checklist

Antes de cada push a `main`:

- [ ] Lint passing: `cd apps/lifestyle && npm run lint`
- [ ] Type-check passing: `cd apps/lifestyle && npm run type-check` (o `tsc --noEmit`)
- [ ] Si hay migraciones nuevas: aplicadas en staging primero, luego en produccion
- [ ] Si se agregan env vars nuevas: configuradas en Vercel antes del deploy
- [ ] Si se modifican edge functions: redesplegar manualmente (no auto-deploy)
- [ ] Si es cambio mayor: tomar snapshot/backup de la BD si Supabase Pro esta activo

---

## Hacer deploy

### Opcion A — Push a main (normal)

```bash
git add .
git commit -m "feat/fix: descripcion del cambio"
git push origin main
```

Vercel inicia el build automaticamente. Ver progreso en Vercel Dashboard → Deployments.

### Opcion B — Deploy manual via CLI

```bash
# Preview (no afecta produccion)
vercel --cwd apps/lifestyle

# Produccion
vercel --cwd apps/lifestyle --prod
```

---

## Verificar deploy exitoso

1. Vercel Dashboard → Deployments → confirmar estado "Ready" (verde)
2. Revisar build logs en busca de warnings criticos
3. Visitar `https://[NEXT_PUBLIC_APP_URL]/api/health` — debe retornar `200 OK`
   - Nota: este endpoint existe solo si S3-OPS-01 esta completo. Si no, verificar manualmente.
4. Login al dashboard de un negocio de prueba: `[APP_URL]/dashboard?token=[token]`
5. Enviar mensaje de prueba al bot de WhatsApp del negocio de prueba
6. Verificar que las citas del dia se ven correctamente en el panel del asistente

---

## Rollback en Vercel

```bash
# Ver deployments recientes
vercel ls --cwd apps/lifestyle

# Promover un deployment anterior a produccion
vercel promote [deployment-url] --scope [team]
```

O via Dashboard: Vercel → Deployments → encontrar el deployment anterior → "..." → "Promote to Production".

El rollback es inmediato (cambio de routing, no rebuild).

---

## Aplicar migraciones de Supabase

Las migraciones viven en `apps/lifestyle/supabase/migrations/`. Se aplican manualmente — no hay auto-migration en el build de Vercel.

### Con Supabase CLI (recomendado)

```bash
# Autenticar (solo primera vez)
supabase login

# Aplicar todas las migraciones pendientes al proyecto remoto
supabase db push --project-ref [project-ref]

# Ver migraciones aplicadas
supabase migration list --project-ref [project-ref]
```

### Con SQL directo (alternativa)

```bash
# Aplicar una migracion especifica
psql "$SUPABASE_DB_URL" -f apps/lifestyle/supabase/migrations/[nombre].sql
```

O via Supabase Dashboard → SQL Editor: pegar el contenido de la migracion y ejecutar.

**Importante:** aplicar migraciones ANTES del deploy del codigo que las requiere. Si el codigo llega primero, puede fallar hasta que la BD este actualizada.

---

## Desplegar edge functions

Las edge functions no se despliegan automaticamente con el push a main. Deben desplegarse manualmente cuando hay cambios.

```bash
# Autenticar Supabase CLI
supabase login

# Desplegar una funcion especifica
supabase functions deploy dispatch-lifestyle-notifications \
  --project-ref [project-ref] \
  --no-verify-jwt

supabase functions deploy dispatch-auto-cancel \
  --project-ref [project-ref] \
  --no-verify-jwt
```

Despues de desplegar, verificar en Supabase Dashboard → Edge Functions que la funcion esta activa y que los Schedules siguen configurados (cron `* * * * *`).

**Los Schedules NO se despliegan con el codigo.** Si se eliminan o el proyecto se recrea, deben reconfigurarse manualmente en Supabase Dashboard.

---

## Rollback de Supabase

Supabase no tiene rollback automatico de migraciones. Opciones:

1. **PITR (Supabase Pro):** restaurar a un punto anterior al deploy. Ver RUNBOOK.md → seccion 6.
2. **Migration de reversion manual:** escribir una migracion `[numero]_revert_[nombre].sql` que deshaga los cambios y aplicarla.
3. **Para cambios aditivos (ADD COLUMN, CREATE TABLE):** simplemente no son urgentes — el codigo viejo ignora columnas nuevas.

---

## Variables de entorno en Vercel

### Ver variables actuales

Vercel Dashboard → proyecto → Settings → Environment Variables.

### Agregar/editar una variable

1. Vercel Dashboard → Settings → Environment Variables → Add New
2. Seleccionar en que environments aplica (Production, Preview, Development)
3. Guardar
4. Si la variable afecta el runtime (no solo build-time): trigger redeploy

### Variables que requieren redeploy al cambiar

Todas las variables de servidor (no `NEXT_PUBLIC_*`) requieren redeploy para tomar efecto en funciones existentes. Las `NEXT_PUBLIC_*` requieren rebuild.

### Sincronizar env vars a local

```bash
vercel env pull apps/lifestyle/.env.local --cwd apps/lifestyle
```

---

## Configurar un nuevo ambiente (staging)

1. Crear nuevo proyecto en Vercel apuntando al mismo repo, `rootDirectory: apps/lifestyle`, branch: `staging` (o el que corresponda)
2. Configurar todas las env vars del nuevo ambiente (SUPABASE_URL apuntando a un proyecto Supabase de staging, etc.)
3. Crear un proyecto Supabase separado para staging
4. Aplicar todas las migraciones al proyecto de staging:
   ```bash
   supabase db push --project-ref [staging-project-ref]
   ```
5. Desplegar edge functions al proyecto de staging
6. Configurar los Schedules manualmente en el proyecto de staging

No existe staging configurado actualmente — toda prueba se hace en local o en preview deployments de Vercel.
