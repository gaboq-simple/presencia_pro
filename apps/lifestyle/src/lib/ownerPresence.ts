// ─── ownerPresence — la única analítica de uso que existe (D6) ────────────────
// `businesses.owner_last_seen_at` responde una sola pregunta: ¿el dueño sigue
// abriendo la app? Es la señal 4 de la tabla "Cómo se ve el fracaso" del plan, y
// el modo de falla que vigila —el dueño ausente que nunca vuelve— hoy sería
// invisible hasta la baja.
//
// Lo mueve la sesión ADMINISTRATIVA (rol `admin`, que es con el que el dueño
// entra por email — el CHECK de `staff` solo admite admin/barber/assistant y
// `'owner'` ya no existe en ninguna sesión viva). El asistente queda fuera a
// propósito: vive adentro del negocio y su visita no dice nada del dueño, que es
// a quien se está midiendo.
//
// Matiz honesto para quien lea la señal: en un local con encargado, ese encargado
// también es `admin`. Hoy no hay ninguno y el único admin del demo es el dueño;
// si un día los hay, la señal pasa a ser "alguien con autoridad administrativa
// abrió la app" y hay que afinarla (por `staff_id`, no por rol).

import { createClient } from '@supabase/supabase-js';

/**
 * Marca que el dueño acaba de cargar su dashboard. Best-effort ABSOLUTO: no
 * lanza, no bloquea, no se espera. Si la escritura falla, se pierde un punto de
 * una serie — el costo correcto frente a romper la carga de la página.
 */
export async function touchOwnerLastSeen(businessId: string): Promise<void> {
  try {
    const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !key) return;
    // `businesses` es la raíz del tenant (sin columna business_id): se escribe
    // por su propio id, que ya viene de la sesión.
    await createClient(url, key)
      .from('businesses')
      .update({ owner_last_seen_at: new Date().toISOString() })
      .eq('id', businessId);
  } catch {
    // Silencio a propósito: ver el contrato de arriba.
  }
}
