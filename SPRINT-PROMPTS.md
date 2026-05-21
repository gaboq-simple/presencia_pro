# SPRINT-PROMPTS — Prompts pre-armados para Claude Code

> **Cómo usar este archivo:** abre la tarea correspondiente en `SPRINT.md`, busca su ID aquí, copia el bloque entre `---` y pégalo en Claude Code. Gabriel no necesita escribir prompts — solo copiar.
>
> **Regla de oro:** los prompts asumen que Claude Code ya leyó `SPRINT.md`. Si abre sesión nueva, el primer mensaje siempre debe ser "lee SPRINT.md completo y dime en qué tarea estamos".

---

## S1-SEC-01 — Fix R1: webhook Meta fail-open

```
Tarea: S1-SEC-01 de SPRINT.md.

Contexto: el webhook de WhatsApp Meta en apps/lifestyle/src/app/api/bot/route.ts tiene un fail-open. La función verifyMetaSignature() puede devolver null cuando falta META_APP_SECRET, y el check `if (signatureValid === false)` no captura ese caso. Resultado: requests sin firma se procesan.

Acciones específicas:

1. Lee apps/lifestyle/src/app/api/bot/route.ts y localiza la función handleMetaPost y verifyMetaSignature.

2. Lee packages/engine/src/notifications/verifyWebhookSignature.ts (o el equivalente en el engine que mencioné en mi reporte) para confirmar que existe una implementación fail-closed.

3. Si existe la versión del engine: importarla en el route y eliminar la implementación local. Si no existe o difiere, refactorizar la del route para que sea fail-closed.

4. Cambia el check a algo equivalente a `if (signatureValid !== true) return 401`. Cualquier valor distinto de `true` debe rechazar.

5. Si META_APP_SECRET no está configurado, el endpoint debe responder 401 con body claro tipo {"error":"webhook signature secret not configured"}, NO procesar el payload.

6. Verifica con grep que no haya otra reimplementación de verificación Meta en el código.

7. NO toques el verify_token del GET handshake — eso ya funciona bien.

8. Reporta al final: archivos modificados, qué se eliminó, qué se importó.

Criterios de aceptación (de SPRINT.md):
- [ ] El check cambia a fail-closed
- [ ] Si META_APP_SECRET falta, responde 401
- [ ] Se elimina la implementación duplicada
- [ ] No hay otra verificación Meta reimplementada en el codebase

NO modifiques otras partes del bot route. NO refactorices más allá de esto. NO inicies tareas siguientes sin confirmación.
```

---

## S1-SEC-02 — Verificar historial git por credenciales filtradas

```
Tarea: S1-SEC-02 de SPRINT.md.

Contexto: el reporte de Phase 4 detectó que apps/lifestyle/.env.local contiene credenciales reales (Anthropic key, Supabase service role, Twilio token). Necesito confirmar si alguna vez entraron al historial de git.

Acciones específicas:

1. Corre estos comandos y reporta literal el output:
   git log --all --full-history --source -- '**/.env'
   git log --all --full-history --source -- '**/.env.local'
   git log --all --full-history --source -- '**/.env.production'
   git log --all --full-history --source -- '**/.env*'

2. Si alguno retorna commits:
   - Lista los commits con hash, fecha, autor, mensaje
   - Para cada commit, identifica si el archivo fue agregado, modificado o eliminado
   - NO intentes "limpiar" el historial con git filter-branch ni git filter-repo en esta tarea
   - Reporta a Gabriel para que decida si reescribir historial (decisión costosa: rompe forks/clones)

3. Verifica que el .gitignore raíz excluya .env*:
   grep -E "^\.env" .gitignore
   
   Y verifica .gitignore en cada workspace:
   ls -la apps/lifestyle/.gitignore packages/engine/.gitignore 2>/dev/null || echo "no hay gitignore en workspace"

4. Lista las variables que veas en apps/lifestyle/.env.local SIN imprimir sus valores. Solo los nombres. Ejemplo: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, etc.

5. Genera un checklist de rotación para Gabriel con un bloque tipo:
   - [ ] Rotar ANTHROPIC_API_KEY en console.anthropic.com → Settings → API Keys
   - [ ] Rotar SUPABASE_SERVICE_ROLE_KEY en supabase.com → Project Settings → API
   - [ ] Rotar TWILIO_AUTH_TOKEN en console.twilio.com
   - [ ] Actualizar .env.local con keys nuevas
   - [ ] Actualizar env vars en Vercel Dashboard (production + preview)
   - [ ] Verificar que apps siguen funcionando tras rotación

6. NO ejecutes la rotación. Solo prepara el checklist.

Reporta al final: si hubo hits o no, qué env vars existen, checklist generado.
```

---

## S1-SEC-03 — Apagar dra-quevedo deploy en Vercel

```
Tarea: S1-SEC-03 de SPRINT.md.

Contexto: dra-quevedo es un experimento que se va a archivar. Mientras Gabriel apaga el deploy en Vercel, tú vas a marcar el código como archivado y prevenir deploys accidentales futuros.

Acciones específicas:

1. Crea o actualiza clients/dra-quevedo/README.md con este contenido:

```
# dra-quevedo — EXPERIMENTO ARCHIVADO

**Estado:** archivado el [FECHA — Claude Code: poner fecha actual]
**Motivo:** experimento de aplicación del engine genérico a vertical médica. No es un cliente real, no es un producto activo de Zentriq.

## NO desplegar

Este proyecto NO debe desplegarse en Vercel ni recibir nuevo trabajo. Su data en Supabase se preserva para referencia pero no se opera.

## Si se quiere retomar

Ver SPRINT.md → backlog post-sprint, ítem "Separar dra-quevedo a otro repo". El plan es moverlo a su propio repositorio antes de cualquier reanudación.

## Contacto

Gabriel — contacto@zentriq.mx
```

2. Verifica el vercel.json raíz: confirma que el ignoreCommand sigue activo. Pega su contenido.

3. Lee clients/dra-quevedo/vercel.json y reporta su contenido.

4. NO borres ningún archivo. NO toques migrations. NO modifiques código de la app.

5. Reporta al final: README creado/actualizado, contenido de vercel.json raíz y clients/dra-quevedo/vercel.json, recordatorio a Gabriel de pausar el deploy en Vercel Dashboard.
```

