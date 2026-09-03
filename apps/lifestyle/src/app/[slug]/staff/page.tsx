// ─── /[slug]/staff — Login de barbero scopeado por negocio (MT-02) ────────────
// Server Component. Resuelve el negocio desde el slug de la URL y renderiza el
// PinForm con ESE contexto, para que el PIN se valide DENTRO del negocio correcto.
//
// Por qué existe: el PIN es UNIQUE(business_id, pin) — único POR negocio, no
// global. El login pelado (/staff, WHERE pin=$1 LIMIT 1) no tenía contexto de
// negocio → con N clientes, dos barberos con el mismo PIN colisionaban y el
// login caía en el negocio equivocado en silencio. Scopear por slug lo cierra.
//
// Slug desconocido/inactivo → notFound() (mismo patrón que el minisite /[slug]).
// REGLA: service_role_key nunca sale al cliente.

import { notFound } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { getCurrentSession } from '@/lib/auth';
import PinForm from '@/components/staff/PinForm';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

async function getBusinessBySlug(slug: string): Promise<{ id: string; name: string } | null> {
  const supabase = getServiceClient();
  const { data, error } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('slug', slug)
    .eq('active', true)
    .maybeSingle();
  if (error) throw new Error(`getBusinessBySlug failed: ${error.message}`);
  return data as { id: string; name: string } | null;
}

export default async function SlugStaffPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<React.ReactElement> {
  const { slug } = await params;
  const business = await getBusinessBySlug(slug);
  if (!business) notFound();

  // Ya hay sesión de ESTE negocio → NO se redirige (S9-SEC-01). Antes sí, y eso
  // dejaba el teclado de PIN inalcanzable: entrado un perfil, esa computadora no
  // podía entrar con otro hasta que la cookie expirara a los 7 días. Ahora la
  // ruta es el SELECTOR DE PERFIL: "Continuar como X" para el caso diario (un
  // tap) y el teclado para entrar como otra persona, en la misma pantalla.
  //
  // Sesión de OTRO negocio → no se ofrece continuar: acá no aplica. Teclado limpio.
  const session = await getCurrentSession();
  const sesionDeEsteNegocio =
    session && session.type === 'business' && session.business_id === business.id
      ? session
      : null;

  return (
    <PinForm
      businessSlug={slug}
      businessName={business.name}
      sesionActual={
        sesionDeEsteNegocio
          ? {
              nombre:  sesionDeEsteNegocio.name || 'tu sesión',
              rol:     sesionDeEsteNegocio.role,
              destino: sesionDeEsteNegocio.role === 'barber' ? '/staff' : '/dashboard',
            }
          : null
      }
    />
  );
}
