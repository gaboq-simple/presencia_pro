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
 * Bloquea DOS cosas, no una — la baja y la ausencia de consentimiento:
 *
 *   · `opted_out_at IS NOT NULL` — el titular pidió la baja (P2);
 *   · `consented_via = 'pending_notice'` o `consent_at IS NULL` — **nunca vio el
 *     aviso** (P4). El primero es el alta manual, que existe porque alguien
 *     tecleó su nombre; el segundo son los clientes anteriores a la migración
 *     037, a los que no se les hizo backfill por decisión explícita. Si el guard
 *     solo mirara la baja, el agujero se mudaría de lugar en vez de cerrarse:
 *     hoy `consent_at IS NULL` no bloquea nada.
 *
 * Lanza si la consulta falla, y eso es deliberado: el guard trata el error como
 * supresión (falla CERRADO). Tragarse el error acá y devolver `false` haría lo
 * contrario — mandarle a alguien de quien no sabemos si se dio de baja.
 */
export const optOutLookup: OptOutLookup = {
  async blockedReason(businessId: string, phone: string): Promise<string | null> {
    const { data, error } = await tenantDb(getServiceClient(), businessId)
      .table('customers')
      .select('opted_out_at, consent_at, consented_via')
      .eq('phone', phone)
      .maybeSingle();

    if (error) throw new Error(`optOutLookup failed: ${error.message}`);
    // Teléfono sin fila: no bloquea. Todo lo proactivo sale de `customers`, así
    // que un número sin fila no puede recibir nada de todos modos, y bloquearlo
    // frenaría altas recién creadas en la misma transacción.
    if (!data) return null;

    const row = data as { opted_out_at: string | null; consent_at: string | null; consented_via: string | null };
    if (row.opted_out_at !== null) return 'el titular se dio de baja';
    if (row.consent_at === null || row.consented_via === 'pending_notice') {
      return 'el titular todavía no vio el aviso de privacidad';
    }
    return null;
  },
};