---

## S1-SEC-04 — Habilitar RLS en `organizations`

```
Tarea: S1-SEC-04 de SPRINT.md.

Contexto crítico: la tabla `organizations` (creada en apps/lifestyle/supabase/migrations/021_organizations.sql) NO tiene RLS habilitado. Cualquier usuario authenticated puede `SELECT * FROM organizations` y obtener `access_token` de todas las cadenas, lo cual les da acceso completo a las sucursales de esas organizaciones via el proxy.

Antes de implementar, investiga:

1. Lee apps/lifestyle/supabase/migrations/021_organizations.sql completo y entiende el schema de organizations (columnas, FKs, propósito).

2. Lee apps/lifestyle/supabase/migrations/002_rls_policies.sql (o donde estén las funciones SECURITY DEFINER) y entiende el patrón de ls_staff_business_id(), ls_staff_role(), etc.

3. Lee apps/lifestyle/src/proxy.ts y apps/lifestyle/src/lib/auth.ts (o equivalente) para entender cómo se usa el access_token de organization. Específicamente: ¿se busca via service_role bypass o se busca con cliente authenticated?

Reporta lo que encontraste antes de escribir la migration. Espera mi confirmación de la estrategia de RLS antes de proceder.

Una vez confirmada la estrategia, crea la migration en apps/lifestyle/supabase/migrations/ con el siguiente número disponible (probablemente 024_organizations_rls.sql o similar — verifica primero los números existentes).

La migration debe:
- ENABLE ROW LEVEL SECURITY ON organizations
- Policy SELECT: el caller solo puede leer organizaciones donde tenga acceso vía staff o vía sesión de organization. La forma exacta depende de la investigación anterior.
- Policy UPDATE: solo admin via SECURITY DEFINER, o solo service_role
- Policies INSERT y DELETE: solo service_role

Criterios de aceptación finales:
- [ ] Migration aplica limpia con `supabase db reset` local
- [ ] Un user authenticated arbitrario que haga SELECT * FROM organizations retorna 0 filas (probarlo en consola SQL local con auth.uid simulado)
- [ ] La lógica existente del proxy sigue funcionando (no romper logins por token)
- [ ] NO ejecutes la migration contra el proyecto de producción. Solo crear el archivo y probar localmente.

NO pushees a producción. NO toques otras tablas. Reporta al final con archivos creados.
```

---

## S1-SEC-05 — Fix R4: escalada de rol via `ls_staff_update_self`

```
Tarea: S1-SEC-05 de SPRINT.md.

Contexto: la policy `ls_staff_update_self` permite que un staff (incluso un barber) haga `UPDATE staff SET role = 'admin' WHERE id = ls_staff_id()` y escale a admin. La policy usa `USING (id = ls_staff_id())` sin restringir qué columnas se pueden modificar.

Acciones:

1. Localiza la policy en apps/lifestyle/supabase/migrations/ (probablemente 002_rls_policies.sql). Pega su definición textual.

2. Investiga las opciones técnicas:
   - Opción A: trigger BEFORE UPDATE que rechace cambios en columnas sensibles (role, business_id, auth_id, pin) si el caller no es admin
   - Opción B: dos policies separadas con WITH CHECK que compare OLD vs NEW (requiere función helper)
   - Opción C: revocar UPDATE sobre las columnas sensibles vía column privileges (PostgreSQL soporta esto)

Reporta cuál opción prefieres con justificación y espera confirmación antes de implementar.

Una vez confirmada la opción, implementa en una nueva migration (siguiente número disponible).

Criterios de aceptación:
- [ ] Un staff role=barber NO puede cambiar su propio role
- [ ] Un staff role=barber NO puede cambiar su propio business_id
- [ ] Un staff role=barber NO puede cambiar su propio auth_id
- [ ] Un staff role=barber SÍ puede cambiar su propio name, photo_url (si existe), y cualquier campo benigno
- [ ] Un admin puede cambiar todo dentro de su negocio
- [ ] Migration aplica limpia local

NO pushees a producción. Reporta al final.
```

---

## S1-SEC-06 — Fix R5: customers UPDATE sin restricción

```
Tarea: S1-SEC-06 de SPRINT.md.

Contexto: la policy UPDATE de customers permite a cualquier staff modificar cualquier registro de cualquier cliente del negocio, INCLUYENDO el campo business_id. Un staff podría mover un cliente al negocio de un competidor si conoce ese UUID.

Acciones:

1. Pega la policy UPDATE actual de customers desde apps/lifestyle/supabase/migrations/002_rls_policies.sql (o donde esté).

2. Crea migration que reemplaza la policy con una que tenga WITH CHECK (business_id = ls_staff_business_id()).

3. Considera si reducir el USING también para que barber/assistant solo puedan actualizar customers con quienes tienen citas (consistencia con SELECT). Pregunta a Gabriel antes si esto puede romper flujos. Por defecto, mantener USING permisivo (cualquier staff del negocio) pero hacer el WITH CHECK estricto.

Criterios de aceptación:
- [ ] Un staff NO puede cambiar business_id de un customer
- [ ] El staff sigue pudiendo actualizar notes, favorite_*, phone, etc.
- [ ] Migration aplica limpia local

NO pushees a producción.
```

---

## S1-SEC-07 — Security headers HTTP

