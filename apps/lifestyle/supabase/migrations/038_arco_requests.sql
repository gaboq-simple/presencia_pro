-- ─── Migration 038: arco_requests — derechos ARCO (LFPDPPP Art. 22-25) ──────
-- Almacena solicitudes ARCO (Acceso, Rectificación, Cancelación, Oposición).
-- El equipo de Zentriq las procesa manualmente desde el panel admin o por email.
-- business_id es nullable: una solicitud puede venir de un número no registrado.

CREATE TABLE IF NOT EXISTS public.arco_requests (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_phone    text        NOT NULL,
  customer_name     text,
  customer_email    text,
  request_type      text        NOT NULL
    CHECK (request_type IN ('acceso', 'rectificacion', 'cancelacion', 'oposicion')),
  description       text,
  status            text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed', 'rejected')),
  resolved_at       timestamptz,
  resolved_by       uuid        REFERENCES public.staff(id) ON DELETE SET NULL,
  resolution_notes  text,
  business_id       uuid        REFERENCES public.businesses(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Índice para búsquedas por negocio y teléfono
CREATE INDEX IF NOT EXISTS idx_arco_requests_business_id ON public.arco_requests(business_id);
CREATE INDEX IF NOT EXISTS idx_arco_requests_phone       ON public.arco_requests(customer_phone);

-- RLS
ALTER TABLE public.arco_requests ENABLE ROW LEVEL SECURITY;

-- INSERT: solo via service_role (API route) — anon no puede insertar directamente
-- (la API Route usa service_role_key que bypasa RLS)

-- SELECT: cualquier staff del negocio puede ver las solicitudes de su business
CREATE POLICY "ls_arco_requests_select" ON public.arco_requests
  FOR SELECT
  USING (
    business_id IS NULL
    OR business_id = (
      SELECT s.business_id FROM public.staff s
      WHERE s.auth_id = auth.uid()
      LIMIT 1
    )
  );

-- UPDATE: solo admin del negocio puede actualizar status / notas de resolución
CREATE POLICY "ls_arco_requests_update_admin" ON public.arco_requests
  FOR UPDATE
  USING (
    business_id = (
      SELECT s.business_id FROM public.staff s
      WHERE s.auth_id = auth.uid()
        AND s.role = 'admin'
      LIMIT 1
    )
  )
  WITH CHECK (
    business_id = (
      SELECT s.business_id FROM public.staff s
      WHERE s.auth_id = auth.uid()
        AND s.role = 'admin'
      LIMIT 1
    )
  );

COMMENT ON TABLE public.arco_requests IS
  'Solicitudes ARCO de titulares de datos. Procesadas manualmente en máximo 20 días hábiles (LFPDPPP Art. 24).';
