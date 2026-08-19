// ─── optOutLookup — con qué el guard comprueba la baja (S8-PER-01 · P3) ──────
// Server-only. Implementa la interfaz mínima `OptOutLookup` que el engine pide
// para los envíos proactivos, sin meterle supabase-js al engine.
//
// La consulta es la que el índice parcial de P1 fue creado para servir
// (`idx_customers_business_active_contactable`): un `head: true` que no trae
// filas, solo el conteo.
//
// **Un teléfono desconocido NO está dado de baja.** Si no hay fila en
// `customers` para ese número, `isOptedOut` devuelve `false`. Eso es correcto y
// conviene decir por qué: todo lo proactivo sale de `customers`, así que un
// número sin fila no puede recibir nada proactivo de todos modos; y devolver
// `true` por las dudas bloquearía envíos legítimos a clientes recién creados en
// la misma transacción.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import type { OptOutLookup } from '@presenciapro/engine/notifications';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

/**
 * El lookup que se le pasa a `sendWhatsAppMeta` con `purpose: 'proactive'`.
 *
 * Lanza si la consulta falla, y eso es deliberado: el guard trata el error como
 * supresión (falla CERRADO). Tragarse el error acá y devolver `false` haría lo
 * contrario — mandarle a alguien de quien no sabemos si se dio de baja.
 */
export const optOutLookup: OptOutLookup = {
  async isOptedOut(businessId: string, phone: string): Promise<boolean> {
    const { count, error } = await tenantDb(getServiceClient(), businessId)
      .table('customers')
      .select('id', { count: 'exact', head: true })
      .eq('phone', phone)
      .not('opted_out_at', 'is', null);

    if (error) throw new Error(`optOutLookup failed: ${error.message}`);
    return (count ?? 0) > 0;
  },
};