```
Tarea: S1-SEC-07 de SPRINT.md.

Acciones:

1. Lee apps/lifestyle/next.config.ts.

2. Agrega una función `async headers()` que retorne estos headers para todas las rutas:
   - Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
   - X-Frame-Options: SAMEORIGIN
   - X-Content-Type-Options: nosniff
   - Referrer-Policy: strict-origin-when-cross-origin
   - Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()

3. Content-Security-Policy: investiga los dominios externos que el dashboard y el mini-sitio necesitan (Supabase URLs, posibles CDNs, fonts). Empieza con un CSP en modo Content-Security-Policy-Report-Only para evitar romper algo. NO uses enforce todavía.

   Sugerencia inicial (ajustar tras investigación):
   - default-src 'self'
   - script-src 'self' 'unsafe-inline'  (Next requiere unsafe-inline para hidration)
   - style-src 'self' 'unsafe-inline'
   - img-src 'self' data: blob: https://*.supabase.co
   - connect-src 'self' https://*.supabase.co https://api.anthropic.com
   - font-src 'self' data:
   - frame-ancestors 'self'

4. Probar localmente con `npm run dev --workspace=apps/lifestyle`:
   - Navegar a / (mini-sitio público de algún business si hay datos seed)
   - Navegar a /login
   - Navegar a /dashboard (si hay token de test)
   - Verificar en DevTools → Network → Response Headers que aparecen
   - Verificar en Console que no haya errores de CSP en Report-Only

5. Lee también si el sellers-portal tiene next.config.ts y si conviene aplicar los mismos headers. Reporta pero NO modifiques sellers-portal en esta tarea (fuera de scope).

Criterios de aceptación:
- [ ] next.config.ts retorna los 5 headers básicos
- [ ] CSP en Report-Only
- [ ] Dashboard, login y mini-sitio siguen funcionando localmente
- [ ] No hay errores de CSP en consola con configuración base

NO toques producción. Reporta al final.
```

---

## S1-SEC-08 — Fix JSON-LD `</script>` escape

```
Tarea: S1-SEC-08 de SPRINT.md.

Acciones:

1. Lee apps/lifestyle/src/app/[slug]/page.tsx, encuentra el bloque del script type="application/ld+json" alrededor de la línea 335.

2. Reemplaza `JSON.stringify(jsonLd)` por una función que escape los caracteres peligrosos:

   const safeJsonLd = JSON.stringify(jsonLd)
     .replace(/</g, '\\u003c')
     .replace(/>/g, '\\u003e')
     .replace(/&/g, '\\u0026')
     .replace(/\u2028/g, '\\u2028')
     .replace(/\u2029/g, '\\u2029');

3. O extrae en una utility helper en apps/lifestyle/src/lib/json-ld.ts si conviene.

4. Test manual: temporalmente edita un business en local con `description = 'normal text </script><script>alert(1)</script> end'` y verifica que el HTML renderizado escapa correctamente (ver source HTML, no debe romper el tag).

Criterios de aceptación:
- [ ] El escape funciona para </script>, &, line separators
- [ ] No rompe JSON-LD válido (probar con Google Rich Results Test si es posible, o al menos validar el JSON parsea)

Reporta al final.
```

---

## S1-SEC-09 — Cookie session 30 → 7 días

```
Tarea: S1-SEC-09 de SPRINT.md.

Acciones:

1. Localiza dónde se setea la cookie `ls_session`. Probable: apps/lifestyle/src/lib/auth.ts o un helper de cookies.

2. Cambia maxAge de 30 días (2592000 segundos) a 7 días (604800 segundos).

3. Verifica que la cookie sigue teniendo: httpOnly: true, sameSite: 'lax', secure: true en producción, path: '/'.

4. Documenta en un comentario inline el motivo del cambio: "// Reducido de 30 a 7 días — Phase 4 R10 / TODO M-2."

Criterios de aceptación:
- [ ] maxAge cambiado
- [ ] Comentario inline presente
- [ ] No se rompen otras cookies

Reporta al final.
```

---

## S1-OPS-01 — Supabase Pro + PITR + dump externo

```
Tarea: S1-OPS-01 de SPRINT.md.

PARTE A (humana, Gabriel hace):
- Upgrade del proyecto Supabase a Pro plan
- Activar PITR en Settings → Database
- Confirmar a Claude Code cuando esté listo

PARTE B (Claude Code hace tras confirmación):

1. Crea scripts/backup-supabase.sh con este pseudoflujo:
   - Requiere env vars: SUPABASE_DB_URL (postgres connection string), BACKUP_ENCRYPTION_PASSPHRASE, BACKUP_S3_BUCKET o BACKUP_R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
   - Genera timestamp ISO
   - Corre `pg_dump --no-owner --no-acl "$SUPABASE_DB_URL" | gzip > /tmp/backup-{timestamp}.sql.gz`
   - Encripta: `gpg --batch --symmetric --passphrase-file <(echo $BACKUP_ENCRYPTION_PASSPHRASE) /tmp/backup-{timestamp}.sql.gz`
   - Sube con AWS CLI a S3 o con rclone a R2: `aws s3 cp /tmp/backup-{timestamp}.sql.gz.gpg s3://$BACKUP_S3_BUCKET/`
   - Limpia /tmp
   - Imprime "Backup uploaded: s3://...".

2. Investiga si Gabriel prefiere S3, Cloudflare R2, o Backblaze B2. Pregunta antes de asumir.

3. Crea una nota en scripts/README.md (o créalo si no existe) explicando cómo correr el script y las env vars que requiere.

4. Documenta en SPRINT.md → Bitácora que se creó el script.

5. NO ejecutes el script todavía. Espera a que Gabriel confirme env vars y bucket creado.

6. Para automatizar el cron semanal, dos opciones:
   - Opción A: GitHub Actions workflow `.github/workflows/backup-weekly.yml` que corre el script (necesita secrets configurados)
   - Opción B: Supabase Edge Function programada con pg_cron-like schedule
   
   Recomendación: A. Más portable, más visible, secrets en un solo lugar.

7. Para el RESTORE DRILL (criterio crítico de la tarea):
   - Documenta el procedimiento de restore en draft de RUNBOOK.md
   - NO ejecutes el drill ahora. El drill se hace en S4-OPS-02.

Criterios de aceptación:
- [ ] Script de backup creado y testeable localmente
- [ ] Workflow de GH Actions (o Supabase Function) que automatiza weekly
- [ ] Procedimiento de restore documentado (para drill posterior)

Reporta al final qué creaste y qué env vars/secretos necesita Gabriel configurar.
```

---

## S1-OPS-02 — Rate limiting distribuido

```
Tarea: S1-OPS-02 de SPRINT.md.

Decisión técnica primero:
- Upstash Redis: free tier 10k commands/day, REST API, integración fácil con Vercel
- Vercel KV: integrado nativo, free tier limitado

