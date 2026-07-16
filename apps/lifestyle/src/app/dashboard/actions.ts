// ─── Dashboard Server Actions ─────────────────────────────────────────────────
// Mutaciones de citas desde el dashboard admin.
// Cada acción verifica sesión + rol admin antes de modificar datos.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';
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
  // 1. Verificar sesión
  const authClient = await createAuthClient();
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) throw new Error('Unauthorized');

  // 2. Verificar rol admin y obtener business_id
  const supabase = getServiceClient();
  // eslint-disable-next-line no-restricted-syntax -- resolución de identidad del actor por auth_id (único global): el business_id SALE de acá, no se puede scopear por él.
  const { data: staffRecord, error: staffError } = await supabase
    .from('staff')
    .select('role, business_id')
    .eq('auth_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (staffError || !staffRecord || staffRecord.role !== 'admin') {
    throw new Error('Forbidden');
  }

  // 3. Actualizar — el helper inyecta .eq('business_id') → aislamiento garantizado
  const { error } = await tenantDb(supabase, staffRecord.business_id as string)
    .table('appointments')
    .update({ status })
    .eq('id', appointmentId);

  if (error) throw new Error(`updateAppointmentStatus failed: ${error.message}`);

  revalidatePath('/dashboard');
}
