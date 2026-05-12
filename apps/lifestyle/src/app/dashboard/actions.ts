// ─── Dashboard Server Actions ─────────────────────────────────────────────────
// Mutaciones de citas desde el dashboard admin.
// Cada acción verifica sesión + rol admin antes de modificar datos.

'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@supabase/supabase-js';
import { createClient as createAuthClient } from '@/lib/supabase/server';

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
  const { data: staffRecord, error: staffError } = await supabase
    .from('staff')
    .select('role, business_id')
    .eq('auth_id', user.id)
    .eq('active', true)
    .maybeSingle();

  if (staffError || !staffRecord || staffRecord.role !== 'admin') {
    throw new Error('Forbidden');
  }

  // 3. Actualizar — el filtro por business_id garantiza aislamiento
  const { error } = await supabase
    .from('appointments')
    .update({ status })
    .eq('id', appointmentId)
    .eq('business_id', staffRecord.business_id as string);

  if (error) throw new Error(`updateAppointmentStatus failed: ${error.message}`);

  revalidatePath('/dashboard');
}