Recomendación: Upstash Redis. Más portable.

Acciones:

1. Pregunta a Gabriel si tiene preferencia o si va con Upstash. Si Upstash, Gabriel crea cuenta y comparte UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN.

2. Una vez confirmado, instala @upstash/ratelimit y @upstash/redis en apps/lifestyle:
   npm install --workspace=apps/lifestyle @upstash/ratelimit @upstash/redis

3. Crea apps/lifestyle/src/lib/rate-limit.ts con:
   - Cliente Redis singleton
   - Función limit(identifier, max, windowSec) que devuelve { success, limit, remaining, reset }

4. Aplica a apps/lifestyle/src/app/api/auth/pin/route.ts:
   - Reemplaza el rate limiter in-memory
   - Identifier: combinar IP (de x-forwarded-for) + business_id si está en el body
   - Límite: 5 intentos / 60s
   - Bloqueo de 15 min tras exceder: implementar con un segundo Redis key con TTL
   - Respuesta 429 con Retry-After

5. Aplica a apps/lifestyle/src/app/api/bot/route.ts:
   - Identifier: el `phone_number_id` o el sender phone del payload de Meta
   - Límite: 30 mensajes / 60s
   - 429 silencioso si excede (no responder al webhook, o responder 200 sin procesar)

6. Manejo de errores: si Redis está caído, la decisión por defecto debe ser "permitir" (fail-open en rate limit, no en seguridad — un rate limit caído NO debe bloquear PINs legítimos). Loguea el error pero permite el request.

7. Test local: simular 6 intentos de PIN seguidos, verificar que el 6to falla con 429.

Criterios de aceptación:
- [ ] Rate limit distribuido funcional en /api/auth/pin
- [ ] Rate limit distribuido funcional en /api/bot
- [ ] Fail-open si Redis está caído
- [ ] 429 con Retry-After correcto
- [ ] No rompe flujos válidos

Reporta al final.
```

---

## S2-LEG-01 — Publicar /aviso-de-privacidad

```
Tarea: S2-LEG-01 de SPRINT.md.

DEPENDENCIA: S2-G-01 (Gabriel debe traer el aviso del abogado). NO procedas sin el archivo.

Una vez Gabriel comparta el aviso (típicamente .md o .pdf):

1. Si es .md: crear apps/lifestyle/src/app/aviso-de-privacidad/page.tsx que renderiza el contenido como una página estática server-component, con tipografía legible (max-width 65ch, padding generoso).

2. Si es .pdf: subir a apps/lifestyle/public/aviso-de-privacidad.pdf y la ruta /aviso-de-privacidad puede ser una página simple que linkea al PDF + un summary del contenido.

3. Pregunta a Gabriel: ¿el aviso vive en zentriq.mx o en presenciapro.com? Si en zentriq.mx, no crear ruta local — solo link desde el footer.

4. Agrega link en:
   - Footer del dashboard (apps/lifestyle/src/components/.../Footer.tsx o equivalente)
   - Footer del mini-sitio /[slug] (apps/lifestyle/src/components/site/Footer.tsx)
   - Aviso al final del bot WhatsApp: en el primer mensaje al cliente, agregar línea tipo "Al continuar aceptas nuestro aviso de privacidad: https://..."

5. Si el aviso tiene fecha de última actualización, ponerla visible en la página.

Criterios de aceptación:
- [ ] Aviso accesible públicamente sin auth
- [ ] Links en ambos footers
- [ ] Mensaje del bot menciona el aviso en primer contacto

Reporta al final.
```

---

## S2-LEG-02 — Captura de consentimiento en `customers`

```
Tarea: S2-LEG-02 de SPRINT.md.

Acciones:

1. Crea migration en apps/lifestyle/supabase/migrations/ con siguiente número disponible:
   - ALTER TABLE customers ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
   - ALTER TABLE customers ADD COLUMN IF NOT EXISTS consented_via TEXT;
   - COMMENT ON COLUMN customers.consent_at IS 'Timestamp del consentimiento al tratamiento de datos personales bajo LFPDPPP.';
   - COMMENT ON COLUMN customers.consented_via IS 'Mecanismo: whatsapp_first_message, manual_admin, etc.';
   - Backfill: UPDATE customers SET consent_at = created_at, consented_via = 'historical_inferred' WHERE consent_at IS NULL;

2. Localiza packages/engine/src/bot/lifestyle/handler.ts. Encuentra el upsert de customers (donde se crea el cliente al primer mensaje).

3. Modifica el upsert para que:
   - En INSERT: setee consent_at = NOW(), consented_via = 'whatsapp_first_message'
   - En UPDATE/conflict: NO toque consent_at ni consented_via (preserve los originales)
   
   Esto puede requerir cambiar de .upsert() a .insert() con onConflict ignorante, o usar dos paths (check first, then insert if not exists).

4. Test: simular primer mensaje de un nuevo cliente, verificar que consent_at queda registrado.

Criterios de aceptación:
- [ ] Migración aplicada limpia
- [ ] Customers existentes tienen consent_at = created_at
- [ ] Customers nuevos al primer mensaje tienen consent_at = NOW()
- [ ] Upserts posteriores no sobrescriben consent_at

Reporta al final.
```

---

## S2-LEG-03 — Endpoint ARCO mínimo

```
Tarea: S2-LEG-03 de SPRINT.md.

Acciones:

1. Crea apps/lifestyle/src/app/arco/page.tsx (server component) con formulario:
   - Nombre completo (required)
   - Teléfono o email (al menos uno, required)
   - Tipo de solicitud (radio): Acceso, Rectificación, Cancelación, Oposición
   - Descripción de la solicitud (textarea, required)
   - Checkbox: "Acepto el aviso de privacidad" (required)
   - Botón submit

