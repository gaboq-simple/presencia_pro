// ─── Señales — capa de datos server (D7) ──────────────────────────────────────
// Junta en DOS queries por negocio lo que `lib/senales.ts` (puro) necesita para
// las cuatro señales. Los cortes salen de `corteData` (misma lectura que usa la
// card del dueño) y los días de caja se arman acá agrupando por día LOCAL.
//
// Por qué no reusar `getInsumosDelCorte` por día: son 14 días × 2 queries × N
// negocios. Una sola query por tabla sobre toda la ventana y el agrupado en
// memoria hace lo mismo con dos viajes.
//
// 🔴 SCOPE: `tenantDb` con el business_id que el barrido está recorriendo.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';
import { getCortesDesde } from '@/lib/corteData';
import { computeCobrado } from '@/lib/cobrado';
import { VENTANA_DIAS, type EntradaSenales, type DiaDeCaja, type CorteParaSenal } from '@/lib/senales';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type CitaRow = {
  completed_at:  string;
  price_charged: number | string | null;
  service:       { price: number | string } | null;
};
type MovRow = { occurred_on: string; type: string; amount: number | string };

function restarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - dias);
  return d.toISOString().slice(0, 10);
}

/**
 * Todo lo que las señales necesitan de un negocio, en la ventana de 14 días.
 *
 * `ownerLastSeenAt` viaja tal cual (puede ser null: el dueño nunca abrió la app,
 * que es precisamente la señal 4).
 */
export async function getEntradaSenales(
  businessId: string,
  timezone: string,
  ownerLastSeenAt: string | null,
  hoy: string = todayStrInTz(timezone),
): Promise<EntradaSenales> {
  const desde = restarDias(hoy, VENTANA_DIAS - 1);
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);

  const { start } = localDayRangeUtc(desde, timezone);
  const { end }   = localDayRangeUtc(hoy, timezone);

  const [cortes, citasRes, movsRes] = await Promise.all([
    getCortesDesde(businessId, desde),
    db
      .table('appointments')
      .select('completed_at, price_charged, service:service_id(price)')
      .eq('status', 'completed')
      .gte('completed_at', start)
      .lt('completed_at', end),
    db
      .table('caja_movimientos')
      .select('occurred_on, type, amount')
      .gte('occurred_on', desde)
      .lte('occurred_on', hoy),
  ]);

  if (citasRes.error) throw new Error(`getEntradaSenales citas: ${citasRes.error.message}`);
  if (movsRes.error)  throw new Error(`getEntradaSenales movimientos: ${movsRes.error.message}`);

  // Agrupado por día LOCAL del negocio — la misma atribución de D5/D6: una cita
  // cuenta el día en que se COBRÓ, no el que se agendó.
  const citasPorDia = new Map<string, { amount: number }[]>();
  for (const r of (citasRes.data ?? []) as unknown as CitaRow[]) {
    const dia = todayStrInTz(timezone, new Date(r.completed_at));
    const lista = citasPorDia.get(dia) ?? [];
    lista.push({ amount: Number(r.price_charged ?? r.service?.price ?? 0) });
    citasPorDia.set(dia, lista);
  }

  const movsPorDia = new Map<string, { type: string; amount: number }[]>();
  for (const r of (movsRes.data ?? []) as unknown as MovRow[]) {
    const lista = movsPorDia.get(r.occurred_on) ?? [];
    lista.push({ type: r.type, amount: Number(r.amount) });
    movsPorDia.set(r.occurred_on, lista);
  }

  const dias: DiaDeCaja[] = [];
  for (let i = 0; i < VENTANA_DIAS; i++) {
    const fecha = restarDias(hoy, i);
    const citas = citasPorDia.get(fecha) ?? [];
    const movs  = movsPorDia.get(fecha) ?? [];
    dias.push({
      fecha,
      cobrado: computeCobrado(citas, movs).total,
      // Cuenta de movimientos "fuera de agenda" registrados ese día. Las
      // contraentradas cuentan como registro: son actividad de caja, y la señal
      // pregunta si ALGUIEN estaba registrando, no cuánto neto quedó.
      movimientos: movs.length,
    });
  }

  return {
    cortes: cortes as CorteParaSenal[],
    dias,
    ownerLastSeenAt,
    hoy,
  };
}
