// ─── Server action de cabos sueltos (D3) ─────────────────────────────────────
// Módulo propio a propósito: `assistant-actions.ts` ya carga con las mutaciones
// de citas y los cabos son una LECTURA de otra ventana temporal (14 días, no el
// día en curso). Mezclarlos haría que cada cambio de una cosa obligara a releer
// la otra.
//
// Solo lee. La resolución de un cabo la hacen las actions que ya existen
// (completeAppointment / noShowAppointment), con sus gates intactos.

'use server';

import { getCurrentSession } from '@/lib/auth';
import { getCabos } from '@/lib/cabosData';
import type { CitaSinResolver } from '@/lib/cabos';

export type CaboSuelto = CitaSinResolver;

/**
 * Cabos sueltos del negocio de la sesión. El `business_id` sale de la SESIÓN,
 * nunca del cliente — el mismo contrato que el resto de las actions del panel.
 */
export async function listarCabos(): Promise<{ total: number; lista: CaboSuelto[] }> {
  const session = await getCurrentSession();
  if (!session) throw new Error('Unauthorized');

  const cabos = await getCabos(session.business_id);
  return { total: cabos.total, lista: cabos.lista };
}