2. Server action que recibe el form y envía email a contacto@zentriq.mx. Opciones para email:
   - Resend (https://resend.com) — free tier 100 emails/día
   - Email via API de Postmark, SendGrid
   - Pregunta a Gabriel cuál prefiere o si ya tiene uno configurado para reportes semanales

3. Página de confirmación tras submit: "Hemos recibido tu solicitud. Tienes derecho a respuesta en máximo 20 días hábiles según LFPDPPP. Te contactaremos a [teléfono/email] proporcionado."

4. NO requiere auth. NO almacena la solicitud en DB en esta versión inicial (decisión consciente: minimizar superficie de PII; el email cumple obligación legal).

5. Link desde /aviso-de-privacidad → /arco con texto tipo "Ejerce tus derechos ARCO aquí".

6. Considera rate limiting en el submit del form (5 solicitudes/hora por IP) usando el helper de S1-OPS-02.

Criterios de aceptación:
- [ ] Form funcional, valida campos requeridos
- [ ] Email llega a contacto@zentriq.mx con todos los datos
- [ ] Confirmación al usuario tras submit
- [ ] Rate limited

Reporta al final.
```

---

## S2-OPS-01 — Refactor onboard-business.ts

```
Tarea: S2-OPS-01 de SPRINT.md.

Acciones:

1. Lee apps/lifestyle/scripts/onboard-business.ts completo. Entiende el flujo actual.

2. Identifica dónde se crea el business y dónde quedan los campos whatsapp_number y whatsapp_phone_number_id (probablemente como '').

3. Agrega validación final al script:
   - Si los flags --whatsapp-phone-number y --whatsapp-phone-id NO se pasan, falla con un mensaje claro pidiéndolos
   - Alternativamente: permite que el script termine con warning si no se pasan, pero genera el checklist con esos pasos pendientes resaltados

4. Al final del script, generar un archivo en onboarding/{slug}-checklist.md con plantilla:

```markdown
# Checklist de onboarding: {business_name} ({slug})

Generado: {timestamp}
Estado del onboarding: 60% completo

## ✅ Hecho automáticamente
- [x] Business creado: business_id={id}
- [x] Staff creados: {count} staff
- [x] Services creados: {count} services
- [x] Access tokens generados

## ⚠️ Pasos manuales pendientes

### 1. Registrar webhook en Meta Business Manager
- URL: NEXT_PUBLIC_APP_URL/api/bot
- Verify token: usar WHATSAPP_WEBHOOK_VERIFY_TOKEN actual
- Suscribir a campo: messages

### 2. Obtener phone_number_id de Meta
- Entrar a Meta Business → WhatsApp → Phone Numbers
- Copiar el Phone Number ID del número del negocio
- Actualizar el business: 
  UPDATE businesses SET whatsapp_phone_number_id = '<ID>' WHERE slug = '{slug}';

### 3. Configurar crons de Supabase
- Edge Function: dispatch-lifestyle-notifications → schedule: '* * * * *'
- Edge Function: dispatch-weekly-report → schedule: '0 10 * * 1'

### 4. Entregar credenciales al cliente
- URL admin: NEXT_PUBLIC_APP_URL/dashboard?token={admin_token}
- URL staff: NEXT_PUBLIC_APP_URL/staff
- PINs: ver salida del script (guardar en 1Password antes de enviar)

### 5. Probar
- Mandar mensaje de prueba al WhatsApp del negocio
- Verificar que el bot responde
- Crear cita de prueba
- Verificar que aparece en dashboard

---

Una vez todos los pasos arriba estén ✓, marcar este checklist como done y cerrar onboarding.
```

5. El script imprime al final algo como:
   ```
   ✅ Onboarding 60% completo.
   📋 Checklist en: onboarding/{slug}-checklist.md
   ➡️ Sigue los pasos 1-5 del checklist para completar.
   ```

6. Crea la carpeta onboarding/ en el repo si no existe, con un .gitkeep o README.md.

7. Agrega onboarding/*.md al .gitignore EXCEPTO README.md, ya que los checklists contienen tokens y PINs sensibles.

Criterios de aceptación:
- [ ] Script falla o advierte si faltan campos críticos de WhatsApp
- [ ] Genera checklist en onboarding/{slug}-checklist.md
- [ ] Checklist es claro, copiable, sin ambigüedad
- [ ] onboarding/*.md (excepto README) en .gitignore

Reporta al final.
```

---

## S2-DOC-01 — Crear RUNBOOK.md

```
Tarea: S2-DOC-01 de SPRINT.md.

Acciones:

Crea RUNBOOK.md en la raíz del repo con estructura mínima:

```markdown
# RUNBOOK — presenciapro

> Procedimientos operativos para emergencias e incidentes comunes. Última actualización: {timestamp}

## Información clave

- **Producción Vercel:** [URL]
- **Supabase project ID:** [ID]
- **Supabase Dashboard:** https://supabase.com/dashboard/project/[ID]
- **Meta Business:** [link al business]
- **Anthropic Console:** https://console.anthropic.com
- **Dominio:** zentriq.mx, presenciapro.com (si aplica)
- **DNS:** [proveedor]
- **Contacto técnico primario:** Gabriel — contacto@zentriq.mx
- **Contacto de respaldo emergencia:** [PENDIENTE — definir en S2-DOC-03]

---

## 1. El bot deja de responder

### Síntomas
- Clientes reportan que el bot no contesta
- /api/health retorna error
- Logs de Vercel muestran 500s en /api/bot

### Diagnóstico (en orden)
1. Verificar /api/health en producción → si Supabase está mal, ir al paso 4
2. Verificar Vercel deployment status → si hay outage, esperar
3. Verificar logs recientes en Vercel → buscar errores
4. Verificar status.supabase.com
5. Verificar console.anthropic.com → ¿hay outage? ¿se acabó cuota?
6. Verificar Meta status → developers.facebook.com/status

### Mitigación rápida
- Si problema es Anthropic: el bot tiene fallback. Avisar al cliente del downgrade.
- Si problema es Supabase: nada que hacer hasta que recuperen. Avisar al cliente.
- Si problema es del código: rollback en Vercel a deployment anterior (ver DEPLOY.md → Rollback)

---

## 2. Rotar WHATSAPP_ACCESS_TOKEN

### Cuándo
- Token comprometido
- Rotación regular (cada 60 días sugerido)
- Después de un incidente de seguridad

### Procedimiento
1. Entrar a Meta Business → System Users → Generate New Token
2. Permisos requeridos: whatsapp_business_messaging, whatsapp_business_management
3. Copiar el nuevo token
4. En Vercel: Settings → Environment Variables → WHATSAPP_ACCESS_TOKEN → editar → paste nuevo → save
5. Trigger redeploy de apps/lifestyle (o esperar siguiente deploy normal)
6. Verificar enviando un mensaje de prueba al bot

---

## 3. Regenerar access_token de un business

### Cuándo
- El dueño del negocio reporta que su link de admin fue compartido por error
- Token sospechoso

### Procedimiento
```sql
UPDATE businesses 
SET access_token = encode(gen_random_bytes(32), 'hex')
WHERE slug = '{slug}'
RETURNING access_token;
```

Entregar el nuevo token al dueño por canal seguro (1Password share link, WhatsApp directo en persona, NUNCA email).

---

## 4. Restaurar base de datos desde backup

### Pre-requisitos
- AWS CLI / rclone configurado con credenciales de bucket
- gpg con la passphrase de backup
- psql instalado

### Procedimiento
1. Listar backups disponibles:
   `aws s3 ls s3://[bucket]/`
2. Descargar el backup deseado:
   `aws s3 cp s3://[bucket]/backup-{timestamp}.sql.gz.gpg /tmp/`
3. Desencriptar:
   `gpg --batch --decrypt --passphrase-file <(echo $BACKUP_ENCRYPTION_PASSPHRASE) /tmp/backup-{timestamp}.sql.gz.gpg > /tmp/backup.sql.gz`
4. Descomprimir:
   `gunzip /tmp/backup.sql.gz`
5. Crear proyecto Supabase staging O usar PITR si la pérdida es <7 días
6. Restaurar:
   `psql "$STAGING_DB_URL" -f /tmp/backup.sql`
7. Verificar integridad: contar filas en businesses, customers, appointments
8. Validar funcionalmente con un login de prueba

**Tiempo estimado en drill:** [PENDIENTE — completar tras S4-OPS-02]

---

## 5. Cliente fundador en crisis (escalamiento)

### Niveles
- **L1** (cualquier issue): respuesta <2h en horario laboral
- **L2** (bot caído, data perdida, dashboard inaccesible): respuesta <1h, 24/7 durante piloto
- **L3** (security incident, data leak): respuesta inmediata, notificación a abogado

### Acción inmediata L2/L3
1. Notificar al cliente: "Estamos sobre esto. Te aviso en X minutos."
2. Documentar inicio del incidente en INCIDENTS.md
3. Aplicar mitigación
4. Notificar resolución
5. Post-mortem en INCIDENTS.md
```

Adicionalmente:
- Crea INCIDENTS.md con un template vacío para registrar incidentes futuros.
- Confirma que ambos archivos están en raíz, no en alguna subcarpeta.

Reporta al final.
```

---

## S2-DOC-02 — Crear DEPLOY.md

```
Tarea: S2-DOC-02 de SPRINT.md.

Acciones:

1. Investiga el flujo real de deploy. Pregunta a Gabriel si lo desconoces:
   - ¿Push a main → Vercel auto-deploy?
   - ¿Manual desde CLI?
   - ¿Branch específico?
   - ¿Hay preview environments?

2. Crea DEPLOY.md en raíz con:

```markdown
# DEPLOY — presenciapro

## Flujo de producción
[Describir el flujo real — ej: "push a main → Vercel webhook → auto-deploy de apps/lifestyle"]

## Antes de hacer deploy
- [ ] Lint passing local
- [ ] Type-check passing local
- [ ] Migrations aplicadas en staging
- [ ] Variables de entorno verificadas en Vercel
- [ ] (Si es deploy mayor) backup manual previo

## Cómo deployar
[Pasos específicos]

## Cómo verificar deploy exitoso
1. Esperar status "Ready" en Vercel
2. Verificar /api/health responde 200
3. Login al dashboard de un business test
4. Mandar mensaje al bot de prueba
5. Verificar que appointments existentes se ven

## Rollback
[Pasos para rollback]

## Variables de entorno por ambiente
- Production: lista de env vars en Vercel (sin valores)
- Preview: si aplica
- Local: ver .env.local.example
```

Reporta al final.
```

---

## S2-DOC-03 — Crear ACCESS.md

```
Tarea: S2-DOC-03 de SPRINT.md.

IMPORTANTE: este documento NO va en el repo. NO commit. Vive en 1Password / Bitwarden de Gabriel.

Acciones de Claude Code:

1. Genera un TEMPLATE de ACCESS.md como archivo separado (puedes ponerlo en /tmp/ACCESS-TEMPLATE.md y mostrarlo en pantalla) que Gabriel pueda copiar a 1Password.

Template:

```markdown
# ACCESS — Cuentas y credenciales de presenciapro / Zentriq

> Documento sensible. NO commit a git. NO compartir por email/chat sin cifrado.
> Última actualización: {timestamp}

## Quién tiene acceso a qué (matrix)

| Cuenta | Owner | Admin secundario | Recovery |
|---|---|---|---|
| Vercel | Gabriel | [PENDIENTE definir] | Email de Gabriel |
| Supabase (proyecto presenciapro) | Gabriel | [PENDIENTE] | Email de Gabriel |
| Anthropic Console | Gabriel | — | Email de Gabriel |
| Meta Business Manager | Gabriel | [PENDIENTE] | — |
| Twilio (dev sandbox) | Gabriel | — | — |
| Dominio zentriq.mx (registrar) | Gabriel | — | Email de Gabriel |
| Cloudflare (DNS zentriq.mx) | Gabriel | — | — |
| GitHub (Gabollo69) | Gabriel | — | 2FA backup codes en 1Password |
| 1Password vault Zentriq | Gabriel | [PENDIENTE: 1 persona de confianza] | Emergency Kit impreso |
| Email contacto@zentriq.mx | Gabriel | — | Recovery a email personal |

## Cómo agregar a alguien a una cuenta

[Procedimiento específico por cuenta]

## Contacto de emergencia

Persona que tiene acceso de respaldo en caso de incapacidad de Gabriel:
- **Nombre:** [PENDIENTE definir]
- **Relación:** [familia / socio / abogado]
- **Tiene acceso a:** 1Password Emergency Kit
- **Su rol en emergencia:** notificar a clientes activos, mantener servicios pagos al día, contactar a abogado para sucesión del negocio
```

2. Genera una checklist para Gabriel:
   - [ ] Decidir quién es el contacto de emergencia (1 persona)
   - [ ] Configurar 1Password Emergency Kit con esa persona
   - [ ] Imprimir Emergency Kit y guardar en lugar físico seguro
   - [ ] Copiar este template a 1Password como nota cifrada
   - [ ] Llenar todos los [PENDIENTE] del template

3. NO crees este archivo en el repo. Solo muestra el template en pantalla.

4. Agrega a .gitignore una línea preventiva: `ACCESS.md` por si acaso.

Reporta al final.
```

---

## S3-UX-01 — Login muestra nombre del negocio

```
Tarea: S3-UX-01 de SPRINT.md.

Acciones:

1. Lee apps/lifestyle/src/app/login/page.tsx.

2. La página /login se accede normalmente con un query param o un token. Investiga cómo se llega ahí (proxy.ts, layout.tsx).

3. Modifica la página para que:
   - Si la sesión actual o el contexto permite identificar el business: lee businesses.name por slug o por token
   - Muestra ese nombre como h1 en lugar de "PresenciaPro"
   - Si la sesión es de organization: muestra el nombre de la organización
   - Si no hay contexto (login frío): mantén "PresenciaPro" como fallback

4. NO rompas el flujo de login. Es Server Component, lee del DB con service_role si es necesario.

5. Ajustar visualmente para que el nombre del negocio se vea bien (puede ser más largo que "PresenciaPro").

Criterios de aceptación:
- [ ] Login muestra nombre del negocio cuando aplica
- [ ] Fallback a PresenciaPro cuando no hay contexto
- [ ] No rompe login

Reporta al final.
```

---

## S3-UX-02 — Footer con soporte

```
Tarea: S3-UX-02 de SPRINT.md.

Acciones:

1. Localiza el footer del dashboard (apps/lifestyle/src/app/dashboard/.../Footer.tsx o equivalente, o si vive en layout.tsx).

2. Localiza Footer del mini-sitio (apps/lifestyle/src/components/site/Footer.tsx).

3. Agrega a ambos footers:
   - Texto "Soporte: contacto@zentriq.mx" con mailto: link
   - Link a /aviso-de-privacidad
   - Link a /terminos si existe (si no, omitir)
   - El footer del mini-sitio mantiene "Creado con presenciapro"

4. Mantén estilo visual consistente — no metas un menú gigante, solo una línea discreta.

Criterios de aceptación:
- [ ] Footer del dashboard tiene email de soporte
- [ ] Footer del mini-sitio tiene email de soporte + link al aviso
- [ ] Ambos visualmente discretos

Reporta al final.
```

---

## S3-UX-03 — error.tsx con email de soporte

```
Tarea: S3-UX-03 de SPRINT.md.

Acciones:

1. Lee los 4 error.tsx:
   - apps/lifestyle/src/app/error.tsx
   - apps/lifestyle/src/app/dashboard/error.tsx
   - apps/lifestyle/src/app/staff/error.tsx
   - apps/lifestyle/src/app/[slug]/error.tsx

2. En cada uno, agrega texto + link:
   "Si el problema persiste, escríbenos a contacto@zentriq.mx" con mailto: link.

3. El mailto: incluye en el subject el error.digest si existe:
   `mailto:contacto@zentriq.mx?subject=Error%20presenciapro%20${error.digest}`

4. Mantén el resto del componente igual.

Criterios de aceptación:
- [ ] 4 archivos modificados
- [ ] mailto incluye digest para correlación
- [ ] No revelar stack trace al usuario

Reporta al final.
```

---

## S3-UX-04 — Favicon y metadata

```
Tarea: S3-UX-04 de SPRINT.md.

Acciones:

1. Pregunta a Gabriel si tiene un logo/icono de presenciapro listo. Si no, propón:
   - Icono temporal: letra "P" o "p" estilizada en color base del producto, o un símbolo simple
   - Generar con tooling como https://favicon.io o usar SVG simple

2. Una vez con asset:
   - apps/lifestyle/public/favicon.ico (32x32)
   - apps/lifestyle/public/icon.png o apps/lifestyle/src/app/icon.png (512x512)
   - apps/lifestyle/public/apple-touch-icon.png (180x180)
   - apps/lifestyle/public/manifest.json con name, short_name, theme_color

3. En apps/lifestyle/src/app/layout.tsx (root):
   - metadata: { metadataBase, title, description, openGraph, twitter }
   - title default: "presenciapro — gestión de barbería y servicios"

4. Para el mini-sitio /[slug], la metadata debe seguir siendo personalizada por negocio (NO sobrescribir con "presenciapro").

5. Probar en https://realfavicongenerator.net o en navegador (DevTools → Application → Manifest).

Criterios de aceptación:
- [ ] Favicon visible en pestaña
- [ ] Apple touch icon configurado
- [ ] Manifest.json válido
- [ ] OG tags correctos para dashboard / login (no para /[slug])

Reporta al final.
```

---

## S3-OPS-01 — Endpoint /api/health + UptimeRobot

```
Tarea: S3-OPS-01 de SPRINT.md.

Acciones:

1. Crea apps/lifestyle/src/app/api/health/route.ts:

```typescript
export async function GET() {
  const checks = {
    timestamp: new Date().toISOString(),
    status: 'ok' as 'ok' | 'degraded' | 'down',
    supabase: 'ok' as 'ok' | 'fail',
  };
  
  try {
    // Ping mínimo a Supabase
    const supabase = createServerClient();  // Ajustar import
    const { error } = await supabase.from('businesses').select('id').limit(1);
    if (error) checks.supabase = 'fail';
  } catch {
    checks.supabase = 'fail';
  }
  
  if (checks.supabase === 'fail') checks.status = 'down';
  
  return Response.json(checks, { status: checks.status === 'ok' ? 200 : 503 });
}
```

2. Probar local: `curl localhost:3002/api/health` debe responder 200 con JSON.

3. Tras deploy, Gabriel:
   - Crea cuenta en uptimerobot.com (free)
   - Crea monitor HTTP: URL `https://[prod-url]/api/health`, interval 5 min, expected status 200
   - Configura alerta a WhatsApp (via Telegram bot bridge o email-to-SMS) o email
   - Comparte el status page público con Claude Code si desea documentarlo

4. Documenta URL del status page en RUNBOOK.md → Información clave.

Criterios de aceptación:
- [ ] /api/health funcional
- [ ] Retorna 200/503 según estado
- [ ] UptimeRobot configurado (humano)
- [ ] Status page documentado en RUNBOOK

Reporta al final.
```

---

## S3-OPS-02 — CI/CD mínimo

```
Tarea: S3-OPS-02 de SPRINT.md.

Acciones:

1. Crea .github/workflows/ci.yml:

```yaml
name: CI
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]

jobs:
  lint-and-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
      - run: npm ci
      - run: npm run lint --workspace=apps/lifestyle
      - run: npm run type-check --workspace=apps/lifestyle
```

2. Ajustar versión de Node si el repo declara otra.

3. Probar localmente que los comandos pasan:
   - npm run lint --workspace=apps/lifestyle
   - npm run type-check --workspace=apps/lifestyle
   
   Si fallan, repórtalo a Gabriel ANTES de pushear el workflow.

4. Gabriel decide si activar branch protection en main requiriendo CI passing. Recomendación: sí.

5. Si todo pasa local, el workflow puede subirse. Si no, primero arreglar los problemas que detecte localmente.

Criterios de aceptación:
- [ ] Workflow CI activo
- [ ] Lint y type-check pasan en main actual
- [ ] (Opcional) Branch protection en main

Reporta al final.
```

---

## S3-OPS-03 — Limpiar console.error con posible PII

```
Tarea: S3-OPS-03 de SPRINT.md.

Acciones:

1. En packages/engine/src/, busca los 3-4 console.error identificados en Phase 4 sección 2:
   - bot/route.ts:415 (apps/lifestyle/src/app/api/bot/route.ts)
   - awaitingBookingName.ts:172
   - awaitingConfirmation.ts:189
   - notifications/messaging.ts:119

2. Para cada uno, reemplaza con logBotError() o equivalente que use maskPhone para cualquier número y estructure el error en JSON.

3. Patrón estándar:

```typescript
import { logBotError, maskPhone } from './utils/logger';

// Antes:
console.error('[ctx] failed:', err);

// Después:
logBotError({
  ts: new Date().toISOString(),
  service: 'engine',
  business_id: businessId,  // si disponible
  customer_phone: customerPhone ? maskPhone(customerPhone) : undefined,
  error_message: err instanceof Error ? err.message : String(err),
  context: 'awaitingBookingName',
});
```

4. Si err.message puede contener teléfono (errores de Meta API), aplicar maskPhone al string.

5. NO hagas refactor masivo del logger. Solo cambia esos 3-4 puntos.

Criterios de aceptación:
- [ ] 3-4 puntos identificados convertidos a logBotError
- [ ] PII masked
- [ ] No introducir nuevos console.error sin masking

Reporta al final con los archivos modificados.
```

---

## S4-OPS-01 — Dry run de onboarding completo

```
Tarea: S4-OPS-01 de SPRINT.md.

Acciones:

1. Gabriel define un negocio dummy para el dry run. Ejemplo: "Barbería Test ABC", slug 'barberia-test-abc'.

2. Gabriel + Claude Code ejecutan el flujo completo SIGUIENDO ÚNICAMENTE el script y el checklist generado:
   - Llenar config.json para barberia-test-abc
   - Correr scripts/onboard-business.ts --config config.json
   - Seguir cada paso del checklist generado en onboarding/barberia-test-abc-checklist.md
   - NO improvisar, NO saltarse pasos, NO hacer cosas no documentadas

3. Por cada fricción encontrada (paso ambiguo, error, paso faltante), Claude Code:
   - Documenta en SPRINT.md → Bitácora con detalle
   - Si es mejora al script: la implementa
   - Si es mejora al checklist: la implementa
   - Si requiere decisión: pregunta a Gabriel

4. Iterar hasta que el onboarding sea "ejecutable por una persona razonable siguiendo el checklist sin ayuda externa".

5. Al final, eliminar el negocio dummy de la DB (DELETE en orden de FKs) y de Vercel/Meta si aplicó algo.

Criterios de aceptación:
- [ ] Onboarding completo end-to-end ejecutado
- [ ] Todas las fricciones documentadas e idealmente resueltas
- [ ] Script y checklist iterados a estado producible
- [ ] Negocio dummy limpiado

Reporta al final.
```

---

## S4-OPS-02 — Restore drill

```
Tarea: S4-OPS-02 de SPRINT.md.

Acciones:

1. Asegúrate de tener al menos un backup en el bucket de S3-OPS-01.

2. Gabriel crea un proyecto Supabase staging (puede ser Free tier, solo para el drill).

3. Sigue el procedimiento de RUNBOOK.md → sección 4 (Restaurar base de datos desde backup) paso por paso. NO improvisar.

4. Cronometra cada fase:
   - Descarga del backup: __ min
   - Desencriptado y descompresión: __ min
   - Restauración a staging: __ min
   - Verificación de integridad: __ min
   - **Total RTO real:** __ min

5. Verifica:
   - Conteos de filas coinciden con producción (al menos del momento del backup)
   - Un login de prueba funciona en staging
   - Una appointment se puede leer correctamente

6. Documenta el RTO real en RUNBOOK.md sección 4.

7. Si el RTO es > 30 min, declarar este número como compromiso real en el contrato del piloto (NO prometer mejor de lo que realmente se logra).

8. Eliminar proyecto staging al terminar para no acumular costos.

Criterios de aceptación:
- [ ] Restore exitoso end-to-end
- [ ] RTO documentado
- [ ] Verificación funcional pasada

Reporta al final.
```

---
