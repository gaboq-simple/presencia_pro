-- ─── Migration 010: Supabase Storage — bucket staff-photos ──────────────────
-- Crea el bucket público 'staff-photos' con límites de tipo y tamaño.
-- Políticas RLS sobre storage.objects para aislamiento por business_id.
-- Las escrituras desde la API route usan service_role_key (bypasa RLS),
-- pero las políticas garantizan que ningún cliente autenticado pueda
-- escribir en el folder de otro negocio.

-- ─── Bucket ───────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'staff-photos',
  'staff-photos',
  true,
  2097152,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public            = true,
  file_size_limit   = 2097152,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- ─── Políticas RLS sobre storage.objects ─────────────────────────────────────

-- SELECT: público — cualquiera puede leer (bucket es public)
DROP POLICY IF EXISTS "staff-photos: public read"  ON storage.objects;
CREATE POLICY "staff-photos: public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'staff-photos');

-- INSERT: solo admin activo del business_id que coincide con el primer segmento
-- del path ({business_id}/{staff_id}.{ext})
DROP POLICY IF EXISTS "staff-photos: admin insert" ON storage.objects;
CREATE POLICY "staff-photos: admin insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'staff-photos'
    AND EXISTS (
      SELECT 1 FROM public.staff
      WHERE auth_id       = auth.uid()
        AND role          = 'admin'
        AND active        = true
        AND business_id::text = split_part(name, '/', 1)
    )
  );

-- UPDATE: solo admin del mismo business_id
DROP POLICY IF EXISTS "staff-photos: admin update" ON storage.objects;
CREATE POLICY "staff-photos: admin update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'staff-photos'
    AND EXISTS (
      SELECT 1 FROM public.staff
      WHERE auth_id       = auth.uid()
        AND role          = 'admin'
        AND active        = true
        AND business_id::text = split_part(name, '/', 1)
    )
  );

-- DELETE: solo admin del mismo business_id
DROP POLICY IF EXISTS "staff-photos: admin delete" ON storage.objects;
CREATE POLICY "staff-photos: admin delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'staff-photos'
    AND EXISTS (
      SELECT 1 FROM public.staff
      WHERE auth_id       = auth.uid()
        AND role          = 'admin'
        AND active        = true
        AND business_id::text = split_part(name, '/', 1)
    )
  );
