-- ─── Migration 045: cerrar enumeración cross-tenant de 'staff-photos' (MT-05) ──
-- La migración 010 creó la policy SELECT "staff-photos: public read" con
-- USING (bucket_id = 'staff-photos') — sin scope de tenant. En un bucket PÚBLICO
-- esa policy es redundante para el serving (las fotos se sirven por URL pública
-- vía getPublicUrl → /object/public/..., que NO consulta RLS) y para el
-- upload/remove (API route con service_role, que bypassa RLS). Lo único que
-- habilitaba era que cualquier cliente anon LISTARA todos los objetos del bucket
-- → enumeración de las fotos de staff de TODOS los negocios (leak cross-tenant,
-- flagged por el advisor de Supabase).
--
-- Fix: eliminar la policy SELECT. El bucket sigue público (las fotos se muestran
-- igual por URL pública); las 3 policies admin (insert/update/delete, scopeadas
-- por business_id vía split_part(name,'/',1)) se conservan intactas.
--
-- Aplicada al remoto vía MCP apply_migration; este archivo queda como registro.
-- Verificado por ruta real: anon LIST del bucket devuelve [] tras el drop, y la
-- URL pública de un objeto sigue sirviendo 200.

DROP POLICY IF EXISTS "staff-photos: public read" ON storage.objects;
