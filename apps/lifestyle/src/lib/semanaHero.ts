// ─── Semana — capa de datos del héroe de Panorama (dv3-3') ────────────────────
// Dos queries sobre la ventana de dos semanas (la actual y la pasada), agrupadas
// por día LOCAL del negocio, más el corte de HOY para el chip del descuadre.
//
// La atribución es la MISMA de toda la capa de dinero: una cita cuenta el día en
// que se cobró (`completed_at` local), no el que se agendó, y las entradas de
// caja cuentan por `occurred_on`. Es la regla de `lib/cobrado.ts`, y por eso el
// héroe de la semana y el titular de hoy no pueden contradecirse.
//
// 🔴 SCOPE: `tenantDb` con el business_id de la sesión.

import { createClient } from '@supabase/supabase-js';
import { tenantDb } from '@/lib/tenantDb';
import { localDayRangeUtc, todayStrInTz } from '@/lib/dayWindow';
import { computeCobrado } from '@/lib/cobrado';
import { computeSemanaHero, type DiaSemana, type SemanaHero } from '@/lib/semanaCalc';
import { getCortesDelDia, type CorteRow } from '@/lib/corteData';
import { resolverCortes } from '@/lib/corte';

function getServiceClient() {
  const url = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
  if (!url || !key) throw new Error('Supabase env vars not set');
  return createClient(url, key);
}

type CitaRow = { completed_at: string; price_charged: number | string | null; service: { price: number | string } | null };
type MovRow  = { occurred_on: string; type: string; amount: number | string };
type AvailRow = { day_of_week: number };

function sumarDias(fecha: string, dias: number): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

/** El lunes de la semana de `fecha`. La semana del local va lunes → domingo. */
export function lunesDe(fecha: string): string {
  const d = new Date(`${fecha}T00:00:00Z`);
  const dow = d.getUTCDay();                 // 0=domingo
  return sumarDias(fecha, dow === 0 ? -6 : 1 - dow);
}

export type SemanaHeroData = {
  hero: SemanaHero;
  /** El corte de HOY ya resuelto (la última fila manda), o null si no hubo. */
  corteHoy: CorteRow | null;
  hoy: string;
};

/**
 * El héroe de la semana + el chip del corte de hoy.
 *
 * El chip es la mitad que la capa de dinero le agregó a este paso: el titular
 * dice cuánto se cobró y el chip dice si eso cuadró contra el cajón. Sin él, el
 * número de la semana volvería a ser un número sin contraste.
 */
export async function getSemanaHero(businessId: string, timezone: string): Promise<SemanaHeroData> {
  const supabase = getServiceClient();
  const db = tenantDb(supabase, businessId);

  const hoy = todayStrInTz(timezone);
  const lunes = lunesDe(hoy);
  const lunesPasado = sumarDias(lunes, -7);

  const { start } = localDayRangeUtc(lunesPasado, timezone);
  const { end }   = localDayRangeUtc(hoy, timezone);

  // `staff_availability` NO tiene business_id (su aislamiento es transitivo por
  // staff_id, ver el contrato de tenantDb): se acota con los ids del negocio,
  // que sí salen de una query scopeada.
  const { data: staffRows } = await db.table('staff').select('id').eq('active', true);
  const staffIds = ((staffRows ?? []) as unknown as { id: string }[]).map((s) => s.id);

  const [citasRes, movsRes, availRes, cortes] = await Promise.all([
    db
      .table('appointments')
      .select('completed_at, price_charged, service:service_id(price)')
      .eq('status', 'completed')
      .gte('completed_at', start)
      .lt('completed_at', end),
    db
      .table('caja_movimientos')
      .select('occurred_on, type, amount')
      .gte('occurred_on', lunesPasado)
      .lte('occurred_on', hoy),
    // Qué días abre el negocio: un día sin NINGÚN barbero con horario activo no
    // es un día en cero, es un día cerrado — y se pinta distinto (hatch).
    staffIds.length === 0
      ? Promise.resolve({ data: [] as unknown[] })
      : supabase.from('staff_availability').select('day_of_week').in('staff_id', staffIds).eq('is_active', true),
    getCortesDelDia(businessId, hoy),
  ]);

  if (citasRes.error) throw new Error(`getSemanaHero citas: ${citasRes.error.message}`);
  if (movsRes.error)  throw new Error(`getSemanaHero movimientos: ${movsRes.error.message}`);

  const citasPorDia = new Map<string, { amount: number }[]>();
  for (const r of (citasRes.data ?? []) as unknown as CitaRow[]) {
    const dia = todayStrInTz(timezone, new Date(r.completed_at));
    const l = citasPorDia.get(dia) ?? [];
    l.push({ amount: Number(r.price_charged ?? r.service?.price ?? 0) });
    citasPorDia.set(dia, l);
  }

  const movsPorDia = new Map<string, { type: string; amount: number }[]>();
  for (const r of (movsRes.data ?? []) as unknown as MovRow[]) {
    const l = movsPorDia.get(r.occurred_on) ?? [];
    l.push({ type: r.type, amount: Number(r.amount) });
    movsPorDia.set(r.occurred_on, l);
  }

  const diasAbiertos = new Set(((availRes.data ?? []) as unknown as AvailRow[]).map((a) => a.day_of_week));

  const armar = (lunesDeLaSemana: string): DiaSemana[] =>
    Array.from({ length: 7 }, (_, i) => {
      const fecha = sumarDias(lunesDeLaSemana, i);
      const dow = new Date(`${fecha}T00:00:00Z`).getUTCDay();
      return {
        fecha,
        cobrado: computeCobrado(citasPorDia.get(fecha) ?? [], movsPorDia.get(fecha) ?? []).total,
        // Sin filas de horario en toda la BD (negocio nuevo) NO se pinta todo
        // cerrado: eso sería una semana en hatch por falta de configuración.
        cerrado: diasAbiertos.size > 0 && !diasAbiertos.has(dow),
      };
    });

  const resueltos = resolverCortes(cortes);

  return {
    hero: computeSemanaHero({ estaSemana: armar(lunes), semanaPasada: armar(lunesPasado), hoy }),
    corteHoy: resueltos[0]?.corte ?? null,
    hoy,
  };
}
