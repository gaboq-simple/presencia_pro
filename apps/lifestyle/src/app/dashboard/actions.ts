// ─── Dashboard Server Actions ─────────────────────────────────────────────────
// Mutaciones de citas desde el dashboard admin.
// Cada acción verifica sesión + rol admin antes de modificar datos.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { requireOwnerOrAdmin } from '@/lib/auth';
import { tenantDb } from '@/lib/tenantDb';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/**
 * Actualiza el status de una cita a 'completed' o 'no_show'.
 * Solo accesible para staff con role='admin' del negocio dueño de la cita.
 */
export async function updateAppointmentStatus(
  appointmentId: string,
  status: 'completed' | 'no_show',
): Promise<void> {
  // 1. Verificar sesión — autoridad admin del negocio (owner o admin), vía
  //    getCurrentSession (token o Supabase Auth). Rechaza barber/assistant, así
  //    esta acción sigue siendo inalcanzable para el barbero (sin abrir agujero).
  const auth = await requireOwnerOrAdmin();
  if (!auth.ok) throw new Error(auth.status === 401 ? 'Unauthorized' : 'Forbidden');

  // 2. Actualizar — el helper inyecta .eq('business_id') → aislamiento garantizado.
  //    modified_by_staff_id firma el audit: el trigger toma el actor de esa columna
  //    (queda actor_type='staff' + actor_staff_id real, no 'unknown').
  const supabase = getServiceClient();
  const { error } = await tenantDb(supabase, auth.businessId)
    .table('appointments')
    .update({ status, modified_by_staff_id: auth.staffId })
    .eq('id', appointmentId);

  if (error) throw new Error(`updateAppointmentStatus failed: ${error.message}`);

  revalidatePath('/dashboard');
}
